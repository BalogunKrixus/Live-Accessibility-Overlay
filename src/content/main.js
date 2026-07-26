/**
 * Content-script entry point.
 *
 * Owns the shadow host, the scan lifecycle, and the wiring between the panel
 * and the marker layer. Injected on demand — it does not exist on a page until
 * the user asks for it, and it holds no state beyond the current tab session.
 */
(() => {
  const LAO = (globalThis.__LAO__ ||= {});
  if (LAO.app) {
    // Re-injection of an already-running instance: just show it again.
    LAO.app.open();
    return;
  }

  const { util } = LAO;
  const STORAGE_KEY = 'lao:prefs';

  class App {
    constructor() {
      this.prefs = {
        theme: 'system',      // system | light | dark
        side: 'right',        // right | left
        lenses: { contrast: true, headings: true, images: true, tabs: false },
      };
      this.results = null;
      this.groupOf = new Map(); // issue id -> card id, so a marker opens the right card
      this.isOpen = false;
      this.scanToken = 0;

      this._mount();
      this._loadPrefs();
      this._observe();
    }

    /* ---------------------------------------------------------------- mount */

    _mount() {
      this.host = document.createElement(util.HOST_TAG);
      // Belt and braces: even before the stylesheet lands, the host must not
      // take part in the page's layout or intercept clicks.
      this.host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
      this.host.setAttribute('data-lao-root', '');

      this.shadow = this.host.attachShadow({ mode: 'open' });

      try {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(LAO.styles);
        this.shadow.adoptedStyleSheets = [sheet];
      } catch {
        const style = document.createElement('style');
        style.textContent = LAO.styles;
        this.shadow.appendChild(style);
      }

      (document.body || document.documentElement).appendChild(this.host);

      this.overlay = new LAO.Overlay(this.shadow, {
        onSelect: (issue) => this.focusIssue(issue),
      });

      this.panel = new LAO.Panel(this.host, this.shadow, {
        onClose: () => this.close(),
        onRescan: () => this.scan({ announce: true }),
        onToggleLens: (key) => this.toggleLens(key),
        onCycleTheme: () => this.cycleTheme(),
        onFlipSide: () => this.flipSide(),
        onReveal: (issue) => this.reveal(issue),
        onSelect: (id) => this.overlay.select(id),
      });

      this._applyPrefs();
    }

    /* ---------------------------------------------------------------- prefs */

    async _loadPrefs() {
      try {
        const stored = await chrome.storage.local.get(STORAGE_KEY);
        const saved = stored?.[STORAGE_KEY];
        if (saved) {
          this.prefs = { ...this.prefs, ...saved, lenses: { ...this.prefs.lenses, ...saved.lenses } };
        }
      } catch {
        /* Storage unavailable; defaults are fine. */
      }
      this._applyPrefs();
    }

    _savePrefs() {
      try {
        chrome.storage.local.set({ [STORAGE_KEY]: this.prefs });
      } catch {
        /* Non-fatal. */
      }
    }

    _applyPrefs() {
      if (this.prefs.theme === 'system') this.host.removeAttribute('data-theme');
      else this.host.dataset.theme = this.prefs.theme;
      this.host.dataset.side = this.prefs.side;
      this.panel.setTheme(this.prefs.theme);
      this.panel.setLenses(this.prefs.lenses);
      this.overlay.setLenses(this.prefs.lenses);
    }

    cycleTheme() {
      const next = { system: 'light', light: 'dark', dark: 'system' }[this.prefs.theme];
      this.prefs.theme = next;
      this._applyPrefs();
      this._savePrefs();
    }

    flipSide() {
      this.prefs.side = this.prefs.side === 'right' ? 'left' : 'right';
      this.host.dataset.side = this.prefs.side;
      this._savePrefs();
    }

    toggleLens(key) {
      this.prefs.lenses = { ...this.prefs.lenses, [key]: !this.prefs.lenses[key] };
      this._applyPrefs();
      this._savePrefs();
    }

    /* ----------------------------------------------------------------- scan */

    async scan({ announce = false } = {}) {
      const token = ++this.scanToken;
      this.panel.setScanning(true);

      // Yield once so the scanning state paints before a long synchronous pass.
      await new Promise((r) => requestAnimationFrame(r));
      if (token !== this.scanToken) return;

      const started = performance.now();
      let results;
      try {
        results = {
          contrast: LAO.auditContrast.run(),
          headings: LAO.auditHeadings.run(),
          images: LAO.auditImages.run(),
          tabs: LAO.auditTabOrder.run(),
        };
      } catch (err) {
        console.error('[Live Accessibility Overlay] scan failed', err);
        this.panel.setScanning(false);
        return;
      }
      if (token !== this.scanToken) return;

      this.results = results;
      this.duration = Math.round(performance.now() - started);

      // Map every contrast issue to the card that represents its colour pair,
      // so clicking a marker on the page opens the group it belongs to.
      this.groupOf.clear();
      for (const group of results.contrast.groups) {
        for (const issue of group.issues) this.groupOf.set(issue.id, group.key);
      }

      this.overlay.setData({
        contrast: results.contrast.issues,
        images: results.images.issues,
        headings: results.headings.issues.filter((h) => h.element && h.rect),
        tabs: results.tabs,
      });

      this.panel.setScanning(false);
      this.panel.setResults(results);
      this._reportBadge();

      if (announce) this.panel._announce(`Rescanned in ${this.duration}ms`);
    }

    _reportBadge() {
      if (!this.results) return;
      const total =
        this.results.contrast.issues.length +
        this.results.headings.issues.length +
        this.results.images.issues.length +
        this.results.tabs.issues.length;

      const all = [
        ...this.results.contrast.issues,
        ...this.results.headings.issues,
        ...this.results.images.issues,
        ...this.results.tabs.issues,
      ];
      const tone = all.some((i) => i.severity === 'critical')
        ? 'critical'
        : all.some((i) => i.severity === 'warning')
          ? 'warning'
          : all.length
            ? 'notice'
            : 'clear';

      try {
        chrome.runtime.sendMessage({ type: 'lao:badge', count: total, tone, active: this.isOpen });
      } catch {
        /* Extension context invalidated (reloaded); harmless. */
      }
    }

    /* ------------------------------------------------------------ selection */

    /** A marker was clicked: open the matching lens and card. */
    focusIssue(issue) {
      const lens = issue.lens;
      const cardId = lens === 'contrast' ? this.groupOf.get(issue.id) || issue.id : issue.id;
      this.panel.state.expanded.add(cardId);
      this.panel.showDetail(lens);
      this.overlay.select(issue.id);
    }

    /** A panel row was activated: scroll to the element and ring it. */
    reveal(issue) {
      const element = issue.element || issue.el;
      if (!element) return;
      this.overlay.select(issue.id || null);
      this.overlay.reveal(element);
    }

    /* --------------------------------------------------------- live updates */

    _observe() {
      // Pages that stream content in should not require a manual rescan, but a
      // scan on every mutation would fight the page for the main thread. A
      // trailing debounce with a hard ceiling keeps it responsive and cheap.
      const rescan = util.debounce(() => {
        if (this.isOpen) this.scan();
      }, 900, 4000);

      this.observer = new MutationObserver((records) => {
        for (const record of records) {
          // Ignore our own DOM, and ignore attribute noise on the host.
          if (util.isOurs(record.target) || record.target === this.host) continue;
          if (record.target?.getRootNode?.() === this.shadow) continue;
          rescan();
          return;
        }
      });

      this.observer.observe(document.documentElement, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['class', 'style', 'alt', 'aria-label', 'aria-hidden', 'tabindex', 'hidden', 'role'],
      });

      // A theme change at the OS level should retint the panel immediately.
      this._mq = matchMedia('(prefers-color-scheme: dark)');
      this._mq.addEventListener?.('change', () => this.panel.setTheme(this.prefs.theme));
    }

    /* ------------------------------------------------------------ lifecycle */

    open() {
      if (this.isOpen) return;
      this.isOpen = true;
      this.host.style.display = '';
      this.panel.open();
      this.scan();
    }

    close() {
      if (!this.isOpen) return;
      this.isOpen = false;
      this.panel.close();
      this.overlay.setLenses({ contrast: false, headings: false, images: false, tabs: false });
      this._reportBadge();

      // Let the close transition finish before the layer stops painting.
      const delay = util.prefersReducedMotion() ? 0 : 360;
      setTimeout(() => {
        if (!this.isOpen) this.host.style.display = 'none';
      }, delay);

      // Focus was inside the panel; hand it back to the page rather than
      // leaving it on a hidden element.
      try {
        document.body?.focus?.({ preventScroll: true });
      } catch {
        /* Not focusable; the browser will fall back to the document. */
      }
    }

    toggle() {
      if (this.isOpen) this.close();
      else {
        this.host.style.display = '';
        this.overlay.setLenses(this.prefs.lenses);
        this.open();
      }
    }
  }

  /* ------------------------------------------------------------- messaging */

  const app = new App();
  LAO.app = app;

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    switch (msg?.type) {
      case 'lao:ping':
        sendResponse({ type: 'lao:pong' });
        return false;
      case 'lao:open':
        app.open();
        sendResponse({ ok: true });
        return false;
      case 'lao:toggle':
        app.toggle();
        sendResponse({ ok: true });
        return false;
      default:
        return false;
    }
  });

  app.open();
})();
