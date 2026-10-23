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

Lives at `/admin` on the game's web address. It should call `GET .../admin/me`
first and show nothing (or the game's normal 404) unless that answers 200. It
should honour `?bug=<id>` (open that bug report) and `#health`, `#backups`,
`#errors`, `#bugs` (scroll to that part), which the alerts link to. Pictures
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
| `GET /api/:apiVersion/admin/errors?source=&sort=&limit=&sinceDays=` | `{ groups: ErrorGroup[], totals }` |

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

## Where the numbers come from

Every player count leaves out bots and test accounts (usernames starting
`zz_`, emails at `.invalid`, `.example`, `example.com/net/org`):
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
uses the running server's database and Redis.

```ts
interface DailySummary {
  day: string;
  stat: DailyStat;               // counted now if the hourly fill has not reached it
  players: { total; activeToday; active7; active30 };  // as of now
  newErrors: { source: string; message: string; count: number }[];  // kinds first seen that day, top 5
  bugReports: { id: number; message: string }[];       // that day's reports, first 10, 80 characters each
}
```

## Server settings

- `ADMIN_USER_IDS`: the owner's account number(s). Required for the dashboard
  to open at all.
- `DASHBOARD_STATS=off`: this server does not fill the daily table (leave it
  to another server sharing the database). The day-by-day record and the
  error intake run regardless.
