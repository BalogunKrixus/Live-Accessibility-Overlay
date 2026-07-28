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

  /** How long the DOM must be quiet before the page counts as fully read. */
  const SETTLE_MS = 1200;

  /**
   * The pass, in the order it runs. Named stages exist so the panel can show a
   * real fraction rather than an indeterminate spinner — and so "what is it
   * doing right now" has an answer in plain words.
   */
  const STAGES = [
    ['contrast', 'Reading text colours', () => LAO.auditContrast.run()],
    ['headings', 'Checking headings', () => LAO.auditHeadings.run()],
    ['images', 'Checking images', () => LAO.auditImages.run()],
    ['tabs', 'Following the keyboard order', () => LAO.auditTabOrder.run()],
  ];

  /**
   * Chrome's `chrome.*` returns promises under MV3; Firefox's is callback-based
   * and only `browser.*` returns promises. Awaiting `chrome.*` in Firefox would
   * silently resolve to undefined — preferences would never load and the ping
   * handshake would never answer — so prefer `browser` where it exists.
   */
  const api = globalThis.browser ?? globalThis.chrome;

  class App {
    constructor() {
      this.prefs = {
        theme: 'system',      // system | light | dark
        side: 'right',        // right | left
      };
      this.results = null;
      this.isOpen = false;
      this.scanToken = 0;
      this.settled = document.readyState === 'complete';

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
        onSelectStep: (step) => this.panel.showKeyboard(),
      });

      this.panel = new LAO.Panel(this.host, this.shadow, {
        onClose: () => this.close(),
        onRescan: () => this.scan({ announce: true }),
        onCycleTheme: () => this.cycleTheme(),
        onFlipSide: () => this.flipSide(),
        onShowTarget: (element, tier, label) => this.overlay.focus(element, tier, label),
        onClearMarks: () => this.overlay.clear(),
        onShowTabPath: (on) =>
          this.overlay.setTabPath(on, this.results?.tabs.steps || []),
      });

      this._applyPrefs();
    }

    /* ---------------------------------------------------------------- prefs */

    async _loadPrefs() {
      try {
        const stored = await api.storage.local.get(STORAGE_KEY);
        const saved = stored?.[STORAGE_KEY];
        // Only known keys are adopted, so a preference blob written by an older
        // version cannot reintroduce settings this build no longer has.
        if (saved) {
          if (saved.theme) this.prefs.theme = saved.theme;
          if (saved.side) this.prefs.side = saved.side;
        }
      } catch {
        /* Storage unavailable; defaults are fine. */
      }
      this._applyPrefs();
    }

    _savePrefs() {
      try {
        api.storage.local.set({ [STORAGE_KEY]: this.prefs });
      } catch {
        /* Non-fatal. */
      }
    }

    _applyPrefs() {
      if (this.prefs.theme === 'system') this.host.removeAttribute('data-theme');
      else this.host.dataset.theme = this.prefs.theme;
      this.host.dataset.side = this.prefs.side;
      this.panel.setTheme(this.prefs.theme);
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

    /* ----------------------------------------------------------------- scan */

    async scan({ announce = false } = {}) {
      const token = ++this.scanToken;
      this.panel.setScanning(true);

      const started = performance.now();
      const results = {};

      // One stage per frame. Yielding between them costs a few frames and buys
      // two things: the progress actually moves, and a heavy page is never
      // frozen for the whole pass.
      for (let i = 0; i < STAGES.length; i++) {
        const [key, label, run] = STAGES[i];
        this.panel.setProgress(i / STAGES.length, label);

        await new Promise((r) => requestAnimationFrame(r));
        if (token !== this.scanToken) return;

        try {
          results[key] = run();
        } catch (err) {
          console.error(`[Live Accessibility Overlay] ${key} check failed`, err);
          this.panel.setScanning(false);
          return;
        }
      }
      this.panel.setProgress(1);
      if (token !== this.scanToken) return;

      this.results = results;
      this.duration = Math.round(performance.now() - started);

      // The page stays unmarked until the user picks something to look at.
      if (this.overlay.showTabPath) this.overlay.setTabPath(true, results.tabs.steps);

      this.panel.setScanning(false);
      this.panel.setResults(results);
      this._reportBadge();

      if (announce) this.panel._announce(`Rescanned in ${this.duration}ms`);
    }

    /**
     * The toolbar badge carries one number: how many issues are on the page in
     * this tab. It counts the same grouped items the panel lists, so the badge
     * and the panel can never disagree — showing raw findings here while the
     * panel showed grouped ones was just confusing.
     */
    _reportBadge() {
      if (!this.results) return;
      const items = LAO.copy.build(this.results);
      const tone = items.some((i) => i.tier === 'fix') ? 'fix' : items.length ? 'check' : 'clear';

      try {
        api.runtime.sendMessage({ type: 'lao:badge', count: items.length, tone });
      } catch {
        /* Extension context invalidated (reloaded); harmless. */
      }
    }

    /* --------------------------------------------------------- live updates */

    /**
     * "Is it still reading the page?" has two halves. How far through the
     * current pass it is, the progress bar answers. Whether that pass saw the
     * whole page is the harder one: a scan is a snapshot, and a page that is
     * still fetching images or hydrating a lazy section will keep changing
     * underneath it. So track that directly — the page counts as fully read
     * once loading has finished *and* the DOM has been quiet for a moment.
     */
    _noteActivity() {
      this._lastChange = performance.now();
      if (this.settled !== false) {
        this.settled = false;
        this.panel.setSettled(false);
      }
      this._watchSettle();
    }

    _watchSettle() {
      clearTimeout(this._settleTimer);
      if (!this.isOpen) return;
      this._settleTimer = setTimeout(() => {
        const quiet = performance.now() - (this._lastChange || 0) >= SETTLE_MS;
        if (document.readyState === 'complete' && quiet) {
          this.settled = true;
          this.panel.setSettled(true);
        } else {
          this._watchSettle();
        }
      }, SETTLE_MS);
    }

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
          this._noteActivity();
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

      // Late images and stylesheets change what there is to measure, so a scan
      // that ran before `load` has not seen the finished page.
      if (document.readyState !== 'complete') {
        this.settled = false;
        addEventListener('load', () => this._noteActivity(), { once: true });
      }

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
      this.panel.setSettled(this.settled !== false);
      this._watchSettle();
      this.scan();
    }

    close() {
      if (!this.isOpen) return;
      this.isOpen = false;
      clearTimeout(this._settleTimer);
      this.panel.close();
      this.overlay.clear();
      this.overlay.setTabPath(false);
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
        this.open();
      }
    }
  }

  /* ------------------------------------------------------------- messaging */

  const app = new App();
  LAO.app = app;

  api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
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
