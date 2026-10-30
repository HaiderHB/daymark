// Clearly labelled, in-memory sample data. Never written to the tracker database.
export function demoRows(now = Date.now()) {
  const rows = [];
  for (let day = 0; day < 30; day++) {
    const d = new Date(now);
    d.setDate(d.getDate() - day);
    d.setHours(8 + (day % 3), 15, 0, 0);
    let t = +d;
    const schedule = [
      ['cursor', 64],
      ['claude', 31],
      ['chrome', 12, 'youtube.com'],
      ['cursor', 52],
      ['', 22, null, 'afk'],
      ['vivaldi', 38],
      ['linear', 17],
      ['chrome', 8, 'twitch.tv'],
      ['cursor', 83],
      ['', 45, null, 'afk'],
      ['chatgpt', 27],
      ['hermes', 41],
      ['chrome', 23, 'youtube.com'],
      ['capacity', 32],
      ['steam', 18],
      ['cursor', 44],
    ];
    for (const [app, minutes, domain, kind] of schedule) {
      const end = t + (minutes + (day % 5) * 2) * 60000;
      if (t < now)
        rows.push({
          start: t,
          end: Math.min(end, now),
          app,
          kind: kind || 'active',
          domain: domain || null,
          media: domain === 'youtube.com',
          game: false,
          title:
            app === 'cursor'
              ? `app.ts - ${day % 2 ? 'daymark' : 'client-portal'} - Cursor`
              : app === 'vivaldi'
                ? `${day % 2 ? 'Design research' : 'Sprint planning'} - Vivaldi`
                : null,
        });
      t = end;
    }
  }
  return rows.sort((a, b) => a.start - b.start);
}
