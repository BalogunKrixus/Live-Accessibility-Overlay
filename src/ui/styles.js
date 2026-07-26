/**
 * The design system, as one stylesheet inside the shadow root.
 *
 * Nothing here leaks to the host page and nothing on the host page reaches in:
 * every property the panel relies on is set explicitly on `:host` and reset on
 * the subtree, so a page with `* { box-sizing: content-box }` or an aggressive
 * `!important` reset cannot distort the UI.
 */
(() => {
  const LAO = (globalThis.__LAO__ ||= {});
  if (LAO.styles) return;

  /* --------------------------------------------------------------- palette */

  /**
   * Four hues, deliberately not a traffic light.
   *
   *   Rose   — critical, a hard failure
   *   Ochre  — warning, works but degrades for someone
   *   Iris   — notice, worth a look, not a defect
   *   Aqua   — the brand, and the all-clear
   *
   * Every text-bearing value below clears 4.5:1 against its own surface, and
   * the severity hues stay distinguishable in greyscale because each is paired
   * with a three-segment meter glyph rather than carrying meaning on its own.
   */
  const LIGHT = `
    --lao-surface: #FFFFFF;
    --lao-surface-sunken: #F4F5F7;
    --lao-surface-raised: #FFFFFF;
    --lao-surface-hover: #F0F2F5;
    --lao-surface-active: #E7EAEF;
    --lao-scrim: rgba(18, 21, 27, 0.10);

    --lao-line: #E4E6EB;
    --lao-line-strong: #C7CCD6;

    --lao-text: #14161C;
    --lao-text-muted: #565D6E;
    /* Chosen against the *active* surface, not white — it is the hardest
       background this token lands on (hovered occurrence rows), and 4.5:1 has
       to hold on every surface it appears over, not just the easiest one. */
    --lao-text-faint: #5F6675;

    --lao-brand: #0C6F79;
    --lao-brand-strong: #08535B;
    --lao-brand-ink: #064B52;
    --lao-brand-wash: #E6F3F4;
    --lao-brand-edge: #A9D8DC;

    --lao-critical: #C22F4A;
    --lao-critical-wash: #FBEAED;
    --lao-critical-edge: #F0C0C9;
    --lao-critical-mark: #E03E5C;

    --lao-warning: #8A5A0B;
    --lao-warning-wash: #FBF1E0;
    --lao-warning-edge: #EBD3A6;
    --lao-warning-mark: #D08A1F;

    --lao-notice: #4B4BC4;
    --lao-notice-wash: #EDEDFB;
    --lao-notice-edge: #C7C7F0;
    --lao-notice-mark: #6A63E8;

    --lao-focus: #0C6F79;
    --lao-focus-contrast: #FFFFFF;

    --lao-shadow-panel:
      0 0 0 1px rgba(18, 21, 27, 0.06),
      0 1px 2px rgba(18, 21, 27, 0.04),
      0 12px 28px -8px rgba(18, 21, 27, 0.16),
      0 32px 64px -24px rgba(18, 21, 27, 0.20);
    --lao-shadow-pop:
      0 0 0 1px rgba(18, 21, 27, 0.07),
      0 6px 16px -4px rgba(18, 21, 27, 0.18);
    --lao-marker-halo: rgba(255, 255, 255, 0.92);
  `;

  const DARK = `
    --lao-surface: #16181E;
    --lao-surface-sunken: #101217;
    --lao-surface-raised: #1D2027;
    --lao-surface-hover: #232730;
    --lao-surface-active: #2B303A;
    --lao-scrim: rgba(0, 0, 0, 0.40);

    --lao-line: #282C35;
    --lao-line-strong: #3C424F;

    --lao-text: #ECEEF3;
    --lao-text-muted: #A3AAB9;
    --lao-text-faint: #949CAC;

    --lao-brand: #4FD1DC;
    --lao-brand-strong: #7FE2EA;
    --lao-brand-ink: #B7F0F5;
    --lao-brand-wash: #10262A;
    --lao-brand-edge: #23474D;

    --lao-critical: #FF8098;
    --lao-critical-wash: #2A1218;
    --lao-critical-edge: #55232D;
    --lao-critical-mark: #FF7189;

    --lao-warning: #F0B457;
    --lao-warning-wash: #271C0C;
    --lao-warning-edge: #4C3818;
    --lao-warning-mark: #F0B457;

    --lao-notice: #A5A4FF;
    --lao-notice-wash: #1A1A2E;
    --lao-notice-edge: #33325C;
    --lao-notice-mark: #9C99FF;

    --lao-focus: #4FD1DC;
    --lao-focus-contrast: #0B0D11;

    --lao-shadow-panel:
      0 0 0 1px rgba(255, 255, 255, 0.07),
      0 1px 2px rgba(0, 0, 0, 0.5),
      0 16px 32px -8px rgba(0, 0, 0, 0.55),
      0 40px 72px -28px rgba(0, 0, 0, 0.7);
    --lao-shadow-pop:
      0 0 0 1px rgba(255, 255, 255, 0.09),
      0 8px 20px -4px rgba(0, 0, 0, 0.6);
    --lao-marker-halo: rgba(8, 10, 14, 0.88);
  `;

  const CSS = `
/* ============================================================== foundation */

:host {
  /* The host page's stylesheet stops here. */
  all: initial;

  position: fixed;
  inset: 0;
  z-index: 2147483647;
  pointer-events: none;
  contain: layout style;

  /* Type ------------------------------------------------------------------ */
  --lao-font: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI Variable Text",
              "Segoe UI", Inter, Roboto, "Helvetica Neue", Arial, sans-serif;
  --lao-mono: ui-monospace, SFMono-Regular, "SF Mono", "JetBrains Mono", Menlo,
              Consolas, "Liberation Mono", monospace;

  --lao-size-micro: 10.5px;
  --lao-size-meta: 12px;
  --lao-size-body: 13px;
  --lao-size-lead: 14px;
  --lao-size-title: 15px;
  --lao-size-numeral: 21px;
  --lao-size-hero: 40px;

  /* Space ----------------------------------------------------------------- */
  --lao-s1: 4px;  --lao-s2: 8px;  --lao-s3: 12px; --lao-s4: 16px;
  --lao-s5: 20px; --lao-s6: 24px; --lao-s7: 32px; --lao-s8: 44px;

  /* Form ------------------------------------------------------------------ */
  --lao-r-sm: 7px;
  --lao-r-md: 11px;
  --lao-r-lg: 15px;
  --lao-r-panel: 18px;
  --lao-r-pill: 999px;

  /* Motion ---------------------------------------------------------------- */
  --lao-t-micro: 110ms;
  --lao-t-base: 190ms;
  --lao-t-panel: 340ms;
  --lao-ease-out: cubic-bezier(0.22, 1, 0.36, 1);
  --lao-ease-in: cubic-bezier(0.55, 0, 1, 0.45);
  --lao-ease-soft: cubic-bezier(0.32, 0.72, 0, 1);

  --lao-panel-w: 372px;

  font-family: var(--lao-font);
  font-size: var(--lao-size-body);
  line-height: 1.45;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
  font-variant-numeric: tabular-nums;
  color-scheme: light;

  ${LIGHT}
}

:host([data-theme="dark"]) { color-scheme: dark; ${DARK} }

@media (prefers-color-scheme: dark) {
  :host(:not([data-theme="light"])) { color-scheme: dark; ${DARK} }
}

/* Scoped reset: the subtree inherits nothing from the page. */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

button, input, select, textarea {
  font: inherit; color: inherit; background: none; border: 0;
  letter-spacing: inherit;
}
button { cursor: pointer; -webkit-appearance: none; appearance: none; text-align: left; }
ul, ol { list-style: none; }
h1, h2, h3, h4 { font-size: inherit; font-weight: inherit; }
svg { display: block; flex: none; }
[hidden] { display: none !important; }

/* One focus treatment everywhere: a brand ring plus a contrast-coloured inner
   ring, so it stays visible on any surface in either theme. */
:where(button, a, input, select):focus-visible {
  outline: 2px solid var(--lao-focus);
  outline-offset: 2px;
  /* A soft halo so the ring survives on tinted surfaces, without stacking a
     third visible edge. The element's own radius is left alone — overriding it
     on focus makes controls change shape as you tab through them. */
  box-shadow: 0 0 0 5px color-mix(in srgb, var(--lao-focus) 22%, transparent);
}
:where(button, a, input, select):focus:not(:focus-visible) { outline: none; }

/* Programmatic focus targets. They are not keyboard reachable (tabindex="-1"),
   they exist so screen readers announce the new context on a view change, so a
   visible ring would only ever be confusing. */
.lao-panel:focus, .lao-panel:focus-visible,
.lao-view:focus, .lao-view:focus-visible { outline: none; }

.lao-visually-hidden {
  position: absolute !important;
  width: 1px; height: 1px;
  padding: 0; margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  clip-path: inset(50%);
  white-space: nowrap; border: 0;
}

/* ================================================================== panel */

.lao-panel {
  pointer-events: auto;
  position: fixed;
  top: var(--lao-s4);
  bottom: var(--lao-s4);
  right: var(--lao-s4);
  width: var(--lao-panel-w);
  max-width: calc(100vw - var(--lao-s7));
  max-height: calc(100vh - var(--lao-s7));

  display: flex;
  flex-direction: column;
  overflow: hidden;

  background: var(--lao-surface);
  color: var(--lao-text);
  border-radius: var(--lao-r-panel);
  box-shadow: var(--lao-shadow-panel);

  transform-origin: 100% 0;
  transition:
    opacity var(--lao-t-panel) var(--lao-ease-soft),
    transform var(--lao-t-panel) var(--lao-ease-soft),
    right var(--lao-t-base) var(--lao-ease-out),
    left var(--lao-t-base) var(--lao-ease-out);
}

:host([data-side="left"]) .lao-panel { right: auto; left: var(--lao-s4); transform-origin: 0 0; }

/* Open / close. The panel rises and settles rather than sliding in from an
   edge — it reads as the tool coming forward, not a drawer. */
.lao-panel[data-state="closed"] {
  opacity: 0;
  transform: translateY(-6px) scale(0.975);
  pointer-events: none;
}
.lao-panel[data-state="open"] { opacity: 1; transform: none; }

/* ------------------------------------------------------------------ header */

.lao-head {
  display: flex;
  align-items: center;
  gap: var(--lao-s3);
  padding: var(--lao-s4) var(--lao-s4) var(--lao-s3);
  border-bottom: 1px solid var(--lao-line);
  flex: none;
}

.lao-mark { display: flex; align-items: center; gap: 9px; min-width: 0; flex: 1; }
.lao-mark svg { color: var(--lao-brand); }

.lao-wordmark {
  display: flex; flex-direction: column; min-width: 0; gap: 1px;
}
.lao-wordmark b {
  font-size: var(--lao-size-body);
  font-weight: 600;
  letter-spacing: -0.012em;
  white-space: nowrap;
}
.lao-wordmark span {
  font-size: var(--lao-size-micro);
  font-weight: 500;
  letter-spacing: 0.075em;
  text-transform: uppercase;
  color: var(--lao-text-faint);
  white-space: nowrap;
}

.lao-head-actions { display: flex; align-items: center; gap: 2px; flex: none; }

.lao-icon-btn {
  width: 30px; height: 30px;
  display: grid; place-items: center;
  border-radius: var(--lao-r-sm);
  color: var(--lao-text-muted);
  transition: background var(--lao-t-micro) var(--lao-ease-out),
              color var(--lao-t-micro) var(--lao-ease-out),
              transform var(--lao-t-micro) var(--lao-ease-out);
}
.lao-icon-btn:hover { background: var(--lao-surface-hover); color: var(--lao-text); }
.lao-icon-btn:active { background: var(--lao-surface-active); transform: scale(0.94); }

/* ------------------------------------------------------------------- views */

.lao-viewport { flex: 1; overflow: hidden; position: relative; }

/* Two panes side by side. The columns are 50% *of the track*, which is itself
   200% of the viewport — so each pane is exactly one panel wide, and shifting
   by 50% of the track advances by exactly one pane. */
.lao-track {
  display: grid;
  grid-template-columns: repeat(2, 50%);
  width: 200%;
  height: 100%;
  transition: transform var(--lao-t-panel) var(--lao-ease-soft);
}
:host([data-view="detail"]) .lao-track { transform: translateX(-50%); }

.lao-view {
  height: 100%;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  scrollbar-color: var(--lao-line-strong) transparent;
}
.lao-view::-webkit-scrollbar { width: 10px; }
.lao-view::-webkit-scrollbar-thumb {
  background: var(--lao-line-strong);
  border: 3px solid var(--lao-surface);
  border-radius: var(--lao-r-pill);
}
.lao-view::-webkit-scrollbar-track { background: transparent; }

/* The off-screen pane is inert, so it never receives focus or is read out. */
.lao-view[inert] { visibility: hidden; }

/* --------------------------------------------------------------- overview */

/* The headline answers "how bad is it?" in words. No score: a score invites
   gaming and tells nobody what to do next. */
.lao-hero { padding: var(--lao-s6) var(--lao-s4) var(--lao-s2); }
.lao-hero-big {
  font-size: 26px; font-weight: 600;
  letter-spacing: -0.028em; line-height: 1.15;
  color: var(--lao-text);
}
.lao-hero-small {
  margin-top: 6px;
  font-size: var(--lao-size-body);
  color: var(--lao-text-muted);
  max-width: 30ch;
}

.lao-section-label {
  display: flex; align-items: center; justify-content: space-between;
  padding: var(--lao-s5) var(--lao-s4) var(--lao-s2);
  font-size: var(--lao-size-micro);
  font-weight: 600; letter-spacing: 0.085em; text-transform: uppercase;
  color: var(--lao-text-faint);
}

/* Severity as a single dot plus a word. Two tiers, not three — "notice" is a
   distinction only an expert wants to make. */
.lao-dot {
  width: 8px; height: 8px; border-radius: 50%;
  flex: none; margin-top: 5px;
  background: var(--lao-critical);
}
.lao-dot[data-tier="check"] {
  background: transparent;
  box-shadow: inset 0 0 0 2px var(--lao-warning);
}
.lao-dot[data-tier="none"] { background: var(--lao-line-strong); }

/* ------------------------------------------------------------ issue rows */

.lao-items { padding: 0 var(--lao-s3); display: grid; gap: 2px; }

.lao-item {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: start;
  gap: var(--lao-s3);
  width: 100%; min-width: 0;
  padding: 11px var(--lao-s2) 11px var(--lao-s3);
  border-radius: var(--lao-r-md);
  transition: background var(--lao-t-micro) var(--lao-ease-out);
}
.lao-item:hover { background: var(--lao-surface-hover); }
.lao-item:hover .lao-chevron { transform: translateX(2px); }

.lao-item-body { display: grid; gap: 2px; min-width: 0; }
.lao-item-title {
  font-size: var(--lao-size-body); font-weight: 500;
  letter-spacing: -0.006em; line-height: 1.35;
  overflow-wrap: anywhere;
}
.lao-item-meta {
  font-size: var(--lao-size-meta); color: var(--lao-text-faint);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.lao-chevron {
  color: var(--lao-text-faint); margin-top: 3px;
  transition: transform var(--lao-t-base) var(--lao-ease-soft);
}

/* The two deeper views. Quieter than the issue list so they never compete
   with it for attention. */
.lao-items--quiet .lao-item-title { font-weight: 400; color: var(--lao-text-muted); }
.lao-explore { margin-top: auto; padding-bottom: var(--lao-s4); }

/* ------------------------------------------------------------- all clear */

.lao-clear {
  display: flex; flex-direction: column; align-items: center;
  text-align: center;
  padding: var(--lao-s8) var(--lao-s6) var(--lao-s6);
  gap: var(--lao-s4);
}
.lao-clear-mark { position: relative; width: 92px; height: 92px; display: grid; place-items: center; }
.lao-clear-mark svg { color: var(--lao-brand); position: relative; z-index: 1; }
.lao-clear-mark::before,
.lao-clear-mark::after {
  content: ""; position: absolute; inset: 0;
  border-radius: 50%;
  border: 1px solid var(--lao-brand-edge);
  opacity: 0;
}
.lao-clear-mark::before { animation: lao-settle-inner 900ms var(--lao-ease-soft) forwards; }
.lao-clear-mark::after  { animation: lao-settle-outer 1100ms var(--lao-ease-soft) 120ms forwards; }
@keyframes lao-settle-inner {
  0%   { transform: scale(0.5); opacity: 0; }
  100% { transform: scale(0.82); opacity: 0.75; }
}
@keyframes lao-settle-outer {
  0%   { transform: scale(0.6); opacity: 0; }
  100% { transform: scale(1); opacity: 0.4; }
}
.lao-clear-title { font-size: 19px; font-weight: 600; letter-spacing: -0.02em; }
.lao-clear p { font-size: var(--lao-size-body); color: var(--lao-text-muted); max-width: 30ch; }
.lao-clear-detail {
  font-size: var(--lao-size-meta); color: var(--lao-text-faint);
  padding-top: var(--lao-s2); border-top: 1px solid var(--lao-line);
  width: 100%; line-height: 1.7;
}

/* ============================================================ sub screens */

.lao-sub-head {
  position: sticky; top: 0; z-index: 2;
  display: flex; align-items: center; justify-content: space-between; gap: var(--lao-s2);
  padding: 9px var(--lao-s3) 9px var(--lao-s2);
  background: color-mix(in srgb, var(--lao-surface) 88%, transparent);
  backdrop-filter: blur(12px) saturate(1.4);
  -webkit-backdrop-filter: blur(12px) saturate(1.4);
  border-bottom: 1px solid var(--lao-line);
}
.lao-back {
  display: flex; align-items: center; gap: 4px;
  padding: 6px 10px 6px 6px;
  border-radius: var(--lao-r-sm);
  font-size: var(--lao-size-meta); font-weight: 500;
  color: var(--lao-text-muted);
  transition: background var(--lao-t-micro) var(--lao-ease-out),
              color var(--lao-t-micro) var(--lao-ease-out);
}
.lao-back:hover { background: var(--lao-surface-hover); color: var(--lao-text); }
.lao-back svg { transition: transform var(--lao-t-base) var(--lao-ease-out); }
.lao-back:hover svg { transform: translateX(-2px); }

.lao-sub-title {
  font-size: var(--lao-size-meta); font-weight: 600;
  color: var(--lao-text-muted); padding-right: var(--lao-s2);
}

/* Prev/Next through the issue list — the whole interaction model in one
   control, so nobody has to go back to a menu between issues. */
.lao-stepper { display: flex; align-items: center; gap: 2px; flex: none; }
.lao-stepper-count {
  font-size: var(--lao-size-micro); font-weight: 600;
  color: var(--lao-text-faint);
  font-variant-numeric: tabular-nums;
  min-width: 56px; text-align: center;
  letter-spacing: 0.02em;
}
.lao-step-btn {
  width: 28px; height: 28px;
  display: grid; place-items: center;
  border-radius: var(--lao-r-sm);
  color: var(--lao-text-muted);
  transition: background var(--lao-t-micro) var(--lao-ease-out),
              color var(--lao-t-micro) var(--lao-ease-out);
}
.lao-step-btn:hover:not(:disabled) { background: var(--lao-surface-hover); color: var(--lao-text); }
.lao-step-btn:disabled { opacity: 0.3; cursor: default; }

.lao-sub-body { padding: var(--lao-s4); display: grid; gap: var(--lao-s5); }

.lao-tier {
  display: inline-flex; align-items: center; gap: 7px;
  font-size: var(--lao-size-meta); font-weight: 600;
  color: var(--lao-critical);
}
.lao-tier[data-tier="check"] { color: var(--lao-warning); }
.lao-tier .lao-dot { margin-top: 0; }

.lao-issue-title {
  font-size: 20px; font-weight: 600;
  letter-spacing: -0.022em; line-height: 1.25;
  margin-top: -12px;
}

.lao-block { display: grid; gap: var(--lao-s2); }
.lao-block-title {
  font-size: var(--lao-size-micro); font-weight: 600;
  letter-spacing: 0.085em; text-transform: uppercase;
  color: var(--lao-text-faint);
}
.lao-prose { font-size: var(--lao-size-body); color: var(--lao-text-muted); line-height: 1.6; }

/* Evidence: the real thing, shown rather than described. */
.lao-sample {
  display: grid; gap: 4px;
  padding: var(--lao-s5) var(--lao-s4);
  border-radius: var(--lao-r-md);
  border: 1px solid var(--lao-line);
}
.lao-sample-lg { font-size: 19px; font-weight: 600; letter-spacing: -0.015em; }
.lao-sample-sm { font-size: var(--lao-size-body); }

.lao-quote {
  display: grid; gap: 4px;
  padding: var(--lao-s3) var(--lao-s4);
  border-radius: var(--lao-r-md);
  background: var(--lao-surface-sunken);
  border-left: 2px solid var(--lao-line-strong);
}
.lao-quote-label {
  font-size: var(--lao-size-micro); font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.07em;
  color: var(--lao-text-faint);
}
.lao-quote-text { font-size: var(--lao-size-body); color: var(--lao-text); overflow-wrap: anywhere; }

/* The colour swap: old to new, as two chips. Says what to change without
   requiring anyone to know what a hex value is. */
.lao-swap {
  display: grid; grid-template-columns: auto 1fr auto;
  align-items: center; gap: var(--lao-s3);
  width: 100%;
  padding: 11px var(--lao-s3);
  border: 1px solid var(--lao-line);
  border-radius: var(--lao-r-md);
  background: var(--lao-surface);
  transition: border-color var(--lao-t-micro) var(--lao-ease-out),
              background var(--lao-t-micro) var(--lao-ease-out);
}
.lao-swap:hover { border-color: var(--lao-brand-edge); background: var(--lao-brand-wash); }
.lao-swap-chips { display: flex; align-items: center; gap: 3px; }
.lao-chip-colour {
  width: 22px; height: 22px; border-radius: 6px;
  border: 1px solid var(--lao-scrim);
  box-shadow: inset 0 0 0 1px rgba(255,255,255,0.12);
}
.lao-swap-arrow { color: var(--lao-text-faint); }
.lao-swap-body { display: grid; gap: 1px; min-width: 0; }
.lao-swap-hex {
  font-family: var(--lao-mono); font-size: var(--lao-size-body);
  font-weight: 600; letter-spacing: 0.01em;
}
.lao-swap-note { font-size: var(--lao-size-micro); color: var(--lao-text-faint); }
.lao-copied { color: var(--lao-brand); font-weight: 600; }
.lao-copy-icon { color: var(--lao-text-faint); }

/* Stepping through the places one issue occurs, one at a time. */
.lao-places {
  display: grid; grid-template-columns: auto 1fr auto;
  align-items: center; gap: var(--lao-s2);
  padding: 7px var(--lao-s2);
  border: 1px solid var(--lao-line);
  border-radius: var(--lao-r-md);
}
.lao-places-body { display: grid; gap: 1px; min-width: 0; text-align: center; }
.lao-places-count {
  font-size: var(--lao-size-micro); font-weight: 600;
  color: var(--lao-text-faint); font-variant-numeric: tabular-nums;
}
.lao-places-text {
  font-size: var(--lao-size-meta); color: var(--lao-text-muted);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}

.lao-actions { display: flex; gap: var(--lao-s2); flex-wrap: wrap; }
.lao-btn {
  display: inline-flex; align-items: center; gap: 6px;
  min-height: 34px; padding: 0 14px;
  border-radius: var(--lao-r-sm);
  font-size: var(--lao-size-meta); font-weight: 600;
  border: 1px solid var(--lao-line-strong);
  color: var(--lao-text);
  transition: background var(--lao-t-micro) var(--lao-ease-out),
              border-color var(--lao-t-micro) var(--lao-ease-out),
              transform var(--lao-t-micro) var(--lao-ease-out);
}
.lao-btn:hover { background: var(--lao-surface-hover); border-color: var(--lao-text-faint); }
.lao-btn:active { transform: scale(0.97); }

/* Technical details: present for engineers, invisible to everyone else.
   Native <details> carries the right semantics without any ARIA of ours. */
.lao-tech {
  border-top: 1px solid var(--lao-line);
  padding-top: var(--lao-s3);
}
.lao-tech-summary {
  display: flex; align-items: center; gap: 6px;
  font-size: var(--lao-size-meta); font-weight: 500;
  color: var(--lao-text-faint);
  cursor: pointer;
  padding: 4px 0;
  border-radius: var(--lao-r-sm);
  list-style: none;
}
.lao-tech-summary::-webkit-details-marker { display: none; }
.lao-tech-summary:hover { color: var(--lao-text-muted); }
.lao-tech-summary .lao-chevron { margin-top: 0; }
.lao-tech[open] .lao-tech-summary .lao-chevron { transform: rotate(90deg); }
.lao-tech-summary:focus-visible {
  outline: 2px solid var(--lao-focus); outline-offset: 2px;
}
.lao-tech-list {
  display: grid; gap: 5px;
  padding: var(--lao-s2) 0 var(--lao-s1);
  font-size: var(--lao-size-meta);
  color: var(--lao-text-muted);
  line-height: 1.5;
}
.lao-tech-sel { font-family: var(--lao-mono); font-size: var(--lao-size-micro); color: var(--lao-text-faint); }

/* --------------------------------------------------------- page outline */

.lao-outline { display: grid; }

.lao-h {
  display: grid;
  grid-template-columns: auto auto 1fr auto;
  align-items: center;
  gap: var(--lao-s2);
  padding: 7px var(--lao-s2);
  border-radius: var(--lao-r-sm);
  width: 100%;
  transition: background var(--lao-t-micro) var(--lao-ease-out);
}
.lao-h:hover { background: var(--lao-surface-hover); }

/* The rail cancels the row's vertical padding so depth reads as continuous
   verticals rather than a column of dashes. */
.lao-rail { display: flex; align-self: stretch; flex: none; margin: -7px 0; }
.lao-rail i {
  width: 11px; align-self: stretch;
  border-left: 1px solid var(--lao-line);
  margin-right: 1px;
}

.lao-h-level {
  font-family: var(--lao-mono);
  font-size: var(--lao-size-micro); font-weight: 700;
  padding: 3px 5px; border-radius: 5px;
  background: var(--lao-surface-sunken);
  color: var(--lao-text-muted);
  flex: none;
}
.lao-h[data-sev="critical"] .lao-h-level { background: var(--lao-critical-wash); color: var(--lao-critical); }
.lao-h[data-sev="warning"] .lao-h-level  { background: var(--lao-warning-wash); color: var(--lao-warning); }
.lao-h[data-sev="notice"] .lao-h-level   { background: var(--lao-notice-wash); color: var(--lao-notice); }

.lao-h-text {
  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: var(--lao-size-meta);
}
.lao-h-flag {
  font-size: var(--lao-size-micro); font-weight: 600;
  padding: 2px 6px; border-radius: var(--lao-r-pill);
  white-space: nowrap; flex: none;
  background: var(--lao-warning-wash); color: var(--lao-warning);
}
.lao-h-flag[data-sev="critical"] { background: var(--lao-critical-wash); color: var(--lao-critical); }
.lao-h-flag[data-sev="notice"]   { background: var(--lao-notice-wash); color: var(--lao-notice); }

/* -------------------------------------------------------- keyboard path */

.lao-path-list { display: grid; gap: 1px; border-radius: var(--lao-r-sm); overflow: hidden; }
.lao-path-row {
  display: grid; grid-template-columns: auto 1fr auto;
  align-items: center; gap: var(--lao-s2);
  width: 100%;
  padding: 8px var(--lao-s2);
  background: var(--lao-surface-sunken);
  font-size: var(--lao-size-meta);
  transition: background var(--lao-t-micro) var(--lao-ease-out);
}
.lao-path-row:hover { background: var(--lao-surface-active); }
.lao-path-num {
  min-width: 20px; height: 20px; padding: 0 5px;
  display: grid; place-items: center;
  border-radius: var(--lao-r-pill);
  background: var(--lao-brand); color: var(--lao-focus-contrast);
  font-size: var(--lao-size-micro); font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.lao-path-name {
  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: var(--lao-text-muted);
}
.lao-unnamed { font-style: italic; opacity: 0.9; }

/* ------------------------------------------------------------------ footer */

.lao-foot {
  flex: none;
  display: flex; align-items: center; justify-content: space-between; gap: var(--lao-s3);
  padding: 8px var(--lao-s2) 8px var(--lao-s4);
  border-top: 1px solid var(--lao-line);
  background: var(--lao-surface-sunken);
}
.lao-foot-actions { display: flex; align-items: center; gap: 2px; flex: none; }
.lao-status {
  font-size: var(--lao-size-micro);
  color: var(--lao-text-faint);
  letter-spacing: 0.03em;
  display: flex; align-items: center; gap: 6px;
  min-width: 0;
}
.lao-status span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lao-dot-live {
  width: 5px; height: 5px; border-radius: 50%;
  background: var(--lao-brand); flex: none;
}
:host([data-scanning="true"]) .lao-dot-live { animation: lao-pulse 1.4s var(--lao-ease-soft) infinite; }
@keyframes lao-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.25; } }

/* ================================================================ overlay */

.lao-layer {
  position: fixed; inset: 0;
  pointer-events: none;
  overflow: hidden;
}

/* --- The signature: corner brackets, not a box ---------------------------- */

/* Exactly one of these exists at a time. Marking every finding at once is what
   made the first version overwhelming: it turned the page into a wall of
   brackets and said nothing about where to begin. */
.lao-mk {
  position: absolute;
  pointer-events: none;
  --c: var(--lao-critical-mark);
  --len: 16px;
  --w: 2px;
}
.lao-mk[data-tier="check"] { --c: var(--lao-warning-mark); }
.lao-mk[data-tier="none"]  { --c: var(--lao-brand); }

/* Eight gradient slices draw four L-shaped corners in a single element. The
   halo is a drop-shadow on the alpha, so it hugs the brackets rather than
   outlining a rectangle. */
.lao-mk-frame {
  position: absolute; inset: 0;
  border-radius: 4px;
  background-repeat: no-repeat;
  background-image:
    linear-gradient(var(--c), var(--c)), linear-gradient(var(--c), var(--c)),
    linear-gradient(var(--c), var(--c)), linear-gradient(var(--c), var(--c)),
    linear-gradient(var(--c), var(--c)), linear-gradient(var(--c), var(--c)),
    linear-gradient(var(--c), var(--c)), linear-gradient(var(--c), var(--c));
  background-size:
    var(--len) var(--w), var(--w) var(--len),
    var(--len) var(--w), var(--w) var(--len),
    var(--len) var(--w), var(--w) var(--len),
    var(--len) var(--w), var(--w) var(--len);
  background-position:
    left top, left top,
    right top, right top,
    left bottom, left bottom,
    right bottom, right bottom;
  filter:
    drop-shadow(0 0 0.5px var(--lao-marker-halo))
    drop-shadow(0 0 2px var(--lao-marker-halo));
}

.lao-mk-fill {
  position: absolute; inset: 0;
  border-radius: 4px;
  background: var(--c);
  opacity: 0.08;
}

/* A plain-language caption, not a ratio. Whoever is reading it already has the
   full explanation in the panel; this only has to say which thing is meant. */
/* Right-aligned above the frame. Whatever sits above a marked block is almost
   always left-aligned and narrower than it — a heading, a previous paragraph —
   so the top-right corner is usually empty space. Left-aligning it collided
   with the heading above on the very first page tried. */
.lao-mk-badge {
  position: absolute;
  bottom: 100%; right: -2px;
  margin-bottom: 5px;
  max-width: min(340px, 60vw);
  display: block;
  padding: 4px 9px;
  border-radius: 7px;
  background: var(--c);
  color: #fff;
  font-family: var(--lao-font);
  font-size: 11.5px; font-weight: 600;
  letter-spacing: -0.005em;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  box-shadow: 0 2px 8px rgba(0,0,0,0.22), 0 0 0 1px var(--lao-marker-halo);
}
.lao-mk[data-tier="check"] .lao-mk-badge { color: #2A1B00; }

/* Near the top of the viewport there is nothing above to hang from. */
.lao-mk[data-flip="true"] .lao-mk-badge { bottom: auto; top: calc(100% + 5px); }

/* The entrance animates opacity only. A running animation wins over inline
   styles, so animating transform here would permanently override the
   positioning transform written every frame. */
.lao-mk--in { animation: lao-mk-in 240ms var(--lao-ease-soft) both; }
.lao-mk--in .lao-mk-frame { animation: lao-frame-in 240ms var(--lao-ease-soft) both; }
@keyframes lao-mk-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes lao-frame-in {
  from { transform: scale(1.03); }
  to   { transform: none; }
}

/* --- Tab order path ------------------------------------------------------- */

.lao-path { position: absolute; inset: 0; overflow: visible; }
.lao-path path {
  fill: none;
  stroke: var(--lao-brand);
  stroke-width: 1.75;
  stroke-linecap: round;
  stroke-linejoin: round;
  opacity: 0.8;
  filter: drop-shadow(0 0 2px var(--lao-marker-halo));
}
/* Backward jumps differ in colour *and* dash, so the distinction does not rely
   on hue alone. */
.lao-path path[data-backward="true"] {
  stroke: var(--lao-warning-mark);
  stroke-dasharray: 5 4;
}

/* Direction is stated by an arrowhead at the midpoint rather than by motion —
   it stays legible when the page is paused, printed or screenshotted, and it
   costs nothing under prefers-reduced-motion. */
.lao-path .lao-arrow {
  fill: var(--lao-brand);
  stroke: none;
  opacity: 0.9;
  filter: drop-shadow(0 0 1.5px var(--lao-marker-halo));
}
.lao-path .lao-arrow[data-backward="true"] { fill: var(--lao-warning-mark); }

/* Positioned with left/top so transform stays free for the corner offset and
   the hover scale — an inline transform would otherwise beat the :hover rule. */
.lao-node {
  position: absolute;
  left: 0; top: 0;
  pointer-events: auto;
  min-width: 22px; height: 22px;
  padding: 0 6px;
  display: grid; place-items: center;
  border-radius: var(--lao-r-pill);
  background: var(--lao-brand);
  color: var(--lao-focus-contrast);
  font-family: var(--lao-font);
  font-size: 11px; font-weight: 700;
  font-variant-numeric: tabular-nums;
  box-shadow: 0 1px 4px rgba(0,0,0,0.3), 0 0 0 1.5px var(--lao-marker-halo);
  cursor: pointer;
  /* Hung off the corner rather than laid over it: at -7px the badge sat on top
     of inline link text, hiding the content being audited. */
  transform: translate(-78%, -78%);
  transform-origin: 100% 100%;
  transition: transform var(--lao-t-micro) var(--lao-ease-out),
              background var(--lao-t-base) var(--lao-ease-out);
  animation: lao-mk-in var(--lao-t-base) var(--lao-ease-soft) both;
}
.lao-node:hover { transform: translate(-78%, -78%) scale(1.16); }
/* Near the top of the viewport there is nowhere above to hang, so drop it to
   the element's left instead of letting it clip off-screen. */
.lao-node[data-flip="true"] { transform: translate(-100%, 0); }
.lao-node[data-flip="true"]:hover { transform: translate(-100%, 0) scale(1.16); }
.lao-node[data-flag="true"] { background: var(--lao-warning-mark); color: #2A1B00; }
.lao-node[data-flag="critical"] { background: var(--lao-critical-mark); color: #fff; }

/* ============================================== reduced motion / contrast */

/* Motion is removed, not merely shortened — including the decorative flow and
   settle animations, which are the ones most likely to cause discomfort. */
@media (prefers-reduced-motion: reduce) {
  :host {
    --lao-t-micro: 1ms;
    --lao-t-base: 1ms;
    --lao-t-panel: 1ms;
  }
  .lao-panel[data-state="closed"] { transform: none; }
  .lao-clear-mark::before { animation: none; opacity: 0.75; transform: scale(0.82); }
  .lao-clear-mark::after { animation: none; opacity: 0.4; }
  :host([data-scanning="true"]) .lao-dot { animation: none; opacity: 0.5; }
  .lao-mk--in, .lao-mk--in .lao-mk-frame, .lao-node { animation: none; }
  * { transition-duration: 1ms !important; }
}

/* Windows High Contrast: hand everything back to the system palette rather
   than fighting it with forced colour overrides. */
@media (forced-colors: active) {
  .lao-panel { border: 1px solid CanvasText; }
  .lao-mk-frame { forced-color-adjust: none; }
  .lao-swap, .lao-places, .lao-sample, .lao-path-row { border: 1px solid CanvasText; }
  :where(button, [tabindex]):focus-visible { outline: 2px solid Highlight; }
}
`;

  LAO.styles = CSS;
})();
