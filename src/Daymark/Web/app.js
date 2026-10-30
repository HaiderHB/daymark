import {
  COLORS,
  LABELS,
  category,
  appName,
  duration,
  localDay,
  midnight,
  dayAfter,
  analyze,
  csv,
} from './analytics.mjs';
import { demoRows } from './demo.mjs';
import { aiReport, demoAi, contexts, PROVIDERS } from './ai.mjs';

const $ = (s) => document.querySelector(s),
  $$ = (s) => [...document.querySelectorAll(s)];
const esc = (v) =>
  String(v ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const fragment = new URLSearchParams(location.hash.slice(1));
if (fragment.has('token')) {
  sessionStorage.setItem('daymark-token', fragment.get('token'));
  history.replaceState(null, '', location.pathname);
}
let token = sessionStorage.getItem('daymark-token') || '',
  page = 'overview',
  range = 1,
  endDate = localDay(Date.now()),
  demo = false,
  settings,
  status = {},
  startup = false,
  browserToken = '',
  rows = [],
  aiEvents = [],
  report,
  search = '',
  busy = false,
  dirty = false;
const names = {
  overview: 'Overview',
  timeline: 'Timeline',
  apps: 'Apps & websites',
  patterns: 'Patterns',
  ai: 'AI activity',
  settings: 'Settings',
};
const headings = {
  overview: [
    'A CLEARER PICTURE OF YOUR DAY',
    'Your time, in perspective',
    'See where your focus goes. Make space for what matters.',
  ],
  timeline: [
    'ONE MOMENT AT A TIME',
    'The shape of your day',
    'Follow your focus, your breaks, and the spaces in between.',
  ],
  apps: [
    'THE PLACES YOUR TIME GOES',
    'Every app has a place',
    'Decide what counts as work. Your history follows your rules.',
  ],
  patterns: [
    'A LITTLE SELF-KNOWLEDGE',
    'Find your natural rhythm',
    'Notice when work flows, and when your attention wanders.',
  ],
  settings: ['MADE TO FIT YOUR DAY', 'Keep it personal', 'Your rules, your privacy, your pace.'],
  ai: [
    'YOUR BACKGROUND TEAM',
    'Keep your agents in motion',
    'See when an AI task is running, waiting, or no longer sending a signal.',
  ],
};
function bounds() {
  const end = dayAfter(new Date(endDate + 'T12:00:00'));
  const start = new Date(end);
  start.setDate(start.getDate() - range);
  return [+start, end];
}
function shortDate(t) {
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function time(t) {
  return new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
function dot(k) {
  return `<i class="dot" style="background:${COLORS[k]}"></i>`;
}
function label(k) {
  return `<span class="category">${dot(k)}${LABELS[k]}</span>`;
}
function toast(text) {
  $('#toast').textContent = text;
  $('#toast').hidden = false;
  setTimeout(() => ($('#toast').hidden = true), 3500);
}
async function api(path, body) {
  const res = await fetch('/api/' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw Error(data.error || 'Unable to connect to Daymark.');
  return data;
}
function error(err) {
  $('#error').textContent = err.message;
  $('#error').hidden = false;
}
async function refresh(force = false) {
  if (busy) return;
  busy = true;
  try {
    const [start, end] = bounds();
    if (!settings) {
      const result = await api('settings');
      settings = result.settings;
      startup = result.startup;
      browserToken = result.browserToken;
    }
    status = await api('status');
    rows = demo ? demoRows() : await api(`segments?start=${start}&end=${end}`);
    aiEvents = demo ? demoAi(rows) : await api(`ai-events?start=${start}&end=${end}`);
    report = analyze(rows, settings, start, end);
    $('#error').hidden = true;
    updateChrome();
    if ((page !== 'settings' || force) && !(page === 'apps' && document.activeElement?.id === 'app-search'))
      render();
  } catch (e) {
    error(e);
    $('#tracker-label').textContent = 'Disconnected';
    if (!settings)
      $('#content').innerHTML =
        '<div class="empty"><div class="empty-symbol">◫</div><strong>Open Daymark from your tray</strong>Your dashboard needs its private access key.<br>Double-click the green Daymark icon beside the Windows clock.</div>';
  } finally {
    busy = false;
  }
}
function updateChrome() {
  const [start, end] = bounds();
  $('#range-label').textContent =
    range === 1
      ? new Date(start).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
      : `${shortDate(start)} – ${shortDate(end - 1)}`;
  $('#date').value = endDate;
  $('#date').max = localDay(Date.now());
  $('#next').disabled = endDate >= localDay(Date.now());
  $('#tracker-label').textContent = status.paused
    ? 'Tracking paused'
    : status.kind === 'afk'
      ? 'Away from keyboard'
      : status.kind === 'locked'
        ? 'Computer locked'
        : 'Tracking your day';
  $('#pause').textContent = status.paused ? '▶' : 'Ⅱ';
  $('#pause').title = status.paused ? 'Resume tracking' : 'Pause tracking';
  $('#pause').setAttribute('aria-label', $('#pause').title);
  $('.live-dot').style.background = status.paused ? '#dbad77' : '#a9d987';
  $('#demo-banner').hidden = !demo;
  $('#demo').textContent = demo ? 'Sample data on' : 'Try sample data';
  $$('[data-range]').forEach((b) => b.classList.toggle('selected', +b.dataset.range === range));
  $('#updated').textContent = demo ? 'Sample data · never saved' : 'Updates every 15s';
}
function render() {
  if (!report) return;
  const h = headings[page];
  $('#page-label').textContent = names[page];
  $('#eyebrow').textContent = h[0];
  $('#title').innerHTML = esc(h[1]) + '<span>.</span>';
  $('#subtitle').textContent = h[2];
  $('#range-toolbar').hidden = page === 'settings';
  $('#export').hidden = page === 'settings';
  $$('[data-page]').forEach((b) => {
    b.classList.toggle('active', b.dataset.page === page);
    b.setAttribute('aria-current', b.dataset.page === page ? 'page' : 'false');
  });
  $('#content').innerHTML = { overview, apps, timeline, patterns, ai: aiView, settings: settingsView }[
    page
  ]();
  if (page === 'apps') $('#content').insertAdjacentHTML('beforeend', contextView());
  if (page === 'settings') $('#content').insertAdjacentHTML('afterbegin', capturePreferences());
  bindContent();
}
function metric(title, value, foot, icon, primary = false) {
  return `<article class="metric${primary ? ' primary' : ''}"><div class="metric-label">${title}<span class="metric-icon">${icon}</span></div><div class="metric-value">${value}</div><div class="metric-foot">${foot}</div></article>`;
}
function contextView() {
  const list = contexts(report.segments);
  return `<article class="panel section-spacer"><div class="panel-head"><div><h2>Inside your work</h2><p class="panel-sub">Vivaldi tab titles and Cursor projects inferred from the window title. This is part of app time, not additional time.</p></div></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Tab / project</th><th>App</th><th>Time</th></tr></thead><tbody>${
    list
      .slice(0, 100)
      .map(
        (c) =>
          `<tr><td style="max-width:500px;overflow-wrap:anywhere">${esc(c.name)}</td><td>${esc(appName(c.app, settings))}</td><td>${duration(c.ms)}</td></tr>`,
      )
      .join('') ||
    '<tr class="table-empty"><td colspan="3">Titles appear after using Vivaldi or Cursor with title tracking enabled.</td></tr>'
  }</tbody></table></div><p class="tiny">Showing up to 100 contexts. Cursor project names depend on its title format. Full captured titles are included in CSV exports.</p></article>`;
}
function capturePreferences() {
  return `<article class="panel section-spacer" style="margin-bottom:20px"><div class="panel-head"><div><h2>Work context & AI signals</h2><p class="panel-sub">These preferences apply when you save below. Title capture is separate from the website-domain allowlist.</p></div></div><label class="setting"><div><strong>Vivaldi tab titles</strong><p>Save the foreground tab's visible window title, including sites outside the domain allowlist. No URL is read. Titles may contain document or conversation names.</p></div><input type="checkbox" id="title-vivaldi" ${settings.captureTitleApps.includes('vivaldi') ? 'checked' : ''}></label><label class="setting"><div><strong>Cursor project titles</strong><p>Save the foreground window title and group by the project name when its title format allows it.</p></div><input type="checkbox" id="title-cursor" ${settings.captureTitleApps.includes('cursor') ? 'checked' : ''}></label><label class="setting"><div><strong>AI task activity</strong><p>Accept local Claude Code and Codex lifecycle signals. AI time is separate from your foreground work time.</p></div><input type="checkbox" id="ai-enabled" ${settings.aiTrackingEnabled ? 'checked' : ''}></label><label class="setting"><div><strong>Browser AI indicators (experimental)</strong><p>Allow the extension to inspect generation controls on chatgpt.com and claude.ai, including background tabs. Requires those host grants; no prompt or answer text is collected.</p></div><input type="checkbox" id="ai-web" ${settings.aiWebEnabled ? 'checked' : ''}></label></article>`;
}
function aiView() {
  const [start, end] = bounds(),
    a = aiReport(
      aiEvents,
      report.segments.filter((r) => category(r, settings) === 'work'),
      start,
      end,
    ),
    coverage = report.totals.work ? Math.round((a.overlap / report.totals.work) * 100) : 0,
    states = {
      running: 'In progress',
      waiting: 'Waiting for you',
      idle: 'Stopped / idle',
      unknown: 'Unknown / stale',
    };
  return `<div class="cards">${metric('At least one AI in progress', duration(a.total), 'Overlapping agents count once', '✧', true)}${metric('AI coverage while you work', coverage + '%', `${duration(a.overlap)} of your work time`, '↗')}${metric('Work without a running signal', duration(Math.max(0, report.totals.work - a.overlap)), 'Includes unknown / unconnected time', '◷')}${metric('Agents with running signals', a.latest.filter((e) => e.state === 'running').length, 'Latest signals in this period', '⌁')}</div><article class="panel"><div class="panel-head"><div><h2>Your background team</h2><p class="panel-sub">Lifecycle hooks are the stronger signal. Browser controls are an estimate. Unknown never means confirmed idle.</p></div></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Agent</th><th>Project</th><th>Latest state</th><th>Signal</th></tr></thead><tbody>${
    a.latest
      .slice(0, 50)
      .map(
        (e) =>
          `<tr><td>${PROVIDERS[e.provider] || esc(e.provider)}</td><td>${esc(e.project || '—')}</td><td><span class="category"><i class="dot" style="background:${e.state === 'running' ? COLORS.work : e.state === 'waiting' ? COLORS.personal : COLORS.neutral}"></i>${states[e.state]}</span></td><td>${e.evidence === 'hook' ? 'Lifecycle hook' : 'Web UI estimate'}</td></tr>`,
      )
      .join('') ||
    '<tr class="table-empty"><td colspan="4">No AI signals yet. Connect the coding hooks or grant AI website access in the extension.</td></tr>'
  }</tbody></table></div></article><div class="grid-main section-spacer"><article class="panel"><div class="panel-head"><h2>Connect Claude Code & Codex</h2></div><p class="summary-line">Run <b>install-ai-hooks.ps1</b> from your installed Daymark folder. It preserves existing hooks and adds a small local event reporter. Restart your coding sessions afterward.</p><p class="tiny">In Codex, review and trust the Daymark hooks in the hooks UI before they run. The installer does not bypass hook trust. Claude Code can also require trusting new hooks. Prompt text, responses and tool arguments are discarded; only lifecycle state, a hashed session ID and the project folder name are retained.</p></article><article class="panel"><div class="panel-head"><h2>What the signal can tell you</h2></div><p class="summary-line">Coding hooks track a task from prompt submission to stop, with waiting states around permission/input requests. They measure task lifecycle, not exact model compute time. A silent hook session expires to <b>Unknown after 30 minutes</b>; browser signals expire after <b>90 seconds</b>.</p><p class="tiny">ChatGPT and Claude web use best-effort generation-button detection, which can break after a UI change. Background tab throttling can leave a gap. Ordinary Claude/ChatGPT desktop chat apps have no dependable integration here; their app usage is tracked, their prompt-running state is not.</p></article></div><article class="panel"><div class="panel-head"><h2>Recent AI activity</h2><span class="badge">Separate from your work clock</span></div><div class="session-list">${
    a.spans
      .filter((s) => s.state !== 'unknown')
      .slice(-40)
      .reverse()
      .map(
        (s) =>
          `<div class="session-row"><time>${shortDate(s.start)} ${time(s.start)}</time><span class="category">${states[s.state]}</span><span class="session-apps">${PROVIDERS[s.provider]} · ${esc(s.project || 'browser')}</span><span class="row-value">${duration(s.end - s.start)}</span></div>`,
      )
      .join('') || '<div class="empty">AI lifecycle intervals will appear here once connected.</div>'
  }</div></article>`;
}
function metrics() {
  const r = report,
    pct = r.active ? Math.round((100 * r.totals.work) / r.active) : 0;
  return `<div class="cards">${metric('Time working', duration(r.totals.work), `<strong>${pct}%</strong> of your active time`, '↗', true)}${metric('Personal time', duration(r.totals.personal), `${r.interruptions} ${r.interruptions === 1 ? 'switch' : 'switches'} from work`, '◷')}${metric('Away from keyboard', duration(r.totals.afk + r.totals.locked), 'Includes idle and locked time', '☷')}${metric('Average work session', duration(r.averageWork), `${r.workSessions} work ${r.workSessions === 1 ? 'session' : 'sessions'} this period`, '⌁')}</div>`;
}
function legend() {
  return `<div class="legend">${['work', 'personal', 'neutral', 'afk'].map((k) => `<span>${dot(k)}${LABELS[k]}</span>`).join('')}</div>`;
}
function emptyHistory() {
  return !report.active && !demo
    ? '<div class="no-history"><div><strong>Your day is just getting started.</strong><p>Use your PC normally. Your first activity appears within a few seconds.</p></div><button class="button secondary" data-demo>Explore sample data →</button></div>'
    : '';
}
function chart() {
  const r = report;
  const items = range === 1 ? r.days[0]?.hours || [] : r.days;
  const max = Math.max(3600000, ...items.map((d) => d.work + d.personal + d.neutral + d.afk + d.locked));
  const scale = range === 1 ? 3600000 : Math.ceil(max / 3600000) * 3600000;
  return `<div class="chart ${range === 1 ? 'hourly' : ''}" role="img" aria-label="Stacked ${range === 1 ? 'hourly' : 'daily'} activity chart"><div class="chart-grid">${[0, 1, 2, 3].map(() => '<div class="gridline"></div>').join('')}</div><div class="axis"><span>${duration(scale, true)}</span><span>${duration((scale * 2) / 3, true)}</span><span>${duration(scale / 3, true)}</span><span>0</span></div><div class="bars">${items
    .map((d, i) => {
      const total = d.work + d.personal + d.neutral + d.afk + d.locked;
      const caption =
        range === 1
          ? i % 4 === 0
            ? `${String(i).padStart(2, '0')}`
            : ''
          : range === 30
            ? i % 5 === 0
              ? new Date(d.date).getDate()
              : ''
            : new Date(d.date).toLocaleDateString(undefined, { weekday: 'short' });
      return `<div class="bar-column" title="${range === 1 ? `${i}:00` : shortDate(d.date)} · Work ${duration(d.work)} · Personal ${duration(d.personal)} · Away ${duration(d.afk + d.locked)}"><div class="bar-stack" style="height:${Math.max(0, (total / scale) * calcChartHeight())}px">${['work', 'personal', 'neutral', 'afk', 'locked'].map((k) => `<i style="height:${total ? (d[k] / total) * 100 : 0}%;background:${COLORS[k]}"></i>`).join('')}</div><span class="bar-label">${caption}</span></div>`;
    })
    .join('')}</div></div>`;
}
function calcChartHeight() {
  return innerWidth >= 1550 ? 185 : 145;
}
function donut() {
  const r = report,
    t = r.totals,
    total = r.active + t.afk + t.locked;
  let pos = 0;
  const stops = ['work', 'personal', 'neutral', 'afk'].map((k) => {
    const val = k === 'afk' ? t.afk + t.locked : t[k],
      from = pos;
    pos += total ? (val / total) * 100 : 0;
    return `${COLORS[k]} ${from}% ${pos}%`;
  });
  return `<div class="donut-layout"><div class="donut" style="background:${total ? `conic-gradient(${stops.join(',')})` : '#f0f3eb'}" role="img" aria-label="${duration(t.work)} work, ${duration(t.personal)} personal, ${duration(t.afk + t.locked)} away"><div class="donut-center"><strong>${r.active ? Math.round((t.work / r.active) * 100) : 0}%</strong><small>active time working</small></div></div><div class="breakdown">${['work', 'personal', 'neutral', 'afk'].map((k) => `<div>${dot(k)}<span>${LABELS[k]}<strong>${duration(k === 'afk' ? t.afk + t.locked : t[k])}</strong></span></div>`).join('')}</div></div><div class="panel-note">${duration(total)} observed · ${duration(t.offline)} offline<br>Work share excludes away and offline time.</div>`;
}
function appRows(limit = 5) {
  const list = report.apps.slice(0, limit);
  return list.length
    ? list
        .map(
          (a) =>
            `<div class="app-row"><span class="app-icon">${esc(a.name.slice(0, 2))}</span><div class="app-details"><strong>${esc(a.name)}</strong><div class="app-bar"><i style="width:${(a.ms / (report.apps[0]?.ms || 1)) * 100}%"></i></div></div><div class="row-value">${duration(a.ms)}<small>${Math.round((a.ms / (report.active || 1)) * 100)}%</small></div></div>`,
        )
        .join('')
    : '<div class="empty">Your most-used apps will appear here.</div>';
}
function insight() {
  const r = report;
  if (!r.active) return 'A little observation goes a long way. Give your day time to take shape.';
  if (r.longestWork >= 30 * 60000)
    return `Your longest work stretch was <b>${duration(r.longestWork)}</b>. That's time you made for what matters.`;
  if (r.totals.neutral > r.active / 3)
    return 'Some apps are still unsorted. Give them a category to make your picture more complete.';
  return `You've made room for <b>${duration(r.totals.work)}</b> of work. Small sessions add up, too.`;
}
function sessionStats() {
  const r = report;
  return `<div class="session-stats"><div><span class="stat-label">Longest work session</span><strong class="stat-value">${duration(r.longestWork)}</strong><span class="stat-detail">One continuous stretch</span></div><div><span class="stat-label">Average personal session</span><strong class="stat-value">${duration(r.averagePersonal)}</strong><span class="stat-detail">${r.personalSessions} personal sessions</span></div><div><span class="stat-label">Work sessions / day</span><strong class="stat-value">${r.workSessionsPerDay.toFixed(1)}</strong><span class="stat-detail">Across ${r.activeDays} recorded days</span></div><div><span class="stat-label">Average return to work</span><strong class="stat-value">${r.averageReturn === null ? '—' : duration(r.averageReturn)}</strong><span class="stat-detail">Completed personal detours</span></div></div>`;
}
function overview() {
  return `${emptyHistory()}${metrics()}<div class="grid-main"><article class="panel"><div class="panel-head"><div><h2>Your daily rhythm</h2><p class="panel-sub">${range === 1 ? 'An hour-by-hour look at today.' : 'How your time adds up, day by day.'}</p></div><span class="badge">${range === 1 ? 'By hour' : 'By day'}</span></div>${chart()}${legend()}</article><article class="panel"><div class="panel-head"><div><h2>A little balance</h2><p class="panel-sub">Work, life, and the space between.</p></div></div>${donut()}</article></div><div class="grid-main"><article class="panel"><div class="panel-head"><div><h2>Where your time went</h2><p class="panel-sub">The apps that shaped your day.</p></div><button class="text-link" data-go="apps">View all ↗</button></div>${appRows()}</article><article class="panel"><div class="panel-head"><div><h2>Finding your flow</h2><p class="panel-sub">A closer look at your sessions.</p></div><span class="badge">⌁</span></div>${sessionStats()}<div class="insight"><span>✧</span><div>${insight()}</div></div></article></div>${heatmap()}`;
}
function heatmap() {
  const days = report.days.slice(-14);
  return `<article class="panel heatmap-panel"><div class="panel-head"><div><h2>Your focus, across the clock</h2><p class="panel-sub">Darker green means more work in that hour. Hover for the full picture.</p></div><span class="badge">Local time</span></div><div class="heatmap"><span></span>${Array.from({ length: 24 }, (_, i) => `<span class="heat-hour">${i % 3 === 0 ? String(i).padStart(2, '0') : ''}</span>`).join('')}${days.map((d) => `<span class="heat-label">${new Date(d.date).toLocaleDateString(undefined, { weekday: 'short' })}</span>${d.hours.map((h, i) => `<div class="heat-cell" style="background:${h.work ? `rgba(39,115,86,${Math.min(1, 0.15 + (h.work / 3600000) * 0.85)})` : h.personal ? '#f0dbcb' : h.afk + h.locked ? '#e1e4da' : '#f1f4ec'}" title="${shortDate(d.date)} ${i}:00 · Work ${duration(h.work)} · Personal ${duration(h.personal)} · Away ${duration(h.afk + h.locked)}"></div>`).join('')}`).join('')}</div><div class="legend"><span>${dot('work')}Work</span><span>${dot('personal')}Personal only</span><span>${dot('afk')}Away only</span><span>Blank = no activity · ${range > 14 ? 'Showing the last 14 days' : 'All hours in your timezone'}</span></div></article>`;
}
function timeline() {
  const groups = report.days
    .filter((d) => report.segments.some((s) => s.end > d.date && s.start < dayAfter(d.date)))
    .reverse();
  return `${metrics()}${
    groups.length
      ? groups
          .map((d) => {
            const start = d.date,
              end = dayAfter(start),
              sessions = analyze(report.segments, settings, start, end).sessions;
            let cursor = start;
            const spans = [];
            for (const s of sessions) {
              if (s.start > cursor)
                spans.push(
                  `<span style="width:${((s.start - cursor) / (end - start)) * 100}%;background:#f3f5ee" title="No record"></span>`,
                );
              spans.push(
                `<span style="width:${((s.end - s.start) / (end - start)) * 100}%;background:${COLORS[s.category]}" title="${time(s.start)}–${time(s.end)} · ${LABELS[s.category]} ${duration(s.end - s.start)}"></span>`,
              );
              cursor = s.end;
            }
            return `<article class="panel section-spacer"><div class="panel-head"><div><h2>${new Date(start).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</h2><p class="panel-sub">${duration(d.work)} working · ${duration(d.personal)} personal · ${duration(d.afk + d.locked)} away</p></div></div><div class="timeline-strip">${spans.join('')}</div><div class="time-axis"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span></div>${legend()}<div class="session-list">${sessions.map((s) => `<div class="session-row"><time>${time(s.start)} – ${time(s.end)}</time>${label(s.category)}<span class="session-apps">${esc([...s.apps].map((a) => appName(a, settings)).join(', ')) || 'No app activity'}</span><span class="row-value">${duration(s.end - s.start)}</span></div>`).join('')}</div></article>`;
          })
          .join('')
      : '<article class="panel"><div class="empty"><strong>Your timeline is taking shape</strong>Activity will appear as you use your computer.</div></article>'
  }<p class="tiny">Sessions continue across app changes within the same category. Away, offline and pauses break a session. AFK is backdated to last input once the grace period expires.</p>`;
}
function selectCategory(value, attributes = '') {
  return `<select ${attributes} aria-label="Activity category">${['work', 'personal', 'neutral'].map((k) => `<option value="${k}" ${value === k ? 'selected' : ''}>${LABELS[k]}</option>`).join('')}</select>`;
}
function apps() {
  const list = report.apps.filter((a) => (a.name + ' ' + a.app).toLowerCase().includes(search.toLowerCase()));
  return `<article class="panel"><div class="panel-head"><div><h2>Your applications</h2><p class="panel-sub">Category changes also update your historical reports. Website rules take priority.</p></div><input id="app-search" class="search" placeholder="Find an app…" value="${esc(search)}" aria-label="Find an app"></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Application</th><th>Time spent</th><th>Share</th><th>Category</th></tr></thead><tbody>${list.map((a) => `<tr><td><div class="table-name"><span class="app-icon">${esc(a.name.slice(0, 2))}</span><span>${esc(a.name)}<small>${esc(a.app)}.exe${a.game ? ' · game detected' : ''}</small></span></div></td><td>${duration(a.ms)}</td><td>${Math.round((a.ms / (report.active || 1)) * 100)}%</td><td>${selectCategory(settings.apps.find((x) => x.process === a.app)?.category || (a.game ? 'personal' : 'neutral'), `data-app-category="${esc(a.app)}" ${demo ? 'disabled' : ''}`)}</td></tr>`).join('') || '<tr class="table-empty"><td colspan="4">No matching app activity in this period.</td></tr>'}</tbody></table></div></article><article class="panel section-spacer"><div class="panel-head"><div><h2>Your allowed websites</h2><p class="panel-sub">Only approved domains are recorded. Site time is part of browser time, not additional time.</p></div><button class="text-link" data-go="settings">Manage allowlist ↗</button></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Website</th><th>Browser</th><th>Time</th><th>Category</th></tr></thead><tbody>${report.sites.map((s) => `<tr><td>${esc(s.domain)}</td><td>${esc(appName(s.app, settings))}</td><td>${duration(s.ms)}</td><td>${label(s.category)}</td></tr>`).join('') || '<tr class="table-empty"><td colspan="4">Pair the browser extension in Settings to see YouTube and Twitch here.</td></tr>'}</tbody></table></div></article><div class="insight"><span>⌁</span><div>Unknown apps start as <b>Unsorted</b>. Games in Steam, Epic, Riot and Xbox installation folders default to Personal. Your explicit app rules always win.</div></div>`;
}
function patterns() {
  const r = report,
    hours = Array.from({ length: 24 }, (_, i) => ({
      hour: i,
      work: r.days.reduce((n, d) => n + d.hours[i].work, 0),
      personal: r.days.reduce((n, d) => n + d.hours[i].personal, 0),
    }));
  const best = [...hours].sort((a, b) => b.work - a.work)[0],
    distracted = [...hours].sort((a, b) => b.personal - a.personal)[0];
  const hour = (h) => `${String(h).padStart(2, '0')}:00`;
  return `${metrics()}<div class="grid-main"><article class="panel"><div class="panel-head"><h2>Your working window</h2><span class="badge">Observed, not a prediction</span></div><p class="patterns-lead">${best?.work ? `Your busiest work hour starts at <strong>${hour(best.hour)}</strong>.` : 'A rhythm takes a little time to emerge.'}</p><p class="summary-line">${best?.work ? `${duration(best.work)} of work recorded in that hour across this period. Your daily average is <strong>${duration(r.workPerDay)}</strong> over ${r.activeDays} recorded days.` : 'Check back after a few work sessions, or explore the sample data.'}</p><div class="insight"><span>✧</span><div>${distracted?.personal ? `Most personal time falls around <b>${hour(distracted.hour)}</b>. Is that an intentional break, or a place to protect your attention?` : 'Personal app activity will help show where your breaks tend to land.'}</div></div></article><article class="panel"><div class="panel-head"><h2>Work, breaks, and returning</h2></div>${sessionStats()}<p class="tiny">${r.personalSessionsPerDay.toFixed(1)} personal sessions per recorded day. A detour is personal time directly between work sessions; AFK and unsorted apps break that chain.</p></article></div>${heatmap()}<article class="panel"><div class="panel-head"><h2>How to read these numbers</h2></div><p class="summary-line">These are patterns in <strong>foreground app activity</strong>, not a judgment about your productivity. Reading and thinking can look idle. A video can keep playing after you walk away. Use categories and the AFK threshold to fit how you actually work.</p><p class="tiny">Averages use days with recorded active time, so a missing day isn't counted as zero. Sessions at the edges of the selected period are clipped. Five-second sampling can miss very brief switches.</p></article>`;
}
function settingsView() {
  return `<div class="settings-layout"><div class="settings-stack"><article class="panel"><div class="panel-head"><div><h2>The quiet essentials</h2><p class="panel-sub">Set it once. Let your day happen.</p></div></div><label class="setting"><div><strong>Start with Windows</strong><p>Run quietly in the system tray when you sign in.</p></div><input id="startup" type="checkbox" ${startup ? 'checked' : ''}></label><label class="setting"><div><strong>Minutes before you're away</strong><p>After this grace period, idle time is counted back to your last input.</p></div><input id="idle" type="number" min="1" max="30" value="${settings.idleMinutes}" aria-label="Minutes before away"></label><label class="setting"><div><strong>Watching counts as active</strong><p>Foreground media reported by Windows or an allowed browser site keeps the session active. Background music does not.</p></div><input id="media" type="checkbox" ${settings.mediaKeepsActive ? 'checked' : ''}></label><div class="settings-actions"><button id="save-settings" class="button" ${demo ? 'disabled' : ''}>Save preferences</button><span class="tiny">Changes stay on this PC.</span></div></article><article class="panel"><div class="panel-head"><div><h2>Your app rules</h2><p class="panel-sub">Use the process name without .exe. Unlisted apps remain Unsorted.</p></div></div><div class="rules">${settings.apps.map((a, i) => `<div class="app-row"><div class="app-details"><strong>${esc(a.name)}</strong><small>${esc(a.process)}.exe</small></div>${selectCategory(a.category, `data-rule="${i}" ${demo ? 'disabled' : ''}`)}<button class="delete-small" data-remove-app="${i}" aria-label="Remove ${esc(a.name)} rule" ${demo ? 'disabled' : ''}>×</button></div>`).join('')}</div><form id="add-app" class="form-row"><input name="process" placeholder="Process name" required maxlength="100" aria-label="Process name"><input name="name" placeholder="Display name" required maxlength="100" aria-label="Display name">${selectCategory('work', 'name="category"')}<button class="button secondary" ${demo ? 'disabled' : ''}>Add rule</button></form></article><article class="panel"><div class="panel-head"><div><h2>Website allowlist</h2><p class="panel-sub">Domain only. No paths, page titles, searches or browsing history.</p></div></div><div class="rules">${settings.sites.map((s, i) => `<div class="app-row"><div class="app-details"><strong>${esc(s.domain)}</strong><small>${esc(appName(s.browser, settings))}</small></div>${selectCategory(s.category, `data-site-rule="${i}" ${demo ? 'disabled' : ''}`)}<button class="delete-small" data-remove-site="${i}" aria-label="Stop tracking ${esc(s.domain)}" ${demo ? 'disabled' : ''}>×</button></div>`).join('')}</div><form id="add-site" class="form-row"><input name="domain" placeholder="example.com" required aria-label="Allowed domain"><select name="browser" aria-label="Browser"><option value="chrome">Chrome</option><option value="vivaldi">Vivaldi</option><option value="msedge">Edge</option><option value="brave">Brave</option></select>${selectCategory('personal', 'name="category"')}<button class="button secondary" ${demo ? 'disabled' : ''}>Allow site</button></form><p class="tiny">After adding a domain, open the extension and choose “Grant allowed sites”. Removing a site stops future collection; already recorded history stays until you erase it.</p></article></div><div class="settings-stack"><article class="panel"><div class="panel-head"><div><h2>Connect your browser</h2><p class="panel-sub">${status.browserConnected ? 'A browser reported activity recently.' : 'One small extension. Only your chosen sites.'}</p></div><span class="badge">Chrome / Chromium</span></div><ol class="steps"><li>Open <b>chrome://extensions</b> in Chrome (or your browser's extensions page) and enable <b>Developer mode</b>.</li><li>Choose <b>Load unpacked</b> and select the <b>extension</b> folder from your Daymark download.</li><li>Open Daymark's extension options. Select the browser, paste this pairing key, and connect.</li><li>Choose <b>Grant allowed sites</b>, then reload any already-open allowed tabs.</li></ol><input class="pairing-code" id="pairing-key" type="password" value="${demo ? 'Sample mode — switch to your data to pair' : esc(browserToken)}" readonly aria-label="Browser pairing key"><button id="copy-key" class="button secondary" ${demo ? 'disabled' : ''}>Copy pairing key</button><p class="tiny">The key stays on your device. It can send browser activity and read the allowlist, but cannot read your history.</p></article><article class="panel"><div class="panel-head"><h2>Your data is yours</h2></div><p class="summary-line">Everything is stored in <b>%LOCALAPPDATA%\Daymark</b>. No account, analytics, screenshots, keystroke content, AI prompt text, or cloud sync. Enabled Vivaldi/Cursor titles stay local.</p><p class="tiny">Pause anytime from the tray. Closing this dashboard leaves tracking running. Quitting Daymark stops it.</p><button id="clear" class="button danger" ${demo ? 'disabled' : ''}>Erase tracking history</button><p class="tiny">This permanently removes activity, but keeps your preferences.</p></article><article class="panel"><div class="panel-head"><h2>Daymark 0.1.0</h2><span class="badge">Open source</span></div><p class="tiny">A quiet companion for understanding how you spend your time. Windows 10 / 11 · Five-second sampling · SQLite storage.</p></article></div></div>`;
}
async function saveRules() {
  await api('settings', { settings, startup });
  dirty = false;
  await refresh(true);
  toast('Your rules are saved.');
}
function bindContent() {
  $$('[data-go]').forEach((b) => (b.onclick = () => go(b.dataset.go)));
  $$('[data-demo]').forEach((b) => (b.onclick = toggleDemo));
  $$('[data-app-category]').forEach(
    (b) =>
      (b.onchange = async () => {
        try {
          const existing = settings.apps.find((a) => a.process === b.dataset.appCategory);
          if (existing) existing.category = b.value;
          else
            settings.apps.push({
              process: b.dataset.appCategory,
              name: appName(b.dataset.appCategory, settings),
              category: b.value,
            });
          await saveRules();
        } catch (e) {
          error(e);
        }
      }),
  );
  $('#app-search')?.addEventListener('input', (e) => {
    search = e.target.value;
    const pos = e.target.selectionStart;
    render();
    $('#app-search').focus();
    $('#app-search').setSelectionRange(pos, pos);
  });
  if (page !== 'settings') return;
  ['#startup', '#idle', '#media', '#title-vivaldi', '#title-cursor', '#ai-enabled', '#ai-web'].forEach(
    (id) => ($(id).oninput = () => (dirty = true)),
  );
  $('#save-settings').onclick = async () => {
    try {
      settings.idleMinutes = +$('#idle').value;
      settings.mediaKeepsActive = $('#media').checked;
      settings.captureTitleApps = ['vivaldi', 'cursor'].filter((app) => $('#title-' + app).checked);
      settings.aiTrackingEnabled = $('#ai-enabled').checked;
      settings.aiWebEnabled = $('#ai-web').checked;
      startup = $('#startup').checked;
      await saveRules();
    } catch (e) {
      error(e);
    }
  };
  $$('[data-rule]').forEach(
    (b) => (b.onchange = () => mutate(() => (settings.apps[+b.dataset.rule].category = b.value))),
  );
  $$('[data-site-rule]').forEach(
    (b) => (b.onchange = () => mutate(() => (settings.sites[+b.dataset.siteRule].category = b.value))),
  );
  $$('[data-remove-app]').forEach(
    (b) => (b.onclick = () => mutate(() => settings.apps.splice(+b.dataset.removeApp, 1))),
  );
  $$('[data-remove-site]').forEach(
    (b) => (b.onclick = () => mutate(() => settings.sites.splice(+b.dataset.removeSite, 1))),
  );
  $('#add-app').onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(e.target),
      process = f
        .get('process')
        .trim()
        .toLowerCase()
        .replace(/\.exe$/, '');
    if (settings.apps.some((a) => a.process === process)) return toast('That app already has a rule.');
    mutate(() => settings.apps.push({ process, name: f.get('name').trim(), category: f.get('category') }));
  };
  $('#add-site').onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(e.target),
      domain = f.get('domain').trim().toLowerCase(),
      browser = f.get('browser');
    if (settings.sites.some((s) => s.domain === domain && s.browser === browser))
      return toast('That site is already allowed.');
    mutate(() => settings.sites.push({ domain, browser, category: f.get('category') }));
  };
  $('#copy-key').onclick = async () => {
    try {
      await navigator.clipboard.writeText(browserToken);
      toast('Pairing key copied.');
    } catch {
      $('#pairing-key').type = 'text';
      $('#pairing-key').select();
      toast('Select and copy your pairing key.');
    }
  };
  $('#clear').onclick = async () => {
    const confirmation = prompt('Permanently erase all tracking history? Type DELETE to confirm.');
    if (confirmation !== 'DELETE') return;
    try {
      await api('clear', { confirmation });
      await refresh();
      toast('Tracking history erased.');
    } catch (e) {
      error(e);
    }
  };
}
async function mutate(fn) {
  const backup = structuredClone(settings);
  try {
    fn();
    await saveRules();
  } catch (e) {
    settings = backup;
    error(e);
  }
}
function go(next) {
  if (dirty && !confirm('Discard unsaved preferences?')) return;
  dirty = false;
  page = next;
  render();
  window.scrollTo({ top: 0 });
}
async function toggleDemo() {
  if (dirty && !confirm('Discard unsaved preferences?')) return;
  dirty = false;
  demo = !demo;
  await refresh(true);
}
$$('[data-page]').forEach((b) => (b.onclick = () => go(b.dataset.page)));
$$('[data-range]').forEach(
  (b) =>
    (b.onclick = () => {
      range = +b.dataset.range;
      endDate = localDay(Date.now());
      refresh();
    }),
);
$('#previous').onclick = () => shift(-range);
$('#next').onclick = () => shift(range);
function shift(days) {
  const d = new Date(endDate + 'T12:00:00');
  d.setDate(d.getDate() + days);
  endDate = localDay(Math.min(+d, Date.now()));
  refresh();
}
$('#date').onchange = (e) => {
  if (e.target.value) {
    endDate = e.target.value;
    refresh();
  }
};
$('#demo').onclick = toggleDemo;
$('#exit-demo').onclick = toggleDemo;
$('#pause').onclick = async () => {
  try {
    status = await api('pause', { paused: !status.paused });
    updateChrome();
    toast(status.paused ? 'Tracking paused.' : 'Tracking resumed.');
  } catch (e) {
    error(e);
  }
};
$('#export').onclick = () => {
  if (!report) return;
  const blob = new Blob([csv(report.segments, settings)], { type: 'text/csv;charset=utf-8' }),
    url = URL.createObjectURL(blob),
    a = document.createElement('a');
  a.href = url;
  a.download = `daymark-${demo ? 'sample-' : ''}${endDate}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
window.addEventListener('resize', () => {
  if (page === 'overview') render();
});
await refresh();
setInterval(() => {
  if (!document.hidden && !dirty) refresh();
}, 15000);
