export const PROVIDERS = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  'claude-web': 'Claude web',
  'chatgpt-web': 'ChatGPT web',
};
export function union(spans) {
  const merged = [];
  for (const s of spans.filter((s) => s.end > s.start).sort((a, b) => a.start - b.start)) {
    const last = merged.at(-1);
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
    else merged.push({ start: s.start, end: s.end });
  }
  return merged;
}
export function aiReport(events, workSegments, start, end, now = Date.now()) {
  end = Math.min(end, now);
  const groups = new Map();
  for (const e of events) {
    const key = e.provider + '/' + e.session;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }
  const spans = [],
    latest = [];
  for (const list of groups.values()) {
    list.sort((a, b) => a.at - b.at);
    list.forEach((e, i) => {
      const expires = (e.seen || e.at) + (e.evidence === 'web-ui' ? 90000 : 1800000),
        to = Math.min(end, list[i + 1]?.at ?? end, expires);
      if (to > Math.max(start, e.at)) spans.push({ ...e, start: Math.max(start, e.at), end: to });
    });
    const e = list.at(-1),
      expires = (e.seen || e.at) + (e.evidence === 'web-ui' ? 90000 : 1800000);
    latest.push({ ...e, state: now < expires ? e.state : 'unknown' });
  }
  const running = union(spans.filter((s) => s.state === 'running'));
  const total = running.reduce((n, s) => n + s.end - s.start, 0);
  let overlap = 0;
  for (const w of workSegments)
    for (const a of running) overlap += Math.max(0, Math.min(w.end, a.end) - Math.max(w.start, a.start));
  return { spans, running, total, overlap, latest: latest.sort((a, b) => b.at - a.at) };
}
export function contextName(app, title) {
  if (app === 'vivaldi') return title.replace(/\s*[-–—]\s*Vivaldi\s*$/i, '').trim();
  if (app === 'cursor') {
    const clean = title.replace(/\s*[-–—]\s*Cursor\s*$/i, '');
    return clean
      .split(/\s+[-–—]\s+/)
      .at(-1)
      .trim();
  }
  return title;
}
export function contexts(rows) {
  const result = new Map();
  for (const r of rows) {
    if (r.kind !== 'active' || !r.title) continue;
    const name = contextName(r.app, r.title),
      key = r.app + '/' + name;
    const v = result.get(key) || { app: r.app, name, ms: 0 };
    v.ms += r.end - r.start;
    result.set(key, v);
  }
  return [...result.values()].sort((a, b) => b.ms - a.ms);
}
export function demoAi(rows) {
  return rows
    .filter((r, i) => r.app === 'cursor' && i % 2 === 0)
    .flatMap((r, i) => [
      {
        at: r.start,
        seen: r.end - 1000,
        provider: i % 2 ? 'codex' : 'claude-code',
        session: 'sample-' + i,
        project: 'daymark',
        state: 'running',
        evidence: 'hook',
      },
      {
        at: r.end,
        seen: r.end,
        provider: i % 2 ? 'codex' : 'claude-code',
        session: 'sample-' + i,
        project: 'daymark',
        state: 'idle',
        evidence: 'hook',
      },
    ]);
}
