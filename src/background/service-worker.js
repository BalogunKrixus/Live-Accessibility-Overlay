/**
 * Live Accessibility Overlay — service worker.
 *
 * The extension holds no host permissions. Nothing is injected into any page
 * until the user explicitly asks for it (toolbar click or Alt+Shift+A), at
 * which point `activeTab` grants one-off access to that tab only. This keeps
 * the privacy story absolute: the extension cannot read a page it was not
 * invited into, and no scan result ever leaves the tab it was measured in.
 */

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

const PROTECTED = /^(chrome|edge|about|devtools|chrome-extension|moz-extension|view-source):/i;
const WEBSTORE = /^https:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore)/i;

/** Pages Chrome refuses to script. Failing loudly here beats a silent no-op. */
function blockedReason(url = '') {
  if (PROTECTED.test(url)) return 'Chrome does not allow extensions to run on browser pages.';
  if (WEBSTORE.test(url)) return 'Chrome does not allow extensions to run on the Web Store.';
  if (!url) return 'This tab has no page loaded yet.';
  return null;
}

/** Ask the tab whether the runtime is already live. Never throws. */
async function ping(tabId) {
  try {
    const res = await chrome.tabs.sendMessage(tabId, { type: 'lao:ping' });
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
      await chrome.tabs.sendMessage(tab.id, { type: 'lao:toggle' });
    } catch {
      /* Tab navigated mid-flight; the next click re-injects. */
    }
    return;
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: false },
      files: RUNTIME,
      injectImmediately: true,
    });
    await chrome.tabs.sendMessage(tab.id, { type: 'lao:open' });
  } catch (err) {
    await flashBadge(tab.id, '!', String(err?.message || err));
  }
}

async function flashBadge(tabId, text, title) {
  try {
    await chrome.action.setBadgeText({ tabId, text });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: '#8A5A0B' });
    await chrome.action.setTitle({ tabId, title: `Live Accessibility Overlay — ${title}` });
    setTimeout(() => {
      chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {});
      chrome.action
        .setTitle({ tabId, title: 'Live Accessibility Overlay — toggle (Alt+Shift+A)' })
        .catch(() => {});
    }, 4000);
  } catch {
    /* Tab closed. */
  }
}

chrome.action.onClicked.addListener(toggle);

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-overlay') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  toggle(tab);
});

/**
 * The toolbar badge shows one thing: the number of issues on the page in this
 * tab. Badges are set per-tab, so switching tabs shows that tab's own count and
 * never another page's. Anything that is not an issue count — a checkmark, a
 * status glyph — would make the number ambiguous at a glance, so there is none.
 */
const BADGE_COLOR = { fix: '#C22F4A', check: '#8A5A0B', clear: '#0C6F79' };

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== 'lao:badge' || !sender.tab?.id) return;
  const tabId = sender.tab.id;
  const { count = 0, tone = 'clear' } = msg;

  // No issues means no badge. A "0" reads as a measurement someone has to
  // interpret; an empty icon reads as nothing to do.
  const text = count > 99 ? '99+' : count > 0 ? String(count) : '';
  chrome.action.setBadgeText({ tabId, text }).catch(() => {});
  chrome.action
    .setBadgeBackgroundColor({ tabId, color: BADGE_COLOR[tone] || BADGE_COLOR.clear })
    .catch(() => {});
  chrome.action.setBadgeTextColor?.({ tabId, color: '#FFFFFF' }).catch(() => {});
  sendResponse({ ok: true });
  return false;
});

/**
 * Any navigation invalidates the count. `status === 'loading'` covers full page
 * loads; `info.url` also fires for in-page route changes in single-page apps,
 * where the count would otherwise sit there describing the previous view.
 */
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === 'loading' || info.url) {
    chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {});
  }
});
