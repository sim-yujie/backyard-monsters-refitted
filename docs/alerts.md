# Server health and Telegram alerts

The game tells the owner on Telegram when something is wrong, and the owner's
dashboard (a hidden page on the game page, `/admin`) shows the server's health.

## What sends an alert

| Problem | Who notices | Dashboard link |
|---|---|---|
| Game server down (the whole server or machine) | the outside check, GitHub Actions, every 5 minutes | `/admin#health` |
| Game page down | the outside check | `/admin#health` |
| Database or Redis not answering | the game server, every minute | `/admin#health` |
| Disk nearly full (90%) | the game server, from the machine's health file | `/admin#health` |
| Nightly backup missed (none for 26 hours) | the game server, from the machine's health file | `/admin#backups` |
| The machine's health file stopped updating | the game server | `/admin#health` |
| Sudden jump in server errors | the game server, from the error store | `/admin#errors` |
| Each new bug report (at most 10 an hour) | the game server, when it saves one | `/admin#bugs` |
| Each moderator ban or mute (every one) | the game server, when a moderator does it | `/admin#moderators` (Undo there) |
| Each chat-filter flag (at most 10 an hour, the rest summed up) | the chat server, when the chat filter stores a flag (`alertChatFlag`, `chat/chatWatch.ts`) | `/admin#moderation?player=<id>` |
| Each player's chat report (at most 30 an hour, the rest summed up) | the game server, when it saves one | `/admin#moderation?player=<id>` |
| A brand-new account (joined in the last hour) uploading a profile photo (at most 10 an hour) | the game server, when it saves the photo | `/admin#moderation?player=<id>` |
| Daily summary of yesterday (not a problem; once a day) | the game server, just after 00:00 UTC (08:00 SGT) | `/admin#bugs`, or `#health` on a day without reports |

The daily summary (`services/alerts/dailySummary.ts`) has yesterday's new and
active players, attacks and tribe raids, event players, browser and server
errors, the problems still open, and the day's bug reports (at most 10), each
with the first 80 characters of what the player wrote. It goes once a day
between 00:05 and 12:00 UTC: a server that was down at midnight sends it when
it is back, and two servers sharing one Redis send it once. A failed send is
tried again 15 minutes later. `bun run alerts:summary [YYYY-MM-DD]` prints it
without sending; add `--send` to send it.

### Moderation messages (owner, 24 Nov 2026)

`services/alerts/moderationAlerts.ts`. These let the owner watch the
moderators and the chat:

