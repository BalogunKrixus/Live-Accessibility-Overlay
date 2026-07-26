/**
 * Shared namespace + DOM primitives.
 *
 * Injected files share one isolated-world global rather than using ES modules,
 * because declarative and programmatic content scripts cannot use `import`.
 */
(() => {
  const LAO = (globalThis.__LAO__ ||= {});
  if (LAO.util) return;

  const HOST_TAG = 'live-accessibility-overlay';

  /** Elements that never carry rendered content worth auditing. */
  const SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'META', 'LINK', 'TITLE',
    'HEAD', 'BR', 'WBR', 'PARAM', 'SOURCE', 'TRACK',
  ]);

  const isOurs = (node) =>
    !!(node && node.nodeType === 1 && node.tagName?.toLowerCase() === HOST_TAG);

  /**
   * Depth-first walk of every element in the document, descending through open
   * shadow roots and same-origin iframes are deliberately excluded (a frame is
   * a separate document with its own scan lifecycle).
   *
   * Most audit tools stop at the shadow boundary and silently under-report on
   * component-driven sites; descending is a correctness requirement, not a
   * nicety.
   */
  function walkElements(root, visit) {
    const stack = [root];
    while (stack.length) {
      const node = stack.pop();
      if (!node) continue;

      const children = node.children;
      if (children) {
        for (let i = children.length - 1; i >= 0; i--) {
          const el = children[i];
          if (isOurs(el) || SKIP_TAGS.has(el.tagName)) continue;
          visit(el);
          if (el.shadowRoot) stack.push(el.shadowRoot);
          stack.push(el);
        }
      }
    }
  }

  /** Collect elements matching a selector, shadow roots included. */
  function queryDeep(selector, root = document) {
    const out = [];
    const test = (el) => {
      try {
        if (el.matches(selector)) out.push(el);
      } catch {
        /* Invalid selector for this node type. */
      }
    };
    walkElements(root, test);
    return out;
  }

  /**
   * Text nodes with rendered content, grouped by their nearest element.
   * Returns a Map of element -> concatenated text, so a paragraph is measured
   * once rather than once per text run.
   */
  function collectTextOwners(root = document) {
    const owners = new Map();
    const consider = (textNode) => {
      const raw = textNode.nodeValue;
      if (!raw || !raw.trim()) return;
      const el = textNode.parentElement;
      if (!el || isOurs(el) || SKIP_TAGS.has(el.tagName)) return;
      const prev = owners.get(el);
      owners.set(el, prev ? `${prev} ${raw.trim()}` : raw.trim());
    };

    const scan = (r) => {
      const walker = document.createTreeWalker(r, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = walker.nextNode())) consider(n);
      // TreeWalker will not cross a shadow boundary; recurse explicitly.
      walkElements(r, (el) => {
        if (el.shadowRoot) scan(el.shadowRoot);
      });
    };
    scan(root);
    return owners;
  }

  /**
   * Screen-reader-only text is *intended* to be invisible. Reporting it as a
   * contrast failure is the single most common false positive in naive
   * scanners, so detect the standard clip/clip-path patterns and exclude them.
   */
  function isVisuallyHidden(el, cs) {
    const r = el.getBoundingClientRect();
    if (r.width <= 1 && r.height <= 1) return true;
    const clip = cs.clip;
    if (clip && clip !== 'auto' && /rect\((?:0(?:px)?[,\s]+){3}0(?:px)?\)/.test(clip.replace(/\s+/g, ' '))) {
      return true;
    }
    const cp = cs.clipPath;
    if (cp && (cp === 'inset(50%)' || cp === 'inset(100%)' || /circle\(0/.test(cp))) return true;
    if (cs.textIndent && parseFloat(cs.textIndent) <= -999) return true;
    return false;
  }

  /** True when the element contributes nothing to the rendered page. */
  function isRendered(el, cs = getComputedStyle(el)) {
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse') return false;
    if (parseFloat(cs.opacity) === 0) return false;
    if (cs.contentVisibility === 'hidden') return false;
    if (el.closest?.('[aria-hidden="true"],[hidden],[inert]')) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    return true;
  }

  /**
   * Cumulative opacity — an ancestor at 0.4 opacity genuinely reduces the
   * contrast a reader perceives, and pretending otherwise over-reports passes.
   */
  function effectiveOpacity(el) {
    let o = 1;
    let node = el;
    while (node && node.nodeType === 1) {
      const v = parseFloat(getComputedStyle(node).opacity);
      if (!Number.isNaN(v)) o *= v;
      if (o === 0) break;
      node = node.parentElement || node.getRootNode()?.host || null;
    }
    return o;
  }

  /** Viewport-relative rect, tolerant of elements that report several boxes. */
  function rectOf(el) {
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  }

  const intersectsViewport = (r, pad = 400) =>
    r.y + r.h > -pad &&
    r.y < innerHeight + pad &&
    r.x + r.w > -pad &&
    r.x < innerWidth + pad;

  /** Stable-ish identity for an element, used to preserve UI state re-scans. */
  function fingerprint(el, extra = '') {
    const path = [];
    let node = el;
    let depth = 0;
    while (node && node.nodeType === 1 && depth++ < 6) {
      const parent = node.parentElement;
      const idx = parent ? Array.prototype.indexOf.call(parent.children, node) : 0;
      path.push(`${node.tagName}:${idx}`);
      node = parent;
    }
    return `${path.join('/')}|${extra}`;
  }

  /** Trailing-edge debounce with a hard ceiling so live pages still update. */
  function debounce(fn, wait, maxWait) {
    let t = 0;
    let firstCall = 0;
    return (...args) => {
      const now = Date.now();
      if (!firstCall) firstCall = now;
      clearTimeout(t);
      if (maxWait && now - firstCall >= maxWait) {
        firstCall = 0;
        fn(...args);
        return;
      }
      t = setTimeout(() => {
        firstCall = 0;
        fn(...args);
      }, wait);
    };
  }

  const truncate = (s, n) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : s || '');

  /** Human label for an element, for the panel's issue list. */
  function describe(el) {
    const tag = el.tagName.toLowerCase();
    const id = el.id ? `#${el.id}` : '';
    const cls = !id && typeof el.className === 'string' && el.className.trim()
      ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}`
      : '';
    return `${tag}${id}${cls}`;
  }

  LAO.util = {
    HOST_TAG,
    isOurs,
    walkElements,
    queryDeep,
    collectTextOwners,
    isVisuallyHidden,
    isRendered,
    effectiveOpacity,
    rectOf,
    intersectsViewport,
    fingerprint,
    debounce,
    truncate,
    describe,
    prefersReducedMotion: () => matchMedia('(prefers-reduced-motion: reduce)').matches,
  };
})();
