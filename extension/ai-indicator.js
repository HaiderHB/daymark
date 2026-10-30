// Experimental UI signals only. No prompt, response, conversation title or URL path is read.
globalThis.daymarkAiState = function (root = document) {
  const visible = (selector) =>
    [...root.querySelectorAll(selector)].some(
      (el) => !el.hidden && el.getAttribute('aria-hidden') !== 'true' && el.getClientRects().length > 0,
    );
  if (
    visible(
      '[data-testid="stop-button"], [data-testid="stop-response-button"], button[aria-label="Stop generating"], button[aria-label="Stop response"], button[aria-label="Stop streaming"], button[aria-label="Stop"]',
    )
  )
    return 'running';
  if (
    visible('#prompt-textarea, [data-testid="chat-input"], .ProseMirror[contenteditable="true"]') &&
    visible(
      '[data-testid="send-button"], button[aria-label="Send message"], button[aria-label="Send Message"], button[aria-label="Send prompt"]',
    )
  )
    return 'idle';
  return 'unknown';
};
