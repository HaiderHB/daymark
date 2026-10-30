// Runs only on domains the user explicitly granted. Never reads the page title or URL path.
(() => {
  if (globalThis.__daymarkActive) return;
  globalThis.__daymarkActive = true;
  function pulse() {
    if (['chatgpt.com', 'claude.ai'].includes(location.hostname))
      chrome.runtime.sendMessage({ type: 'ai', state: globalThis.daymarkAiState() }).catch(() => {});
    if (document.visibilityState !== 'visible') return;
    const playing = [...document.querySelectorAll('video,audio')].some(
      (m) => !m.paused && !m.ended && m.readyState >= 2,
    );
    chrome.runtime.sendMessage({ type: 'pulse', playing }).catch(() => {});
  }
  pulse();
  setInterval(pulse, 5000);
  document.addEventListener('visibilitychange', pulse);
  window.addEventListener('focus', pulse);
  if (['chatgpt.com', 'claude.ai'].includes(location.hostname)) {
    let pending = false;
    const observer = new MutationObserver(() => {
      if (pending) return;
      pending = true;
      setTimeout(() => {
        pending = false;
        pulse();
      }, 1500);
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-label', 'data-testid', 'disabled', 'hidden'],
    });
    window.addEventListener('pagehide', () =>
      chrome.runtime.sendMessage({ type: 'ai', state: 'unknown' }).catch(() => {}),
    );
  }
})();
