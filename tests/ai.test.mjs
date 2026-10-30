import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { aiReport, contexts, contextName } from '../src/Daymark/Web/ai.mjs';
import { permissionOrigins } from '../extension/shared.mjs';
const e = (at, state, session = 'a', evidence = 'hook', seen = at) => ({
  at,
  state,
  session,
  provider: 'codex',
  project: 'repo',
  evidence,
  seen,
});
test('concurrent AI sessions count once and coverage is limited to human work', () => {
  const r = aiReport(
    [e(1000, 'running'), e(11000, 'idle'), e(5000, 'running', 'b'), e(15000, 'idle', 'b')],
    [{ start: 3000, end: 8000 }],
    0,
    20000,
    20000,
  );
  assert.equal(r.total, 14000);
  assert.equal(r.overlap, 5000);
});
test('missing stop does not manufacture indefinite running time', () => {
  const r = aiReport([e(1000, 'running')], [], 0, 4000000, 4000000);
  assert.equal(r.total, 1800000);
  assert.equal(r.latest[0].state, 'unknown');
});
test('web heartbeats expire sooner, and waiting is not running', () => {
  const r = aiReport([e(1000, 'running', 'a', 'web-ui'), e(6000, 'waiting', 'b')], [], 0, 200000, 200000);
  assert.equal(r.total, 90000);
  assert.equal(r.latest.find((x) => x.session === 'a').state, 'unknown');
});
test('coalesced heartbeats preserve a long continuous run', () => {
  const r = aiReport(
    [e(1000, 'running', 'a', 'web-ui', 601000), e(602000, 'idle', 'a', 'web-ui')],
    [],
    0,
    700000,
    700000,
  );
  assert.equal(r.total, 601000);
});
test('context grouping strips browser suffix and groups Cursor files by project', () => {
  assert.equal(contextName('vivaldi', 'Design notes - Vivaldi'), 'Design notes');
  assert.equal(contextName('cursor', 'index.ts — daymark — Cursor'), 'daymark');
  const r = contexts([
    { app: 'cursor', title: 'app.ts - daymark - Cursor', kind: 'active', start: 0, end: 1000 },
    { app: 'cursor', title: 'test.ts - daymark - Cursor', kind: 'active', start: 1000, end: 2000 },
  ]);
  assert.equal(r.length, 1);
  assert.equal(r[0].ms, 2000);
});
test('AI permission grants do not add domains to the usage allowlist', () => {
  const sites = [{ browser: 'chrome', domain: 'youtube.com' }];
  assert.equal(permissionOrigins(sites, 'vivaldi', true).length, 4);
  assert.equal(sites.length, 1);
  assert.deepEqual(permissionOrigins(sites, 'vivaldi', false), []);
});
test('web detector reports unknown when controls are absent and ignores hidden stop buttons', () => {
  const context = {};
  vm.createContext(context);
  vm.runInContext(readFileSync(new URL('../extension/ai-indicator.js', import.meta.url), 'utf8'), context);
  assert.equal(context.daymarkAiState({ querySelectorAll: () => [] }), 'unknown');
  const visible = { hidden: false, getAttribute: () => null, getClientRects: () => [1] };
  assert.equal(
    context.daymarkAiState({ querySelectorAll: (s) => (s.includes('stop-button') ? [visible] : []) }),
    'running',
  );
  assert.equal(
    context.daymarkAiState({
      querySelectorAll: (s) => (s.includes('stop-button') ? [{ ...visible, hidden: true }] : []),
    }),
    'unknown',
  );
  assert.equal(
    context.daymarkAiState({ querySelectorAll: (s) => (s.includes('stop-button') ? [] : [visible]) }),
    'idle',
  );
});
