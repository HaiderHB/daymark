import { allowedDomain, permissionOrigins } from './shared.mjs';
const BASE = 'http://127.0.0.1:43127';
chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());
async function state() {
  return chrome.storage.local.get({ token: '', browser: 'chrome', sites: [], aiWebEnabled: false });
}
async function post(pulse) {
  const config = await state();
  if (!config.token) return;
  try {
    await fetch(BASE + '/api/browser', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + config.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ browser: config.browser, ...pulse }),
      signal: AbortSignal.timeout(3000),
    });
  } catch {}
}
let registration = Promise.resolve();
function register() {
  registration = registration.catch(() => {}).then(registerNow);
  return registration;
}
async function registerNow() {
  const c = await state();
  const permitted = [];
  for (const origin of permissionOrigins(c.sites, c.browser, c.aiWebEnabled)) {
    if (await chrome.permissions.contains({ origins: [origin] })) permitted.push(origin);
  }
  await chrome.scripting.unregisterContentScripts();
  if (permitted.length)
    await chrome.scripting.registerContentScripts([
      {
        id: 'daymark-allowed',
        matches: permitted,
        js: ['ai-indicator.js', 'content.js'],
        runAt: 'document_idle',
        persistAcrossSessions: true,
      },
    ]);
}
chrome.runtime.onInstalled.addListener(() => register().catch(() => {}));
chrome.runtime.onStartup.addListener(() => register().catch(() => {}));
chrome.permissions.onAdded.addListener(() => register().catch(() => {}));
chrome.permissions.onRemoved.addListener(() => register().catch(() => {}));
chrome.storage.onChanged.addListener(() => register().catch(() => {}));
// We request no tabs/history permission. URLs are only accessible on granted hosts.
async function clearOrReport(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId),
      win = await chrome.windows.get(tab.windowId);
    if (!tab.active || !win.focused) return;
    const c = await state();
    let host = '';
    try {
      host = new URL(tab.url || '').hostname;
    } catch {}
    const domain = allowedDomain(host, c.sites, c.browser);
    await post({ domain, playing: false, focused: !!domain });
  } catch {}
}
chrome.tabs.onActivated.addListener((info) => clearOrReport(info.tabId));
chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (tab.active && (change.url || change.status === 'loading')) clearOrReport(tabId);
});
chrome.windows.onFocusChanged.addListener(async (id) => {
  if (id === chrome.windows.WINDOW_ID_NONE) {
    await post({ domain: null, playing: false, focused: false });
    return;
  }
  const tabs = await chrome.tabs.query({ active: true, windowId: id });
  if (tabs[0]?.id) await clearOrReport(tabs[0].id);
});
chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (msg?.type === 'sync') {
    register()
      .then(() => respond({ ok: true }))
      .catch((e) => respond({ error: e.message }));
    return true;
  }
  if (!['pulse', 'ai'].includes(msg?.type) || !sender.tab || sender.frameId !== 0) return false;
  (async () => {
    const config = await state();
    const host = new URL(sender.url).hostname;
    if (msg.type === 'ai') {
      const provider = host === 'chatgpt.com' ? 'chatgpt-web' : host === 'claude.ai' ? 'claude-web' : null;
      if (!config.aiWebEnabled || !provider || !['running', 'idle', 'unknown'].includes(msg.state)) {
        respond({ ok: false });
        return;
      }
      const sessionData = await chrome.storage.session.get('instance');
      const instance = sessionData.instance || crypto.randomUUID();
      if (!sessionData.instance) await chrome.storage.session.set({ instance });
      await fetch(BASE + '/api/ai', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + config.token, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          session: `${config.browser}:${instance}:${sender.tab.id}`,
          project: null,
          state: msg.state,
          evidence: 'web-ui',
        }),
        signal: AbortSignal.timeout(3000),
      });
      respond({ ok: true });
      return;
    }
    const domain = allowedDomain(host, config.sites, config.browser);
    if (!domain) {
      respond({ ok: false });
      return;
    }
    const tab = await chrome.tabs.get(sender.tab.id);
    const win = await chrome.windows.get(tab.windowId);
    if (!tab.active || !win.focused) {
      respond({ ok: false });
      return;
    }
    await post({ domain, playing: !!msg.playing, focused: true });
    respond({ ok: true });
  })().catch(() => respond({ ok: false }));
  return true;
});
