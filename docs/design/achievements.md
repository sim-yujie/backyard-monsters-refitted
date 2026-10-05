# Achievements — Design

A design document for issue #204: the 22 Flash achievements, counted on the server, an
achievements screen, an unlock pop-up, and a way for other players to see what someone has
earned. Planning only; no game code lands with this document.

All citations are `path:line` relative to the repository root. Claims about Flash cite
`client/scripts`; claims about the revamp cite `server/src` or `web/src`; anything new is marked
as a proposal. Numbers nobody has playtested are marked `[PLACEHOLDER]`.

Contents:

1. [Goals](#1-goals)
2. [The owner's decisions](#2-the-owners-decisions)
3. [What Flash had](#3-what-flash-had)
4. [What the revamp already has](#4-what-the-revamp-already-has)
5. [The 22 achievements](#5-the-22-achievements)
6. [Storage](#6-storage)
7. [Counting and unlocking](#7-counting-and-unlocking)
8. [Backfill for existing players](#8-backfill-for-existing-players)
9. [Routes](#9-routes)
10. [What the player sees](#10-what-the-player-sees)
11. [Safety](#11-safety)
12. [Testing](#12-testing)
13. [Work packages](#13-work-packages)
14. [Open questions](#14-open-questions)

---

## 1. Goals

- **Every Flash achievement has a home.** All 22 entries of Flash's list are in one catalogue on
  the server, with Flash's own numbers, so nothing is lost even where the feature behind one does
  not exist yet.
- **The server counts; the client only shows.** Every stat moves where the server itself changes
  the thing being counted, under the player's save lock. Nothing the client sends is believed.
- **A small reward.** Each achievement pays a little Shiny the moment it unlocks.
- **Seen by the player and by others.** A screen with progress, a pop-up when one unlocks, and a
  short read-only list other players can open from the map.
- **Existing players do not start from zero.** What their yard already proves is unlocked on
  first read.

## 2. The owner's decisions

Settled on 2026-10-05:

| # | Decision |
| --- | --- |
| D1 | Every stat is counted on the server, where it changes, as the issue says. The client is never trusted. (Answers the issue's Q1: counting and the screen ship together; there is no separate early-counting phase, and backfill covers the gap.) |
| D2 | **Reward:** a small Shiny amount per achievement, scaled by difficulty, roughly 5 to 25. The amounts in §5 are a proposal for the owner to approve (open question Q1). (Replaces the issue's Q4 default of "none".) |
| D3 | **Visible to others:** other players can see a player's achievements, for example from the map panel. Where exactly is proposed in §10.3. |
| D4 | **An unlock pop-up** in game. |
| D5 | Achievements tied to features the revamp does not have (Descent, Underhall, Inferno, alliances, Flash's blocked `hugerage`) are listed one by one, each either "shown but locked" or left out; recommendation in §5.3, open question Q2. |

Taken in this document as defaults, from the issue (owner may overrule):

| # | Default |
| --- | --- |
| D6 | `playeroutpost` is cumulative: +1 for every player outpost taken, never going down (issue Q2, as Flash, `client/scripts/BASE.as:2314`). |
| D7 | Flash's numbering is kept (1 to 22) as the stored id, so the record lines up with Flash's `stats.achievements` one to one. |

## 3. What Flash had

### 3.1 The list

`client/scripts/ACHIEVEMENTS.as:35-50` holds 23 entries; entry 0 is an empty placeholder marked
`block`, so the real achievements are 1 to 22. Each has `rules` (stat → target); entry 4 also has
`ANY: 1` ("any one rule is enough"); entry 9 is `block: true` (never awarded). The stats are
listed at `ACHIEVEMENTS.as:12-32`.

The client kept everything itself and saved it as `stats.achievements = { s: stats, c: completed }`
(`ACHIEVEMENTS.as:159-167`, `client/scripts/BASE.as:2632`). Newly finished ids went to the server
as `achieved` (`BASE.as:3210`), which the server only forwarded to Facebook. There was no in-game
screen and no reward.

### 3.2 Where Flash counted each stat

| Stat | Where | What moves it |
| --- | --- | --- |
| `thlevel` | `BUILDING14.as:137`, `:151`, `:177` | Town Hall built or upgraded: its level |
| `map2` | `BUILDING11.as:54`, `:286` | Map Room level 2 / joined Map Room 2 |
| `wmoutpost` | `BASE.as:2306` | First open of a taken-over wild monster camp |
| `playeroutpost` | `BASE.as:2314` | First open of a taken-over player outpost, +1 each |
| `monstersblended` | `BUILDING9.as:45-47` | Each monster walking into the Monster Juicer |
| `upgrade_champ1..3` | `CHAMPIONCAGE.as:597`, `:807`, `:852` | Gorgo / Drull / Fomor reaching level 6 |
| `heavytraps` | `BUILDING117.as:14` | A Heavy Trap finished building, +1 each |
| `blocksbuilt` | `BUILDING17.as:34` | A Block finished building, +1 each |
| `wm2hall` | `ATTACK.as:961-963` | A Kozu (tribe 2, `com/monsters/ai/TRIBES.as:58-59`) Town Hall destroyed in a wild monster attack |
| `starterkit` | `popup_prefab.as:272` | A Starter Kit bought |
| `alliance` | `BASE.as:819`, `com/monsters/alliances/ALLIANCES.as:553` | Being in an alliance |
| `stockpile` | `BASE.as:4725-4726` | Holding **more than** 25,000,000 of each of the four resources |
| `unlock_monster` | `CREATURELOCKER.as:75`, `:85`, `:911` | A Monster Locker unlock finishing |
| `hugerage` | `com/monsters/effects/ResourceBombs.as:318-319` | Firing the biggest Putty catapult bomb (`pu3`) |
| `DESCENT_LEVEL` | `ATTACK.as:975` | Inferno Descent level reached (`MAPROOM_DESCENT.as:24`: 14 levels) |
| `UNDERHALL_LEVEL` | `BUILDING14.as:138` | Town Hall level, meant for the Inferno yard |
| `INFERNO_QUESTS_COMPLETED` | `QUESTS.as:1652` | Inferno quests completed |

On load, Flash also filled gaps from its quest record: champion quests `UG1-3`, `WM2`, and
`QUESTS._global.monstersblended` (`ACHIEVEMENTS.as:62-77`, `BASE.as:1092-1110`).

### 3.3 Flash bugs we do not copy

- **"Any champion" only ever counted Gorgo.** The `ANY` loop sets `fail = true` on the first unmet
  rule and then `break`s on the next met one without clearing it (`ACHIEVEMENTS.as:118-131`). We
  implement what was meant: any one of the three.
- **Descent, Underhall and Inferno could never unlock.** The constants are `"descentLevel"`,
  `"underhallLevel"`, `"infernoQuestsCompleted"` (`ACHIEVEMENTS.as:5-9`), but the stats object and
  the rules use the keys `"DESCENT_LEVEL"` and so on (`:13-15`, `:47-50`). `Check` only writes a
  stat whose key exists (`:105-107`), so those stats stayed 0 forever.
- **The Locker back-check only looked at one monster.** A stray `break` ends the loop after `C2`
  (`CREATURELOCKER.as:82-87`).
- **Unlocks only counted in build mode** (`ACHIEVEMENTS.as:104`): irrelevant once the server
  counts.

## 4. What the revamp already has

- **Nothing that works for achievements.** `Save.achieved` is a jsonb column nothing reads
  (`server/src/database/models/save.model.ts:451`). Sandbox yards carry a `stats.achievements` blob
  (`server/src/utils/sandbox/overworldYard.ts`). No UI.
- **`save.stats` is client-writable.** It is in `Save.saveKeys` (`save.model.ts:475-479`), the list
  an owner `/base/save` writes. Owner saves are refused by default
  (`server/src/config/OwnerSaveConfig.ts:1-33`), but the switch can be turned back on, so nothing
  the server must trust can live there.
- **The precedent: `save.onboarding`.** A server-only jsonb column on the main save, not a
  frontend key, in neither save-key list, written only by yard actions and server counter hooks
  (`server/src/services/onboarding/state.ts:1-21`). It already holds counters that only server
  events move (`state.ts:101-115`): `juiced` (`server/src/services/goals/counters.ts:52-62`, called
  from `server/src/controllers/yard/juice.ts:19` and `bunker.ts:25`) and Map Room 1 tribes destroyed
  by the server's replay, Kozu included (`server/src/services/goals/tribeCounter.ts`, called from
  `server/src/services/maproom/v1/scaledMR1Tribes.ts:176`). The migration that added it is
  `server/src/database/migrations/20261002_AddOnboardingToSave.ts`.
- **One wrapper for every yard action.** `POST /bm/yard/<action>` locks the main row, catches the
  yard up, runs the route, applies Shiny, resources and slices, flushes and commits
  (`server/src/controllers/yard/yardAction.ts:38-66`, `runYardAction` at `:452`). Outpost actions
  lock the main row too. Building, upgrading, the Locker, the Juicer, champions and Starter Kits
  all go through it (`server/src/controllers/yard/index.ts:74-122`).
- **The catch-up says what finished.** `catchUpYard` returns `CompletedJob[]`
  (`server/src/services/yard/catchUp.ts:93-105`): `build`/`upgrade` jobs with the building type
  and level (`catchUpBuildings.ts:59-77`), `unlock` jobs (`catchUpLocker.ts:36-44`). It runs in
  every yard action and in the owner's `/base/load` (`server/src/controllers/base/load/baseLoad.ts:206-221`).
  Instant builds and upgrades do not go through it; they write `buildingdata` directly
  (`server/src/controllers/yard/instantUpgrade.ts`, `build.ts:62-64`).
- **Takeover knows camp from player.** `takeoverCell` locks the taker's main row; a cell whose save
  is `BaseType.TRIBE` is a wild camp, one with a `previousOwner` is a player's outpost
  (`server/src/controllers/maproom/v2/takeoverCell.ts:147-207`).
- **Attacks land on the server.** The replay's outcome is written to the defender in the
  `/base/save` attack branch (`server/src/controllers/base/save/baseSave.ts:424`) and, for an
  attack finished from its checkpoint, in `server/src/services/base/finaliseAttack.ts:285-298`.
  Auto-attack has its own route (`server/src/controllers/maproom/v2/autoAttack.ts:37`).
- **Shiny** is `credits` on the main save. A Shiny-locked account still collects rewards
  (`server/src/services/base/updateCredits.ts:12-14`, `:36-40`).
- **The bell.** One notification row per event (`server/src/services/notifications/notifications.ts`),
  kinds `jobs` and `away` (`server/src/database/models/notification.model.ts:5`).
- **Storage cap** = (10,000 + silos) × packing + 2,000,000 per outpost
  (`server/src/services/base/economy/resourceBudget.ts:338-350`); six level-10 silos give
  23,050,000, so `stockpile` needs at least one outpost or packing. Reachable, but late.
- **Other players on screen today:** the Map Room 2 cell panel (picture, name, level; empire value
  and alliance behind "More about this yard", `web/src/ui/maproom/CellPanel.ts:1-20`, `:308-313`,
  `:482`) and the Map Room 1 target card (`web/src/ui/maproom1/TargetCard.ts`; it has the
  `userid`, `web/src/game/maproom1/mr1Model.ts`). There is no web chat yet (#282) and no player
  profile.
- **Pop-ups:** the keyed notice line (`web/src/ui/maproom/Notices.ts`, used by the yard at
  `web/src/app/scenes/YardScene.ts:220`) and the bell. Panels follow the "door" pattern
  (`web/src/ui/mail/MailDoor.ts`) and yard plugins (`web/src/game/yard/plugins/goals.ts`).
- **Alliances** exist on the server (Flash-era routes, `server/src/app.routes.ts`, "Alliances"),
  but the web client has no way to create or join one. **Inferno, Descent and Underhall** are not
  in the web client at all.

## 5. The 22 achievements

### 5.1 The catalogue

Names and descriptions are proposals (Flash's titles lived on Facebook; the client has none).
"Counted by" says where the server moves the stat (§7). "Backfill" says what the first read can
prove (§8). Shiny is the proposed reward (open question Q1).

| # | Flash rule | Proposed name — description | Counted by | Backfill | Shown | Shiny |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `thlevel` ≥ 2 | **Moving Up** — Upgrade your Town Hall to level 2 | Derived: main-yard Town Hall level | Yes | Yes | 5 |
| 2 | `thlevel` ≥ 5 | **Town Planner** — Town Hall level 5 | Derived | Yes | Yes | 10 |
| 3 | `thlevel` ≥ 8 | **Backyard Boss** — Town Hall level 8 | Derived | Yes | Yes | 15 |
| 4 | any `upgrade_champ1..3` ≥ 1 | **Champion Trainer** — Fully evolve Gorgo, Drull or Fomor (level 6) | Derived: `save.champion`, G1-G3 at level 6, frozen ones included | Yes | Yes | 15 |
| 5 | all `upgrade_champ1..3` ≥ 1 | **Champion of Champions** — Fully evolve all three | Derived, as 4 | Yes | Yes | 25 |
| 6 | `map2` ≥ 1 | **Brave New World** — Upgrade your Map Room to level 2 and join the world map | Derived: Map Room level 2 or `mapversion` 2 | Yes | Yes | 10 |
| 7 | `wmoutpost` ≥ 1 | **Camp Crusher** — Take over a wild monster camp | Event: `takeoverCell`, target was a tribe | Approximate (§8) | Yes | 10 |
| 8 | `playeroutpost` ≥ 5 | **Empire Builder** — Take over 5 outposts from other players | Event: `takeoverCell`, target had an owner, +1 each | No (§8) | Yes | 20 |
| 9 | `hugerage` ≥ 1 (blocked) | **Huge Rage** — Fire the biggest Putty catapult bomb | Event: attack replay fires `pu3` | No | No (§5.3) | 10 |
| 10 | `wm2hall` ≥ 1 | **Kozu Crusher** — Destroy a Kozu Town Hall | Event: Map Room 1 Kozu tribe destroyed (`onboarding.counters.tribes.kozu`) or a Map Room 2 Kozu camp's Town Hall destroyed in an attack landing | Yes, from server-written tribe records | Yes | 10 |
| 11 | `monstersblended` ≥ 5000 | **Juice Master** — Juice 5,000 monsters | Event, already counted: `onboarding.counters.juiced` | Only what that counter holds | Yes | 20 |
| 12 | `blocksbuilt` ≥ 200 | **Great Wall** — Build 200 Blocks | Event: a Block (type 17) finishing its build, +1 each | Lower bound: Blocks standing now | Yes | 10 |
| 13 | `starterkit` ≥ 1 | **Instant Outpost** — Buy a Starter Kit | Event: `POST /bm/yard/starterkit` succeeds | No | Yes | 5 |
| 14 | `alliance` ≥ 1 | **Better Together** — Join an alliance | Derived: in an alliance | Yes | No (§5.3) | 5 |
| 15 | `stockpile` ≥ 1 | **Hoarder** — Hold more than 25,000,000 of each resource at once | Derived after every resource change: r1-r4 all > 25,000,000 | Yes | Yes | 25 |
| 16 | `heavytraps` ≥ 8 | **Trapper** — Build 8 Heavy Traps | Event: a Heavy Trap (type 117) finishing its build, +1 each | Lower bound: Heavy Traps standing now | Yes | 10 |
| 17 | `unlock_monster` ≥ 1 | **New Recruit** — Unlock a monster in the Monster Locker | Derived: any monster unlocked in `lockerdata` other than the free Pokey (`C1`, #218) | Yes | Yes | 5 |
| 18 | Descent level ≥ 1 | **Into the Depths** — Clear the first Descent level | Event, when Descent exists | — | No (§5.3) | 10 |
| 19 | Descent level ≥ 14 | **Rock Bottom** — Clear all 14 Descent levels | Event, when Descent exists | — | No | 25 |
| 20 | Underhall level ≥ 5 | **Hall of the Deep** — Upgrade the Underhall to level 5 (Flash's intent inferred from `BUILDING14.as:138`) | Derived, when Inferno exists | — | No | 15 |
| 21 | Inferno quests ≥ 10 | **Hellraiser** — Complete 10 Inferno quests | Event, when Inferno exists | — | No | 15 |
| 22 | `thlevel` ≥ 10 | **Top of the Heap** — Town Hall level 10 | Derived | Yes | Yes | 25 |

**Shown now: 16 achievements, 220 Shiny in total.** The six hidden ones add 80 more when their
features arrive (300 for all 22).

How the Shiny was scaled `[PLACEHOLDER]`: 5 for a first step anyone reaches in a day or two (Town
Hall 2, first unlock, a kit); 10 for a milestone of the middle game (Town Hall 5, Map Room 2, first
camp, Kozu, 200 Blocks, 8 Heavy Traps); 15 for a long build (Town Hall 8, one champion at level 6);
20 for a long grind (5,000 juiced, 5 player outposts); 25 for the end game (Town Hall 10, all three
champions, 25 million of everything).

### 5.2 Rules the catalogue encodes

- A rule is a list of `{ stat, target }` and a mode, `all` (the default) or `any` (entry 4 only).
  Unlocked when every (or any) stat is at or above its target. Stats never go down.
- An entry has `available: boolean`. An unavailable entry is never evaluated, never sent to a
  client, and never paid. Turning one on later is one line plus its counter.
- The catalogue is server-side data (`server/src/game-data/achievements.ts`, proposed) with each
  entry's Flash citation. The client gets names, descriptions and rewards from the routes (§9), as
  the Goals panel does, so there is no second copy in `web/`.

### 5.3 Achievements tied to missing features (open question Q2)

| # | Needs | Recommendation |
| --- | --- | --- |
| 9 `hugerage` | Nothing new: catapult bombs exist in web attacks | **Leave out.** Flash blocked it on purpose and never awarded it (`ACHIEVEMENTS.as:44-46`, `:115-117`). Easy to add later from the attack replay if the owner wants it. |
| 14 `alliance` | A web alliance screen (none planned) | **Leave out until alliances reach the web client.** Membership is state, so a later backfill unlocks it for everyone already in one. |
| 18, 19 Descent | Inferno Descent | **Leave out until it exists.** |
| 20 Underhall | Inferno yard | **Leave out until it exists.** |
| 21 Inferno quests | Inferno quests | **Leave out until it exists.** |

Why leave out rather than show locked: six greyed tiles nobody can ever earn make the screen read
as a third unfinished, and some may never come. Instead, one quiet line at the bottom of the screen:
"More achievements arrive with alliances and the Inferno." The alternative the owner may prefer:
a collapsed "Coming later" group at the bottom with the six greyed out and no progress.

## 6. Storage

**Proposal: a new server-only jsonb column `save.achievements` on the main save**, built like
`save.onboarding`. Flash's shape is kept inside it (`s` for stats, `c` for completed, Flash's
numbers and stat names), with what the server needs added:

```jsonc
{
  "v": 1,
  "s": {                       // Flash's stat names; every value only ever goes up
    "thlevel": 6, "map2": 1, "wmoutpost": 1, "playeroutpost": 2,
    "monstersblended": 812, "upgrade_champ1": 1, "upgrade_champ2": 0, "upgrade_champ3": 0,
    "heavytraps": 3, "wm2hall": 1, "blocksbuilt": 140, "starterkit": 0, "alliance": 0,
    "unlock_monster": 1, "stockpile": 0, "hugerage": 0,
    "descent": 0, "underhall": 0, "infernoquests": 0
  },
  "c": {                       // Flash's achievement numbers
    "1": { "at": 1791100000, "shiny": 5, "seen": 1 },
    "6": { "at": 1791200000, "shiny": 10, "backfill": 1 }
  },
  "backfilledAt": 1791100000   // absent until the first read has run (§8)
}
```

Why not Flash's own place, `stats.achievements`:

- **The client can write `stats`.** It is in `Save.saveKeys` (`save.model.ts:479`); a client could
  set its own achievements with one save whenever owner saves are allowed. A column in neither
  save-key list and not a frontend key cannot be written by any client
  (`services/onboarding/state.ts:10-15` makes the same argument).
- **Old blobs would be mistaken for real ones.** Sandbox yards and old Flash saves already carry a
  `stats.achievements`. A new column starts `NULL`, which plainly means "never worked out", and
  triggers the backfill (§8).
- **Unlock time, reward and "seen" need a place.** Flash's `c` was `id → 1`; we need when, how much
  was paid, and whether the pop-up was shown.

Why one column on the main save rather than a new table: every write already holds the main row's
lock (yard actions, takeover, the tribe counter), so the record changes in the same transaction as
the thing it counts and is never out of step. A table of unlock rows would make "who has
achievement X" a query, which nothing needs yet. `Save.achieved` and `stats.achievements` stay as
they are, unread; the `achieved` column can be dropped in a later clean-up.

Writers go through one helper (`updateAchievements(save, fn)`, proposed, like `updateOnboarding`)
so no writer loses a field another owns.

## 7. Counting and unlocking

### 7.1 Two kinds of stat

- **Derived stats** are read from what the server already holds whenever the record is evaluated:
  Town Hall level, Map Room 2, champion levels, Locker unlocks, the four resources, alliance
  membership, and the two counters `onboarding` already keeps (`juiced`, `tribes.kozu`). The stored
  value becomes `max(stored, derived)`, so a stat never drops (a recycled building, a juiced
  champion, spent resources take nothing back).
- **Event stats** cannot be read from the yard afterwards, so the event adds to `s` directly:
  `blocksbuilt`, `heavytraps`, `wmoutpost`, `playeroutpost`, `starterkit`, and the Map Room 2 half
  of `wm2hall`.

Reusing `onboarding.counters.juiced` and `tribes.kozu` avoids a second counter for the same event.
The evaluator reads them; it never writes `onboarding`.

### 7.2 Where evaluation runs

One pure function, `evaluateAchievements(record, view, now)` (proposed), takes the record and a
read-only view of the player's main save (plus the event deltas), folds in the derived stats,
unlocks every available entry now met and not yet in `c`, and returns the new record, the new
unlocks and the Shiny to credit. Callers persist it under the main-row lock:

| Where | What it adds | Lock already held |
| --- | --- | --- |
| Yard action wrapper, after the outcome is applied and before the flush (`yardAction.ts:452`, near `syncBaseValue` at `:252`) | Derived stats after any action; `blocksbuilt`/`heavytraps` from the catch-up's `build` jobs of type 17/117 and from an instant build of either; `starterkit` from the Starter Kit route's report | Main row (outposts too) |
| Owner `/base/load` catch-up (`baseLoad.ts:206-221`, `catchUpLockedYard` / `catchUpLockedOutpost`) | As the wrapper, from what the catch-up finished while away; the backfill (§8) | Main row |
| `takeoverCell` (`takeoverCell.ts:147-207`) | `wmoutpost` = 1 if the cell was a tribe; `playeroutpost` + 1 if it had a previous owner | Taker's main row |
| Attack landing: `/base/save` attack branch (`baseSave.ts:424`), `finaliseAttack.ts:298`, auto-attack | `wm2hall` = 1 when the defender is a Map Room 2 Kozu camp and its Town Hall ended destroyed | No: a short transaction that locks the attacker's main row, as `recordTribeDestroyed` does (`tribeCounter.ts`) |
| Map Room 1 tribe save (`scaledMR1Tribes.ts:176`) | Nothing new: `tribes.kozu` is already counted there. Evaluate in the same short transaction so the unlock is immediate | Attacker's main row, inside `recordTribeDestroyed` |
| The achievements state route (§9) | Derived stats; backfill | Main row (it is a yard action) |

Counting builds from the catch-up's `build` jobs rather than comparing Block counts before and after
is deliberate: a Block put into the Yard Planner's storage and placed again is not a new build.
Any other route that creates a finished Block or Heavy Trap must add to the count too; the WP
checks the Yard Planner and the guided start. Starter Kit buildings count only if they finish a
build countdown, as in Flash: a building placed already finished is set up without `Constructed`
(`popup_prefab.as:266`, `BFOUNDATION.as:3032`), while a countdown that ends calls it
(`BFOUNDATION.as:1382-1385`).

### 7.3 On unlock

In the same transaction as the event:

1. `c[id] = { at: now, shiny }`.
2. Credit `shiny` to the main save's `credits` (a Shiny-locked account collects it too, as quest
   rewards are, `updateCredits.ts:12-14`).
3. Write one bell notification, new kind `achievement`, naming it and the Shiny.

The client learns of it in the answer (§9.3) and shows the pop-up (§10.2). `seen` is set when the
client says it showed it, so an unlock that happens while the player is not looking (an attack
finished from its checkpoint) still pops up next time.

## 8. Backfill for existing players

When the record is `NULL` (every save today), the first evaluation under the main-row lock works out
what the save already proves, then sets `backfilledAt`. Only what the server itself wrote counts.

| Achievement | Backfill source | Quality |
| --- | --- | --- |
| 1, 2, 3, 22 Town Hall | Main-yard Town Hall level | Exact |
| 4, 5 champions | `save.champion`, G1-G3 at level 6, frozen included | Exact for champions still owned; one juiced away is lost |
| 6 Map Room 2 | Map Room level 2 or `mapversion` 2 | Exact |
| 7 wild camp | Owns at least one outpost now | Approximate: an outpost taken from a player also counts; most first outposts are camps |
| 8 player outposts | None | Not backfilled: the only trace is the previous owner's "outpost taken" mail (`services/maproom/v2/outpostNotices.ts:140-160`), which names the taker only in its text and can be deleted |
| 10 Kozu | `tribes.kozu`, plus any of the player's Map Room 1 Kozu tribe records still marked `destroyed` (server-written, `scaledMR1Tribes.ts:120`) | Partial: a tribe that has respawned is unmarked again (`mr1TribeRules.ts:104`); Map Room 2 camps only from launch |
| 11 juiced | `onboarding.counters.juiced` | Only juicing since #227 (2026-10-02) |
| 12 Blocks, 16 Heavy Traps | Blocks / Heavy Traps standing now, main yard and outposts | Lower bound (recycled and fired ones are not known) |
| 13 Starter Kit | None: nothing records a kit | Not backfilled |
| 15 stockpile | Resources now | Exact |
| 17 Locker | `lockerdata` | Exact |

**Not used:** Flash-era blobs the old client wrote itself (`stats.achievements`, `quests` with its
`UG1-3`, `WM2` and `monstersblended`, `wmstatus`). D1 says the client is never trusted, and these
could have been edited. (Open question Q5 in case the owner wants them.)

**Do backfilled achievements pay?** Proposed: yes, they unlock with their Shiny, and the first
pop-up is one summary ("You've earned 6 achievements: +55 Shiny") rather than six. The Goals
baseline chose the opposite (claimed, no reward), but Goals are tutorial steps; achievements are a
record of what the player did. Open question Q4.

**Bots and anyone else never loaded** (bot neighbours, #233; seeded Map Room 2 players) keep a
`NULL` record. The public view (§9.2) works the same backfill out read-only for them, so a bot shows
the badges its yard implies, like any player, and nothing is written.

## 9. Routes

### 9.1 The player's own

Following the Goals routes (`web/src/api/goals.ts:10-13`), both are yard actions, so they get the
lock, the catch-up and the backfill for free:

- `POST /api/:apiVersion/bm/yard/achievements/state` → `{ achievements: AchievementView[], earned,
  total, shinyEarned, fresh: UnlockView[] }`. Each view: `id`, `name`, `description`, `shiny`,
  `status` (`locked` | `earned`), `at` when earned, `progress` (`{ value, target }`, or for entry 5
  one per champion).
- `POST /api/:apiVersion/bm/yard/achievements/seen` body `{ ids: number[] }` → marks those `seen`.
  Ids not earned are ignored.

### 9.2 Someone else's

- `GET /api/:apiVersion/bm/achievements/player/:userid` (verifyUserAuth, a rate limiter like
  `publicReadLimiter`) → `{ userid, name, earned, total, achievements: [{ id, name, description,
  status, at? }] }`. **No progress numbers, no Shiny**: only what is earned and when. Read-only:
  a `NULL` record is worked out on the fly and not stored (§8). A banned or unknown user is `404`.

### 9.3 Unlocks in other answers

Every answer that already reads the main row carries `achievements: UnlockView[]` when something is
earned and not yet seen: yard action answers (next to `completed` and `notifications`), the owner's
`/base/load`, and `takeoverCell`. `UnlockView = { id, name, shiny, backfill? }`. The client shows the
pop-up and calls `seen`. Unlocks with no live answer (attack landings) arrive in the next one.

`docs/server-api.md` gains all of the above.

## 10. What the player sees

### 10.1 The achievements screen

- **Where it opens:** an "Achievements" item in the account menu, which every screen with the HUD
  has (`web/src/ui/AccountMenu.ts`), and the pop-up's "View" button. No new HUD button, to keep the
  bar clear. (A trophy button beside Mail and the bell in the yard is the alternative.)
- **Layout:** a docked panel like the mailbox (`web/src/ui/mail/MailDoor.ts` pattern). Header:
  "7 of 16 earned · 85 Shiny earned". Two groups, **To do** (closest to done first) and **Earned**
  (newest first). Each row: badge, name, description, a progress bar with "Town Hall 4 / 5", and
  either "+10 Shiny" or "Earned 3 Oct 2026". Footer line from §5.3.
- **Phone:** full-height sheet, same rows.

### 10.2 The unlock pop-up

- A card that slides up at the bottom centre: badge, "Achievement earned!", the name, "+10 Shiny",
  and **View**. It stays 6 seconds `[PLACEHOLDER]`, then goes; several queue one after another; the
  backfill's are one summary card.
- **Not during the guided start.** Unlocks while Bob's tutorial is running (Town Hall 2 is likely)
  wait until it ends, so the pop-up never covers a tutorial step.
- Not during an attack; it shows on the next screen that gets an answer.
- The Shiny readout in the HUD updates from the same answer.
- The bell keeps a line for each ("Achievement earned: Town Planner, +10 Shiny"), worded in
  `web/src/ui/notifications/NotificationPanel.ts`.

### 10.3 Other players' achievements (proposal for D3)

| Place | What | Why |
| --- | --- | --- |
| Map Room 2 cell panel, another player's yard or outpost | A line "Achievements 7 / 16" with a few newest badges, inside "More about this yard" (`CellPanel.ts:308-313`, beside empire value and alliance); tapping opens the read-only list | The panel is already where a player sizes someone up; keeping it behind "More" respects #174's slimming |
| Map Room 1 target card, a player neighbour | The same line under the name and level | Same reason; the card has the `userid` |
| Later: chat (#282) | Tap a name → a small profile card with the same line | Comes with chat; not in this plan |

The read-only list is the same screen without progress or Shiny, titled "Name's achievements".
Wild monster camps and tribes show nothing. The line is fetched when the panel opens (§9.2), not
added to the Map Room 2 area answer, which covers many cells at once.

### 10.4 Art

Sixteen badges, one per shown achievement, made with Gemini as the art plan says. Until then a
placeholder trophy in three tiers by reward (5: bronze, 10-15: silver, 20-25: gold), drawn in CSS
so the screen ships without waiting.

## 11. Safety

- **No client path writes the record**: not a frontend key, in neither save-key list; a test
  proves `/base/save` cannot set it, as for `onboarding`.
- **Derived stats trust the yard as the server holds it.** That is sound while owner saves are
  refused (`OWNER_SAVE_MODE=refuse`, the default). If that switch is ever set to `allow`, a forged
  yard could earn derived achievements; the WP adds that line to the switch's comment.
- **Paying twice is impossible**: an id in `c` is never paid again, and every write holds the main
  row's lock.
- **Event counts are bounded by real events**: each takeover, build finish and attack landing is
  one server event the server already guards against replays.
- **Privacy**: the public route shows only earned achievements and dates.
- **Bots** are not told apart: they show what their yard implies, never a tell-tale empty list.

## 12. Testing

- **Evaluator (pure):** every entry at target − 1 and target; `any` vs `all`; stats never drop;
  unavailable entries never unlock; a second run unlocks nothing; Shiny sum.
- **Backfill (pure):** each row of §8 from a fixture save; a fresh account unlocks nothing; Flash
  blobs ignored even when they claim everything.
- **Hooks (server, DB tests):** a Block and a Heavy Trap finishing through the catch-up, an instant
  build, the Yard Planner storage round trip not counting; a Starter Kit; a camp takeover and a
  player-outpost takeover; a Map Room 2 Kozu camp attack through both landings; Map Room 1 Kozu
  through `recordTribeDestroyed`; juicing; a champion reaching 6; a Locker unlock; resources passing
  25 million. Each: credits once, one bell row, the unlock in the answer.
- **Routes:** state, seen, public view (no progress, read-only for `NULL`, `404`), rate limit, and
  `/base/save` unable to write the column.
- **Web (vitest):** the screen's grouping, progress text and footer; the pop-up queue, summary card,
  hold-back during the guided start, `seen` call; the cell panel and target card lines.

## 13. Work packages

Each is sized for one agent (S < 2 days, M < 1 week).

| WP | Work | Depends on | Size |
| --- | --- | --- | --- |
| WP0 (#290) | **Catalogue and storage.** Migration adding `save.achievements jsonb NULL`; the entity property (server-only, not a frontend key, in neither save-key list); `services/achievements/state.ts` reader/normaliser and `updateAchievements`; `game-data/achievements.ts` with all 22, Flash citations, names, Shiny, `available`. Tests: reader, `/base/save` cannot write it. | — | S |
| WP1 (#291) | **Evaluator and backfill (pure).** `deriveStats(view)`, `evaluateAchievements(record, view, now)`, `backfillAchievements(view)` per §7.1, §7.2, §8, with the pure tests in §12. | WP0 | M |
| WP2 (#292) | **Yard wiring.** Evaluate in the yard action wrapper and the owner `/base/load` catch-up; Block and Heavy Trap build counts from `build` jobs and instant builds (and any other route that finishes one); Starter Kit; Shiny credit; bell kind `achievement` (model, service); `achievements` in yard and load answers. DB tests. | WP1 | M |
| WP3 (#293) | **Map and attack events.** `takeoverCell` (camp vs player); Map Room 2 Kozu Town Hall in both attack landings and auto-attack via a short locked-transaction helper; evaluation inside `recordTribeDestroyed`; `achievements` in the takeover answer. DB tests. | WP2 | S-M |
| WP4 (#294) | **Routes.** `bm/yard/achievements/state`, `bm/yard/achievements/seen`, `GET bm/achievements/player/:userid` with rate limiter and read-only backfill; `docs/server-api.md`. | WP2 | S |
| WP5 (#295) | **Web: achievements screen.** `web/src/api/achievements.ts`; `AchievementsDoor` + screen per §10.1; account-menu item on every HUD screen; read-only mode for another player. vitest. | WP4 | M |
| WP6 (#296) | **Web: unlock pop-up.** Card and queue per §10.2; reads `achievements` from yard, load and takeover answers; calls `seen`; holds back during the guided start; bell wording; Shiny readout. vitest. | WP4 (View button needs WP5) | S |
| WP7 (#297) | **Web: other players.** Line and newest badges in the Map Room 2 cell panel's "More about this yard" and the Map Room 1 target card; opens WP5's read-only screen. vitest. | WP5 | S |
| WP8 (#298) | **Badge art.** Sixteen badges via Gemini (owner's art pipeline), swapped in for the CSS tiers. | — | S |
| WP9 (#299, backlog) | **The six hidden achievements.** Turn each on when its feature lands: alliance (with a web alliance screen), Descent ×2, Underhall, Inferno quests, and `hugerage` if the owner wants it. | Those features | S each |

Order: WP0 and WP8 can start at once; then WP1; then WP2; then WP3 and WP4 side by side; then WP5
and WP6; then WP7. Nothing is visible to players until WP5 and WP6, but WP2-WP4 already pay Shiny
and write bell lines when they merge. If the owner wants nothing paid before the screen exists,
WP2 puts the Shiny credit and the bell line behind a switch that WP6 turns on.

**As built (WP2):** the switch is `ACHIEVEMENT_REWARDS` (`server/src/config/AchievementConfig.ts`),
off unless set to `on`. Counting and unlocking run either way; while it is off an unlock is stored
`unpaid` (no Shiny, no bell line, not in any answer), and the first evaluation with it on pays every
`unpaid` unlock once. Bell rows are kind `achievement`: the backfill's unlocks share one row, every
other unlock has its own.

**As built (WP3):** `takeoverCell` evaluates on the taker's locked main row before the new outpost
joins their list (so a first-ever backfill does not take it for one they already had): a cell
that was `BaseType.TRIBE` adds `wmoutpost`, one with a previous owner `playeroutpost` + 1; the
answer carries `achievements`. Attack landings call `recordAttackAchievements`
(`server/src/services/achievements/events.ts`) once the landing is written: `wm2hall` = 1 when the
defender is a Map Room 2 Kozu camp (`type` tribe, `wmid` 11) whose Town Hall was standing when the
attack began and is at 0 health in the battle's result, recorded through `recordAchievementEvents`,
a short transaction that locks the attacker's main row. It runs in the `/base/save` attack branch
(the save that ends the attack) and in the finaliser, which auto-attack lands through; a failure is
logged and never fails the landed attack. `recordTribeDestroyed` evaluates in its own transaction.

**As built (WP4):** `progress` is `{ value, target, parts? }`: `value` capped at `target` and full
once earned; entries 4 and 5 count champions met and list each in `parts`. The state list is built
after the wrapper's evaluation (`YardAction.reportAfterAchievements`), so a first read answers with
its backfill. While rewards are off an owed unlock reads `locked` in both the player's own list and
the public one. Both yard routes work on an outpost. The public route's limiter is 30 a minute per
user.

## 14. Open questions

| # | Question | Recommendation |
| --- | --- | --- |
| Q1 | Approve the Shiny per achievement (§5.1): 5 for first steps, 10 middle game, 15 long builds, 20 long grinds, 25 end game; 220 for the 16 shown now. | As in the table. |
| Q2 | The six achievements whose feature is missing (`hugerage`, alliance, Descent ×2, Underhall, Inferno quests): leave out, or show greyed as "coming later"? | Leave out, with one footer line; add each when its feature lands. `hugerage` stays out (Flash never awarded it). |
| Q3 | Where other players see achievements: Map Room 2 cell panel ("More about this yard") and Map Room 1 target card, later chat names. | As proposed. |
| Q4 | Do achievements the first read finds (backfill) pay their Shiny? | Yes, with one summary pop-up. |
| Q5 | Ignore the old Flash client's own records (its juiced count, champion quests) in the backfill? | Yes: the client wrote them, so they are not trusted. |
| Q6 | Approve the proposed names and descriptions (§5.1). | As in the table; any can change. |
