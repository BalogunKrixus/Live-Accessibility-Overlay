/**
 * Heading structure audit.
 *
 * Produces a flat, ordered outline (document order) annotated with structural
 * problems, which the panel renders as a nested map.
 */
(() => {
  const LAO = (globalThis.__LAO__ ||= {});
  if (LAO.auditHeadings) return;

  const { util } = LAO;

  const SELECTOR = 'h1,h2,h3,h4,h5,h6,[role="heading"]';

  function levelOf(el) {
    const aria = el.getAttribute('aria-level');
    if (aria) {
      const n = parseInt(aria, 10);
      if (n >= 1 && n <= 6) return n;
      if (n > 6) return 6;
    }
    const m = /^H([1-6])$/.exec(el.tagName);
    if (m) return parseInt(m[1], 10);
    return 2; // role="heading" with no level defaults to 2 per ARIA.
  }

  /** Accessible name, near enough: aria-label / aria-labelledby / text. */
  function nameOf(el) {
    const label = el.getAttribute('aria-label');
    if (label && label.trim()) return label.trim();
    const ref = el.getAttribute('aria-labelledby');
    if (ref) {
      const text = ref
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent?.trim() || '')
        .filter(Boolean)
        .join(' ');
      if (text) return text;
    }
    // Image-only headings still have a name via the image's alt text.
    const text = el.textContent?.trim();
    if (text) return text;
    const img = el.querySelector('img[alt]');
    if (img?.alt?.trim()) return img.alt.trim();
    return '';
  }

  function run() {
    const els = util.queryDeep(SELECTOR).filter((el) => {
      if (el.matches('[role="heading"]') && /^H[1-6]$/.test(el.tagName)) return true;
      return true;
    });

    // queryDeep walks depth-first with a stack, so re-sort into document order —
    // the outline is meaningless in any other sequence.
    els.sort((a, b) => {
      const pos = a.compareDocumentPosition(b);
      if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });

    const nodes = [];
    const issues = [];
    let previousLevel = 0;
    let h1Count = 0;

    for (const el of els) {
      let cs;
      try {
        cs = getComputedStyle(el);
      } catch {
        continue;
      }
      const level = levelOf(el);
      const name = nameOf(el);
      const rendered = util.isRendered(el, cs);
      const problems = [];

      if (level === 1) h1Count++;

      if (!name) {
        problems.push({
          severity: 'critical',
          code: 'empty',
          label: 'Empty heading',
          short: 'empty',
          detail:
            'This heading has no text. Screen reader users hear a heading announced with nothing in it, which breaks the outline they navigate by.',
        });
      }

      if (previousLevel && level > previousLevel + 1) {
        problems.push({
          severity: 'warning',
          code: 'skip',
          label: `Skipped from H${previousLevel} to H${level}`,
          short: `H${previousLevel} → H${level}`,
          detail: `Heading levels should step down one at a time. Going from H${previousLevel} straight to H${level} implies a section that is not there, so the outline reads as if content is missing.`,
        });
      }

      if (!rendered && name) {
        problems.push({
          severity: 'notice',
          code: 'hidden',
          label: 'Hidden from view',
          short: 'hidden',
          detail:
            'This heading is in the outline but not visible on screen. That is fine when it is a deliberate landmark label, and confusing when it is left-over markup.',
        });
      }

      if (name && name.length > 120) {
        problems.push({
          severity: 'notice',
          code: 'long',
          label: 'Very long heading',
          short: 'long',
          detail:
            'Headings are used as a table of contents. Over ~120 characters this stops working as a scannable label.',
        });
      }

      const node = {
        id: `heading:${util.fingerprint(el, `h${level}`)}`,
        lens: 'headings',
        element: el,
        level,
        name: name || '(no text)',
        rendered,
        rect: util.rectOf(el),
        problems,
        severity: worst(problems),
        tag: el.tagName.toLowerCase(),
        implicit: !/^H[1-6]$/.test(el.tagName),
      };

      nodes.push(node);
      if (problems.length) issues.push(node);
      if (rendered || name) previousLevel = level;
    }

    /* ------------------------------------------------ document-level checks */

    const documentIssues = [];

    if (!nodes.length) {
      documentIssues.push({
        id: 'heading:none',
        lens: 'headings',
        severity: 'critical',
        element: document.body,
        rect: null,
        name: 'No headings on this page',
        level: 0,
        problems: [
          {
            severity: 'critical',
            code: 'no-headings',
            label: 'No headings at all',
            detail:
              'Screen reader users navigate long pages by jumping between headings. With none, the only way through is to read linearly from the top.',
          },
        ],
      });
    } else if (h1Count === 0) {
      documentIssues.push({
        id: 'heading:no-h1',
        lens: 'headings',
        severity: 'warning',
        element: nodes[0].element,
        rect: nodes[0].rect,
        name: 'No H1 on this page',
        level: 0,
        problems: [
          {
            severity: 'warning',
            code: 'no-h1',
            label: 'Missing top-level heading',
            detail:
              'A page should open with one H1 naming what the page is. Without it there is no anchor for the rest of the outline.',
          },
        ],
      });
    } else if (h1Count > 1) {
      documentIssues.push({
        id: 'heading:multi-h1',
        lens: 'headings',
        severity: 'notice',
        element: nodes.find((n) => n.level === 1)?.element || document.body,
        rect: nodes.find((n) => n.level === 1)?.rect || null,
        name: `${h1Count} H1 headings`,
        level: 0,
        problems: [
          {
            severity: 'notice',
            code: 'multi-h1',
            label: `${h1Count} H1s on one page`,
            detail:
              'Multiple H1s are valid HTML and common in sectioned layouts, but they flatten the outline. Worth confirming this is deliberate.',
          },
        ],
      });
    }

    const all = [...documentIssues, ...issues];

    return {
      lens: 'headings',
      outline: nodes,
      issues: all,
      documentIssues,
      scanned: nodes.length,
    };
  }

  const RANK = { critical: 3, warning: 2, notice: 1 };
  function worst(problems) {
    let best = null;
    for (const p of problems) if (!best || RANK[p.severity] > RANK[best]) best = p.severity;
    return best;
  }

  LAO.auditHeadings = { run };
})();
