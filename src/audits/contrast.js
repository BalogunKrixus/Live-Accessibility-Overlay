/**
 * Contrast audit.
 *
 * Scans every element that renders text, resolves the colour actually behind
 * that text, and measures it against the WCAG AA threshold for its size and
 * weight.
 */
(() => {
  const LAO = (globalThis.__LAO__ ||= {});
  if (LAO.auditContrast) return;

  const { util, color } = LAO;

  /** Backgrounds we cannot honestly reduce to a single colour. */
  function backdropKind(cs) {
    const img = cs.backgroundImage;
    if (!img || img === 'none') return null;
    if (/gradient\(/i.test(img)) return 'gradient';
    return 'image';
  }

  /* ------------------------------------------------------- media backdrops */

  /**
   * A hero photo is very often not a `background-image` at all — it is an
   * `<img>` (or `<video>`, or a `<canvas>`) painted behind the text as a
   * sibling. Walking `background-color` up the tree never touches it, so the
   * walk falls all the way through to the page canvas and reports white text
   * on white "background": a confident, wrong 1:1.
   *
   * So the walk also has to know where the painted media *elements* are.
   */
  const MEDIA_SELECTOR = 'img,svg,video,canvas,object,embed,iframe';

  /** Media large enough to sit behind a block of text, with its rect cached. */
  function collectMedia() {
    const out = [];
    for (const node of util.queryDeep(MEDIA_SELECTOR)) {
      let cs;
      try {
        cs = getComputedStyle(node);
      } catch {
        continue;
      }
      // Deliberately not util.isRendered(): that treats aria-hidden as absent,
      // and a decorative hero image is aria-hidden almost by definition. What
      // matters here is only whether it puts pixels on the screen.
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse') continue;
      if (parseFloat(cs.opacity) < 0.06) continue;

      const r = node.getBoundingClientRect();
      if (r.width < 24 || r.height < 24) continue; // Icons, spacers, tracking pixels.
      out.push({ node, rect: r, chain: null });
    }
    return out;
  }

  /** Fraction of `rect` that `other` covers. */
  function coverage(rect, other) {
    const area = rect.width * rect.height;
    if (area <= 0) return 0;
    const w = Math.min(rect.right, other.right) - Math.max(rect.left, other.left);
    const h = Math.min(rect.bottom, other.bottom) - Math.max(rect.top, other.top);
    if (w <= 0 || h <= 0) return 0;
    return (w * h) / area;
  }

  /** Ancestors including shadow hosts — `contains` stops at a shadow boundary. */
  function composedChain(node) {
    const chain = new Set();
    let n = node;
    while (n) {
      chain.add(n);
      n = n.parentElement || n.getRootNode()?.host || null;
    }
    return chain;
  }

  /**
   * Media that covers most of this text's box and is not an ancestor of it.
   * "Most" matters: an inline icon next to a line of text overlaps its box
   * slightly and is not a backdrop, while a hero image covers all of it.
   */
  function coveringMedia(el, rect, media) {
    if (!media.length) return [];
    const own = composedChain(el);
    const hits = [];
    for (const m of media) {
      if (m.node === el || own.has(m.node)) continue;
      if (coverage(rect, m.rect) < 0.6) continue;
      hits.push(m);
    }
    return hits;
  }

  /**
   * Walk up from the text's element, compositing background layers until an
   * opaque one is found. Crossing a shadow boundary follows the host element,
   * because that is where the visual stacking actually continues.
   */
  function resolveBackdrop(el, media = []) {
    const layers = [];
    let node = el;

    const covering = coveringMedia(el, el.getBoundingClientRect(), media);

    while (node && node.nodeType === 1) {
      // Media inside this node paints on top of this node's background, so it
      // has to be tested before the background is trusted. Once an opaque
      // background has been found further down, anything above it in the tree
      // is hidden behind it and never gets this far.
      for (const m of covering) {
        m.chain ||= composedChain(m.node);
        if (m.chain.has(node)) return { unmeasurable: 'image', node: m.node };
      }

      const cs = getComputedStyle(node);
      const kind = backdropKind(cs);
      if (kind) {
        // An image/gradient sits above anything we have collected so far and we
        // cannot sample it, so the measurement stops being trustworthy here.
        return { unmeasurable: kind, node };
      }

      const bg = color.parse(cs.backgroundColor);
      if (bg && bg.a > 0) {
        layers.unshift(bg);
        if (bg.a >= 0.999) {
          return { color: color.flatten(layers), source: node };
        }
      }

      node = node.parentElement || node.getRootNode()?.host || null;
    }

    // Nothing opaque found: the canvas shows through. Browsers propagate the
    // body/html background to the canvas, and default it to white.
    const rootBg =
      color.parse(getComputedStyle(document.documentElement).backgroundColor) ||
      { r: 255, g: 255, b: 255, a: 0 };
    const bodyBg = document.body
      ? color.parse(getComputedStyle(document.body).backgroundColor)
      : null;
    let base = { r: 255, g: 255, b: 255, a: 1 };
    if (bodyBg && bodyBg.a >= 0.999) base = bodyBg;
    else if (rootBg.a >= 0.999) base = rootBg;
    return { color: color.flatten(layers, base), source: document.documentElement, assumed: true };
  }

  /**
   * WCAG 1.4.3 exempts "inactive user interface components" from the contrast
   * minimum. Browsers grey out disabled controls by default, so measuring them
   * produces a failure on every form on the web — noise that trains people to
   * ignore the tool.
   */
  function isInactive(el) {
    const control = el.closest?.(
      'button,input,select,textarea,fieldset,optgroup,option,[aria-disabled="true"]',
    );
    if (!control) return false;
    if (control.disabled) return true;
    if (control.getAttribute?.('aria-disabled') === 'true') return true;
    return !!el.closest?.('fieldset[disabled]');
  }

  function run() {
    const owners = util.collectTextOwners(document);
    const media = collectMedia();
    const issues = [];
    let measured = 0;

    for (const [el, text] of owners) {
      let cs;
      try {
        cs = getComputedStyle(el);
      } catch {
        continue;
      }

      if (!util.isRendered(el, cs)) continue;
      if (util.isVisuallyHidden(el, cs)) continue; // sr-only: hidden on purpose.
      if (isInactive(el)) continue;                // Disabled controls are exempt.

      const fontSize = parseFloat(cs.fontSize) || 16;
      const weight = color.normaliseWeight(cs.fontWeight);
      const limits = color.threshold(fontSize, weight);

      const rawFg = color.parse(cs.color);
      if (!rawFg) continue;

      // Fully transparent text is either a hiding technique or a bug, but it is
      // not a contrast problem — treat it separately rather than as a 1:1 fail.
      if (rawFg.a === 0) continue;

      const backdrop = resolveBackdrop(el, media);
      const rect = util.rectOf(el);
      if (rect.w === 0 || rect.h === 0) continue;

      measured++;

      if (backdrop.unmeasurable) {
        issues.push({
          id: `contrast:${util.fingerprint(el, 'u')}`,
          lens: 'contrast',
          severity: 'notice',
          element: el,
          rect,
          unmeasurable: backdrop.unmeasurable,
          title: backdrop.unmeasurable === 'gradient' ? 'Text over a gradient' : 'Text over an image',
          detail:
            backdrop.unmeasurable === 'gradient'
              ? 'The background is a gradient, so contrast varies across this text. Check the lightest and darkest points by eye.'
              : 'The background is an image, so contrast cannot be measured automatically. Check it against the busiest part of the image.',
          text: util.truncate(text, 90),
          fontSize,
          weight,
          required: limits.aa,
        });
        continue;
      }

      const opacity = util.effectiveOpacity(el);
      const fg = color.over({ ...rawFg, a: (rawFg.a ?? 1) * opacity }, backdrop.color);
      const bg = backdrop.color;
      const ratio = color.contrast(fg, bg);

      if (ratio >= limits.aa) continue;

      // Distance from passing drives severity: a near-miss is a different kind
      // of problem from text that is genuinely unreadable, and flattening both
      // into "fail" is what makes existing reports feel undifferentiated.
      const shortfall = limits.aa - ratio;
      const severity = ratio < limits.aa * 0.55 ? 'critical' : shortfall > 0.6 ? 'warning' : 'notice';

      issues.push({
        id: `contrast:${util.fingerprint(el, color.toHex(fg) + color.toHex(bg))}`,
        lens: 'contrast',
        severity,
        element: el,
        rect,
        ratio,
        required: limits.aa,
        requiredAAA: limits.aaa,
        large: limits.large,
        fg,
        bg,
        fgHex: color.toHex(fg),
        bgHex: color.toHex(bg),
        fontSize,
        weight,
        assumedBackground: !!backdrop.assumed,
        text: util.truncate(text, 90),
        title: `${color.round(ratio, 2)}:1 — needs ${limits.aa}:1`,
        detail: limits.large
          ? `This text is large (${Math.round(fontSize)}px${weight >= 700 ? ' bold' : ''}), so it only needs ${limits.aa}:1. It still falls short.`
          : `Body text at ${Math.round(fontSize)}px needs ${limits.aa}:1 to pass AA.`,
        get fix() {
          // Computed lazily: the search is only worth running for issues the
          // user actually opens, not for all 300 on a heavy page.
          if (!this._fix) this._fix = color.suggestFix(this.fg, this.bg, this.required);
          return this._fix;
        },
      });
    }

    /**
     * Group by colour pair. A page usually has a handful of broken *decisions*
     * repeated across hundreds of nodes; showing 300 rows misrepresents the
     * size of the problem and buries the fix.
     */
    const groups = new Map();
    for (const issue of issues) {
      const key = issue.unmeasurable
        ? `u:${issue.unmeasurable}`
        : `${issue.fgHex}/${issue.bgHex}/${issue.required}`;
      if (!groups.has(key)) groups.set(key, { key, issues: [], severity: issue.severity });
      const g = groups.get(key);
      g.issues.push(issue);
      if (rank(issue.severity) > rank(g.severity)) g.severity = issue.severity;
    }

    const grouped = [...groups.values()].sort(
      (a, b) => rank(b.severity) - rank(a.severity) || b.issues.length - a.issues.length,
    );

    return { lens: 'contrast', issues, groups: grouped, scanned: measured };
  }

  const rank = (s) => ({ critical: 3, warning: 2, notice: 1 }[s] || 0);

  LAO.auditContrast = { run, rank };
})();
