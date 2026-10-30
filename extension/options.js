import { permissionOrigins } from './shared.mjs';
const $ = (s) => document.querySelector(s);
let sites = [];
let aiWebEnabled = false;
const saved = await chrome.storage.local.get({
  token: '',
  browser: 'chrome',
  sites: [],
  aiWebEnabled: false,
});
$('#token').value = saved.token;
$('#browser').value = saved.browser;
sites = saved.sites;
aiWebEnabled = saved.aiWebEnabled;
render();
function render() {
  const list = $('#sites');
  list.replaceChildren();
  for (const s of sites.filter((s) => s.browser === $('#browser').value)) {
    const li = document.createElement('li');
    li.textContent = s.domain;
    list.append(li);
  }
  if (aiWebEnabled)
    for (const host of ['chatgpt.com', 'claude.ai']) {
      const li = document.createElement('li');
      li.textContent = host + ' · AI controls only (experimental)';
      list.append(li);
    }
  $('#grant').disabled = !aiWebEnabled && !sites.some((s) => s.browser === $('#browser').value);
}
$('#browser').onchange = () => {
  $('#grant').disabled = true;
  $('#status').textContent = 'Connect again to save your browser selection.';
};
$('#connect').onclick = async () => {
  try {
    const token = $('#token').value.trim(),
      browser = $('#browser').value;
    const res = await fetch('http://127.0.0.1:43127/api/browser/config', {
      headers: { Authorization: 'Bearer ' + token },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw Error('Pairing failed. Copy the browser pairing key from Daymark Settings.');
    ({ sites, aiWebEnabled } = await res.json());
    await chrome.storage.local.set({ token, browser, sites, aiWebEnabled });
    await chrome.runtime.sendMessage({ type: 'sync' });
    render();
    $('#status').textContent = 'Connected. Now grant access to your allowed sites.';
  } catch (e) {
    $('#status').textContent = e.message.includes('fetch')
      ? 'Cannot reach Daymark. Start the desktop app, then try again.'
      : e.message;
  }
};
$('#grant').onclick = async () => {
  try {
    const origins = permissionOrigins(sites, $('#browser').value, aiWebEnabled);
    const granted = await chrome.permissions.request({ origins });
    if (!granted) {
      $('#status').textContent = 'No access was granted. Tracking stays off for those sites.';
      return;
    }
    await chrome.runtime.sendMessage({ type: 'sync' });
    $('#status').textContent = 'Ready. Reload your allowed tabs, then use your browser normally.';
  } catch (e) {
    $('#status').textContent = e.message;
  }
};
