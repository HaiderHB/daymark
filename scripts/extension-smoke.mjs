import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = process.cwd(),
  dir = path.join(root, 'artifacts', 'extension-smoke-' + Date.now()),
  extension = path.join(dir, 'extension');
await mkdir(dir, { recursive: true });
await cp(path.join(root, 'extension'), extension, { recursive: true });
const manifest = JSON.parse(await readFile(path.join(extension, 'manifest.json'), 'utf8'));
// Simulate already-granted specific hosts in an isolated test copy. Shipping permissions stay optional.
manifest.host_permissions.push('https://youtube.com/*', 'https://chatgpt.com/*', 'https://claude.ai/*');
await writeFile(path.join(extension, 'manifest.json'), JSON.stringify(manifest));
const received = [];
const server = createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  received.push({ path: req.url, body: body ? JSON.parse(body) : null });
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ ok: true }));
});
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(43127, '127.0.0.1', resolve);
});
let context;
try {
  context = await chromium.launchPersistentContext(path.join(dir, 'profile'), {
    headless: true,
    channel: 'chromium',
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  const worker = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'));
  await new Promise((r) => setTimeout(r, 500));
  await worker.evaluate(() =>
    chrome.storage.local.set({
      token: 'synthetic-test-key',
      browser: 'chrome',
      sites: [{ browser: 'chrome', domain: 'youtube.com', category: 'personal' }],
      aiWebEnabled: true,
    }),
  );
  for (let i = 0; i < 20; i++) {
    const scripts = await worker.evaluate(() => chrome.scripting.getRegisteredContentScripts());
    if (scripts.length) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  await context.route('https://**/*', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html><body><button data-testid="stop-button">Stop</button><div id="prompt-textarea" contenteditable="true">PRIVATE PROMPT</div></body></html>',
    }),
  );
  const page = await context.newPage();
  await page.goto('https://chatgpt.com/');
  await page.waitForTimeout(1000);
  assert.ok(
    received.some((r) => r.path === '/api/ai' && r.body.state === 'running'),
    'Extension reports generation indicator',
  );
  await page.evaluate(() => {
    document.querySelector('button').remove();
    const b = document.createElement('button');
    b.dataset.testid = 'send-button';
    b.textContent = 'Send';
    document.body.append(b);
  });
  await page.waitForTimeout(2000);
  assert.ok(
    received.some((r) => r.path === '/api/ai' && r.body.state === 'idle'),
    'Extension observes generation end',
  );
  await page.goto('https://youtube.com/');
  await page.waitForTimeout(1000);
  assert.ok(
    received.some((r) => r.path === '/api/browser' && r.body.domain === 'youtube.com'),
    'Allowlisted foreground domain reported',
  );
  await page.goto('https://unapproved.example/');
  await page.waitForTimeout(500);
  assert.ok(
    !JSON.stringify(received).includes('unapproved.example'),
    'Unapproved hostname never transmitted',
  );
  assert.ok(!JSON.stringify(received).includes('PRIVATE PROMPT'), 'Prompt contents never transmitted');
  console.log(
    'PASS: MV3 service worker, content injection, AI start/stop controls, allowlisted sites, no prompt contents or unapproved domains.',
  );
} finally {
  if (context) await context.close();
  await new Promise((r) => server.close(r));
}
