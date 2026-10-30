import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = process.cwd(),
  dir = path.join(root, 'artifacts', 'smoke-' + Date.now()),
  port = 43128;
await mkdir(dir, { recursive: true });
await mkdir(path.join(root, 'docs'), { recursive: true });
const exe =
  process.env.DAYMARK_EXE ||
  path.join(root, 'src', 'Daymark', 'bin', 'Release', 'net10.0-windows10.0.19041.0', 'Daymark.exe');
const child = spawn(exe, ['--data-dir', dir, '--port', String(port), '--background', '--no-track'], {
  windowsHide: true,
  stdio: 'ignore',
});
let browser;
try {
  let configuration;
  for (let i = 0; i < 60; i++) {
    try {
      configuration = JSON.parse(await readFile(path.join(dir, 'settings.json'), 'utf8'));
      const res = await fetch(`http://127.0.0.1:${port}/`);
      if (res.ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  assert.ok(configuration, 'App created settings');
  const base = `http://127.0.0.1:${port}`,
    auth = { Authorization: 'Bearer ' + configuration.uiToken };
  assert.equal((await fetch(base + '/api/status')).status, 401, 'Unauthenticated request rejected');
  assert.equal(
    (await fetch(base + '/api/status', { headers: { ...auth, Origin: 'https://evil.example' } })).status,
    403,
    'Foreign origin rejected',
  );
  assert.equal(
    (
      await fetch(base + '/api/segments?start=0&end=1000', {
        headers: { Authorization: 'Bearer ' + configuration.browserToken },
      })
    ).status,
    401,
    'Browser cannot read history',
  );
  assert.equal(
    (
      await fetch(base + '/api/browser/config', {
        headers: { Authorization: 'Bearer ' + configuration.browserToken },
      })
    ).status,
    200,
    'Browser can read allowlist',
  );
  const pulse = await fetch(base + '/api/browser', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + configuration.browserToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ browser: 'chrome', domain: 'private.example.com', playing: true, focused: true }),
  });
  assert.equal(pulse.status, 200);
  const badRange = await fetch(base + '/api/segments?start=0&end=999999999999', { headers: auth });
  assert.equal(badRange.status, 400);
  assert.equal(
    (
      await fetch(base + '/api/status', {
        headers: { Authorization: 'Bearer ' + configuration.integrationToken },
      })
    ).status,
    401,
    'Integration key cannot read status',
  );
  await fetch(base + '/api/pause', {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ paused: false }),
  });
  for (const event of ['UserPromptSubmit', 'PermissionRequest', 'Stop']) {
    await new Promise((resolve, reject) => {
      const hook = spawn(exe, ['--hook', 'codex', '--data-dir', dir, '--port', String(port)], {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let output = '';
      hook.stdout.on('data', (d) => (output += d));
      hook.on('error', reject);
      hook.on('exit', (code) => {
        try {
          assert.equal(code, 0);
          assert.deepEqual(JSON.parse(output), {});
          resolve();
        } catch (e) {
          reject(e);
        }
      });
      hook.stdin.end(
        JSON.stringify({
          hook_event_name: event,
          session_id: 'synthetic-session',
          cwd: 'C:/examples/daymark',
          prompt: 'PRIVATE TEST PROMPT',
        }),
      );
    });
  }
  // Use a bounded range, as with every history endpoint.
  const aiRows = await (
    await fetch(base + `/api/ai-events?start=${Date.now() - 60000}&end=${Date.now() + 1000}`, {
      headers: auth,
    })
  ).json();
  assert.deepEqual(
    aiRows.map((e) => e.state),
    ['running', 'waiting', 'idle'],
  );
  assert.ok(!JSON.stringify(aiRows).includes('PRIVATE TEST PROMPT'));
  await fetch(base + '/api/pause', {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ paused: true }),
  });
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
    timezoneId: 'America/Toronto',
  });
  const page = await context.newPage(),
    errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base + '/#token=' + configuration.uiToken);
  await page.getByRole('heading', { name: 'Your time, in perspective.' }).waitFor();
  await page.getByRole('button', { name: 'Try sample data', exact: true }).click();
  await page.getByText("You're exploring sample data.", { exact: false }).waitFor();
  await page.getByRole('button', { name: '7 days', exact: true }).click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(root, 'docs', 'overview.png'), fullPage: true });
  await page.locator('[data-page=timeline]').click();
  await page.getByRole('heading', { name: 'The shape of your day.' }).waitFor();
  assert.ok((await page.locator('.session-row').count()) > 10);
  await page.locator('[data-page=apps]').click();
  await page.getByRole('heading', { name: 'Your allowed websites' }).waitFor();
  assert.ok(await page.getByText('youtube.com', { exact: true }).count());
  await page.locator('[data-page=patterns]').click();
  await page.getByRole('heading', { name: 'Your working window' }).waitFor();
  await page.locator('[data-page=ai]').click();
  await page.getByRole('heading', { name: 'Your background team' }).waitFor();
  assert.ok((await page.locator('.session-row').count()) > 0);
  await page.locator('[data-page=settings]').click();
  await page.getByRole('heading', { name: 'Your app rules' }).waitFor();
  assert.equal(await page.locator('#save-settings').isDisabled(), true);
  await page.getByRole('button', { name: 'Back to my data →' }).click();
  await page.waitForTimeout(300);
  assert.equal(await page.locator('#save-settings').isDisabled(), false);
  await page.locator('#idle').fill('4');
  await page.locator('#save-settings').click();
  await page.getByText('Your rules are saved.', { exact: true }).waitFor();
  const saved = await (await fetch(base + '/api/settings', { headers: auth })).json();
  assert.equal(saved.settings.idleMinutes, 4);
  const workApp = page.locator('#add-app');
  await workApp.locator('[name=process]').fill('test-app');
  await workApp.locator('[name=name]').fill('Test App');
  await workApp.getByRole('button', { name: 'Add rule' }).click();
  await page.getByText('Test App', { exact: true }).waitFor();
  await page.locator('[data-page=overview]').click();
  await page.getByRole('button', { name: 'Try sample data', exact: true }).click();
  await page.waitForTimeout(300);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  const download = await downloadPromise;
  assert.ok(download.suggestedFilename().includes('sample'));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(dir, 'mobile.png'), fullPage: true });
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    'No horizontal overflow on narrow screen',
  );
  assert.deepEqual(errors, [], 'No browser runtime errors');
  await writeFile(
    path.join(dir, 'result.json'),
    JSON.stringify(
      {
        passed: true,
        checks: [
          'API authorization',
          'origin checks',
          'extension least privilege',
          'range validation',
          'all dashboard pages',
          'settings persistence',
          'custom app rule',
          'CSV download',
          'narrow viewport',
          'no runtime errors',
        ],
      },
      null,
      2,
    ),
  );
  console.log(
    'PASS: API security, 5 dashboard pages, settings persistence, app rules, CSV export, responsive layout.',
  );
} finally {
  if (browser) await browser.close();
  child.kill();
}
