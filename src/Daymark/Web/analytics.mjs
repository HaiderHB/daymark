export const COLORS = {
  work: '#277356',
  personal: '#dc9971',
  neutral: '#a9b5bf',
  afk: '#dedfd7',
  locked: '#dedfd7',
  offline: '#f0f0ea',
};
export const LABELS = {
  work: 'Work',
  personal: 'Personal',
  neutral: 'Unsorted',
  afk: 'Away',
  locked: 'Locked',
  offline: 'Offline',
};
export function category(row, settings) {
  if (row.kind !== 'active') return row.kind;
  const site = row.domain && settings.sites.find((x) => x.browser === row.app && x.domain === row.domain);
  return (
    site?.category ||
    settings.apps.find((x) => x.process === row.app)?.category ||
    (row.game ? 'personal' : 'neutral')
  );
}
export function appName(app, settings) {
  return (
    settings.apps.find((x) => x.process === app)?.name || (app ? app[0].toUpperCase() + app.slice(1) : 'Away')
  );
}
export function duration(ms, compact = false) {
  const minutes = Math.floor(Math.max(0, ms) / 60000);
  if (!minutes) return ms > 0 ? '<1m' : '0m';
  const h = Math.floor(minutes / 60),
    m = minutes % 60;
  return h ? `${h}h${m ? ` ${m}m` : compact ? '' : ' 00m'}` : `${m}m`;
}
export function localDay(value) {
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function midnight(value) {
  const d = new Date(value);
  d.setHours(0, 0, 0, 0);
  return +d;
}
export function dayAfter(value) {
  const d = new Date(midnight(value));
  d.setDate(d.getDate() + 1);
  return +d;
}
export function clip(rows, start, end) {
  return rows
    .filter((r) => r.end > start && r.start < end)
    .map((r) => ({ ...r, start: Math.max(start, r.start), end: Math.min(end, r.end) }));
}
export function sessionsFor(rows, settings) {
  const sessions = [];
  for (const row of [...rows].sort((a, b) => a.start - b.start)) {
    const type = category(row, settings),
      last = sessions.at(-1);
    if (last && last.category === type && row.start === last.end) {
      last.end = row.end;
      if (row.app) last.apps.add(row.app);
    } else
      sessions.push({
        start: row.start,
        end: row.end,
        category: type,
        apps: new Set(row.app ? [row.app] : []),
      });
  }
  return sessions;
}
export function analyze(rows, settings, start, end) {
  const segments = clip(rows, start, end).sort((a, b) => a.start - b.start);
  const totals = { work: 0, personal: 0, neutral: 0, afk: 0, locked: 0, offline: 0 };
  const apps = new Map(),
    sites = new Map(),
    days = new Map();
  for (let t = midnight(start); t < end; t = dayAfter(t))
    days.set(localDay(t), {
      date: t,
      work: 0,
      personal: 0,
      neutral: 0,
      afk: 0,
      locked: 0,
      offline: 0,
      hours: Array.from({ length: 24 }, () => ({
        work: 0,
        personal: 0,
        neutral: 0,
        afk: 0,
        locked: 0,
        offline: 0,
      })),
    });
  for (const row of segments) {
    const type = category(row, settings),
      ms = row.end - row.start;
    totals[type] += ms;
    if (row.kind === 'active') {
      const value = apps.get(row.app) || {
        app: row.app,
        name: appName(row.app, settings),
        ms: 0,
        work: 0,
        personal: 0,
        neutral: 0,
        game: row.game,
      };
      value.ms += ms;
      value[type] += ms;
      apps.set(row.app, value);
      if (row.domain) {
        const key = `${row.app}/${row.domain}`,
          site = sites.get(key) || { domain: row.domain, app: row.app, ms: 0, category: type };
        site.ms += ms;
        sites.set(key, site);
      }
    }
    // Absolute-hour stepping preserves both repeated DST hours without inventing a 24h day.
    for (let t = row.start; t < row.end; ) {
      const d = new Date(t);
      const nextHour = t + 3600000 - ((d.getMinutes() * 60 + d.getSeconds()) * 1000 + d.getMilliseconds());
      const next = Math.min(row.end, nextHour, dayAfter(t));
      if (next <= t) break;
      const day = days.get(localDay(t));
      if (day) {
        day[type] += next - t;
        day.hours[d.getHours()][type] += next - t;
      }
      t = next;
    }
  }
  const sessions = sessionsFor(segments, settings);
  const work = sessions.filter((s) => s.category === 'work'),
    personal = sessions.filter((s) => s.category === 'personal');
  const interruptions = sessions.filter(
    (s, i) =>
      s.category === 'personal' &&
      i > 0 &&
      sessions[i - 1].category === 'work' &&
      s.start === sessions[i - 1].end,
  );
  const returned = interruptions.filter((s) => {
    const i = sessions.indexOf(s);
    return sessions[i + 1]?.category === 'work' && sessions[i + 1].start === s.end;
  });
  const activeDays = [...days.values()].filter((d) => d.work + d.personal + d.neutral > 0).length;
  return {
    segments,
    totals,
    apps: [...apps.values()].sort((a, b) => b.ms - a.ms),
    sites: [...sites.values()].sort((a, b) => b.ms - a.ms),
    days: [...days.values()],
    sessions,
    workSessions: work.length,
    personalSessions: personal.length,
    activeDays,
    workPerDay: totals.work / (activeDays || 1),
    workSessionsPerDay: work.length / (activeDays || 1),
    personalSessionsPerDay: personal.length / (activeDays || 1),
    averageWork: totals.work / (work.length || 1),
    averagePersonal: totals.personal / (personal.length || 1),
    longestWork: Math.max(0, ...work.map((s) => s.end - s.start)),
    interruptions: interruptions.length,
    averageReturn: returned.length
      ? returned.reduce((a, s) => a + s.end - s.start, 0) / returned.length
      : null,
    active: totals.work + totals.personal + totals.neutral,
  };
}
export function csv(rows, settings) {
  const q = (value) =>
    '"' +
    String(value)
      .replaceAll('"', '""')
      .replace(/^[=+@-]/, "'$&") +
    '"';
  return (
    'start,end,seconds,app,domain,category,media,title\r\n' +
    rows
      .map((r) =>
        [
          new Date(r.start).toISOString(),
          new Date(r.end).toISOString(),
          (r.end - r.start) / 1000,
          r.app,
          r.domain || '',
          category(r, settings),
          r.media,
          r.title || '',
        ]
          .map(q)
          .join(','),
      )
      .join('\r\n')
  );
}
