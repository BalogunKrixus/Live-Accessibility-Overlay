/**
 * The panel.
 *
 * Structured like a spell-checker rather than a dashboard: a list of problems
 * in plain words, and a screen that walks through them one at a time. There are
 * no lens toggles and no numbers on the surface — every measurement, selector
 * and WCAG reference lives behind a collapsed "Technical details" disclosure,
 * so a developer can get at it and nobody else has to look at it.
 *
 * Page content (heading text, alt values, class names) is only ever set with
 * textContent, so a page cannot inject markup into the tool inspecting it.
 */
(() => {
  const LAO = (globalThis.__LAO__ ||= {});
  if (LAO.Panel) return;

  const { util, color, icons, copy } = LAO;

  const TIER_LABEL = { fix: 'Fix this', check: 'Worth checking' };

  /* ------------------------------------------------------- tiny DOM helper */

  /**
   * Icon markup is authored in icons.js and never contains page content, but
   * assigning it via innerHTML still trips the AMO reviewer's linter — and a
   * warning a human has to adjudicate is a slower review for no benefit.
   * Parsing once and cloning is safer, faster, and silent.
   */
  const svgCache = new Map();
  function svgNode(markup) {
    let parsed = svgCache.get(markup);
    if (!parsed) {
      parsed = new DOMParser().parseFromString(markup, 'image/svg+xml').documentElement;
      svgCache.set(markup, parsed);
    }
    return document.importNode(parsed, true);
  }

  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'svg') node.replaceChildren(svgNode(v)); // Authored icon markup.
      else if (k === 'on') for (const [ev, fn] of Object.entries(v)) node.addEventListener(ev, fn);
      else if (k === 'data') for (const [d, dv] of Object.entries(v)) node.dataset[d] = dv;
      else node.setAttribute(k, v === true ? '' : String(v));
    }
    for (const child of children.flat()) {
      if (child === null || child === undefined || child === false) continue;
      node.append(child.nodeType ? child : document.createTextNode(String(child)));
    }
    return node;
  }

  class Panel {
    constructor(host, root, handlers) {
      this.host = host;
      this.handlers = handlers;
      this.state = {
        results: null,
        items: [],
        view: 'home',        // home | issue | outline | keyboard
        activeIndex: -1,
        placeIndex: 0,
        techOpen: false,     // Sticky: a developer opens it once, not every time.
        scanning: true,
      };
      this.rowButtons = new Map();
      this._build(root);
    }

    /* --------------------------------------------------------------- build */

    _build(root) {
      this.el = el('div', {
        class: 'lao-panel',
        role: 'dialog',
        'aria-modal': 'false',
        'aria-label': 'Accessibility check',
        tabindex: '-1',
        data: { state: 'closed' },
      });

      this.themeBtn = el('button', {
        type: 'button', class: 'lao-icon-btn',
        on: { click: () => this.handlers.onCycleTheme() },
      });

      const closeBtn = el('button', {
        type: 'button', class: 'lao-icon-btn',
        title: 'Close (Esc)',
        'aria-label': 'Close accessibility check',
        svg: icons.close(16),
        on: { click: () => this.handlers.onClose() },
      });

      const head = el('div', { class: 'lao-head' },
        el('div', { class: 'lao-mark' },
          el('span', { svg: icons.mark(21), 'aria-hidden': 'true' }),
          el('span', { class: 'lao-wordmark' }, el('b', { text: 'Accessibility check' }))),
        el('div', { class: 'lao-head-actions' }, this.themeBtn, closeBtn));

      this.homeView = el('section', {
        class: 'lao-view lao-view--home', 'aria-label': 'What we found', tabindex: '-1',
      });
      this.subView = el('section', {
        class: 'lao-view', 'aria-label': 'Details', tabindex: '-1', inert: true,
      });

      const viewport = el('div', { class: 'lao-viewport' },
        el('div', { class: 'lao-track' }, this.homeView, this.subView));

      this.statusText = el('span', { text: 'Checking…' });
      this.status = el('p', {
        class: 'lao-status', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true',
      }, el('span', { class: 'lao-dot-live', 'aria-hidden': 'true' }), this.statusText);

      this.sideBtn = el('button', {
        type: 'button', class: 'lao-icon-btn lao-icon-btn--sm',
        title: 'Move panel to the other side',
        'aria-label': 'Move panel to the other side',
        svg: icons.dock(15),
        on: { click: () => this.handlers.onFlipSide() },
      });

      this.rescanBtn = el('button', {
        type: 'button', class: 'lao-icon-btn lao-icon-btn--sm',
        title: 'Check again',
        'aria-label': 'Check this page again',
        svg: icons.refresh(14),
        on: { click: () => this.handlers.onRescan() },
      });

      const foot = el('div', { class: 'lao-foot' },
        this.status,
        el('div', { class: 'lao-foot-actions' }, this.sideBtn, this.rescanBtn));

      this.el.append(head, viewport, foot);
      root.appendChild(this.el);

      this.el.addEventListener('keydown', (e) => this._onKeydown(e));
      this._syncThemeButton('system');
    }

    /* ------------------------------------------------------------ lifecycle */

    open() {
      this.el.dataset.state = 'open';
      requestAnimationFrame(() => this.el.focus({ preventScroll: true }));
    }

    close() { this.el.dataset.state = 'closed'; }

    _onKeydown(e) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        if (this.state.view === 'home') this.handlers.onClose();
        else this.showHome();
        return;
      }
      // Walking the list with the arrow keys is the fastest way through, and it
      // matches the Prev/Next buttons the mouse gets.
      if (this.state.view === 'issue' && (e.altKey || e.metaKey)) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); this.step(1); }
        if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); this.step(-1); }
      }
    }

    setScanning(scanning) {
      this.state.scanning = scanning;
      this.host.dataset.scanning = String(scanning);
      if (scanning) this.statusText.textContent = 'Checking this page…';
    }

    setTheme(mode) { this._syncThemeButton(mode); }

    _syncThemeButton(mode) {
      const next = { system: 'light', light: 'dark', dark: 'system' }[mode];
      this.themeBtn.replaceChildren(
        svgNode({ system: icons.auto(16), light: icons.sun(16), dark: icons.moon(16) }[mode]));
      const label = `Theme: ${mode === 'system' ? 'follows your system' : mode}. Switch to ${next}.`;
      this.themeBtn.setAttribute('aria-label', label);
      this.themeBtn.setAttribute('title', label);
    }

    setResults(results) {
      this.state.results = results;
      this.state.items = copy.build(results);
      this._renderHome();
      if (this.state.view === 'issue') {
        // A rescan can change the list under us; fall back to the overview
        // rather than showing a stale issue.
        if (!this.state.items[this.state.activeIndex]) this.showHome();
        else this._renderIssue();
      } else if (this.state.view === 'outline') this._renderOutline();
      else if (this.state.view === 'keyboard') this._renderKeyboard();
      this._renderStatus();
    }

    /* ---------------------------------------------------------------- home */

    _renderHome() {
      const items = this.state.items;
      const frag = document.createDocumentFragment();
      this.rowButtons.clear();

      if (!items.length) {
        frag.append(this._allClear());
      } else {
        const h = copy.headline(items);
        frag.append(el('div', { class: 'lao-hero' },
          el('h2', { class: 'lao-hero-big', text: h.big }),
          el('p', { class: 'lao-hero-small', text: h.small })));

        const fix = items.filter((i) => i.tier === 'fix');
        const check = items.filter((i) => i.tier === 'check');
        if (fix.length) {
          frag.append(this._sectionLabel('Fix these'), this._itemList(fix));
        }
        if (check.length) {
          frag.append(this._sectionLabel(fix.length ? 'Worth checking' : 'Worth a look'),
            this._itemList(check));
        }
      }

      frag.append(this._explore(), this._coverage());
      this.homeView.replaceChildren(frag);
    }

    _sectionLabel(text) {
      return el('h3', { class: 'lao-section-label' }, el('span', { text }));
    }

    _itemList(items) {
      const list = el('ul', { class: 'lao-items' });
      for (const item of items) {
        const places = item.targets.length > 1 ? `${item.targets.length} places` : null;
        const meta = [item.categoryLabel, places].filter(Boolean).join(' · ');

        const btn = el('button', {
          type: 'button',
          class: 'lao-item',
          'aria-label': `${TIER_LABEL[item.tier]}: ${item.title}. ${meta}.`,
          on: { click: () => this.showIssue(item.index) },
        },
          el('span', { class: 'lao-dot', data: { tier: item.tier }, 'aria-hidden': 'true' }),
          el('span', { class: 'lao-item-body' },
            el('span', { class: 'lao-item-title', text: item.title }),
            el('span', { class: 'lao-item-meta', text: meta })),
          el('span', { class: 'lao-chevron', svg: icons.chevronRight(14), 'aria-hidden': 'true' }));

        this.rowButtons.set(item.index, btn);
        list.append(el('li', {}, btn));
      }
      return list;
    }

    _allClear() {
      // The counts live in the coverage strip at the foot of the screen, in the
      // same place they appear when there *are* issues, so they are never said
      // twice and never move.
      return el('div', { class: 'lao-clear' },
        el('div', { class: 'lao-clear-mark' }, el('span', { svg: icons.markSolid(46) })),
        el('div', {},
          el('h2', { class: 'lao-clear-title', text: 'Nothing to fix' }),
          el('p', { text: 'We checked the text, images, headings and keyboard order on this page. It all looks good.' })));
    }

    /**
     * What the scan actually looked at. It is the denominator behind the
     * headline: "5 things to fix" means very different things over 12 pieces of
     * text and over 400.
     */
    _coverage() {
      const r = this.state.results;
      const bits = [
        [r.contrast.scanned, 'pieces of text'],
        [r.images.scanned, 'images'],
        [r.headings.scanned, 'headings'],
        [r.tabs.scanned, 'keyboard stops'],
      ];

      const line = el('p', { class: 'lao-coverage-line' });
      bits.forEach(([n, label], i) => {
        if (i) line.append(el('span', { class: 'lao-sep', text: '·', 'aria-hidden': 'true' }));
        line.append(el('b', { text: String(n) }), document.createTextNode(` ${label}`));
      });

      return el('div', { class: 'lao-coverage' },
        el('h3', { class: 'lao-coverage-label', text: 'Checked on this page' }),
        line);
    }

    /** The two deeper views, kept out of the main flow so they never demand attention. */
    _explore() {
      const wrap = el('div', { class: 'lao-explore' });
      wrap.append(this._sectionLabel('Take a closer look'));

      const list = el('ul', { class: 'lao-items lao-items--quiet' });
      for (const [label, hint, action] of [
        ['Page outline', 'How the headings are structured', () => this.showOutline()],
        ['Keyboard path', 'The route the Tab key takes', () => this.showKeyboard()],
      ]) {
        list.append(el('li', {},
          el('button', {
            type: 'button', class: 'lao-item', on: { click: action },
          },
            el('span', { class: 'lao-item-body' },
              el('span', { class: 'lao-item-title', text: label }),
              el('span', { class: 'lao-item-meta', text: hint })),
            el('span', { class: 'lao-chevron', svg: icons.chevronRight(14), 'aria-hidden': 'true' }))));
      }
      wrap.append(list);
      return wrap;
    }

    _renderStatus() {
      const items = this.state.items;
      const fix = items.filter((i) => i.tier === 'fix').length;
      this.statusText.textContent = !items.length
        ? 'No problems found'
        : `${items.length} found · ${fix} to fix`;
      this.host.dataset.scanning = 'false';
    }

    /* ---------------------------------------------------------- navigation */

    _enterSub(label) {
      this.host.dataset.view = 'detail';
      this.homeView.setAttribute('inert', '');
      this.subView.removeAttribute('inert');
      this.subView.setAttribute('aria-label', label);
      requestAnimationFrame(() => this.subView.focus({ preventScroll: true }));
    }

    showHome() {
      const from = this.state.activeIndex;
      this.state.view = 'home';
      this.host.dataset.view = 'home';
      this.subView.setAttribute('inert', '');
      this.homeView.removeAttribute('inert');
      this.handlers.onClearMarks();
      requestAnimationFrame(() => {
        const btn = this.rowButtons.get(from);
        if (btn) btn.focus({ preventScroll: true });
        else this.homeView.focus({ preventScroll: true });
      });
    }

    showIssue(index) {
      const item = this.state.items[index];
      if (!item) return;
      this.state.view = 'issue';
      this.state.activeIndex = index;
      this.state.placeIndex = 0;
      this._renderIssue();
      this._enterSub(item.title);
      this._revealCurrent();
    }

    step(delta) {
      const next = this.state.activeIndex + delta;
      if (next < 0 || next >= this.state.items.length) return;
      this.state.activeIndex = next;
      this.state.placeIndex = 0;
      this._renderIssue();
      this._revealCurrent();
      this._announce(`${this.state.items[next].title}. ${next + 1} of ${this.state.items.length}.`);
    }

    _revealCurrent() {
      const item = this.state.items[this.state.activeIndex];
      const target = item?.targets[this.state.placeIndex];
      if (target) this.handlers.onShowTarget(target.element, item.tier, item.title);
      else this.handlers.onClearMarks();
    }

    /* --------------------------------------------------------- issue screen */

    _renderIssue() {
      const item = this.state.items[this.state.activeIndex];
      if (!item) return;
      const total = this.state.items.length;
      const n = this.state.activeIndex;

      const prev = el('button', {
        type: 'button', class: 'lao-step-btn',
        'aria-label': 'Previous issue',
        disabled: n === 0,
        svg: icons.chevronLeft(14),
        on: { click: () => this.step(-1) },
      });
      const next = el('button', {
        type: 'button', class: 'lao-step-btn',
        'aria-label': 'Next issue',
        disabled: n === total - 1,
        svg: icons.chevronRight(14),
        on: { click: () => this.step(1) },
      });

      const header = el('div', { class: 'lao-sub-head' },
        this._backButton(),
        el('div', { class: 'lao-stepper' },
          prev,
          el('span', { class: 'lao-stepper-count', text: `${n + 1} of ${total}` }),
          next));

      const body = el('div', { class: 'lao-sub-body' },
        el('span', { class: 'lao-tier', data: { tier: item.tier } },
          el('span', { class: 'lao-dot', data: { tier: item.tier }, 'aria-hidden': 'true' }),
          TIER_LABEL[item.tier]),
        el('h3', { class: 'lao-issue-title', text: item.title }));

      // Evidence and the suggested fix describe the place currently being
      // shown, not the first one — stepping through the places changes both.
      const place = item.targets[this.state.placeIndex];
      const source = place?.source || item.raw;

      const evidence = this._evidence(item, source);
      if (evidence) body.append(evidence);

      // The stepper sits between the sample above it and the fix below it,
      // because moving between places changes both of them.
      if (item.targets.length > 1) body.append(this._places(item));

      body.append(el('section', { class: 'lao-block' },
        el('h4', { class: 'lao-block-title', text: 'Why this matters' }),
        el('p', { class: 'lao-prose', text: item.why })));

      const how = this._howToFix(item, source);
      if (how) body.append(how);

      if (item.targets.length === 1) {
        body.append(el('div', { class: 'lao-actions' },
          el('button', {
            type: 'button', class: 'lao-btn',
            on: { click: () => this._revealCurrent() },
          }, el('span', { svg: icons.target(13), 'aria-hidden': 'true' }), 'Show me on the page')));
      }

      if (item.category === 'tabs') {
        body.append(el('div', { class: 'lao-actions' },
          el('button', {
            type: 'button', class: 'lao-btn',
            on: { click: () => this.showKeyboard() },
          }, 'See the whole keyboard path')));
      }

      body.append(this._tech(item, place));
      this.subView.replaceChildren(header, body);
    }

    _backButton() {
      return el('button', {
        type: 'button', class: 'lao-back', on: { click: () => this.showHome() },
      }, el('span', { svg: icons.chevronLeft(14), 'aria-hidden': 'true' }), 'All issues');
    }

    /** The thing itself: the failing colours, the current alt text, the heading. */
    _evidence(item, source) {
      if (item.category === 'contrast' && source && !source.unmeasurable) {
        return this._contrastReadout(source);
      }
      if (item.category === 'images' && source?.altValue) {
        return el('div', { class: 'lao-quote' },
          el('span', { class: 'lao-quote-label', text: 'It currently says' }),
          el('span', { class: 'lao-quote-text', text: source.altValue }));
      }
      if (item.category === 'headings' && source?.name && source.name !== '(no text)') {
        return el('div', { class: 'lao-quote' },
          el('span', { class: 'lao-quote-label', text: 'The heading' }),
          el('span', { class: 'lao-quote-text', text: source.name }));
      }
      return null;
    }

    /**
     * The score, both colours, and a specimen — in that order.
     *
     * The specimen used to be the whole block, rendered full-bleed in the real
     * colours. For a near-white-on-white pairing that is a blank rectangle:
     * literally accurate, and indistinguishable from the panel being broken. It
     * is now a small labelled strip beneath the numbers, which are what tell you
     * whether this is bad and by how much.
     */
    _contrastReadout(issue) {
      const ratio = color.round(issue.ratio, 2);
      const verdict = issue.ratio >= issue.requiredAAA ? 'aaa'
        : issue.ratio >= issue.required ? 'aa' : 'fail';
      const verdictLabel = { aaa: 'Passes AAA', aa: 'Passes AA', fail: 'Fails AA' }[verdict];

      const swatchRow = (label, hex) =>
        el('div', { class: 'lao-swatch-row' },
          // A ring on both sides of the edge keeps a white chip visible on a
          // light panel and a near-black one visible on a dark panel.
          el('span', { class: 'lao-swatch-chip', style: `background:${hex}`, 'aria-hidden': 'true' }),
          el('span', { class: 'lao-swatch-label', text: label }),
          el('code', { class: 'lao-swatch-hex', text: hex }));

      return el('div', { class: 'lao-contrast' },
        el('div', { class: 'lao-contrast-score' },
          el('div', { class: 'lao-score-figure' },
            el('b', { text: String(ratio) }),
            el('span', { text: ': 1' })),
          el('div', { class: 'lao-score-side' },
            el('span', { class: 'lao-verdict', data: { verdict }, text: verdictLabel }),
            el('span', {
              class: 'lao-score-need',
              text: `Needs ${issue.required}:1${issue.large ? ' (large text)' : ''}`,
            }))),

        el('div', { class: 'lao-contrast-colours' },
          swatchRow('Text', issue.fgHex),
          swatchRow('Background', issue.bgHex)),

        el('div', { class: 'lao-specimen' },
          el('span', { class: 'lao-specimen-label', text: 'How it looks' }),
          el('span', {
            class: 'lao-specimen-box',
            style: `background:${issue.bgHex};color:${issue.fgHex}`,
            text: 'Text like this',
          })));
    }

    _howToFix(item, source) {
      const block = el('section', { class: 'lao-block' },
        el('h4', { class: 'lao-block-title', text: 'How to fix it' }));

      if (item.category === 'contrast' && source && !source.unmeasurable) {
        const issue = source;
        const fix = issue.fix;
        const best = fix.text?.changed ? fix.text : null;

        if (!best) {
          block.append(el('p', {
            class: 'lao-prose',
            text: 'This colour cannot be made readable by making it lighter or darker — it needs a different colour altogether.',
          }));
          return block;
        }

        const hex = color.toHex(best.color);
        block.append(el('p', {
          class: 'lao-prose',
          text: 'Darkening the text is usually the smallest change. This is the closest colour to the original that people can read:',
        }));
        block.append(el('button', {
          type: 'button',
          class: 'lao-swap',
          'aria-label': `Use ${hex} instead of ${issue.fgHex}. Copy this colour.`,
          on: { click: (e) => this._copy(hex, e.currentTarget) },
        },
          el('span', { class: 'lao-swap-chips', 'aria-hidden': 'true' },
            el('span', { class: 'lao-chip-colour', style: `background:${issue.fgHex}` }),
            el('span', { class: 'lao-swap-arrow', svg: icons.chevronRight(12) }),
            el('span', { class: 'lao-chip-colour', style: `background:${hex}` })),
          el('span', { class: 'lao-swap-body' },
            el('b', { class: 'lao-swap-hex', text: hex }),
            // The score the change buys you, so the fix is judged the same way
            // the problem was.
            el('span', { class: 'lao-swap-note' },
              `${color.round(best.ratio, 2)}:1 · `,
              el('span', { class: 'lao-swap-pass', text: 'passes AA' })),
            el('span', { class: 'lao-swap-copied', text: 'Copied', hidden: true })),
          el('span', { class: 'lao-copy-icon', svg: icons.copy(14), 'aria-hidden': 'true' })));
        return block;
      }

      if (!item.howTo) return null;
      block.append(el('p', { class: 'lao-prose', text: item.howTo }));
      return block;
    }

    _places(item) {
      const total = item.targets.length;
      const i = this.state.placeIndex;
      const target = item.targets[i];

      const go = (delta) => {
        this.state.placeIndex = (i + delta + total) % total;
        this._renderIssue();
        this._revealCurrent();
      };

      return el('section', { class: 'lao-block' },
        el('h4', { class: 'lao-block-title', text: `Where it happens` }),
        el('div', { class: 'lao-places' },
          el('button', {
            type: 'button', class: 'lao-step-btn',
            'aria-label': 'Previous place', on: { click: () => go(-1) },
            svg: icons.chevronLeft(14),
          }),
          el('span', { class: 'lao-places-body' },
            el('span', { class: 'lao-places-count', text: `${i + 1} of ${total}` }),
            el('span', { class: 'lao-places-text', text: target?.text || target?.label || '' })),
          el('button', {
            type: 'button', class: 'lao-step-btn',
            'aria-label': 'Next place', on: { click: () => go(1) },
            svg: icons.chevronRight(14),
          })));
    }

    /**
     * Everything an engineer needs and nobody else wants to see. Native
     * <details> gives correct semantics for free; the open state is sticky so a
     * developer sets it once rather than on every issue.
     */
    _tech(item, place) {
      const list = el('ul', { class: 'lao-tech-list' });
      // Contrast numbers belong to the place on screen, not to the group.
      for (const line of place?.tech || item.tech || []) list.append(el('li', { text: line }));
      if (place) list.append(el('li', { class: 'lao-tech-sel', text: place.label }));

      const details = el('details', { class: 'lao-tech', open: this.state.techOpen || null },
        el('summary', { class: 'lao-tech-summary' },
          el('span', { class: 'lao-chevron', svg: icons.chevronRight(12), 'aria-hidden': 'true' }),
          'Technical details'),
        list);

      details.addEventListener('toggle', () => { this.state.techOpen = details.open; });
      return details;
    }

    async _copy(text, button) {
      try {
        await navigator.clipboard.writeText(text);
        // Swap between two elements rather than rewriting one: the note carries
        // the ratio and its verdict, which overwriting would destroy.
        const note = button.querySelector('.lao-swap-note');
        const done = button.querySelector('.lao-swap-copied');
        if (note && done) {
          note.hidden = true;
          done.hidden = false;
          clearTimeout(this._copyTimer);
          this._copyTimer = setTimeout(() => {
            note.hidden = false;
            done.hidden = true;
          }, 1500);
        }
        this._announce(`${text} copied`);
      } catch {
        this._announce('This page blocks copying');
      }
    }

    /* -------------------------------------------------------- page outline */

    showOutline() {
      this.state.view = 'outline';
      this.state.activeIndex = -1;
      this._renderOutline();
      this._enterSub('Page outline');
      this.handlers.onClearMarks();
    }

    _renderOutline() {
      const result = this.state.results.headings;
      const header = el('div', { class: 'lao-sub-head' },
        this._backButton(),
        el('span', { class: 'lao-sub-title', text: 'Page outline' }));

      const body = el('div', { class: 'lao-sub-body' });
      body.append(el('p', {
        class: 'lao-prose',
        text: 'Headings are the table of contents people use to navigate a page by screen reader. Each step should go down one level at a time.',
      }));

      if (!result.outline.length) {
        body.append(el('p', { class: 'lao-prose', text: 'This page has no headings at all.' }));
        this.subView.replaceChildren(header, body);
        return;
      }

      const list = el('ul', { class: 'lao-outline' });
      for (const node of result.outline) {
        const rail = el('span', { class: 'lao-rail', 'aria-hidden': 'true' });
        for (let i = 1; i < Math.min(node.level, 5); i++) rail.append(el('i'));
        const flag = node.problems[0];

        list.append(el('li', {},
          el('button', {
            type: 'button',
            class: 'lao-h',
            data: { sev: node.severity || 'none' },
            'aria-label': `Level ${node.level}: ${node.name}${flag ? `. ${flag.label}` : ''}. Show on the page.`,
            on: { click: () => this.handlers.onShowTarget(node.element, flag ? 'fix' : 'none', node.name) },
          },
            rail,
            el('span', { class: 'lao-h-level', text: `H${node.level}` }),
            el('span', { class: 'lao-h-text', text: node.name }),
            flag ? el('span', {
              class: 'lao-h-flag', data: { sev: flag.severity }, text: flag.short || flag.label,
            }) : null)));
      }
      body.append(list);
      this.subView.replaceChildren(header, body);
    }

    /* --------------------------------------------------------- keyboard path */

    showKeyboard() {
      this.state.view = 'keyboard';
      this._renderKeyboard();
      this._enterSub('Keyboard path');
      this.handlers.onShowTabPath(true);
    }

    _renderKeyboard() {
      const result = this.state.results.tabs;
      const header = el('div', { class: 'lao-sub-head' },
        el('button', {
          type: 'button', class: 'lao-back',
          on: {
            click: () => { this.handlers.onShowTabPath(false); this.showHome(); },
          },
        }, el('span', { svg: icons.chevronLeft(14), 'aria-hidden': 'true' }), 'All issues'),
        el('span', { class: 'lao-sub-title', text: 'Keyboard path' }));

      const body = el('div', { class: 'lao-sub-body' });
      body.append(el('p', {
        class: 'lao-prose',
        text: 'This is the route the Tab key takes through the page, drawn in order. It should flow the same way the page reads. Orange dashes mean focus jumps backwards.',
      }));

      if (!result.steps.length) {
        body.append(el('p', { class: 'lao-prose', text: 'Nothing on this page can be reached with the keyboard.' }));
        this.subView.replaceChildren(header, body);
        return;
      }

      const list = el('ul', { class: 'lao-path-list' });
      for (const step of result.steps.slice(0, 80)) {
        const problem = step.offCanvas ? 'off-screen' : step.backward ? 'goes backwards' : null;
        list.append(el('li', {},
          el('button', {
            type: 'button', class: 'lao-path-row',
            'aria-label': `Stop ${step.index}: ${step.name || 'no name'}${problem ? `, ${problem}` : ''}. Show on the page.`,
            on: { click: () => this.handlers.onShowTarget(step.el, problem ? 'fix' : 'none', step.name) },
          },
            el('span', { class: 'lao-path-num', text: String(step.index) }),
            el('span', {
              class: step.name ? 'lao-path-name' : 'lao-path-name lao-unnamed',
              text: step.name || 'No name — a screen reader cannot announce this',
            }),
            problem ? el('span', {
              class: 'lao-h-flag',
              data: { sev: step.offCanvas ? 'critical' : 'warning' },
              text: problem,
            }) : null)));
      }
      body.append(list);
      this.subView.replaceChildren(header, body);
    }

    _announce(message) {
      this.statusText.textContent = message;
      clearTimeout(this._announceTimer);
      this._announceTimer = setTimeout(() => this._renderStatus(), 2600);
    }
  }

  LAO.Panel = Panel;
})();
