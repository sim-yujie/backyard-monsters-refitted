# Admin dashboard API

The owner-only dashboard's server side. The stats, error, bug report and
admin-check sections are written by the dashboard server work (dash-server);
the Health section below is separate and was written with the Telegram alerts
(docs/alerts.md).

## Owner-only check

- **Who:** `ADMIN_USER_IDS` on the server, a comma list of account numbers
  (`user.userid`). Unset or empty means nobody (`server/src/config/AdminConfig.ts`,
  `isAdminUser`).
- **How:** every route below is mounted by `mountAdminRoutes(router)` in
  `server/src/controllers/admin/routes.ts`, behind its `adminOnly` middleware
  (`makeAdminGuard` in `server/src/services/admin/adminGuard.ts`): the normal
  game sign-in (`Authorization: Bearer <game token>`), then the account number
  must be in `ADMIN_USER_IDS`.
- **Anyone else**, signed in or not, gets a plain `404` with the body
  `Not Found`, the same as an unknown address. A refused signed-in player is
  logged as a warning.
- Answers are JSON `{ error: 0, ...fields }` with `Cache-Control: no-store`.
  A refusal is `{ error: "<words>", reason: "<code>" }` with a 4xx status.
- `:apiVersion` is the game's API version, as for every other route.

## The web page

