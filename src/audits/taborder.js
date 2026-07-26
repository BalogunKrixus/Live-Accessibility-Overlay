/**
 * Tab order audit.
 *
 * The sequence is derived by walking focusable elements and applying the
 * sequential focus navigation rules — positive tabindex values first in
 * ascending order, then everything at tabindex 0 in document order. Nothing
 * here depends on the user actually pressing Tab.
 */
(() => {
  const LAO = (globalThis.__LAO__ ||= {});
  if (LAO.auditTabOrder) return;

  const { util } = LAO;

  const FOCUSABLE = [
    'a[href]',
    'area[href]',
    'button',
    'input',
    'select',
    'textarea',
    'summary',
    'iframe',
    'object',
    'embed',
    'audio[controls]',
    'video[controls]',
    '[tabindex]',
    '[contenteditable=""]',
    '[contenteditable="true"]',
  ].join(',');

  function isDisabled(el) {
    if (el.disabled) return true;
    if (el.getAttribute('aria-disabled') === 'true' && !el.hasAttribute('href')) return true;
    if (el.closest('fieldset[disabled]')) return true;
    if (el.closest('[inert]')) return true;
    return false;
  }

  function tabIndexOf(el) {
    const attr = el.getAttribute('tabindex');
    if (attr !== null) {
      const n = parseInt(attr, 10);
      return Number.isNaN(n) ? 0 : n;
    }
    // Natively focusable elements default to 0.
    return 0;
  }

  function run() {
    const candidates = util.queryDeep(FOCUSABLE);

    const entries = [];
    for (const el of candidates) {
      let cs;
      try {
        cs = getComputedStyle(el);
      } catch {
        continue;
      }
      if (isDisabled(el)) continue;
      if (el.type === 'hidden') continue;
      if (!util.isRendered(el, cs)) continue;

      const tabindex = tabIndexOf(el);
      if (tabindex < 0) continue; // Focusable by script only, not by Tab.

      // Radio groups expose a single tab stop: the checked control, or the
      // first when none is checked. Listing every radio misrepresents the path.
      if (el.type === 'radio' && el.name) {
        const group = [...(el.form || document).querySelectorAll(
          `input[type="radio"][name="${CSS.escape(el.name)}"]`,
        )].filter((r) => util.isRendered(r) && !isDisabled(r));
        const checked = group.find((r) => r.checked);
        const representative = checked || group[0];
        if (representative && representative !== el) continue;
      }

      entries.push({ el, tabindex, rect: util.rectOf(el), docIndex: entries.length });
    }

    // Restore document order — the deep walk does not guarantee it.
    entries.sort((a, b) => docCompare(a.el, b.el));
    entries.forEach((e, i) => { e.docIndex = i; });

    // Sequential focus navigation order.
    const positive = entries.filter((e) => e.tabindex > 0)
      .sort((a, b) => a.tabindex - b.tabindex || a.docIndex - b.docIndex);
    const natural = entries.filter((e) => e.tabindex === 0);
    const ordered = [...positive, ...natural];

    /* ------------------------------------------------------------ analysis */

    const issues = [];
    const steps = ordered.map((e, i) => ({
      ...e,
      index: i + 1,
      id: `tab:${util.fingerprint(e.el, String(i))}`,
      label: util.describe(e.el),
      name: nameOf(e.el),
    }));

    if (positive.length) {
      issues.push({
        id: 'tab:positive',
        lens: 'tabs',
        severity: 'warning',
        element: positive[0].el,
        rect: positive[0].rect,
        steps: positive.length,
        title: `${positive.length} element${positive.length === 1 ? '' : 's'} using positive tabindex`,
        detail:
          'A positive tabindex pulls elements to the front of the tab order, ahead of everything above them on the page. It is almost always a fix for a layout problem that reappears the moment the layout changes.',
        fix: 'Use tabindex="0" and let DOM order define the sequence, reordering the markup if the sequence is wrong.',
      });
    }

    // Backward jumps: the visual position moves up the page, or sharply left on
    // the same row. This is what "tab order does not match the design" means in
    // practice, and it is invisible without walking the sequence.
    const ROW_TOLERANCE = 12;
    for (let i = 1; i < steps.length; i++) {
      const prev = steps[i - 1];
      const cur = steps[i];
      const dy = cur.rect.y - prev.rect.y;
      const sameRow = Math.abs(dy) <= ROW_TOLERANCE;
      const jumpsUp = dy < -ROW_TOLERANCE * 3;
      const jumpsLeft = sameRow && cur.rect.x < prev.rect.x - 24;

      if (jumpsUp || jumpsLeft) {
        cur.backward = true;
        issues.push({
          id: `tab:jump:${i}`,
          lens: 'tabs',
          severity: 'warning',
          element: cur.el,
          rect: cur.rect,
          from: prev.index,
          to: cur.index,
          title: `Focus jumps backwards at step ${cur.index}`,
          detail: jumpsUp
            ? `Tabbing from step ${prev.index} to ${cur.index} moves ${Math.abs(Math.round(dy))}px back up the page. Sighted keyboard users lose their place when focus travels against the reading order.`
            : `Steps ${prev.index} and ${cur.index} sit on the same row, but focus moves right to left.`,
          fix: 'Reorder these elements in the DOM so the tab sequence follows the visual layout.',
        });
      }
    }

    // Focusable elements sitting outside the viewport bounds horizontally are a
    // classic off-canvas menu left in the tab order after it closes.
    for (const step of steps) {
      const r = step.rect;
      const offCanvas = r.x + r.w < -4 || r.x > (document.documentElement.clientWidth || innerWidth) + 4;
      if (offCanvas) {
        step.offCanvas = true;
        issues.push({
          id: `tab:offcanvas:${step.index}`,
          lens: 'tabs',
          severity: 'critical',
          element: step.el,
          rect: r,
          title: `Step ${step.index} is off-screen but still focusable`,
          detail:
            'This control sits outside the page horizontally, usually a closed drawer or menu that was hidden with a transform rather than removed from the tab order. Keyboard users tab into something they cannot see.',
          fix: 'Hide it with display:none, the hidden attribute, or inert while it is closed.',
        });
      }
    }

    if (!steps.length) {
      issues.push({
        id: 'tab:none',
        lens: 'tabs',
        severity: 'notice',
        element: document.body,
        rect: null,
        title: 'Nothing on this page can be reached by keyboard',
        detail:
          'No focusable elements were found. On a purely static page that is expected; if there are controls here, they are not reachable by Tab.',
      });
    }

    return { lens: 'tabs', steps, issues, scanned: steps.length, positiveCount: positive.length };
  }

  function docCompare(a, b) {
    if (a === b) return 0;
    // Elements in different shadow trees are not directly comparable; fall back
    // to comparing their hosts so the sequence stays deterministic.
    const aRef = a.getRootNode() === b.getRootNode() ? a : hostChain(a);
    const bRef = a.getRootNode() === b.getRootNode() ? b : hostChain(b);
    if (!aRef || !bRef || aRef === bRef) return 0;
    const pos = aRef.compareDocumentPosition(bRef);
    if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    return 0;
  }

  function hostChain(el) {
    let node = el;
    while (node && node.getRootNode() !== document) {
      const root = node.getRootNode();
      if (!root?.host) return node;
      node = root.host;
    }
    return node;
  }

  function nameOf(el) {
    const label =
      el.getAttribute('aria-label') ||
      el.getAttribute('title') ||
      el.getAttribute('placeholder') ||
      (el.labels?.[0]?.textContent ?? '') ||
      el.value ||
      el.textContent ||
      '';
    return LAO.util.truncate(String(label).trim().replace(/\s+/g, ' '), 48);
  }

  LAO.auditTabOrder = { run };
})();
