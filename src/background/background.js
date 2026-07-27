/**
 * Live Accessibility Overlay — background script.
 *
 * Runs as a service worker in Chrome and as an event page in Firefox; both are
 * non-persistent and this file uses no API specific to either.
 *
 * The extension holds no host permissions. Nothing is injected into any page
 * until the user explicitly asks for it (toolbar click or Alt+Shift+A), at
 * which point `activeTab` grants one-off access to that tab only. This keeps
 * the privacy story absolute: the extension cannot read a page it was not
 * invited into, and no scan result ever leaves the tab it was measured in.
 */

/**
 * Chrome's `chrome.*` returns promises under MV3. Firefox's `chrome.*` is
 * callback-based for compatibility and only `browser.*` returns promises, so
 * awaiting `chrome.*` in Firefox yields undefined and fails silently.
 * Preferring `browser` gives one promise-based API on both.
 */
const api = globalThis.browser ?? globalThis.chrome;

// Injection order matters: each file attaches to a shared namespace on the
// isolated world's globalThis, so dependencies must land first.
const RUNTIME = [
  'src/core/util.js',
  'src/core/color.js',
  'src/audits/contrast.js',
  'src/audits/headings.js',
  'src/audits/images.js',
  'src/audits/taborder.js',
  'src/ui/styles.js',
  'src/ui/icons.js',
  'src/ui/copy.js',
  'src/ui/overlay.js',
  'src/ui/panel.js',
  'src/content/main.js',
];

const PROTECTED =
  /^(chrome|edge|about|devtools|chrome-extension|moz-extension|view-source|resource):/i;

/**
 * Sites both vendors reserve. Chrome blocks its own Web Store; Firefox blocks
 * addons.mozilla.org and the Firefox accounts domain. Listing both is harmless
 * on either browser and means one build behaves correctly on both.
 */
const RESTRICTED_SITES =
  /^https:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore|addons\.mozilla\.org|addons\.cdn\.mozilla\.net|accounts\.firefox\.com)/i;

/** Pages the browser refuses to script. Failing loudly beats a silent no-op. */
function blockedReason(url = '') {
  if (PROTECTED.test(url)) return 'Your browser does not allow extensions to run on its own pages.';
  if (RESTRICTED_SITES.test(url)) return 'Your browser does not allow extensions to run on this site.';
  if (!url) return 'This tab has no page loaded yet.';
  return null;
}

/** Ask the tab whether the runtime is already live. Never throws. */
async function ping(tabId) {
  try {
    const res = await api.tabs.sendMessage(tabId, { type: 'lao:ping' });
    return res?.type === 'lao:pong';
  } catch {
    return false; // No receiver — not injected yet.
  }
}

async function toggle(tab) {
  if (!tab?.id) return;

  const reason = blockedReason(tab.url);
  if (reason) {
    await flashBadge(tab.id, '—', reason);
    return;
  }

  if (await ping(tab.id)) {
    // Already running: let the content script own the open/close transition so
    // the exit animation plays instead of the DOM being ripped out.
    try {
      await api.tabs.sendMessage(tab.id, { type: 'lao:toggle' });
    } catch {
      /* Tab navigated mid-flight; the next click re-injects. */
    }
    return;
  }

  try {
    await api.scripting.executeScript({
      target: { tabId: tab.id, allFrames: false },
      files: RUNTIME,
      injectImmediately: true,
    });
    await api.tabs.sendMessage(tab.id, { type: 'lao:open' });
  } catch (err) {
    await flashBadge(tab.id, '!', String(err?.message || err));
  }
}

async function flashBadge(tabId, text, title) {
  try {
    await api.action.setBadgeText({ tabId, text });
    await api.action.setBadgeBackgroundColor({ tabId, color: '#8A5A0B' });
    await api.action.setTitle({ tabId, title: `Live Accessibility Overlay — ${title}` });
    setTimeout(() => {
      api.action.setBadgeText({ tabId, text: '' }).catch(() => {});
      api.action
        .setTitle({ tabId, title: 'Live Accessibility Overlay — toggle (Alt+Shift+A)' })
        .catch(() => {});
    }, 4000);
  } catch {
    /* Tab closed. */
  }
}

api.action.onClicked.addListener(toggle);

api.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-overlay') return;
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  toggle(tab);
});

/**
 * The toolbar badge shows one thing: the number of issues on the page in this
 * tab. Badges are set per-tab, so switching tabs shows that tab's own count and
 * never another page's. Anything that is not an issue count — a checkmark, a
 * status glyph — would make the number ambiguous at a glance, so there is none.
 */
const BADGE_COLOR = { fix: '#C22F4A', check: '#8A5A0B', clear: '#0C6F79' };

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== 'lao:badge' || !sender.tab?.id) return;
  const tabId = sender.tab.id;
  const { count = 0, tone = 'clear' } = msg;

  // No issues means no badge. A "0" reads as a measurement someone has to
  // interpret; an empty icon reads as nothing to do.
  const text = count > 99 ? '99+' : count > 0 ? String(count) : '';
  api.action.setBadgeText({ tabId, text }).catch(() => {});
  api.action
    .setBadgeBackgroundColor({ tabId, color: BADGE_COLOR[tone] || BADGE_COLOR.clear })
    .catch(() => {});
  api.action.setBadgeTextColor?.({ tabId, color: '#FFFFFF' }).catch(() => {});
  sendResponse({ ok: true });
  return false;
});

/**
 * Any navigation invalidates the count. `status === 'loading'` covers full page
 * loads; `info.url` also fires for in-page route changes in single-page apps,
 * where the count would otherwise sit there describing the previous view.
 */
api.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === 'loading' || info.url) {
    api.action.setBadgeText({ tabId, text: '' }).catch(() => {});
  }
});
