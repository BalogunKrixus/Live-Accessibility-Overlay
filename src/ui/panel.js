/**
 * The panel.
 *
 * Everything user-visible is built with real elements and textContent — page
 * content (heading text, alt values, class names) is never interpolated into
 * markup, so a page cannot inject anything into the tool inspecting it.
 */
(() => {
  const LAO = (globalThis.__LAO__ ||= {});
  if (LAO.Panel) return;

  const { util, color, icons } = LAO;

  const LENSES = [
    { key: 'contrast', name: 'Contrast', icon: 'contrast', unit: 'text elements' },
    { key: 'headings', name: 'Heading map', icon: 'headings', unit: 'headings' },
    { key: 'images', name: 'Alt text', icon: 'images', unit: 'images' },
    { key: 'tabs', name: 'Tab order', icon: 'tabs', unit: 'focus stops' },
  ];

  const SEV_LABEL = { critical: 'Critical', warning: 'Warning', notice: 'Notice' };
  const RANK = { critical: 3, warning: 2, notice: 1 };

  /* ------------------------------------------------------- tiny DOM helper */

  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'svg') node.innerHTML = v; // Icon markup only, authored here.
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

  const meter = (sev) =>
    el('span', { class: 'lao-meter', data: { sev }, 'aria-hidden': 'true' },
      el('i'), el('i'), el('i'));

  /* ------------------------------------------------------------------ panel */

  class Panel {
    constructor(host, root, handlers) {
      this.host = host;
      this.handlers = handlers;
      this.state = {
        results: null,
        lenses: { contrast: true, headings: true, images: true, tabs: false },
        view: 'home',
        activeLens: null,
        selectedId: null,
        scanning: true,
        expanded: new Set(),
      };
      this.lensButtons = new Map();
      this._build(root);
    }

    /* --------------------------------------------------------------- build */

    _build(root) {
      this.el = el('div', {
        class: 'lao-panel',
        role: 'dialog',
        'aria-modal': 'false',
        'aria-label': 'Live Accessibility Overlay',
        tabindex: '-1',
        data: { state: 'closed' },
      });

      /* Header ------------------------------------------------------------ */
      this.themeBtn = el('button', {
        type: 'button',
        class: 'lao-icon-btn',
        on: { click: () => this.handlers.onCycleTheme() },
      });

      this.sideBtn = el('button', {
        type: 'button',
        class: 'lao-icon-btn',
        title: 'Move panel to the other side',
        'aria-label': 'Move panel to the other side',
        svg: icons.dock(16),
        on: { click: () => this.handlers.onFlipSide() },
      });

      const closeBtn = el('button', {
        type: 'button',
        class: 'lao-icon-btn',
        title: 'Close (Esc)',
        'aria-label': 'Close accessibility overlay',
        svg: icons.close(16),
        on: { click: () => this.handlers.onClose() },
      });

      const head = el('div', { class: 'lao-head' },
        el('div', { class: 'lao-mark' },
          el('span', { svg: icons.aperture(22), 'aria-hidden': 'true' }),
          el('span', { class: 'lao-wordmark' },
            el('b', { text: 'Live Accessibility' }),
            el('span', { text: 'Overlay' }))),
        el('div', { class: 'lao-head-actions' }, this.themeBtn, this.sideBtn, closeBtn));

      /* Views ------------------------------------------------------------- */
      this.homeView = el('section', {
        class: 'lao-view lao-view--home',
        'aria-label': 'Overview',
        tabindex: '-1',
      });
      this.detailView = el('section', {
        class: 'lao-view',
        'aria-label': 'Issue details',
        tabindex: '-1',
        inert: true,
      });

      const track = el('div', { class: 'lao-track' }, this.homeView, this.detailView);
      const viewport = el('div', { class: 'lao-viewport' }, track);

      /* Footer ------------------------------------------------------------ */
      this.statusText = el('span', { text: 'Scanning…' });
      this.status = el('p', {
        class: 'lao-status',
        role: 'status',
        'aria-live': 'polite',
        'aria-atomic': 'true',
      }, el('span', { class: 'lao-dot', 'aria-hidden': 'true' }), this.statusText);

      this.rescanBtn = el('button', {
        type: 'button',
        class: 'lao-btn',
        on: { click: () => this.handlers.onRescan() },
      }, el('span', { svg: icons.refresh(13), 'aria-hidden': 'true' }), 'Rescan');

      const foot = el('div', { class: 'lao-foot' }, this.status, this.rescanBtn);

      this.el.append(head, viewport, foot);
      root.appendChild(this.el);

      this.el.addEventListener('keydown', (e) => this._onKeydown(e));
      this._syncThemeButton('system');
    }

    /* ------------------------------------------------------------ lifecycle */

    open() {
      this.el.dataset.state = 'open';
      // Focus the panel container, not the first control: a screen reader then
      // announces the dialog's name and role before any button label.
      requestAnimationFrame(() => this.el.focus({ preventScroll: true }));
    }

    close() {
      this.el.dataset.state = 'closed';
    }

    _onKeydown(e) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        // Escape unwinds one level at a time rather than discarding the session.
        if (this.state.view === 'detail') this.showHome();
        else this.handlers.onClose();
      }
    }

    /* --------------------------------------------------------------- state */

    setScanning(scanning) {
      this.state.scanning = scanning;
      this.host.dataset.scanning = String(scanning);
      if (scanning) this.statusText.textContent = 'Scanning page…';
    }

    setTheme(mode) {
      this._syncThemeButton(mode);
    }

    _syncThemeButton(mode) {
      const next = { system: 'light', light: 'dark', dark: 'system' }[mode];
      const glyph = { system: icons.auto(16), light: icons.sun(16), dark: icons.moon(16) }[mode];
      this.themeBtn.innerHTML = glyph;
      const label = `Theme: ${mode === 'system' ? 'follows system' : mode}. Switch to ${next}.`;
      this.themeBtn.setAttribute('aria-label', label);
      this.themeBtn.setAttribute('title', label);
    }

    setResults(results) {
      this.state.results = results;
      this.render();
    }

    setLenses(lenses) {
      this.state.lenses = lenses;
      this.render();
    }

    /* -------------------------------------------------------------- render */

    render() {
      if (!this.state.results) return;
      this._renderHome();
      if (this.state.view === 'detail' && this.state.activeLens) this._renderDetail();
      this._renderStatus();
    }

    counts() {
      const r = this.state.results;
      const per = {
        contrast: r.contrast.issues,
        headings: r.headings.issues,
        images: r.images.issues,
        tabs: r.tabs.issues,
      };
      const summary = {};
      let total = 0;
      const bySeverity = { critical: 0, warning: 0, notice: 0 };

      for (const [key, issues] of Object.entries(per)) {
        // A lens that is switched off still reports its count — hiding the
        // number would make the toggle feel like it changes the page's quality
        // rather than what is drawn on it.
        const sev = { critical: 0, warning: 0, notice: 0 };
        for (const i of issues) sev[i.severity] = (sev[i.severity] || 0) + 1;
        summary[key] = { total: issues.length, ...sev, worst: worstOf(issues) };
        total += issues.length;
        for (const k of Object.keys(bySeverity)) bySeverity[k] += sev[k];
      }
      return { per: summary, total, bySeverity };
    }

    _renderHome() {
      const r = this.state.results;
      const c = this.counts();
      const frag = document.createDocumentFragment();

      if (c.total === 0) {
        frag.append(this._allClear(r));
      } else {
        frag.append(this._summary(c));
      }

      frag.append(
        el('h2', { class: 'lao-section-label' }, el('span', { text: 'Lenses' })),
        this._lensList(c),
      );

      // The worst few findings, surfaced without a drill-in. Opening a tool and
      // immediately seeing the actual problem is the whole point; making people
      // hunt for it through a menu is the thing that makes audits feel like
      // homework.
      const top = this._priority();
      if (top.length) {
        frag.append(
          el('h2', { class: 'lao-section-label' }, el('span', { text: 'Start here' })),
          this._priorityList(top),
        );
      }

      // The all-clear state already reports what was checked, so the coverage
      // strip would just print the same four numbers a second time.
      if (c.total > 0) frag.append(this._coverage(r));
      this.homeView.replaceChildren(frag);
    }

    _summary(c) {
      const total = c.total;
      const bar = el('div', { class: 'lao-bar', 'aria-hidden': 'true' });
      for (const sev of ['critical', 'warning', 'notice']) {
        if (!c.bySeverity[sev]) continue;
        bar.append(el('i', { data: { sev }, style: `flex-grow:${c.bySeverity[sev]}` }));
      }

      const legend = el('ul', { class: 'lao-legend' });
      for (const sev of ['critical', 'warning', 'notice']) {
        if (!c.bySeverity[sev]) continue;
        legend.append(el('li', {},
          meter(sev),
          el('b', { text: String(c.bySeverity[sev]) }),
          el('span', { text: SEV_LABEL[sev].toLowerCase() })));
      }

      return el('div', { class: 'lao-summary' },
        el('p', { class: 'lao-count' },
          el('b', { text: String(total) }),
          el('span', { text: total === 1 ? 'thing to look at' : 'things to look at' })),
        bar,
        legend);
    }

    _allClear(r) {
      const checked = [
        [r.contrast.scanned, 'text elements'],
        [r.images.scanned, 'images'],
        [r.headings.scanned, 'headings'],
        [r.tabs.scanned, 'focus stops'],
      ];

      const tallies = el('div', { class: 'lao-tallies' });
      for (const [n, label] of checked) {
        tallies.append(el('div', {}, el('b', { text: String(n) }), el('span', { text: label })));
      }

      return el('div', { class: 'lao-clear' },
        el('div', { class: 'lao-clear-mark' }, el('span', { svg: icons.apertureOpen(46) })),
        el('div', {},
          el('h2', { class: 'lao-clear-title', text: 'Nothing to flag' }),
          el('p', { text: 'Contrast, headings, alt text and tab order all check out on this page.' })),
        tallies);
    }

    _lensList(c) {
      const list = el('ul', { class: 'lao-lenses' });
      this.lensButtons.clear();

      for (const lens of LENSES) {
        const stat = c.per[lens.key];
        const on = this.state.lenses[lens.key];
        const tone = stat.total === 0 ? 'clear' : stat.worst;
        const labelId = `lao-lens-${lens.key}`;

        const openBtn = el('button', {
          type: 'button',
          class: 'lao-lens-open',
          'aria-label':
            `${lens.name}: ${stat.total === 0 ? `no issues, ${scannedFor(this.state.results, lens.key)} ${lens.unit} checked` : `${stat.total} ${stat.total === 1 ? 'issue' : 'issues'}`}. Open details.`,
          on: { click: () => this.showDetail(lens.key) },
        },
          el('span', { class: 'lao-lens-name', id: labelId, text: lens.name }),
          el('span', {
            class: 'lao-lens-meta',
            text: stat.total === 0
              ? `${scannedFor(this.state.results, lens.key)} ${lens.unit} · clear`
              : severityBreakdown(stat),
          }));

        const toggle = el('button', {
          type: 'button',
          class: 'lao-switch',
          role: 'switch',
          'aria-checked': String(on),
          'aria-label': `Draw ${lens.name.toLowerCase()} markers on the page`,
          on: { click: () => this.handlers.onToggleLens(lens.key) },
        });

        const row = el('li', { class: 'lao-lens', data: { on: String(on) } },
          el('span', { class: 'lao-lens-glyph', svg: icons[lens.icon](16), 'aria-hidden': 'true' }),
          openBtn,
          el('span', { class: 'lao-tally', data: { sev: tone }, 'aria-hidden': 'true' },
            stat.total === 0
              ? el('span', { class: 'lao-tally-clear', svg: icons.check(14) })
              : el('span', { text: String(stat.total) })),
          toggle);

        this.lensButtons.set(lens.key, openBtn);
        list.append(row);
      }
      return list;
    }

    /**
     * The handful of findings worth looking at first: worst severity wins, and
     * within a severity the lenses are ordered by how structural the problem is
     * (a nameless link beats a near-miss contrast ratio).
     */
    _priority() {
      const r = this.state.results;
      const weight = { images: 3, tabs: 2, headings: 1, contrast: 0 };
      const pool = [
        ...r.images.issues,
        ...r.tabs.issues,
        ...r.headings.issues,
        // One row per colour pair, not per element — otherwise a single bad
        // token would fill this list on its own.
        ...r.contrast.groups.map((g) => ({ ...g.issues[0], _group: g.key, _count: g.issues.length })),
      ];

      return pool
        .filter((i) => i.severity === 'critical' || i.severity === 'warning')
        .sort((a, b) =>
          (RANK[b.severity] - RANK[a.severity]) ||
          (weight[b.lens] - weight[a.lens]))
        .slice(0, 4);
    }

    _priorityList(items) {
      const list = el('ul', { class: 'lao-top' });
      const lensName = (k) => LENSES.find((l) => l.key === k)?.name ?? k;

      for (const issue of items) {
        const title = issue.lens === 'contrast' && !issue.unmeasurable
          ? `${color.round(issue.ratio, 2)}:1 where ${issue.required}:1 is needed`
          : issue.title || issue.problems?.[0]?.label || 'Issue';
        const extra = issue._count > 1 ? ` · ${issue._count} elements` : '';

        list.append(el('li', {},
          el('button', {
            type: 'button',
            class: 'lao-top-row',
            'aria-label': `${SEV_LABEL[issue.severity]}: ${title}. In ${lensName(issue.lens)}. Open details.`,
            on: {
              click: () => {
                const cardId = issue._group || issue.id;
                this.state.expanded.add(cardId);
                this.showDetail(issue.lens);
              },
            },
          },
            meter(issue.severity),
            el('span', { class: 'lao-top-body' },
              el('span', { class: 'lao-top-title', text: title }),
              el('span', { class: 'lao-top-meta', text: `${lensName(issue.lens)}${extra}` })),
            el('span', { class: 'lao-chevron', svg: icons.chevronRight(13), 'aria-hidden': 'true' }))));
      }
      return list;
    }

    /** What the scan actually looked at — the denominator behind the counts. */
    _coverage(r) {
      const bits = [
        [r.contrast.scanned, 'text elements'],
        [r.images.scanned, 'images'],
        [r.headings.scanned, 'headings'],
        [r.tabs.scanned, 'focus stops'],
      ];
      const line = el('p', { class: 'lao-coverage-line' });
      bits.forEach(([n, label], i) => {
        if (i) line.append(el('span', { class: 'lao-sep', text: '·', 'aria-hidden': 'true' }));
        line.append(el('b', { text: String(n) }), document.createTextNode(` ${label}`));
      });
      return el('div', { class: 'lao-coverage' },
        el('span', { class: 'lao-coverage-label', text: 'Checked on this page' }),
        line);
    }

    _renderStatus() {
      const c = this.counts();
      const parts = [];
      if (c.total === 0) parts.push('No issues found');
      else {
        parts.push(`${c.total} ${c.total === 1 ? 'issue' : 'issues'}`);
        const bits = ['critical', 'warning', 'notice']
          .filter((s) => c.bySeverity[s])
          .map((s) => `${c.bySeverity[s]} ${s}`);
        if (bits.length > 1) parts.push(`(${bits.join(', ')})`);
      }
      this.statusText.textContent = parts.join(' ');
      this.host.dataset.scanning = 'false';
    }

    /* ------------------------------------------------------------ navigation */

    showDetail(lensKey) {
      this.state.activeLens = lensKey;
      this.state.view = 'detail';
      this.host.dataset.view = 'detail';
      this.homeView.setAttribute('inert', '');
      this.detailView.removeAttribute('inert');
      this._renderDetail();
      const lensName = LENSES.find((l) => l.key === lensKey)?.name ?? 'Issue';
      this.detailView.setAttribute('aria-label', `${lensName} details`);
      requestAnimationFrame(() => this.detailView.focus({ preventScroll: true }));
    }

    showHome() {
      const previous = this.state.activeLens;
      this.state.view = 'home';
      this.host.dataset.view = 'home';
      this.detailView.setAttribute('inert', '');
      this.homeView.removeAttribute('inert');
      this.handlers.onSelect(null);
      requestAnimationFrame(() => {
        const btn = this.lensButtons.get(previous);
        btn?.focus({ preventScroll: true });
      });
    }

    _renderDetail() {
      const key = this.state.activeLens;
      const lens = LENSES.find((l) => l.key === key);
      const r = this.state.results;

      const back = el('button', {
        type: 'button',
        class: 'lao-back',
        on: { click: () => this.showHome() },
      }, el('span', { svg: icons.chevronLeft(14), 'aria-hidden': 'true' }), 'Overview');

      this.detailHeading = el('h2', { class: 'lao-detail-title', text: lens.name });

      const header = el('div', { class: 'lao-detail-head' }, back, this.detailHeading);

      let body;
      if (key === 'contrast') body = this._contrastDetail(r.contrast);
      else if (key === 'headings') body = this._headingsDetail(r.headings);
      else if (key === 'images') body = this._imagesDetail(r.images);
      else body = this._tabsDetail(r.tabs);

      this.detailView.replaceChildren(header, body);
    }

    /* ----------------------------------------------------- detail: contrast */

    _contrastDetail(result) {
      if (!result.issues.length) {
        return this._lensClear(
          'Every text element passes',
          `All ${result.scanned} text elements meet WCAG AA for their size and weight.`,
        );
      }

      const wrap = el('div', { class: 'lao-issues' });

      for (const group of result.groups) {
        const first = group.issues[0];
        const count = group.issues.length;

        const title = first.unmeasurable
          ? first.title
          : `${color.round(first.ratio, 2)}:1 against ${first.required}:1`;
        const sub = first.unmeasurable
          ? first.detail
          : `${count} element${count === 1 ? '' : 's'} · ${first.fgHex} on ${first.bgHex}`;

        wrap.append(this._card({
          id: group.key,
          severity: group.severity,
          title,
          sub,
          build: () => this._contrastCardBody(group),
        }));
      }
      return wrap;
    }

    _contrastCardBody(group) {
      const first = group.issues[0];
      const parts = [el('p', { class: 'lao-prose', text: first.detail })];

      if (!first.unmeasurable) {
        // The pair, shown as it actually appears — the sample is the evidence.
        // The swatch renders the real pairing as evidence. It deliberately
        // carries no caption: any label inside it would inherit the failing
        // colours, and an accessibility tool must not print unreadable text.
        // The hex values live in the card subtitle instead.
        parts.push(el('div', { class: 'lao-pair' },
          el('div', {
            class: 'lao-pair-sample',
            style: `background:${first.bgHex};color:${first.fgHex}`,
          },
            el('b', { text: 'Sample text' })),
          el('div', { class: 'lao-ratio' },
            el('b', { text: `${color.round(first.ratio, 2)}` }),
            el('span', { text: `needs ${first.required}` }))));

        if (first.assumedBackground) {
          parts.push(el('p', {
            class: 'lao-prose',
            text: 'No opaque background was found behind this text, so it was measured against the page canvas.',
          }));
        }

        parts.push(this._fixBlock(first));
      }

      parts.push(this._occurrences(group.issues));
      return parts;
    }

    _fixBlock(issue) {
      const fix = issue.fix;
      const block = el('div', { class: 'lao-fix' });
      block.append(el('h3', { class: 'lao-section-label', style: 'padding:0 0 2px', text: 'Closest passing colour' }));

      const candidates = [
        fix.text?.changed && { label: 'Change the text', c: fix.text, moving: 'text' },
        // Never offer to repaint the page canvas — "make the whole page dark
        // grey" is arithmetically correct and useless as advice.
        !issue.assumedBackground && fix.background?.changed &&
          { label: 'Change the background', c: fix.background, moving: 'bg' },
      ].filter(Boolean);

      // Show the closest fix, and the alternative only when it is genuinely
      // comparable. A suggestion that moves the colour three times as far is
      // not a choice, it is noise.
      candidates.sort((a, b) => a.c.delta - b.c.delta);
      const rows = candidates.filter((r, i) => i === 0 || r.c.delta <= candidates[0].c.delta * 1.6);

      if (!rows.length) {
        block.append(el('p', {
          class: 'lao-prose',
          text: 'No colour at this hue reaches the required ratio. This pairing needs a different hue, not a lighter or darker version of it.',
        }));
        return block;
      }

      for (const row of rows) {
        const hex = color.toHex(row.c.color);
        const swatchA = row.moving === 'text' ? hex : issue.fgHex;
        const swatchB = row.moving === 'text' ? issue.bgHex : hex;

        const btn = el('button', {
          type: 'button',
          class: 'lao-fix-row',
          'aria-label': `${row.label} to ${hex}, giving ${color.round(row.c.ratio, 2)} to 1. Copy this colour.`,
          on: { click: (e) => this._copy(hex, e.currentTarget) },
        },
          el('span', { class: 'lao-swatches', 'aria-hidden': 'true' },
            el('span', { class: 'lao-swatch', style: `background:${swatchB}` }),
            el('span', { class: 'lao-swatch', style: `background:${swatchA}` })),
          el('span', { class: 'lao-fix-label' },
            el('b', { text: row.label }),
            el('code', { text: hex })),
          el('span', { class: 'lao-fix-ratio', text: `${color.round(row.c.ratio, 2)}:1` }));

        block.append(btn);
      }

      block.append(el('p', {
        class: 'lao-prose',
        text: 'Hue and saturation are held; only lightness moves, and only as far as it has to.',
      }));
      return block;
    }

    async _copy(text, button) {
      const ratio = button.querySelector('.lao-fix-ratio');
      const original = ratio?.textContent;
      try {
        await navigator.clipboard.writeText(text);
        if (ratio) {
          ratio.textContent = 'Copied';
          ratio.classList.add('lao-copied');
          setTimeout(() => {
            ratio.textContent = original;
            ratio.classList.remove('lao-copied');
          }, 1400);
        }
        this._announce(`${text} copied to clipboard`);
      } catch {
        this._announce('Could not copy — this page blocks clipboard access');
      }
    }

    _occurrences(issues) {
      const wrap = el('div', {});
      wrap.append(el('h3', {
        class: 'lao-section-label',
        style: 'padding:0 0 6px',
        text: `${issues.length} ${issues.length === 1 ? 'occurrence' : 'occurrences'}`,
      }));

      const list = el('ul', { class: 'lao-occurrences' });
      for (const issue of issues.slice(0, 30)) {
        list.append(el('li', {},
          el('button', {
            type: 'button',
            class: 'lao-occurrence',
            'aria-label': `Show ${util.describe(issue.element)} on the page`,
            on: { click: () => this.handlers.onReveal(issue) },
          },
            el('code', { text: util.describe(issue.element) }),
            el('span', { text: issue.text || '' }),
            el('span', { svg: icons.target(13), 'aria-hidden': 'true' }))));
      }
      wrap.append(list);

      if (issues.length > 30) {
        wrap.append(el('p', {
          class: 'lao-prose',
          style: 'padding-top:8px',
          text: `${issues.length - 30} more share this pairing.`,
        }));
      }
      return wrap;
    }

    /* ----------------------------------------------------- detail: headings */

    _headingsDetail(result) {
      const frag = document.createDocumentFragment();

      if (result.documentIssues.length) {
        const wrap = el('div', { class: 'lao-issues' });
        for (const issue of result.documentIssues) {
          const p = issue.problems[0];
          wrap.append(this._card({
            id: issue.id,
            severity: issue.severity,
            title: p.label,
            sub: issue.name,
            build: () => [el('p', { class: 'lao-prose', text: p.detail })],
          }));
        }
        frag.append(wrap);
      }

      if (!result.outline.length) {
        if (!result.documentIssues.length) {
          frag.append(this._lensClear('No headings', 'This page has no heading elements.'));
        }
        return frag;
      }

      frag.append(el('h3', { class: 'lao-section-label', text: 'Outline' }));

      const list = el('ul', { class: 'lao-outline' });
      // Indent is capped so a deeply nested outline never pushes the label off
      // the edge; the level chip carries the exact depth.
      for (const node of result.outline) {
        const rail = el('span', { class: 'lao-rail', 'aria-hidden': 'true' });
        for (let i = 1; i < Math.min(node.level, 5); i++) rail.append(el('i'));

        const flag = node.problems[0];
        const row = el('button', {
          type: 'button',
          class: 'lao-h',
          data: { sev: node.severity || 'none', empty: String(node.name === '(no text)') },
          'aria-label': `Level ${node.level}: ${node.name}${flag ? `. ${flag.label}` : ''}. Show on page.`,
          on: { click: () => this.handlers.onReveal(node) },
        },
          rail,
          el('span', { class: 'lao-h-level', text: node.implicit ? `h${node.level}*` : `H${node.level}` }),
          el('span', { class: 'lao-h-text', text: node.name }),
          flag
            ? el('span', {
                class: 'lao-h-flag',
                data: { sev: flag.severity },
                text: flag.short || flag.label,
              })
            : null);

        list.append(el('li', {}, row));
      }
      frag.append(list);

      if (result.outline.some((n) => n.implicit)) {
        frag.append(el('p', {
          class: 'lao-prose',
          style: 'padding:0 16px 20px',
          text: '* marks an element using role="heading" rather than an h1–h6 tag.',
        }));
      }
      return frag;
    }

    /* ------------------------------------------------------- detail: images */

    _imagesDetail(result) {
      if (!result.issues.length) {
        return this._lensClear(
          'Every image is accounted for',
          `All ${result.scanned} images either describe themselves or are correctly marked decorative.`,
        );
      }

      const wrap = el('div', { class: 'lao-issues' });
      for (const issue of result.issues) {
        wrap.append(this._card({
          id: issue.id,
          severity: issue.severity,
          title: issue.title,
          sub: util.describe(issue.element),
          build: () => {
            const parts = [el('p', { class: 'lao-prose', text: issue.detail })];

            if (issue.altValue !== null) {
              parts.push(el('div', { class: 'lao-pair' },
                el('div', { class: 'lao-pair-sample' },
                  el('b', { text: issue.altValue === '' ? 'alt="" (empty)' : 'Current alt text' }),
                  el('code', { text: issue.altValue || '—' }))));
            } else if (issue.name) {
              parts.push(el('div', { class: 'lao-pair' },
                el('div', { class: 'lao-pair-sample' },
                  el('b', { text: `Named via ${issue.nameFrom}` }),
                  el('code', { text: issue.name }))));
            }

            if (issue.fix) {
              parts.push(el('p', { class: 'lao-prose' },
                el('strong', { text: 'What to do: ' }), issue.fix));
            }

            parts.push(el('div', { class: 'lao-actions' },
              el('button', {
                type: 'button',
                class: 'lao-btn',
                on: { click: () => this.handlers.onReveal(issue) },
              }, el('span', { svg: icons.target(13), 'aria-hidden': 'true' }), 'Show on page')));

            return parts;
          },
        }));
      }
      return wrap;
    }

    /* --------------------------------------------------------- detail: tabs */

    _tabsDetail(result) {
      const frag = document.createDocumentFragment();

      if (!this.state.lenses.tabs) {
        frag.append(el('div', { class: 'lao-issues' },
          el('div', { class: 'lao-card' },
            el('div', { style: 'padding:12px' },
              el('p', { class: 'lao-prose', text: 'The tab path is not being drawn right now.' }),
              el('div', { class: 'lao-actions', style: 'margin-top:10px' },
                el('button', {
                  type: 'button',
                  class: 'lao-btn',
                  data: { variant: 'primary' },
                  on: { click: () => this.handlers.onToggleLens('tabs') },
                }, 'Draw the tab path'))))));
      }

      if (result.issues.length) {
        const wrap = el('div', { class: 'lao-issues' });
        for (const issue of result.issues) {
          wrap.append(this._card({
            id: issue.id,
            severity: issue.severity,
            title: issue.title,
            sub: issue.detail,
            build: () => {
              const parts = [el('p', { class: 'lao-prose', text: issue.detail })];
              if (issue.fix) {
                parts.push(el('p', { class: 'lao-prose' },
                  el('strong', { text: 'What to do: ' }), issue.fix));
              }
              if (issue.element) {
                parts.push(el('div', { class: 'lao-actions' },
                  el('button', {
                    type: 'button',
                    class: 'lao-btn',
                    on: { click: () => this.handlers.onReveal(issue) },
                  }, el('span', { svg: icons.target(13), 'aria-hidden': 'true' }), 'Show on page')));
              }
              return parts;
            },
          }));
        }
        frag.append(wrap);
      } else if (result.steps.length) {
        frag.append(this._lensClear(
          'Tab order follows the page',
          `All ${result.steps.length} focus stops move forward through the layout, with no positive tabindex in use.`,
        ));
      }

      if (result.steps.length) {
        frag.append(el('h3', { class: 'lao-section-label', text: 'Focus path' }));
        const list = el('ul', { class: 'lao-occurrences', style: 'margin:0 12px 20px' });
        for (const step of result.steps.slice(0, 60)) {
          list.append(el('li', {},
            el('button', {
              type: 'button',
              class: 'lao-occurrence',
              'aria-label': `Step ${step.index}: ${step.name || `${step.label}, no accessible name`}. Show on page.`,
              on: { click: () => this.handlers.onReveal(step) },
            },
              el('code', { text: String(step.index).padStart(2, '0') }),
              el('span', {
                class: step.name ? '' : 'lao-unnamed',
                text: step.name || `${step.label} — no accessible name`,
              }),
              el('span', {
                class: 'lao-h-flag',
                data: { sev: step.offCanvas ? 'critical' : 'warning' },
                text: step.offCanvas ? 'off-screen' : 'backwards',
                hidden: !step.backward && !step.offCanvas,
              }))));
        }
        frag.append(list);
        if (result.steps.length > 60) {
          frag.append(el('p', {
            class: 'lao-prose',
            style: 'padding:0 16px 20px',
            text: `${result.steps.length - 60} further stops are drawn on the page but not listed here.`,
          }));
        }
      }

      return frag;
    }

    /* ------------------------------------------------------------ fragments */

    _card({ id, severity, title, sub, build }) {
      const open = this.state.expanded.has(id);
      const bodyId = `lao-body-${hash(id)}`;

      const detail = el('div', { class: 'lao-card-detail' },
        el('div', {}, el('div', { class: 'lao-card-detail-inner', id: bodyId }, ...build())));

      const btn = el('button', {
        type: 'button',
        class: 'lao-card-btn',
        'aria-expanded': String(open),
        'aria-controls': bodyId,
      },
        meter(severity),
        el('span', { class: 'lao-card-body' },
          el('span', { class: 'lao-card-title', text: title }),
          el('span', { class: 'lao-card-sub', text: sub })),
        el('span', { class: 'lao-chevron', svg: icons.chevronRight(14), 'aria-hidden': 'true' }));

      const card = el('div', { class: 'lao-card', data: { open: String(open), sev: severity } }, btn, detail);

      btn.addEventListener('click', () => {
        const nowOpen = !this.state.expanded.has(id);
        if (nowOpen) this.state.expanded.add(id);
        else this.state.expanded.delete(id);
        card.dataset.open = String(nowOpen);
        btn.setAttribute('aria-expanded', String(nowOpen));
      });

      // The severity is on the button for sighted users via the meter glyph; it
      // needs saying out loud too.
      btn.setAttribute('aria-label', `${SEV_LABEL[severity] || 'Notice'}: ${title}. ${sub}`);
      return card;
    }

    _lensClear(title, body) {
      return el('div', { class: 'lao-lens-clear' },
        el('span', { svg: icons.apertureOpen(38) }),
        el('b', { text: title }),
        el('p', { text: body }));
    }

    _announce(message) {
      this.statusText.textContent = message;
      clearTimeout(this._announceTimer);
      this._announceTimer = setTimeout(() => this._renderStatus(), 2600);
    }
  }

  /* --------------------------------------------------------------- helpers */

  function worstOf(issues) {
    let out = 'notice';
    for (const i of issues) if ((RANK[i.severity] || 0) > RANK[out]) out = i.severity;
    return issues.length ? out : 'clear';
  }

  function severityBreakdown(stat) {
    return ['critical', 'warning', 'notice']
      .filter((s) => stat[s])
      .map((s) => `${stat[s]} ${s}`)
      .join(' · ');
  }

  function scannedFor(results, key) {
    return results[key]?.scanned ?? 0;
  }

  function hash(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
    return Math.abs(h).toString(36);
  }

  LAO.Panel = Panel;
})();
