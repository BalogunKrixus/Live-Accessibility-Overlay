/**
 * Alternative text audit.
 *
 * The distinction that matters is *intent*: a decorative image needs alt="",
 * a meaningful one needs a description, and the failure modes are opposite.
 * Tools that report both as "image missing alt" push people towards adding
 * noise to decorative images, which makes pages worse rather than better.
 */
(() => {
  const LAO = (globalThis.__LAO__ ||= {});
  if (LAO.auditImages) return;

  const { util } = LAO;

  const SELECTOR = 'img,input[type="image"],area,svg,[role="img"],object[type^="image"]';

  /** alt text that is technically present but carries no information. */
  const PLACEHOLDER = /^(image|img|photo|picture|graphic|icon|logo|spacer|blank|untitled|thumbnail|banner|placeholder|\d+)$/i;
  const FILENAME = /\.(jpe?g|png|gif|svg|webp|avif|bmp|ico)$/i;

  function accessibleName(el) {
    const label = el.getAttribute('aria-label');
    if (label?.trim()) return { text: label.trim(), from: 'aria-label' };

    const ref = el.getAttribute('aria-labelledby');
    if (ref) {
      const text = ref
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent?.trim() || '')
        .filter(Boolean)
        .join(' ');
      if (text) return { text, from: 'aria-labelledby' };
    }

    if (el.hasAttribute('alt')) return { text: el.getAttribute('alt').trim(), from: 'alt', explicit: true };

    if (el.tagName === 'SVG' || el.tagName === 'svg') {
      const title = el.querySelector(':scope > title');
      if (title?.textContent?.trim()) return { text: title.textContent.trim(), from: '<title>' };
    }

    const titleAttr = el.getAttribute('title');
    if (titleAttr?.trim()) return { text: titleAttr.trim(), from: 'title' };

    return { text: '', from: null };
  }

  /** Is this image the only content of a link or button? */
  function soleContentOfControl(el) {
    const control = el.closest('a[href],button,[role="link"],[role="button"]');
    if (!control) return null;
    const text = (control.textContent || '').trim();
    if (text) return null; // The control has its own text; the image can be decorative.
    const ownName =
      control.getAttribute('aria-label')?.trim() ||
      control.getAttribute('title')?.trim() ||
      '';
    return { control, controlHasName: !!ownName };
  }

  const isHiddenFromAT = (el) =>
    el.getAttribute('aria-hidden') === 'true' ||
    el.getAttribute('role') === 'presentation' ||
    el.getAttribute('role') === 'none';

  function run() {
    const els = util.queryDeep(SELECTOR);
    const issues = [];
    const passes = [];
    let scanned = 0;

    for (const el of els) {
      // An <svg> nested inside another audited svg is one graphic, not two.
      if ((el.tagName === 'svg' || el.tagName === 'SVG') && el.parentElement?.closest('svg')) continue;

      let cs;
      try {
        cs = getComputedStyle(el);
      } catch {
        continue;
      }
      if (!util.isRendered(el, cs)) continue;

      scanned++;

      const rect = util.rectOf(el);
      const name = accessibleName(el);
      const inControl = soleContentOfControl(el);
      const hidden = isHiddenFromAT(el);
      const tag = el.tagName.toLowerCase();
      const src = el.currentSrc || el.getAttribute('src') || el.getAttribute('data-src') || '';
      const base = {
        lens: 'images',
        element: el,
        rect,
        tag,
        src,
        altValue: el.hasAttribute('alt') ? el.getAttribute('alt') : null,
        nameFrom: name.from,
        name: name.text,
      };

      // alt="" and aria-hidden both say "skip me". That is correct on a
      // standalone image and actively harmful on one inside a bare link.
      const explicitlyDecorative = hidden || (name.explicit && name.text === '');

      /* --- The image is the only thing inside a link or button ------------ */
      if (inControl && !inControl.controlHasName && !name.text) {
        issues.push({
          ...base,
          id: `alt:${util.fingerprint(el, explicitlyDecorative ? 'dec-ctl' : 'ctl')}`,
          severity: 'critical',
          kind: explicitlyDecorative ? 'decorative-in-control' : 'unnamed-control',
          title: explicitlyDecorative
            ? 'Interactive image marked decorative'
            : 'Link has no accessible name',
          detail: explicitlyDecorative
            ? 'This image is marked decorative, but it is the only content of a link or button — so the control ends up with no name at all and is announced as just "link".'
            : 'This image is the only content of a link or button, and neither has a name. A screen reader announces it as just "link", with nothing to say where it goes.',
          fix: explicitlyDecorative
            ? 'Either describe the action in the alt text, or give the link its own aria-label.'
            : 'Describe the destination or action in the alt text — "View pricing", not "arrow icon".',
        });
        continue;
      }

      /* --- Decorative, correctly marked ----------------------------------- */
      if (explicitlyDecorative) {
        passes.push({ ...base, kind: 'decorative' });
        continue;
      }

      /* --- No alt attribute at all ---------------------------------------- */
      if (!name.explicit && !name.text) {
        const decorativeGuess = looksDecorative(el, rect);
        issues.push({
          ...base,
          id: `alt:${util.fingerprint(el, 'missing')}`,
          severity: decorativeGuess ? 'warning' : 'critical',
          kind: 'missing',
          title: decorativeGuess ? 'No alt — probably decorative' : 'No alt text',
          detail: decorativeGuess
            ? 'There is no alt attribute. This looks decorative from its size and placement, but a missing attribute is not the same as an empty one — screen readers fall back to announcing the filename.'
            : 'There is no alt attribute, so screen readers announce the filename instead. Anything meaningful here is lost.',
          fix: decorativeGuess
            ? 'If it is decorative, add alt="" so it is skipped cleanly.'
            : 'Add alt text describing what the image conveys in this context.',
        });
        continue;
      }

      /* --- Alt present but unhelpful -------------------------------------- */
      const value = name.text;
      if (PLACEHOLDER.test(value) || FILENAME.test(value)) {
        issues.push({
          ...base,
          id: `alt:${util.fingerprint(el, 'placeholder')}`,
          severity: 'warning',
          kind: 'placeholder',
          title: FILENAME.test(value) ? 'Alt text is a filename' : 'Alt text is a placeholder',
          detail: `The description reads "${util.truncate(value, 60)}", which tells a listener nothing they could not already infer.`,
          fix: 'Describe what the image shows or does, in the context of the surrounding content.',
        });
        continue;
      }

      if (/^(image|picture|photo|graphic|icon) of /i.test(value)) {
        issues.push({
          ...base,
          id: `alt:${util.fingerprint(el, 'redundant')}`,
          severity: 'notice',
          kind: 'redundant',
          title: 'Redundant phrasing in alt',
          detail:
            'Screen readers already announce that this is an image, so "image of…" is read twice over.',
          fix: `Shorten to "${util.truncate(value.replace(/^(image|picture|photo|graphic|icon) of /i, ''), 50)}".`,
        });
        continue;
      }

      if (value.length > 150) {
        issues.push({
          ...base,
          id: `alt:${util.fingerprint(el, 'long')}`,
          severity: 'notice',
          kind: 'too-long',
          title: 'Very long alt text',
          detail: `${value.length} characters. Alt text is read as one uninterrupted block with no way to skim or pause inside it.`,
          fix: 'Keep alt to a sentence, and move any longer explanation into visible text or a caption near the image.',
        });
        continue;
      }

      passes.push({ ...base, kind: 'described' });
    }

    return { lens: 'images', issues, passes, scanned };
  }

  /**
   * Heuristic, and labelled as one in the UI. Small images, and images with no
   * meaningful source, are usually spacers, icons and tracking pixels.
   */
  function looksDecorative(el, rect) {
    if (rect.w <= 24 && rect.h <= 24) return true;
    if (rect.w <= 3 || rect.h <= 3) return true;
    const src = el.getAttribute('src') || '';
    if (/^data:image\/gif/i.test(src) && rect.w < 40) return true;
    if (el.closest('[aria-hidden="true"]')) return true;
    return false;
  }

  LAO.auditImages = { run };
})();