`web/admin.html` (`web/src/admin/`), its own Vite page, so on Vercel
(`cleanUrls`) it lives at `/admin` on the game's web address. It uses the game's
sign-in from the same browser (the session in `localStorage`); with none, or
for anyone but the owner, it shows only "Not found". It should call `GET .../admin/me`
first and show nothing (or the game's normal 404) unless that answers 200. It
should honour `?bug=<id>` (open that bug report) and `#health`, `#backups`,
`#errors`, `#bugs`, `#shiny` (scroll to that part), which the alerts link to. Pictures
(screenshots) must be fetched with the Bearer header and shown through a blob
URL (`URL.createObjectURL`), since an `<img src>` cannot send the header.

## Routes

| Route | Answer |
|---|---|
| `GET /api/:apiVersion/admin/me` | `{ admin: true, userid, username }` |
| `GET /api/:apiVersion/admin/stats/overview?days=30` | `StatsOverview` (days 1 to 400) |
| `GET /api/:apiVersion/admin/stats/daily?from=YYYY-MM-DD&to=YYYY-MM-DD` | `{ from, to, days: DailyStat[] }`; default the last 30 finished days; at most 400 days, else `400 badRange` |
| `GET /api/:apiVersion/admin/bugreports?filter=&before=&limit=` | `{ reports: BugReportSummary[], nextBefore: number \| null }`, newest first |
| `GET /api/:apiVersion/admin/bugreports/:id` | `{ report: BugReportDetail }`, or `404 notFound` |
| `GET /api/:apiVersion/admin/bugreports/:id/screenshot` | the picture's bytes with its type (JPEG/PNG/WebP), or `404` |
| `GET /api/:apiVersion/admin/bugreports/:id/picture` | the player's added picture, the same way |
| `POST /api/:apiVersion/admin/bugreports/:id/ticket` | body `{ status?, notes? }`; answers `{ report: BugReportDetail }` as it is afterwards; `400 badTicket`, `404 notFound` |
| `POST /api/:apiVersion/admin/bugreports/:id/reply` | body `{ message }`; writes to the report's player in the game's mail; answers `{ report: BugReportDetail }`; `400 badReply`, `404 notFound`, `409 signedOut` / `noPlayer` |
| `GET /api/:apiVersion/admin/players?q=` | `{ players: PlayerMatch[] }`: at most 10 whose name holds `q` (any case; `_`, space, `-` and `.` alike; `%` and `_` only themselves), whose account number it is, or who had that name before (on a bug report or award); exact matches first; bots shown but marked and after the players (`searchPlayers` in `services/admin/shinyAwards.ts`) |
| `GET /api/:apiVersion/admin/shiny?before=&limit=` | `{ awards: ShinyAwardView[], nextBefore: number \| null, total: { awards, shiny } }`, newest first; `limit` 1 to 100 (default 50) |
| `POST /api/:apiVersion/admin/shiny` | body `{ userid, amount, reason, bugReportId?, requestId }`; answers `{ award: ShinyAwardView, already: boolean, report?: BugReportDetail }`; `400 badAward`, `409 noPlayer` / `noMainYard` / `notTheirReport` |
| `GET /api/:apiVersion/admin/errors?source=&sort=&limit=&sinceDays=` | `{ groups: ErrorGroup[], totals }` |
| `GET /api/:apiVersion/admin/health` | `AdminHealthReport` (see "Health" below) |

Bug report list: `filter` is `all` (default), `open` (new or working),
`closed` (fixed or won't fix), or one status; `limit` 1 to 100 (default 50);
`before` is the `nextBefore` of the page before.

Errors: `source` is `browser` or `server` (default both); `sort` is `last`
(newest first, default) or `count` (most frequent first); `limit` 1 to 200
(default 100); `sinceDays` keeps only kinds seen in that many days.
`totals` is `{ browser: { kinds, occurrences }, server: { kinds, occurrences } }`.

## Bug report tickets

Each report has a status and the owner's notes, kept on the server only
(`bym.bug_report.status`, `owner_notes`). Nothing goes to any outside service.

- `status`: `new` (every report starts here), `working` (working on it),
  `fixed`, `wontfix` (won't fix). Any status may follow any other.
- `notes`: free text, the whole notes each time (not an addition), at most
  4000 characters (longer is cut). `""` clears them.
- Only what really changes is written. Each change is kept with its time and
  the owner's account number in `bym.bug_report_change`, and shown in the
  report's `changes`. The changes go with their report (180-day clean-up,
  account deletion).

## Replies and Shiny

The owner can write to a bug report's player, and give Shiny to any player.
Both arrive in the game's Mail from **"The game team"** (sender account
number `-1`, `SUPPORT_SENDER` in `server/src/services/mail/systemSender.ts`);
the player never sees who on the team wrote it.

- **Replies.** The first reply starts the report's mail thread
  (`bym.bug_report.mail_thread_id`, subject "About your bug report"); later
  ones join it. The player can answer it from the game's Mail: only a thread
  linked to their own report (`mayAnswerTeam`), never a new thread to `-1`,
  and no truce or Block on it. Their answers show in the report's `thread`
  and count in the list's `unreadReplies` until the owner opens the report.
  An answer does not change the ticket's status. A message is 1 to 580
  characters (the game's mail limit). A report sent signed out, or whose
  account is gone, cannot be answered in the game (`cannotReply`); the page
  shows the report's email, if any, instead.
- **Shiny.** A whole number from 1 to 10,000 per gift, with a reason of 1 to
  200 characters that the player sees. The page asks "are you sure?" above
  500 (the server does not). Given from a report (`bugReportId`), it must be
  that report's player, and the mail goes into the report's thread, so they
  can answer it; given from the Shiny section, it is a notice of its own that
  cannot be answered. The Shiny goes onto the player's main yard, the mail is
  written and the gift is logged (`bym.shiny_award`) together or not at all.
- **One press, one gift.** The page makes a `requestId` (8 to 64 letters,
  digits or `-`) for each press of Give and sends the same one again on a
  retry. The server keeps it once (unique), so a repeat answers the first
  gift with `already: true` instead of giving twice.
- **The game's own save.** A save that buys something writes Shiny as a
  change (`credits = credits + change`), never the whole balance, so a save
  read before a gift cannot wipe the gift out.
- **Account deletion** removes the player's gifts from the log; a deleted
  owner's gifts stay with `by: null`.

## Shapes

All times are ISO strings (UTC). Days are `YYYY-MM-DD`, UTC.

```ts
interface StatsOverview {
  generatedAt: string;
  players: { total: number; activeToday: number; active7: number; active30: number };
  today: DailyStat;              // today so far, counted live
  days: DailyStat[];             // stored finished days, oldest first, ending yesterday
}

interface DailyStat {
  day: string;
  newPlayers: number;            // joined that day
  totalPlayers: number;          // joined up to the end of that day
  activePlayers: number | null;  // opened the game that day; null = unknown
  activeSource: "tracked" | "logs" | "partial" | null;
  attacks: number;               // player attacks started that day
  tribeRaids: number | null;     // wild monster raids landed
  eventNewPlayers: Record<string, number>;      // per event id: first progress that day
  eventPlayers: Record<string, number> | null;  // per event id: any progress that day
  bugReports: number;
  browserErrors: number | null;  // error occurrences that came in that day
  serverErrors: number | null;
}

type TicketStatus = "new" | "working" | "fixed" | "wontfix";

interface BugReportSummary {
  id: number;
  createdAt: string;
  userid: number | null;         // null: sent signed out
  username: string | null;
  preview: string;               // first line of the player's words, 140 characters at most
  gameVersion: string;
  screen: string;
  device: string;                // "phone" | "computer"
  hasScreenshot: boolean;
  hasPicture: boolean;
  emailed: boolean;
  status: TicketStatus;
  statusChangedAt: string | null;
  hasNotes: boolean;
}

interface BugReportDetail extends Omit<BugReportSummary, "preview"> {
  message: string;
  contactEmail: string | null;   // typed by a signed-out player for a reply
  userAgent: string;
  browser: string;               // "Chrome 130 on Android"
  screenSize: string;
  errors: string[];              // the last game errors the browser had, oldest first
  screenshotType: string | null;
  pictureType: string | null;
  emailedAt: string | null;
  ownerNotes: string;
  notesChangedAt: string | null;
  changes: {
    at: string;
    by: number | null;           // the owner's account number
    status: { from: TicketStatus | null; to: TicketStatus } | null;  // set when the status changed
    notes: string | null;        // set when the notes changed: the notes after the change
  }[];                           // oldest first
}

interface ErrorGroup {
  id: number;
  source: "browser" | "server";
  message: string;               // cleaned: no emails, IPs, tokens, long hex
  place: string;                 // script and line, or "METHOD /route", or the log category
  stack: string;
  count: number;
  firstSeen: string;
  lastSeen: string;
  gameVersion: string;           // browser errors: the last one seen
  screen: string;
  userids: number[];             // up to 5 recent account numbers, newest first
}
```

Replies and Shiny:

```ts
// BugReportSummary also has: unreadReplies: number (the player's answers not opened yet)
// BugReportDetail also has:
//   thread: SupportMessage[]          (oldest first; opening the report marks answers read)
//   cannotReply: "signedOut" | "noPlayer" | null
//   awards: ShinyAwardView[]          (given from this report, oldest first)

interface SupportMessage {
  id: string;
  from: "team" | "player";
  text: string;
  at: string;       // ISO time
  unread: boolean;  // a player's answer not seen before this read
}

interface ShinyAwardView {
  id: number;
  userid: number;
  username: string;
  amount: number;
  reason: string;
  bugReportId: number | null;
  by: number | null; // the owner's account number
  at: string;
}

interface PlayerMatch {
  userid: number;
  username: string;
  formerName: string | null; // the earlier name `q` matched, when it is not their name now
  bot: boolean; // a computer-run neighbour (`bym.bot`, not a seeded dev player)
  lastSeenAt: string | null;
}
```

A refusal is `{ error: "<plain words to show>", reason }` with the status in the
route table.

## Where the numbers come from

Every player count leaves out bots (every `bym.bot` row, the seeded Map
Room 2 dev players included) and test accounts (usernames starting `zz_`,
emails at `.invalid`, `.example`, `example.com/net/org`):
`server/src/services/stats/realPlayers.ts`.

- **Daily table** `bym.daily_stat`: one row per finished UTC day, written once
  and never changed, by `startDailyStats` (`services/stats/dailyStats.ts`) at
  start-up and hourly. The first start-up fills every day back to the first
  player's join (at most 400 days).
- **Join day**: the earlier of the main yard's creation and accepting the
  terms. Back to launch.
- **Active players and raids**: from the dashboard's start, a day-by-day
  record in Redis (`services/stats/activity.ts`: sets `stats:active:<day>`,
  `stats:event:<day>:<eventId>`, counters `stats:raids:<day>`,
  `stats:errors:<day>:<source>`, kept 8 days). Before that, rebuilt from the
  server's log files (sign-ins and raid landings), which go back 30 days on
  the live server; older days are `null`.
- **Event players and error counts**: from the dashboard's start only.
- **Attacks**: from the battle records, kept 365 days.

## Errors

- **Browser**: the web client's `game/bugReport/errorReporter.ts` sends
  uncaught errors and unhandled rejections (not `console.error` lines) to
  `POST /api/:apiVersion/clienterrors` (signed in; the account number is kept)
  or `POST /api/:apiVersion/clienterrors/guest` (signed out; nothing about the
  sender is kept). Body `{ errors: [{ kind, message, place, stack, count }],
  gameVersion, screen }`, at most 10 kinds; answers `{ error: 0, kept }`.
  Rate limited to 20 an hour per account or address. The client batches, waits
  30 s between sends, and stops after 5 batches per page load or on a
  401/403/404/429.
- **Server**: every `error`/`fatal` log line is caught in memory
  (`utils/errorCapture.ts`) and moved into the table every 30 s
  (`flushServerErrors` in `services/errors/errorStore.ts`).
- Both are cleaned (`services/errors/errorText.ts`), grouped by kind
  (numbers, ids and build hashes made alike), and kept in `bym.app_error`:
  at most 5000 kinds, each deleted 30 days after it was last seen (the daily
  privacy clean-up). Deleting an account takes its number out.

## Daily summary (for the Telegram summary)

`getDailySummary(day)` in `server/src/services/stats/dailyStats.ts`, for a
finished UTC day (throws for today or later). Without a second argument it
uses the running server's database and Redis. `services/alerts/dailySummary.ts`
sends it to Telegram every morning just after 00:00 UTC (08:00 SGT). Besides
numbers it holds only the first 80 characters of each of the day's bug
reports (the owner's choice; Telegram is in the Privacy Policy); no error
text, names or emails (docs/alerts.md, "Privacy").

```ts
interface DailySummary {
  day: string;
  stat: DailyStat;               // counted now if the hourly fill has not reached it
  players: { total; activeToday; active7; active30 };  // as of now
  newErrors: { id: number; source: string; count: number }[];  // kinds first seen that day, top 5
  bugReports: { id: number; text: string }[];          // that day's reports, first 10; text on one line, 80 characters at most
  openBugReports: number;                              // new or working on it, any day
}
```

## Server settings

- `ADMIN_USER_IDS`: the owner's account number(s). Required for the dashboard
  to open at all.
- `DASHBOARD_STATS=off`: this server does not fill the daily table (leave it
  to another server sharing the database). The day-by-day record and the
  error intake run regardless.

## Health

**Function:** `adminHealthReport({ sql, redis })` in
`server/src/services/health/adminHealth.ts`. It never throws: a part that
fails (the database down, say) is reported as failed.

**Route:** `GET /api/:apiVersion/admin/health` in
`controllers/admin/routes.ts`, behind the owner-only check like the rest,
answering `{ error: 0, ...AdminHealthReport }`.

**Dashboard sections** that Telegram alerts link to, as `#name` on the admin
page (`ADMIN_DASHBOARD_URL`, default `WEB_URL` + `/admin`, i.e.
`https://play.bymrevamped.com/admin#health`): `health`, `backups`, `errors`,
`bugs`. The page should scroll to (or open) the section named in the hash.

### The report

```ts
interface AdminHealthReport {
  health: HealthSummary;
  problems: { key: string; title: string; detail: string; section: "health" | "backups" | "errors" | "bugs" }[];
  unchecked: string[];            // checks that could not run now: "disk", "backup", "errors"
  openAlerts: Record<string, { title: string; section: string; since: number; lastSentAt: number }>; // epoch ms
  telegram: boolean;              // whether this server sends alerts at all
}

interface HealthSummary {
  generatedAt: string;            // ISO time
  server: {
    startedAt: string;            // the game server's last start ("up since")
    uptimeSeconds: number;
    version: { release: string | null; commit: string | null }; // e.g. "v2.0.0-beta.4"; null outside a release copy
    rulesVersion: string;         // combat rules version (16 hex)
    runtime: string;              // "bun 1.4.2"
    memory: { rssBytes: number; heapUsedBytes: number; containerUsedBytes: number | null; containerLimitBytes: number | null };
  };
  host: null | {                  // from status/host.json; null on a machine without it
    generatedAt: string;
    stale: boolean;               // older than 10 minutes: the host script stopped
    hostname: string;
    uptimeSeconds: number | null; // the machine's
    load: (number | null)[];      // 1, 5, 15 minutes
    memory: { totalBytes; availableBytes; swapTotalBytes; swapFreeBytes };   // numbers or null
    containers: null | {          // null when the script could not ask Docker
      service: string;            // caddy, web, db, redis, backup, db-init
      state: string;              // running, exited, restarting...
      health: string | null;      // healthy / unhealthy for db and redis
      restartCount: number | null; // automatic restarts since the container was made (a deploy resets it)
      startedAt: string;          // ISO, Docker's
      oomKilled: boolean;
      exitCode: number | null;
    }[];
  };
  disks: { path; mount; totalBytes; usedBytes; availableBytes; usedPercent: number | null }[];
  disksFrom: "host" | "container" | null; // "container": only the logs folder's disk, seen from inside
  database: { ok: boolean; pingMs: number | null; sizeBytes: number | null; error?: string };
  redis: { ok: boolean; pingMs: number | null; usedMemoryBytes; peakMemoryBytes; maxMemoryBytes; error?: string };
  backups: null | {               // null without host.json
    count: number; totalBytes: number; partialCount: number | null;
    newest: null | { name: string; at: string | null; sizeBytes: number | null; ageHours: number | null };
  };
  responseTimes: { requests: number; p50Ms; p95Ms; maxMs; serverErrors: number; windowMinutes: 15 };
}
```

Times are ISO strings except `openAlerts`, which keeps epoch milliseconds.
Response times cover API requests in the last 15 minutes, in memory (a
restart starts them afresh); asset downloads and `/connection` are left out.

### Where each part comes from

| Part | Source |
|---|---|
| up since, memory | the game server process; the container's limit from cgroup files |
| version | `server/src/config/release-stamp.txt`, filled in by `git archive` (`export-subst`) |
| rules version | `game-rules/combat/MANIFEST.json` (`RULES_VERSION`) |
| database size | `pg_database_size(current_database())`, timed as the ping |
| Redis memory | `PING`, then `INFO memory` |
| machine memory, disks, containers, backups | `status/host.json`, written once a minute by `server/deploy/host-status.sh` on the machine (systemd timer), mounted read-only into the game server |
| error jump | `services/alerts/errorRate.ts`, fed by the error store through `noteServerErrors(count)` |

### Feeding the error-jump alert

The "sudden jump in errors" alert reads a 10-minute counter in
`services/alerts/errorRate.ts`. The error store's half-minute flush
(`flushServerErrors` in `services/errors/errorStore.ts`) calls
`noteServerErrors(occurrences)` every time, an empty flush too, so the check
runs from the first flush after a start (until then it reports as unchecked).
The "usual" rate is learnt afresh after each restart.
