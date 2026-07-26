/**
 * The plain-language layer.
 *
 * Audits produce technically precise findings. This turns each one into
 * something a designer who has never read a WCAG document can act on:
 *
 *   title  — what is wrong, in the words someone would actually use
 *   why    — who it hurts and how, concretely. Never "fails WCAG 1.4.3".
 *   howTo  — what to do about it
 *   tech   — the numbers, selectors and rule references, kept out of the way
 *
 * Keeping this separate from the audits means the measurements stay exact
 * while the wording stays human, and neither one is compromised for the other.
 */
(() => {
  const LAO = (globalThis.__LAO__ ||= {});
  if (LAO.copy) return;

  const { util, color } = LAO;

  /** Two tiers, not three. "Notice" is a category only an expert wants. */
  const tierOf = (severity) => (severity === 'critical' ? 'fix' : 'check');

  const CATEGORY = {
    contrast: 'Text',
    images: 'Images',
    headings: 'Structure',
    tabs: 'Keyboard',
  };

  /* --------------------------------------------------------------- contrast */

  /** The numbers, for one specific piece of text. */
  function contrastTech(issue) {
    if (issue.unmeasurable) {
      return [
        `Background: ${issue.unmeasurable === 'gradient' ? 'CSS gradient' : 'image'}`,
        `Text needs ${issue.required}:1 against whatever sits behind it.`,
        'WCAG 2.2, 1.4.3 Contrast (Minimum), level AA',
      ];
    }
    return [
      `Contrast ${color.round(issue.ratio, 2)}:1 — needs ${issue.required}:1`,
      `${issue.fgHex} text on ${issue.bgHex}`,
      `${Math.round(issue.fontSize)}px${issue.weight >= 700 ? ' bold' : ''}${issue.large ? ' (counts as large text)' : ''}`,
      'WCAG 2.2, 1.4.3 Contrast (Minimum), level AA',
    ];
  }

  /**
   * All the unreadable text on a page is one problem, not one problem per
   * colour pair. Someone who has never read a contrast spec does not care that
   * #B9B9B9 and #949494 are different values — they care that some text is hard
   * to read, and where. Only urgency splits the rows.
   */
  function contrastItem(tier) {
    return {
      title: 'This text is hard to read',
      why: tier === 'fix'
        ? 'The text colour is too close to the colour behind it. People with low vision or colour ' +
          'blindness, and anyone using a phone outdoors, will struggle to read it.'
        : 'The text colour is a little too close to the colour behind it. Most people will manage, ' +
          'but it will be uncomfortable for anyone with reduced vision.',
      howTo: null, // The panel supplies a live colour suggestion, per place.
    };
  }

  function unmeasurableItem(kind) {
    return kind === 'gradient'
      ? {
          title: 'Text sits on a colour that changes',
          why:
            'We cannot measure how readable this is, because the background is not one flat colour. ' +
            'Check it against the lightest part of the background — that is where it will be hardest to read.',
          howTo:
            'If it is hard to read anywhere along the gradient, put a solid panel behind the text so it stays readable everywhere.',
        }
      : {
          title: 'Text sits on top of an image',
          why:
            'We cannot measure how readable this is, because the background is a picture. Check it against ' +
            'the busiest and lightest part of the image, which is where it will be hardest to read.',
          howTo: 'Add a solid or darkened panel behind the text so it does not depend on the image.',
        };
  }

  /* ----------------------------------------------------------------- images */

  const IMAGE_COPY = {
    missing: {
      title: 'This image has no description',
      why:
        'Someone using a screen reader hears the file name read out instead of what the image shows. ' +
        'If the image carries any meaning, that meaning is simply lost.',
      howTo:
        'Add a short description of what the image shows, in the context of the text around it. ' +
        'If it is purely decorative, mark it as decorative instead so it is skipped cleanly.',
    },
    'unnamed-control': {
      title: 'This link has nothing to announce',
      why:
        'The link contains only an image with no description, so a screen reader announces it as just "link" — ' +
        'with no way to tell where it goes. It is the equivalent of a button with no label.',
      howTo: 'Describe where the link goes, not what the picture looks like. "View pricing", not "arrow icon".',
    },
    'decorative-in-control': {
      title: 'This link has nothing to announce',
      why:
        'The image inside this link is marked as decorative, which tells screen readers to skip it. ' +
        'Because the image is the only thing in the link, there is then nothing left to announce.',
      howTo: 'Describe where the link goes in the image description, or give the link its own label.',
    },
    placeholder: {
      title: 'This description is not helpful',
      why:
        'The description is a file name or a generic word. Someone listening to the page learns nothing ' +
        'they could not already guess, so the image may as well have no description at all.',
      howTo: 'Say what the image actually shows and why it is there.',
    },
    redundant: {
      title: 'This description repeats itself',
      why:
        'Screen readers already announce that this is an image, so a description starting with "image of" ' +
        'gets read twice over.',
      howTo: 'Drop the opening words and start with what the image shows.',
    },
    'too-long': {
      title: 'This description is very long',
      why:
        'Image descriptions are read out as one uninterrupted block, with no way to skim or pause partway. ' +
        'A long one becomes tiring to listen to.',
      howTo: 'Keep it to a sentence, and move any longer explanation into visible text or a caption.',
    },
  };

  function imageItem(issue) {
    const base = IMAGE_COPY[issue.kind] || {
      title: issue.title,
      why: issue.detail,
      howTo: issue.fix,
    };
    const tech = [];
    if (issue.altValue !== null) tech.push(`Current alt: ${issue.altValue === '' ? 'alt="" (decorative)' : `"${issue.altValue}"`}`);
    else if (issue.name) tech.push(`Named via ${issue.nameFrom}: "${issue.name}"`);
    else tech.push('No alt attribute present');
    tech.push(`<${issue.tag}> ${util.describe(issue.element)}`);
    tech.push('WCAG 2.2, 1.1.1 Non-text Content, level A');
    return { ...base, tech };
  }

  /* --------------------------------------------------------------- headings */

  const HEADING_COPY = {
    skip: {
      title: 'A heading level was skipped',
      why:
        'Headings work like a table of contents, and screen reader users jump between them to find things. ' +
        'Skipping a level reads as though a whole section is missing.',
      howTo: 'Step heading levels down one at a time. Size is a styling choice — it does not have to match the level.',
    },
    empty: {
      title: 'This heading is empty',
      why:
        'There is a heading here with no words in it. Someone navigating by headings lands on it and hears nothing, ' +
        'which is disorienting.',
      howTo: 'Give it text, or remove it if it is left-over markup.',
    },
    'no-h1': {
      title: 'This page has no main heading',
      why:
        'A page should open with one main heading saying what the page is. Without it, there is nothing ' +
        'anchoring the rest of the outline, and screen reader users have no starting point.',
      howTo: 'Add one top-level heading naming what this page is about.',
    },
    'no-headings': {
      title: 'This page has no headings',
      why:
        'Screen reader users navigate long pages by jumping between headings. With none at all, the only way ' +
        'through the page is to listen to it from the very top.',
      howTo: 'Add headings for each main section of the page.',
    },
    'multi-h1': {
      title: 'This page has several main headings',
      why:
        'More than one top-level heading flattens the outline, so it stops being obvious what the page ' +
        'is actually about. This is sometimes deliberate, so it is worth a look rather than an automatic fix.',
      howTo: 'Usually one main heading is right, with everything else nested underneath it.',
    },
    hidden: {
      title: 'This heading is hidden from view',
      why:
        'The heading is in the page structure but not visible on screen. That is fine when it is a deliberate ' +
        'label for screen reader users, and confusing when it is left-over markup.',
      howTo: 'Confirm it is intentional.',
    },
    long: {
      title: 'This heading is very long',
      why: 'Headings act as a table of contents. A very long one stops working as a label you can scan.',
      howTo: 'Shorten it, and move the detail into the text below.',
    },
  };

  function headingItem(node) {
    const problem = node.problems[0];
    const base = HEADING_COPY[problem.code] || {
      title: problem.label,
      why: problem.detail,
      howTo: null,
    };
    return {
      ...base,
      tech: [
        problem.label,
        node.level ? `Level ${node.level}${node.implicit ? ' (role="heading")' : ` (<h${node.level}>)`}` : 'Document level',
        `Text: ${node.name}`,
        'WCAG 2.2, 1.3.1 Info and Relationships, level A',
      ],
    };
  }

  /* ------------------------------------------------------------------ tabs */

  function tabItem(issue) {
    if (/positive tabindex/i.test(issue.title)) {
      return {
        title: 'Keyboard focus starts in the wrong place',
        why:
          'Something on this page has been forced to the front of the keyboard order, ahead of everything above it. ' +
          'Someone pressing Tab lands there first, which is rarely what they expect.',
        howTo:
          'Let the page order decide the keyboard order. If the order is wrong, move the element in the markup ' +
          'rather than forcing it with a number.',
        tech: [issue.title, issue.detail, 'WCAG 2.2, 2.4.3 Focus Order, level A'],
      };
    }
    if (/off-screen/i.test(issue.title)) {
      return {
        title: 'A hidden control can still be reached',
        why:
          'This control sits off the side of the page — usually a menu or drawer that is closed — but pressing Tab ' +
          'still lands on it. Keyboard users end up focused on something they cannot see, with no idea where they are.',
        howTo: 'Take it out of the keyboard order while it is closed, rather than just moving it off-screen.',
        tech: [issue.title, issue.detail, 'WCAG 2.2, 2.4.3 Focus Order, level A'],
      };
    }
    if (/jumps backwards/i.test(issue.title)) {
      return {
        title: 'Keyboard focus jumps backwards',
        why:
          'Pressing Tab here moves focus back up the page instead of forward. Someone navigating by keyboard ' +
          'loses their place, because focus goes somewhere they have already been.',
        howTo: 'Reorder these elements in the markup so the keyboard order follows the visual layout.',
        tech: [issue.title, issue.detail, 'WCAG 2.2, 2.4.3 Focus Order, level A'],
      };
    }
    return {
      title: issue.title,
      why: issue.detail,
      howTo: issue.fix || null,
      tech: [issue.title],
    };
  }

  /* ------------------------------------------------------------- assembly */

  /**
   * Flatten every finding into one ordered list of plain-language items.
   * Order is worst-first, then top-to-bottom down the page — so pressing
   * "Next" walks you down the page rather than jumping around it.
   */
  const RANK = { critical: 3, warning: 2, notice: 1 };

  /**
   * Collapse findings of the same kind into one row.
   *
   * A gallery with 200 undescribed images has one problem, not 200. Listing
   * each occurrence separately is what makes a real page feel hopeless — the
   * list becomes longer than the page. Each row carries every occurrence, and
   * the issue screen steps through them one at a time.
   */
  function groupBy(issues, keyOf) {
    const groups = new Map();
    for (const issue of issues) {
      const key = keyOf(issue);
      if (!groups.has(key)) groups.set(key, { key, members: [], severity: issue.severity });
      const g = groups.get(key);
      g.members.push(issue);
      if ((RANK[issue.severity] || 0) > (RANK[g.severity] || 0)) g.severity = issue.severity;
    }
    return [...groups.values()];
  }

  /** Which kind of keyboard problem this is, ignoring the step number. */
  function tabKey(issue) {
    if (/positive tabindex/i.test(issue.title)) return 'positive';
    if (/off-screen/i.test(issue.title)) return 'offscreen';
    if (/jumps backwards/i.test(issue.title)) return 'backwards';
    return issue.id;
  }

  function build(results) {
    const items = [];

    // Measurable contrast failures: one row per urgency, not one per colour pair.
    const measurable = results.contrast.issues.filter((i) => !i.unmeasurable);
    for (const tier of ['fix', 'check']) {
      const members = measurable.filter((i) => tierOf(i.severity) === tier);
      if (!members.length) continue;
      items.push(makeItem(
        'contrast',
        tier === 'fix' ? 'critical' : 'warning',
        members, contrastItem(tier), `contrast:${tier}`, members[0],
      ));
    }

    // An unmeasurable background is a different problem with a different answer.
    for (const g of groupBy(results.contrast.issues.filter((i) => i.unmeasurable), (i) => i.unmeasurable)) {
      items.push(makeItem('contrast', g.severity, g.members, unmeasurableItem(g.key), `contrast:${g.key}`, g.members[0]));
    }

    for (const g of groupBy(results.images.issues, (i) => i.kind)) {
      items.push(makeItem('images', g.severity, g.members, imageItem(g.members[0]), `img:${g.key}`, g.members[0]));
    }
    for (const g of groupBy(results.headings.issues, (n) => n.problems[0]?.code || n.id)) {
      items.push(makeItem('headings', g.severity || 'notice', g.members, headingItem(g.members[0]), `h:${g.key}`, g.members[0]));
    }
    for (const g of groupBy(results.tabs.issues, tabKey)) {
      items.push(makeItem('tabs', g.severity, g.members, tabItem(g.members[0]), `tab:${g.key}`, g.members[0]));
    }

    const TIER = { fix: 0, check: 1 };
    items.sort((a, b) => {
      const t = TIER[a.tier] - TIER[b.tier];
      if (t) return t;
      return docOrder(a.targets[0]?.element, b.targets[0]?.element);
    });

    items.forEach((item, i) => { item.index = i; });
    return items;
  }

  /** Said once, in the row's own terms, rather than repeated as N rows. */
  const REPEATED = {
    contrast: (n) => `${n} pieces of text on this page have this problem.`,
    images: (n) => `${n} images on this page have the same problem.`,
    headings: (n) => `${n} headings on this page have the same problem.`,
    tabs: (n) => `This happens at ${n} points in the keyboard order.`,
  };

  function makeItem(category, severity, sources, text, id, raw) {
    // Every target keeps the finding it came from, so stepping through the
    // places can show that place's own evidence and its own fix rather than
    // always the first one's.
    const targets = sources
      .filter((s) => s.element)
      .map((s) => ({
        element: s.element,
        label: util.describe(s.element),
        text: s.text,
        source: s,
        tech: category === 'contrast' ? contrastTech(s) : null,
      }));

    const worded = sources.length > 1 && REPEATED[category]
      ? { ...text, why: `${text.why} ${REPEATED[category](sources.length)}` }
      : text;

    return {
      id: `item:${id}`,
      category,
      categoryLabel: CATEGORY[category],
      tier: tierOf(severity),
      severity,
      targets,
      raw,
      ...worded,
      tech: worded.tech || (category === 'contrast' ? contrastTech(sources[0]) : []),
    };
  }

  function docOrder(a, b) {
    if (!a || !b || a === b) return 0;
    try {
      const pos = a.compareDocumentPosition(b);
      if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    } catch { /* Different trees. */ }
    return 0;
  }

  /**
   * The headline. Counts, in words, without a score — a score invites gaming
   * and tells nobody what to do next.
   */
  function headline(items) {
    const fix = items.filter((i) => i.tier === 'fix').length;
    const check = items.length - fix;

    if (!items.length) return { big: 'Nothing to fix', small: 'This page looks good.' };
    if (!fix) {
      return {
        big: `${check} thing${check === 1 ? '' : 's'} to check`,
        small: 'Nothing is broken — these are worth a quick look.',
      };
    }
    return {
      big: `${fix} thing${fix === 1 ? '' : 's'} to fix`,
      small: check
        ? `And ${check} more worth checking.`
        : 'These make the page hard to use for some people.',
    };
  }

  LAO.copy = { build, headline, CATEGORY, tierOf };
})();