- **A moderator's ban or mute**, every one: who did it, to whom, how long,
  the reason the player saw, up to 3 reported lines, how many of the
  player's lines a ban took out of chat, and the dashboard link where the
  owner can Undo it or make a ban permanent (`/admin#moderators`, "Bans and
  mutes by moderators"). An admin's own steps in the game's Reports window
  are not said.
- **A chat-filter flag**, with the player, the room, the line (their own
  words) and why ("group invite link cut; watched word: private server;
  hidden from others (new player)"). Sent when the chat filter
  (`services/chat/chatFilter.ts`) stores a flag, so the per-player limit (5
  flags in 10 minutes) applies before the hourly cap. The word filter's
  swear flags do not call it.
- **A player's chat report**, with the reporter, the reported player, the
  room and the line (the chat server's own copy; the reporter's copy is
  marked as such when the line had already left the room).
- **A new account's profile photo**: the username, how many minutes ago it
  joined (its main yard's creation or its sign-up, whichever came first)
  and a link. Never the photo, nor a link to it.

Flags, reports and new-account photos are capped per clock hour (UTC): the
last one sent says so, and when the hour ends one message says how many more
there were ("BYMR chat filter: 14 more flags 14:00-15:00 UTC, not sent one
by one."). The counts are the server's own, in memory: a restart starts
them again, and a server stopped mid-hour does not send that hour's count.

A problem is said once. If it is still there 12 hours later it is said again,
and when it clears a "fixed" message says how long it lasted. A message that
could not be sent is tried again a minute later (the outside check: 5 minutes
later). Bug report emails are unchanged; Telegram comes on top.

Alerts are off until the bot's settings are in place (below). Nothing else
changes when they are off.

## Privacy

Telegram is an outside service. The server-health alerts carry no personal
details: no player-written text, no usernames or account numbers, no emails,
no device or browser details, and no error text. An alert says what kind of problem it is,
numbers (a disk's percent, a backup's age, error counts, a bug report's number
and how many came this hour) and a link to the dashboard, which shows the rest
after the owner signs in. The bug report alert is handed the report's number
only, never the report (`services/alerts/bugReportAlert.ts`). Database and
Redis alerts include the connection error the server got (for example
"connection refused"); that is about the server, not a player.

Two exceptions, both the owner's choice:

- The daily summary carries the first 80 characters of each of the day's bug
  reports (2026-10-23), with no name, account number, email or device.
- The moderation messages (2026-11-24, above) carry usernames, the chat
  lines that were reported or flagged, and the reasons moderators gave. They
  never carry an email, an IP address or its hash, a device, or a photo.

Because that is player-written text and names, the Privacy Policy lists
Telegram among the outside services and says what it sees
(`web/privacy.html`, section 3; earlier notes also name
`launch/legal/privacy-policy.md` as the info site's copy, which is not in
this repository: if it still exists, it needs the same change). Anything else new must follow the no-text
rule; more player text in Telegram needs the owner's say and a policy update.

## How it works

- **The game server** (`server/src/services/alerts/`) checks once a minute. It
  starts only when `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are set. What is
  open is kept in Redis (`alerts:open`), so a restart does not repeat it.
- **The machine's health file.** The game server runs in a container and can't
  see the machine's disks, the other containers or the backups folder. A small
  script on the machine itself, `server/deploy/host-status.sh`, writes
  `server/status/host.json` once a minute (a systemd timer). The game server
  reads it through a read-only folder (`docker-compose.prod.yml`). No Docker
  access is given to the game server.
- **The outside check** (`.github/workflows/uptime-check.yml`,
  `.github/scripts/uptime-check.sh`) runs on GitHub, so it still works when the
  whole server is down. It tries each address three times, 20 seconds apart,
  before calling it down. It is off until the repository variable
  `UPTIME_CHECK` is `on`.
- **The live version** shown on the dashboard comes from
  `server/src/config/release-stamp.txt`, which `git archive` fills in with the
  release tag when the code is copied to the server (docs/deploy.md).

## Settings

In `server/production.env` (all optional except the first two):

| Name | What | Default |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | the bot's token from BotFather | none: alerts off |
| `TELEGRAM_CHAT_ID` | the chat the alerts go to | none: alerts off |
| `ADMIN_DASHBOARD_URL` | where alerts link | `WEB_URL` + `/admin` |
| `ALERT_DISK_PERCENT` | "nearly full" | 90 |
| `ALERT_BACKUP_HOURS` | "backup missed" after this many hours | 26 |
| `ALERT_ERRORS_MIN`, `ALERT_ERRORS_FACTOR` | an error jump is at least MIN errors in 10 minutes and FACTOR times the usual | 20, 5 |
| `HOST_STATUS_FILE` | where the machine's health file is read | `status/host.json` |

In the GitHub repository (Settings > Secrets and variables > Actions):

| Kind | Name | Value |
|---|---|---|
| Secret | `TELEGRAM_BOT_TOKEN` | the same token |
| Secret | `TELEGRAM_CHAT_ID` | the same chat id |
| Variable | `UPTIME_CHECK` | `on` to start the 5-minute checks |
| Variable (optional) | `GAME_SERVER_URL` | default `https://api.bymrevamped.com/connection` |
| Variable (optional) | `GAME_PAGE_URL` | default `https://play.bymrevamped.com/` |
| Variable (optional) | `ADMIN_DASHBOARD_URL` | default `https://play.bymrevamped.com/admin` |

## Setting it up (owner)

1. **Make the bot.** In Telegram, message `@BotFather`, send `/newbot` and
   follow the steps. It gives you a token: keep it with your other secrets.
2. **Say hello to it.** Open your new bot in Telegram and send it any message
   (for example `/start`). A bot can only message people who wrote to it first.
3. **Find your chat id.** Put the token in `server/production.env` on the
   server (`TELEGRAM_BOT_TOKEN=<token>`), then:

   ```
   cd /opt/bymr/server && deploy/prod.sh run --rm --no-deps web bun run alerts:chat-id
   ```

   It lists the chats that wrote to the bot, with their ids. Or, from any
   computer, with the token in place of `<token>`:

   ```
   curl -s "https://api.telegram.org/bot<token>/getUpdates" | grep -o '"chat":{"id":-\?[0-9]*'
   ```

   The number after `"id":` is your chat id.
4. **Send a test alert.** Add `TELEGRAM_CHAT_ID=<chat id>` to `production.env`,
   then:

   ```
   cd /opt/bymr/server && deploy/prod.sh run --rm --no-deps web bun run alerts:test
   ```

5. **Turn the server's alerts on** by restarting the game server, so it reads
   the two new lines (players are cut off for about half a minute):

   ```
   cd /opt/bymr/server && deploy/prod.sh up -d web
   ```

   Its log then says `Telegram alerts: on`. Any time,
   `deploy/prod.sh exec web bun run alerts:check` prints the health summary and
   what is wrong right now, without sending anything.
6. **Install the machine's health file** (once, as root on the server):

   ```
   cd /opt/bymr/server
   cp deploy/bymr-host-status.service deploy/bymr-host-status.timer /etc/systemd/system/
   systemctl daemon-reload
   systemctl enable --now bymr-host-status.timer
   bash deploy/host-status.sh --print
   ```

   The last line prints what it writes. `status/host.json` then updates every
   minute. The game server needs `deploy/prod.sh up -d web` once after the
   `./status` folder line is in `docker-compose.prod.yml`.
7. **Turn the outside check on.** In the GitHub repository, add the two
   secrets, then run it once by hand: Actions > Uptime check > Run workflow,
   with "Only send a test message" ticked. When the test message arrives, add
   the variable `UPTIME_CHECK` = `on`.

To stop alerts: remove the two lines from `production.env` and restart the
game server; set `UPTIME_CHECK` to `off` (or delete it) on GitHub.
