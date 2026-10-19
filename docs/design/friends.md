# Friends — Design

A design document for the friends update (issue #367). The owner settled the scope on
2026-10-19: a friends list with friend requests, visiting a friend's yard, helping in it (repairs
and speed-ups), free daily gifts, ways to find people, a friends bar like the original game's, and
privacy controls. The release is held until this is done, so the work is split into packages that
up to three helpers can build at once.

All citations are `path:line` or `path` relative to the repository root. Claims about current
behaviour cite the server, the web client or the Flash client (`client/scripts`); anything new is a
proposal. The numbers this document had to propose are listed in section 10; the owner approved all
of them on 2026-10-19.

Contents:

1. [The owner's decisions](#1-the-owners-decisions)
2. [What exists today](#2-what-exists-today)
3. [How it works for the player](#3-how-it-works-for-the-player)
4. [Help rules](#4-help-rules)
5. [Gift rules](#5-gift-rules)
6. [Server: data model and API](#6-server-data-model-and-api)
7. [Anti-abuse rules](#7-anti-abuse-rules)
8. [Web client](#8-web-client)
9. [Work packages](#9-work-packages)
10. [Owner questions](#10-owner-questions)

---

## 1. The owner's decisions

Settled on 2026-10-19. This document does not re-open them.

1. **Scope for this update:** friends list and friend requests; visit a friend's yard (look only);
   help in a friend's yard by repairing damaged buildings and speeding up a build, upgrade or
   fortify; gifts.
2. **Friendship is mutual:** one player asks, the other accepts. **At most 100 friends.**
3. **Attacking a friend is allowed**, after an "Are you sure? This is your friend." warning, as in
   Flash.
4. **Speed-up help follows Flash:** each help takes 5% off the time left, at most 5 helpers per job,
   each friend once per job. On top of that, **a daily cap per helper** (about 20 helps a day).
   **Repair help counts toward the same daily cap**, and a friend can repair a given building once
   per damage.
5. **The helper earns a small resource reward** for each help within the cap.
6. **Gifts:** a free resource gift scaled to the sender's level; **each friend can get at most one
   gift a day from you.** Gifts must not be farmable with fake accounts.
7. **Finding friends:** search by username; "Add friend" in the Map Room yard popup, in the alliance
   member list and on attack messages.
8. **UI:** a bottom bar of friend portraits like Flash (click one to visit), plus a place for
   requests and search that fits the current web client.
9. **Privacy:** block a player (no requests, gifts or messages from them), hide your online status,
   turn off friend requests.
10. **"Move next to a friend"** (the Map Room 2 outpost invitation) **stays as it is** for now.
11. **Built in parallel** by several helpers, at most three at a time, without two editing the same
    files.

Out of scope: friend quests and achievements, invite links and invite rewards, taunts, a friends
leaderboard, Map Room 3 "relocate near a friend", friends on outposts or in the Inferno, cheaper
"move next to a friend".

## 2. What exists today

**Flash (for reference).** Friends came from Facebook; the game had no list of its own. A friend's
yard opened in "help" mode (`client/scripts/BASE.as:2264`). There a friend could press Repair on a
damaged building, which started its repair (`client/scripts/BUILDINGINFO.as:524-526`), or Help on a
building being built, upgraded or fortified (`BUILDINGINFO.as:530-531`). Help took 5% of the time
left off the countdown (`client/scripts/BFOUNDATION.as:2385-2399`), refused a sixth helper
("already helped by 5") and a repeat helper (`BFOUNDATION.as:2342-2351`), and kept the helpers'
ids on the building as `hl` until the job ended (`BFOUNDATION.as:3026-3027`, cleared at `:2205`,
`:2323`). Helpers got nothing. A gift was one random resource worth 2-4% (three times in four) or
7-12% of the **receiver's** storage cap (`client/scripts/GIFTS.as:24-45`). Attacking a friend asked
"are you sure?" first (`client/scripts/com/monsters/maproom_advanced/PopupInfoEnemy.as:301`).

**Our server.**
- No friend table, requests, gifts or help. The `friend` flag in map cells, neighbour lists and
  mail targets is hard-coded to 0 (`server/src/services/maproom/createNeighbourData.ts:48`,
  `server/src/controllers/mail/getMessageTargets.ts:75-98`). `getfriendinfo` returns an empty list
  (`server/src/controllers/maproom/v3/getFriendInfo.ts:4-12`). Legacy counters `friendcount`,
  `sendgift`, `sendinvite` are only echoed (`server/src/database/models/user.model.ts:110-133`).
- **Blocking exists, without a screen of its own:** `user.blockedUsers` (jsonb, GIN index) is filled
  by reporting a mail thread (`server/src/controllers/mail/reportMessageThread.ts:36`) and already
  stops mail and truce requests both ways (`sendMessage.ts:80`, `requestTruce.ts:61`). There is no
  unblock.
- **Presence exists:** a player is "online" by `services/user/online.ts`; `user.last_seen_at`
  records the last own-yard load, hourly, and is never sent to a client (`user.model.ts:53-61`).
- **Yards are server-run:** every own-yard action locks the save, catches it up, decides, and saves
  (`server/src/controllers/yard/yardAction.ts:42-70`). Countdowns are `cB`/`cU`/`cF` on each
  building; `rE` marks a repair (`server/src/types/BuildingData.ts`). Repair is free, opt-in and
  takes at most an hour (`server/src/services/yard/repair.ts:18-24`).
- **Base load already knows a `help` mode** (`server/src/enums/Base.ts:10`) but nothing handles it;
  `view` loads someone else's yard read-only (`server/src/controllers/base/load/baseLoad.ts:129`).
- Notifications exist with kinds `jobs`, `away`, `achievement`
  (`server/src/database/models/notification.model.ts:9`).
- Storage: one cap for all four resources, `storageCap`/`capOf`
  (`server/src/services/base/economy/resourceBudget.ts:338`, `server/src/services/yard/credit.ts:43`).

**Our web client.** The yard can be visited read-only from the map (`YardScene` with a
`ViewTarget`, `web/src/app/scenes/YardScene.ts:161-177`). The yard's round buttons sit bottom left
(Map, yard switcher or Home) and bottom right (Build, Collect all, Monsters, Layout)
(`web/src/ui/yard/YardDock.ts`). Attacks start in three places, each calling `setAttackTarget`
(`MapRoom1Scene.ts:264`, `MapRoom2Scene.ts:856`, `YardScene.ts:824`). Account settings hold the
username and Shiny Lock (`web/src/ui/AccountSettings.ts`). **There is no alliance member screen
yet**, so decision 7's alliance entry point has nowhere to live (see section 10, Q8).

## 3. How it works for the player

### 3.1 Becoming friends

- Open **Friends** (the bar's "+" or the Account menu), go to **Find**, type at least 3 letters of a
  username, and press **Add friend** on a result. Or press **Add friend** in a Map Room yard popup,
  on an attack message in the mailbox, or on an alliance mate in Find's suggestions.
- The other player gets a notification and a red count on Friends. In **Requests** they press
  **Accept** or **Decline**. A decline is silent: the request just leaves the sender's "Sent" list.
- On accept, both players see each other in their list and bar, and both get a notification.
- **Remove friend** ends it at once for both, silently. Attacking a friend does not end it.
- Limits: 100 friends; 30 requests waiting for an answer at a time; a request lapses after 14 days;
  after a decline, the same player cannot ask again for 7 days.

### 3.2 The friends bar

A strip of portraits along the bottom middle of the player's own yard, between the left and right
buttons, like Flash's. Each portrait is the friend's critter avatar with name and level, a green dot
when online (unless they hide it), and small badges:

- **wrench** — something in their yard you can still help with today;
- **gift** — you have not sent them a gift today.

Order: wrench first, then online, then highest level. The first slot is **+** (opens Friends). It
shows as many portraits as fit, with arrows to page. Clicking a portrait opens a small card:
**Visit**, **Send gift**, **Friends list**. On a phone the strip hides behind a **Friends** round
button in the bottom-left group and slides up when pressed.

The bar shows on the own yard only: the maps are already crowded.

### 3.3 Visiting a friend

**Visit** opens the friend's main yard, read-only, wherever it is on any map. Nothing can be built,
moved or collected. The bottom-left button is **Home**. Buildings you can help with carry a wrench
marker. A line at the top says "Helping {name} — 17 helps left today".

Pressing a building with a wrench opens a small panel:
- **Speed up** — "Takes 6m 30s off the Storage Silo upgrade (5% of the time left)". Shows "3 of 5
  friends have helped" and refuses with a reason when you can't.
- **Repair** — "Repairs this Cannon Tower now."

After a help, a short thank-you shows what was saved and the reward earned, the wrench goes, and the
counter drops. The friend gets a notification ("Bob took 6m 30s off your Storage Silo upgrade"). If
the friend is in their yard right then, their timer updates when that notification arrives.

When the friend is under attack, helping is refused ("They are under attack right now"); looking is
fine. A visit to someone who stopped being your friend meanwhile is refused at the next help.

### 3.4 Gifts

**Send gift** (on the bar card or the list) asks which resource: Twigs, Pebbles, Putty or Goo. It is
free for the sender. One gift per friend per day. The friend sees a notification and a count on
Friends; their **Gifts** tab lists waiting gifts with **Collect** (and **Collect all**) and **Send
one back**. Collecting adds the resource to the main yard up to its storage cap; if there is not
room for all of it, the button warns first. A gift waits 7 days, then lapses. A player can collect
at most 5 gifts a day; the rest wait.

### 3.5 Attacking a friend

Any Attack press on a friend's yard (Map Room 1 list, Map Room 2 popup, the visit's Attack button)
first asks: **"Attack {name}? {name} is your friend."** [Attack] [Cancel]. Nothing else changes.

### 3.6 Privacy

In **Account settings**, a new **Privacy** part:
- **Show when I'm online** (on by default). Off: friends see no dot and no "seen" time.
- **Accept friend requests** (on by default). Off: requests to you are refused with "This player
  isn't taking friend requests." Existing friends stay.
- **Blocked players**: the list, each with **Unblock**.

**Block** sits on a friend's row, on a search result, and in a mail thread (beside Report, which
keeps blocking as it does now, and now also ends any friendship and requests between you, as Block
does; WP1). Blocking someone removes the friendship and any requests between
you, drops their waiting gifts to you, and stops their requests, gifts and messages. They are not
told; what they try fails with the same neutral "You can't send that to this player." Blocking does
not stop attacks either way.

## 4. Help rules

All checks are on the server. A **help** is one speed-up or one repair.

**Who may help.** The two players are friends, have been for at least 24 hours, both accounts are at
least 3 days old and both are at least level 5 (section 7). Neither has blocked the
other. Only the friend's **main yard** can be helped.

**Daily cap.** At most **20 helps a day** per helper, speed-ups and repairs together.
The day turns at 00:00 UTC. A help that is refused does not count.

**Speed-up.**
- Allowed on a building with a build, upgrade or fortify countdown running (`cB`, `cU` or `cF` above
  0 after catch-up). A building being repaired (countdown paused) can still be helped.
- Takes `floor(5% of the time left)` seconds off that countdown, as `BFOUNDATION.HelpB` did. When
  more than one runs (should not happen), the order is build, upgrade, fortify, as Flash.
- At most 5 helpers per job; each friend once per job. The helpers' user ids are kept on the
  building as `hl` (Flash's name). `hl` is cleared when the job finishes, is cancelled, is finished
  with Shiny, or a new job starts on that building.
- Five helps take about 23% off a job (`1 - 0.95^5`).

**Repair.**
- Allowed on a building below full health. It **heals the building to full health at once**
  and clears `rE`, like a one-building "Repair now" with no Shiny. Because the building
  is then healthy, it can be repaired only once per damage, by one friend.
- Damage and the yard's damage figure follow the existing repair rules (`catchUpDamage.ts`).

**Reward.** Each counted help pays the helper **0.25% of the lower of the two players' storage caps
in each of Twigs, Pebbles, Putty and Goo**, credited to the helper's main yard up to
its cap. Using the lower cap means helping a tiny fake yard pays almost nothing. 20 helps a day is at
most 5% of a cap in each resource.

**What the owner sees.** A `friend` notification for each help. A help never changes anything else
in the yard.

## 5. Gift rules

- **Who may gift:** the same friendship rules as help (24 hours of friendship, both accounts 3 days
  old, both level 5+), and not blocked either way.
- **One gift per sender per friend per day** (decision 6), UTC day. Removing and re-adding a friend
  does not give a second gift that day.
- **Amount:** **3% of the lower of the sender's and the receiver's storage caps**, in the resource
  the sender picks. The sender's cap is how decision 6's "scaled to the sender's level"
  is measured: it grows with their silos, packing and outposts. Taking the lower cap means a fake
  low-level account sends very little, and a big player cannot flood a beginner. Worked out and
  fixed when sent.
- **Free:** nothing is taken from the sender.
- **Receiving:** gifts wait up to 7 days. At most **5 collected a day** per player.
  Collecting credits the main yard, clamped to its cap (the yard action credit rule, T3).
- For scale: at most 15% of one's cap a day from gifts, plus at most 5% per resource from helping.

## 6. Server: data model and API

### 6.1 Tables (new)

| Table | Columns | Notes |
| --- | --- | --- |
| `friend` | `userid`, `friend_userid`, `created_at` | Two rows per friendship, one each way. PK (`userid`, `friend_userid`); index on `friend_userid`. `created_at` is "friends since" for the 24-hour rule. |
| `friend_request` | `id`, `from_userid`, `to_userid`, `status` (`pending`, `accepted`, `declined`, `cancelled`, `expired`), `created_at`, `answered_at` | Partial unique index: one `pending` row per ordered pair. A request both ways at once: the second one accepts the first. |
| `friend_gift` | `id`, `from_userid`, `to_userid`, `resource` (`r1`-`r4`), `amount`, `gift_day` (date), `created_at`, `collected_at`, `expires_at` | Unique (`from_userid`, `to_userid`, `gift_day`). |
| `friend_help` | `id`, `helper_userid`, `owner_userid`, `baseid`, `building_id`, `kind` (`speedup`, `repair`), `seconds_saved`, `reward` (jsonb), `help_day` (date), `created_at` | Index (`helper_userid`, `help_day`) for the cap. Doubles as the audit trail. |

**User columns (new):** `hide_online boolean default false`, `friend_requests_off boolean default
false`. `friendcount` is kept equal to the real count, for the legacy client.

**Building data (new key):** `hl: number[]` on a building with a job running.

**Notification kind (new):** `friend`, payload `{ event, userid, username, ... }` where `event` is
`request`, `accepted`, `gift`, `helpSpeedup` (`seconds`, `building`), `helpRepair` (`building`).

Each work package that adds a table writes its own migration file. **Account deletion and data
retention** (`server/src/services/privacy/deleteAccount.ts`, `retention.ts`) must remove a deleted
player's rows from every new table, in the package that adds the table.

### 6.2 API

All under `/api/:apiVersion`, logged-in (`verifyUserAuth` then `verifyAccountStatus`), rate-limited like the mail routes. Routes live in a new
`server/src/controllers/friends/routes.ts` mounted once from `app.routes.ts` (WP1); later packages
add lines to that file only. Answers use `{ error: 0, ... }` like the rest.

| Route | Body / query | Answer |
| --- | --- | --- |
| `GET /bm/friends` | — | `friends: Friend[]`, `max: 100`, `requestsIn: n`, `giftsWaiting: n`, `helpsLeft: n` |
| `GET /bm/friends/requests` | — | `incoming: Request[]`, `outgoing: Request[]` |
| `POST /bm/friends/request` | `{ userid }` or `{ username }` | `{ request, friend? }` or a refusal |
| `POST /bm/friends/request/answer` | `{ requestid, accept }` | `{ friend? }` |
| `POST /bm/friends/request/cancel` | `{ requestid }` | `{}` |
| `POST /bm/friends/remove` | `{ userid }` | `{}` |
| `GET /bm/friends/search` | `?q=` (3+ chars) | `results`: up to 10 `{ userid, username, pic, level, relation }`, exact match first |
| `GET /bm/friends/suggestions` | — | `results`: alliance mates not yet friends (up to 50), same shape |
| `POST /bm/friends/gift` | `{ userid, resource }` | `{ gift }` |
| `GET /bm/friends/gifts` | — | `gifts: Gift[]`, `collectsLeft: n` |
| `POST /bm/friends/gifts/collect` | `{ giftid }` or `{ all: true }` | `{ collected, resources }` |
| `POST /bm/friends/help` | `{ userid, buildingId, kind }` | `{ secondsSaved?, healed?, reward, helpsLeft, building }` |
| `POST /base/load` with `type: "help"` | `baseid` of the friend's main yard | the yard as `view` serves it, plus `help: { helpsLeft, buildings: { [id]: { speedup?, repair? } } }`, each `true` or a reason |
| `POST /player/settings` (existing) | adds `hideOnline?`, `friendRequests?` (every field optional) | `settings` adds both |
| `GET /player/blocked` | — | `blocked: [{ userid, username }]` |
| `POST /player/block`, `POST /player/unblock` | `{ userid }` | `{}` |

`Friend` = `{ userid, username, pic, level, online: "online" | "today" | "week" | "away" | null,
since, giftSentToday, canGiftFrom, help: { speedup, repair } | null }`. `online` is `null` when the
friend hides it; "today"/"week"/"away" come from `last_seen_at`, coarse on purpose. `canGiftFrom` is
when the 24-hour rule clears (null once it has). `help` says whether you could help today; until WP6
lands it is `null`.

`Request` = `{ requestid, userid, username, pic, level, status, at, expires }`, where `userid`,
`username`, `pic` and `level` are the other player's (the sender in `incoming`, the recipient in
`outgoing`), `status` is `pending` | `accepted` | `declined` | `cancelled` | `expired`, and `at` /
`expires` are unix seconds (made / lapses 14 days later). `POST /bm/friends/request` to a player who
had already asked you accepts their request instead: the answer's `request` is theirs with
`status: "accepted"`, and `friend` is the new friend.

`relation` = `self` | `friend` | `requested` (you asked) | `asked` (they asked you) | `none`.
A player who blocked you shows as `none`, and a request then fails with the neutral refusal.

**Refusals** (409, a stable `reason` the client turns into words): `friendLimit`, `theirFriendLimit`,
`requestLimit`, `alreadyFriends`, `alreadyRequested`, `requestsOff`, `declinedRecently`,
`cannotSend` (blocked either way, either account banned, or the account cannot be friended), `tooNew` (24-hour, account age
or level rule, with `from` when known), `dailyCap`, `giftSentToday`, `collectLimit`, `notFriends`,
`helpersFull`, `alreadyHelped`, `nothingToHelp`, `underAttack`, and three for bad targets:
`noSuchPlayer` (no such id or name), `noSuchRequest` (not a waiting request of yours) and `self`.
`requestLimit` is 30 requests waiting; `dailyCap` is 30 requests made today (cancelled ones count).
The body is the usual `ClientSafeError` shape: the reason is in `errorDetails.data.reason`, the
player-facing sentence in `errorDetails.message`, and `declinedRecently` adds `data.from` (unix
seconds when asking again works). A malformed body is a 400 as elsewhere.

**Notifications.** Requests and accepted requests leave a `friend` notification for the other
player; its row's `jobs` holds one entry, `{ event: "request" | "accepted", userid, username }`.

**Friend flag.** Map cells, neighbour lists and mail targets fill `friend: 1` for friends instead of
the hard-coded 0, so the legacy client paths behave (WP2). Read fresh from the `friend` table on every
answer (the Map Room 1 neighbour list is cached for weeks but its flag is refreshed each time). A map
cell carries it as `fr`; a cell of the viewer's own is 0.

**Help-mode load.** `POST /base/load { type: "help", baseid }` answers 409 `notFriends` for anyone who
is not a friend of the owner (also a blocked pair, a banned account, an unknown id), the same for all
of them. The friend's outpost id answers like an unknown base (`baseNotFound`). It is served as a
`view` is, with no fog of war check, `canattack: false`, no write and no presence mark, so it shows
nothing an attacker's view would not. The `help` block comes from `services/friends/helpHook.ts`
(empty until WP6 installs its rules).

**Accounts that cannot be friended.** A request to an account that never answers is handled the way
truce requests to such accounts are (`server/src/services/bots/truceDecline.ts`): the request is
stored and answered the same way, and a decline job runs 2-8 hours later. Same answer shape as any
request, so nothing differs to the sender (WP1).

### 6.3 Help on the server

`POST /bm/friends/help` runs a new wrapper beside `defineYardAction`: lock **both** saves `FOR
UPDATE` in user-id order (no deadlock), refuse while the friend's yard is under attack or raided,
catch up both, check the rules of section 4, apply the speed-up or repair to the friend's save,
credit the reward to the helper's save, write the `friend_help` row and the notification, all in
one transaction. `hl` clearing is added where jobs end or start (`services/yard/build.ts`,
`upgrade`, `fortify`, `instantUpgrade`, `catchUpBuildings.ts`, Shiny `speedup`).

The `help` mode load (WP2) returns the yard like `view` and asks the help rules (WP6) which
buildings can be helped. Until WP6 lands, `help.buildings` is empty.

**As built (WP6, #373).** Numbers in `server/src/services/friends/helpConfig.ts`; rules in
`helpRules.ts`; the route in `controllers/friends/help.ts`.

- Answer: `{ error: 0, secondsSaved | healed: true, reward: { r1..r4 }, helpsLeft, building }`, where
  `reward` is what landed in the helper's pool (after the cap clamp) and `building` is the friend's
  building as now saved (shorter countdown and `hl`, or healed).
- Refusal order: `self`, `noSuchPlayer`, `notFriends`, `cannotSend` (so a stranger learns nothing
  about the yard), `underAttack` (the friend's yard attacked or raided; the helper's own yard gives
  the yard actions' `underAttack` / `raidInProgress`), then after both catch-ups `tooNew`,
  `dailyCap`, then `nothingToHelp`,
  `alreadyHelped`, `helpersFull`. `tooNew` carries `from` (the latest of friendship + 24 h and
  each account's age + 3 days) unless a level is what stops it. A refusal writes nothing, the
  catch-ups included.
- Account age is the main save's `createtime`; level is the main save's level after its catch-up.
- A countdown under 20 seconds (5% rounds to 0) is `nothingToHelp`, so a help always saves time.
- Race safety: both main saves are locked in user-id order, so helps on one yard and helps by one
  helper run one at a time; the 5-helper limit, once-per-job, once-per-damage and the daily cap
  are all read inside the locks.
- `hl` is cleared where a countdown runs out (`advanceBuildingTimers`, which the catch-up, Shiny
  finish, instant upgrade, planner and attack save all use), where an upgrade or fortify starts
  (`startUpgrades`, `fortify`), where one is cancelled (`upgrade`, `fortify`) and where the Map
  Room's upgrade is taken over (`mapRoom`). A Shiny speed-up that does not finish keeps it.
- Notification payload: `{ event: "helpSpeedup", userid, username, building: <type>, buildingId,
  seconds }` or `{ event: "helpRepair", userid, username, building: <type>, buildingId }`.
- `GET /bm/friends`: `helpsLeft` is the real count; each friend's `help` is `null` when the gates
  refuse, else `{ speedup, repair }` (anything helpable now).
- `friend_help` rows go with either account and after 90 days (`retention.ts`).

## 7. Anti-abuse rules

1. **Friendship age gate:** gifts and help need 24 hours of friendship. Remove and
   re-add starts the clock again.
2. **Account gate:** both accounts at least 3 days old and level 5 or more, so a fresh
   fake account is useless for days and costs real play.
3. **Lower-cap scaling:** gift and reward amounts use the lower of the two storage caps, so small
   fake yards give and earn little.
4. **Hard caps:** 100 friends; 30 open outgoing requests; 30 new requests a day; 20 helps a day; 5
   helps per job; one gift per friend per day; 5 gifts collected a day where not set
   by the owner.
5. **Per-pair keys:** `gift_day` and `hl` stop repeats even across remove and re-add.
6. **Server decides everything:** time saved, health, amounts and caps are worked out on the server
   from the locked, caught-up saves; the client only names the friend, the building and the kind.
7. **Rate limits** on search (30 a minute), requests and gifts, like the mail limiters.
8. **Blocks** stop requests, gifts, help-mode visits and mail both ways and never tell the blocked
   player.
9. **Audit:** `friend_help` and `friend_gift` keep who did what for whom, for spotting rings later.
10. **No farming through requests:** declining or ignoring is free; a sender waits 7 days after a
    decline.

## 8. Web client

New code lives in `web/src/ui/friends/` and `web/src/game/friends/` so packages rarely share files.

- `web/src/api/friends.ts` — every call in 6.2 and their types, written once in WP3 from this
  contract (including gifts, help, privacy and block calls), so later packages only import it.
- `web/src/game/friends/friendsStore.ts` — the cached list (friend ids for the attack warning,
  counts for badges), refreshed on open, on a `friend` notification and every few minutes (WP3).
- `ui/friends/FriendsScreen.ts` — a `Panel` with tabs **Friends**, **Requests**, **Gifts**,
  **Find**; each tab its own file so WP8 adds Gifts without touching the others (WP3).
- `ui/friends/FriendsBar.ts` and `FriendCard.ts` — the bar and the portrait card (WP4), mounted by
  the yard scene.
- Visit: a `friend` kind of `ViewTarget`, loaded with `type: "help"`; Home on the dock; the
  "Helping {name}" line (WP5). Help markers and the help panel (WP7).
- `ui/friends/FriendAttackConfirm.ts`, called before the three `setAttackTarget` calls (WP10).
- Privacy part of `AccountSettings.ts`, Block buttons (WP9).
- Add-friend buttons in `ui/maproom/CellPanel.ts`, `ui/maproom1/MapRoom1Ui.ts`, the mailbox attack
  notice, and Find's suggestions (WP11).
- Notification panel words for the `friend` kinds (WP3).

All words in plain English, matching the existing panels.

## 9. Work packages

Each is sized for one helper (S under 2 days, M under a week). "Files" are the areas the package
owns; two packages running at once must not share them.

| WP | Issue | Work | Depends on | Files | Size |
| --- | --- | --- | --- | --- | --- |
| WP1 | #368 | **Server: friends core.** `friend` and `friend_request` tables and entities, user privacy columns, requests (send, answer, cancel, lapse after 14 days, 7-day re-ask wait), list, remove, search, suggestions, block/unblock/blocked, settings fields, `friend` notifications for request/accepted, the never-answering account decline, account deletion, `friendcount`. | — | `server/src/controllers/friends/`, `server/src/services/friends/`, new migration and models, `controllers/auth/updateSettings.ts`, `getAccount.ts`, `notification.model.ts`, `privacy/deleteAccount.ts`, one mount line in `app.routes.ts` | M |
| WP2 | #369 | **Server: visit load and friend flag.** `type: "help"` base load (friends only, main yard only, read-only, `help` block hook); `friend: 1` in map cells, neighbour lists and mail targets. | WP1 | `controllers/base/load/` (new `baseModeHelp.ts`, the switch), `createNeighbourData.ts`, `getMessageTargets.ts`, map cell builders | S |
| WP3 | #370 | **Web: Friends screen.** `api/friends.ts` (whole contract), `friendsStore`, Friends/Requests/Find tabs, entry in the Account menu, badge counts, notification words. Can start at once against fixtures of 6.2. | contract (WP1 to go live) | `web/src/api/friends.ts`, `web/src/game/friends/`, `web/src/ui/friends/` (screen, tabs), `ui/AccountMenu.ts`, `ui/notifications/` | M |
| WP4 | #371 | **Web: friends bar.** Portraits, badges, paging, the card (Visit, Send gift, Friends list), phone button. | WP3 | `ui/friends/FriendsBar.ts`, `FriendCard.ts`, mount in `YardScene.ts`, `ui/yard/YardDock.ts` (phone button) | S-M |
| WP5 | #372 | **Web: visit mode.** `friend` view target, help-mode load, read-only yard, Home, "Helping {name}" line, refused-visit messages. | WP2, WP3 | `app/scenes/YardScene.ts`, `game/attack/attackTarget.ts` (view target), `api/base.ts` | S-M |
| WP6 | #373 | **Server: help engine.** `friend_help` table, `POST /bm/friends/help` (speed-up and repair), the two-save wrapper, gates, daily cap, reward, `hl` and its clearing, `help` block for the visit load, `help` field in the list, `friend` notifications. | WP1, WP2 | `server/src/services/friends/help*.ts`, `controllers/friends/help.ts`, `services/yard/` job start/end points, new migration | M |
| WP7 | #374 | **Web: helping in the visit.** Wrench markers, help panel (speed-up and repair), thank-you, counter, owner's yard refresh on a help notification. | WP5, WP6 | `ui/friends/HelpPanel.ts`, `game/friends/help*.ts`, yard render markers, small `YardScene.ts` hook | S-M |
| WP8 | #375 | **Gifts.** `friend_gift` table, send, list, collect (cap and clamp), lapse after 7 days, notification; Gifts tab with Collect, Collect all, Send one back; resource picker. | WP1, WP3 | `server/src/services/friends/gift*.ts`, `controllers/friends/gift*.ts`, new migration, `web/src/ui/friends/GiftsTab.ts`, `GiftPicker.ts` | M |
| WP9 | #376 | **Web: privacy and block.** Privacy part of Account settings (online, requests, blocked list with Unblock), Block button in mail threads, friend rows and search results. Can start at once against the contract. | contract (WP1 to go live) | `ui/AccountSettings.ts`, `ui/mail/MailboxScreen.ts` (thread menu), `ui/friends/BlockButton.ts` | S |
| WP10 | #377 | **Web: attack warning.** Confirm before attacking a friend at all three attack starts. | WP3 | `ui/friends/FriendAttackConfirm.ts`, `MapRoom1Scene.ts`, `MapRoom2Scene.ts`, `YardScene.ts` (one call each) | S |
| WP11 | #378 | **Web: Add-friend entry points.** Map Room 2 cell popup, Map Room 1 list, mailbox attack notices, Find suggestions (alliance mates). | WP3 | `ui/maproom/CellPanel.ts`, `ui/maproom1/MapRoom1Ui.ts`, `ui/mail/` notice view, `ui/friends/FindTab.ts` | S |

**Order (at most three at once):**

1. **Wave A:** WP1, WP3, WP9. (WP3 and WP9 build against the 6.2 contract and merge once WP1 is in.)
2. **Wave B:** WP2, WP4, WP8.
3. **Wave C:** WP5, WP6, WP11. (WP11 edits the mailbox after WP9 has merged.)
4. **Wave D:** WP7, WP10. (Both touch `YardScene.ts` with one small hook each; merge one, then the
   other.)

Every package ends with its tests (server database tests for routes and rules, web unit tests for
panels) and a short browser check in the shared session. A last end-to-end run with two accounts
(request, accept, visit, speed-up, repair, gift, block) closes the parent issue.

## 10. Owner questions (approved 2026-10-19)

Only the numbers and choices this document had to propose. The owner approved every proposal below
on 2026-10-19 (for Q4, the first option: heal to full at once).

| # | Question | Decision |
| --- | --- | --- |
| Q1 | Daily help cap per helper | **20** helps a day, speed-ups and repairs together |
| Q2 | When does "a day" turn over? | **00:00 UTC** for every daily limit |
| Q3 | Helper's reward per help | **0.25% of the lower of the two storage caps, in each of the four resources** (20 helps = at most 5% a day) |
| Q4 | What a friend's repair does | **Heals that building to full at once** (so once per damage, by one friend). Alternative: heals half the missing health, each friend once |
| Q5 | Gift size | **3% of the lower of the sender's and receiver's storage caps**, one resource the sender picks (Flash gave a random resource, 2-12% of the receiver's cap) |
| Q6 | Gifts a player can collect a day | **5** (more wait, up to 7 days) |
| Q7 | Anti-farm rule for gifts and help | **Friends for 24 hours, both accounts 3+ days old, both level 5+** |
| Q8 | The alliance member list does not exist in the web client yet | For now, **alliance mates appear as suggestions in Friends > Find**; an Add-friend button goes into the member list when that screen is built |
| Q9 | Friend request limits | **30 open requests, 30 new a day, lapse after 14 days, 7-day wait after a decline**; a decline is not shown to the sender |
| Q10 | Where help works | **Main yard only** (not outposts, not the Inferno) |
| Q11 | Where the friends bar shows | **Own yard only** (not the maps or the attack screen) |
| Q12 | How online status shows to friends | **Online / seen today / seen this week / away longer**, nothing when hidden |
