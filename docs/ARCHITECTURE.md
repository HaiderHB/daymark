# Architecture

Daymark is a .NET 10 Windows Forms tray application with a browser dashboard served from embedded static assets. It does not embed Chromium or run Node in production.

## Data flow

1. `WindowsProbe` reads `GetForegroundWindow`, the process name, and `GetLastInputInfo` every five seconds. Executable paths are checked transiently for common game-library folders and are not stored. Windows media sessions are matched to the foreground app.
2. The optional extension reports only an allowlisted domain for an active tab in a focused browser window. Fresh browser observations expire after 16 seconds. Browser scope and domain are validated again on the desktop.
3. `Collector` turns consecutive observations into non-overlapping intervals. Lock overrides media. Long gaps become offline. Once the idle grace period expires, contiguous non-media activity is reclassified back to last input; it never crosses a pause, lock, media interval or unrecorded gap.
4. `Database` merges adjacent equivalent intervals in SQLite using transactions, WAL mode and normal synchronization. The SQLite connection is serialized under a lock. Timestamp values are UTC Unix milliseconds.
5. The dashboard requests a bounded date range and computes category-based reports. Rules are applied at read time, so reclassification updates past data. Local calendar days and DST transitions are respected. Apps and sites are views of the same intervals.

## Security boundaries

- Loopback-only listener, exact host validation, no open CORS policy.
- A random 256-bit UI key and a separate 256-bit restricted browser key, constant-time comparison.
- Mutations require authenticated POST requests. Request bodies are capped at 128 KiB.
- No tracking database or configuration is exposed as static content. Static asset paths are an exact allowlist, embedded into the executable.
- The dashboard escapes user-controlled labels and uses a restrictive content security policy. No external scripts, fonts, analytics or images.
- Browser host grants are optional and requested only from the explicit allowlist. The extension never requests browsing-history access.
- An extension with a stolen pairing key could inject activity; another local process running as the user can read the key file. This is a personal local tracker, not a tamper-proof audit system.

## Resource choices

- One sample every five seconds; no busy loop or global input-content hooks.
- Process metadata cached for up to 30 seconds while the foreground PID is unchanged.
- Adjacent samples coalesce into an interval instead of creating one row per sample.
- A single local database and HTTP listener within the tray process.
- Dashboard JavaScript has no production dependencies. Its refresh pauses when the tab is hidden and while preferences are edited.
- Errors are bounded to approximately 512 KiB; tracking history is intentionally retained until deleted.

## Tests

The .NET tests exercise persistence, coalescing, AFK backdating/splitting, media protection, lock precedence, sleep gaps, pause boundaries, settings validation and domain boundaries. Node tests cover category precedence, no double counting, sessions and returns, date clipping, recorded-day averages, DST, website permissions and CSV formula escaping. The Playwright smoke test exercises the real local server, API authorization, browser-key restrictions, origin rejection, dashboard views, persisted settings, custom rules, downloads and a narrow viewport.

## Deliberate omissions

No URL paths, page content, input content, screenshot capture, cloud sync, automatic updater, content filtering, or productivity scoring. Foreground titles are captured only for enabled Vivaldi/Cursor rules. Schema version 2 adds the nullable title field and a separate AI event table; old activity rows remain valid.

## AI signals

The executable also supports a short-lived `--hook claude-code|codex` mode. It parses lifecycle JSON from stdin, drops content fields and full paths, hashes the session identifier, and posts a minimal state signal using a separate restricted key. It never changes the agent's decision flow. Web indicators use a separate experimental signal source and optional host grants. The database coalesces identical state heartbeats while retaining first/last observation times. Client aggregation unions overlapping AI intervals before intersecting them with human work time. Hook silence expires after 30 minutes; web silence after 90 seconds. Unknown is distinct from idle. Pauses, suspend and graceful exit invalidate live AI state.
