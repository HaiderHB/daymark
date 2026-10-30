import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze, category, csv, dayAfter, midnight, sessionsFor } from '../src/Daymark/Web/analytics.mjs';
import { allowedDomain, permissionOrigins } from '../extension/shared.mjs';
const settings = {
  apps: [
    { process: 'cursor', name: 'Cursor', category: 'work' },
    { process: 'chrome', name: 'Chrome', category: 'personal' },
  ],
  sites: [{ browser: 'chrome', domain: 'youtube.com', category: 'personal' }],
};
const start = +new Date('2026-10-20T09:00:00');
const row = (minute, length, app = 'cursor', kind = 'active', extra = {}) => ({
  start: start + minute * 60000,
  end: start + (minute + length) * 60000,
  app,
  kind,
  domain: null,
  media: false,
  game: false,
  ...extra,
});
test('work, personal, AFK and offline are mutually exclusive; website time is not additive', () => {
  const r = analyze(
    [
      row(0, 60),
      row(60, 20, 'chrome', 'active', { domain: 'youtube.com' }),
      row(80, 10, '', 'afk'),
      row(90, 120, '', 'offline'),
    ],
    settings,
    midnight(start),
    dayAfter(start),
  );
  assert.equal(r.totals.work, 3600000);
  assert.equal(r.active, 80 * 60000);
  assert.equal(r.totals.afk, 10 * 60000);
  assert.equal(r.sites[0].ms, 20 * 60000);
  assert.equal(r.totals.offline, 120 * 60000);
});
test('app switches within a category remain one session, gaps and AFK break it', () => {
  const rows = [row(0, 20), row(20, 20, 'cursor'), row(40, 5, '', 'afk'), row(45, 10), row(60, 10)];
  assert.equal(sessionsFor(rows, settings).filter((s) => s.category === 'work').length, 3);
});
test('completed work-personal-work detours and averages exclude interrupted returns', () => {
  const r = analyze(
    [row(0, 60), row(60, 10, 'chrome'), row(70, 30), row(100, 20, 'chrome'), row(120, 10, '', 'afk')],
    settings,
    midnight(start),
    dayAfter(start),
  );
  assert.equal(r.interruptions, 2);
  assert.equal(r.averageReturn, 10 * 60000);
  assert.equal(r.averageWork, 45 * 60000);
  assert.equal(r.averagePersonal, 15 * 60000);
});
test('report clipping and midnight bucketing preserve totals', () => {
  const s = +new Date('2026-10-20T23:30:00'),
    e = +new Date('2026-10-21T00:30:00');
  const r = analyze([{ ...row(0, 1), start: s, end: e }], settings, midnight(s), dayAfter(e));
  assert.equal(r.days[0].work, 30 * 60000);
  assert.equal(r.days[1].work, 30 * 60000);
  const clipped = analyze([{ ...row(0, 1), start: s, end: e }], settings, s + 15 * 60000, e - 15 * 60000);
  assert.equal(clipped.totals.work, 30 * 60000);
});
test('empty days do not dilute recorded-day averages', () => {
  const r = analyze([row(0, 60)], settings, midnight(start), dayAfter(dayAfter(start)));
  assert.equal(r.days.length, 2);
  assert.equal(r.activeDays, 1);
  assert.equal(r.workPerDay, 3600000);
});
test('explicit rules override game detection; site rules override apps', () => {
  assert.equal(category(row(0, 1, 'cursor', 'active', { game: true }), settings), 'work');
  assert.equal(category(row(0, 1, 'game', 'active', { game: true }), settings), 'personal');
  assert.equal(category(row(0, 1, 'other'), settings), 'neutral');
  const workSite = { ...settings, sites: [{ browser: 'chrome', domain: 'youtube.com', category: 'work' }] };
  assert.equal(category(row(0, 1, 'chrome', 'active', { domain: 'youtube.com' }), workSite), 'work');
});
test('domain allowlist enforces browser scope and label boundaries', () => {
  assert.equal(allowedDomain('m.youtube.com', settings.sites, 'chrome'), 'youtube.com');
  for (const host of ['evilyoutube.com', 'youtube.com.evil.com', 'unapproved.com'])
    assert.equal(allowedDomain(host, settings.sites, 'chrome'), null);
  assert.equal(allowedDomain('youtube.com', settings.sites, 'vivaldi'), null);
  assert.deepEqual(permissionOrigins(settings.sites, 'chrome'), [
    'https://youtube.com/*',
    'https://*.youtube.com/*',
  ]);
});
test('CSV escapes spreadsheet formulas and quotes', () => {
  const output = csv([row(0, 1, '=HYPERLINK("x")')], settings);
  assert.ok(output.includes("'=HYPERLINK"));
  assert.ok(output.includes('""x""'));
});
test('DST fall-back day buckets both repeated hours without dropping duration', () => {
  const old = process.env.TZ;
  process.env.TZ = 'America/Toronto';
  try {
    const s = Date.parse('2026-11-01T00:00:00-04:00'),
      e = Date.parse('2026-11-02T00:00:00-05:00');
    const r = analyze([{ ...row(0, 1), start: s, end: e }], settings, s, e);
    assert.equal(r.totals.work, 25 * 3600000);
    assert.equal(
      r.days[0].hours.reduce((n, h) => n + h.work, 0),
      25 * 3600000,
    );
  } finally {
    process.env.TZ = old;
  }
});
