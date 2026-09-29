# Yard Buildings — Design and Work Plan

How every Map Room 2 main-yard building becomes usable in the web client: what the player sees,
which server routes do the work, what changes in the save, and the work packages (WPs) that build
it, each sized for one agent.

Citations are `path:line` from the repository root. Flash facts cite `client/scripts/`; rules
already written down cite the specs (`docs/specs/base-building.md` = BB, `monsters-and-hatchery.md`
= MH, `combat.md` = CB, `maproom2.md` = MR2). Where this plan proposes something new it says so.

Contents:

1. [Decisions](#1-decisions)
2. [How it works](#2-how-it-works)
3. [Phase 1 — Foundation](#3-phase-1--foundation)
4. [Phase 2 — Monster chain](#4-phase-2--monster-chain)
5. [Phase 3 — Economy](#5-phase-3--economy)
6. [Phase 4 — Academy and Lab](#6-phase-4--academy-and-lab)
7. [Phase 5 — Bunker, champions, Juicer](#7-phase-5--bunker-champions-juicer)
8. [Phase 6 — Baiter, shop, decorations](#8-phase-6--baiter-shop-decorations)
9. [Spec gaps resolved](#9-spec-gaps-resolved)
10. [Known limitations and open questions](#10-known-limitations-and-open-questions)
11. [GitHub issues to file](#11-github-issues-to-file)

---

## 1. Decisions

Owner decisions, binding (2026-09-27). "Where" names the section that applies each one.

| # | Decision | Where |
| --- | --- | --- |
| D1 | No Flash client any more, no compatibility requirement. Keep existing save fields where cheap so current accounts load; change a format when a feature needs it, and say how old saves migrate. | §2.5 |
| D2 | Every yard action is server-authoritative: a route loads the save, advances timers, checks rules, charges, writes once, returns the new state. The web client never sends a whole-yard save. (Technical default chosen by the orchestrator.) | §2.1 |
| D3 | Shiny speed-ups, instant buys and overdrives stay, priced as the original. Shiny only comes from in-game sources (mushrooms, rewards). No real-money store. Prices are computed on the server, never taken from the client. | §2.6 |
| D4 | One "Monsters" screen with tabs (Unlock = Locker, Hatch = Hatchery/HCC, Housing, Train = Academy, Lab), openable from the HUD; clicking one of those buildings opens its tab. Other buildings get actions in the building panel. | §4.1 |
| D5 | Build order: Phase 1 foundation → Phase 2 monster chain → Phase 3 economy → Phase 4 Academy then Lab → Phase 5 Bunker, Champion Cage and Chamber, Juicer → Phase 6 Baiter simulator, General Store shop, decoration inventory. | §3–§8 |
| D6 | Hatchery queue: keep the original per-hatchery queues, `(level + 1) × 20`. The Hatchery Control Centre replaces them with one shared queue as in the original. | §4.4 |
| D7 | Locker: one unlock at a time, as original. Re-enable Vorg (C16), Slimeattikus (C17, with its split child C18) and Rezghul (C19). | §4.3, §4.8 |
| D8 | Hatchery production continues while the player is away: the server catches up production on load (and before attacks and map reads that need the army), stopping when housing is full. | §2.3 |
| D9 | Hatchery add control = the attack Army panel controls (tap a monster, number box, hold-to-repeat +/−, Fill to what housing/queue/goo allow; since #169 (owner, 2026-09-28) Fill ignores housing, as the original did); one server request per batch. | §4.4 |
| D10 | Juicer: keep. The goo rate is looked up in the Flash code. | §7.3 |
| D11 | Bunker: keep the Map Room 2 rule (monsters put in are consumed, cannot return). Champion hunger: keep original (23 h + 24 h grace, loses a feed). | §7 |
| D12 | Harvesters: one "Collect all" HUD button; tapping a single harvester banks just that one. | §5.1 |
| D13 | New walls and traps finish instantly with no worker (as the planner batch routes do). | §5.3 |
| D14 | Mushrooms: as original (worker, 1 in 4 golden gives 3 or 8 Shiny, respawn). Reward decided on the server. | §5.6 |
| D15 | General Store becomes an in-game Shiny shop for the kept items. Radio is dropped. | §5.7, §8.2 |
| D16 | Map Room building level = map version (L2 = Map Room 2, L3 = Map Room 3). Cap the building at L2. Map Room 1 (below Town Hall 6) is a later separate project; keep the TH6 gate. | §5.7, §10 |
| D17 | Korath (G4) stays unavailable. Krallen unchanged (event reward). | §7.4 |
| D18 | Wild Monster Baiter becomes the defence simulator and keeps its 7 levels. | §8.1 |
| D19 | Inferno (Ascend to Inferno, Inferno buildings) out of scope: hide entry points. | §4.5, §5.3 |
| D20 | Tower range/damage per level shown in the building panel; extend the cost-table generator to carry them. | §3.1, §10 Q1 |
| D21 | Out of scope: Facebook/social features, subscriptions, events, real-money payments. | — |
| D22 | Wherever an amount or cost appears, show the resource **icon** with the number instead of the words Twigs/Pebbles/Putty/Goo/Shiny (issue #93, a shared "icon + amount" helper under `web/src/ui/`). Every new screen in this plan uses that helper. The HUD also gets exact amounts on hover and a change float (issue #92). | §3.1, all screens |

Technical defaults this plan adds (not owner decisions; listed so they can be overruled):

| # | Default | Reason |
| --- | --- | --- |
| T1 | Owner `/base/save` on a main yard is refused once Phase 1 lands; attack saves are unchanged. | D1 + D2: nothing legitimate sends it, and it can overwrite `storedata` wholesale (inventory §0 hole 1). |
| T2 | Building countdowns keep their relative `cB`/`cU`/`cF` + `savetime` format; monster timers keep their absolute formats. | D1 "keep where cheap": both already work, the server already advances the relative ones (`server/src/services/base/advanceBuildingTimers.ts:42-91`). |
| T3 | Every refund and every credit (bank, juice, refund) is clamped to the storage cap; charges are not. | Original `BASE.Fund` clamps unless forced (`client/scripts/BASE.as:4494-4536`). |
| T4 | Yard actions are serialised per player: the client sends one action at a time, and the server takes a row lock. | Two quick clicks must not both read the same save and overwrite each other. |
| T5 | The server awards points when it completes a job. | Closes the gap `docs/design/planner-upgrades.md` §3.5 records. |

---

## 2. How it works

### 2.1 The action-route model

Today three routes already work this way (`/bm/yardplanner/apply`, `walls/upgrade`,
`traps/rearm`; `server/src/app.routes.ts:176-181`): a pure service that reads a slice of the save
and returns a plan or throws, and a thin controller that advances timers, applies the plan, debits,
moves `savetime` and flushes once (`server/src/controllers/yardplanner/upgradeWalls.ts:38-77`).
This plan generalises that into one wrapper and many small routes.

**Namespace.** New routes live under `POST /api/:apiVersion/bm/yard/<action>`. The planner routes
stay where they are.

**The wrapper**, `yardRoute(handler)` in `server/src/controllers/yard/yardRoute.ts`, runs every
action the same way:

1. Authenticated user; load `user.save` inside `em.transactional` with a pessimistic write lock on
   the row (T4). Refuse 409 `notMainYard` if the save is not the player's main yard, 409
   `underAttack` if `isAttackActive` says the yard is being attacked
   (`server/src/services/base/isAttackActive.ts`).
2. `now = getCurrentDateTime()`; `catchUpYard(save, now)` (§2.3). This completes every finished
   job, produces offline output, and returns a list of what completed.
3. Parse the body with the route's zod schema (400 on malformed input, as the planner routes do).
4. Call the route's pure service with the caught-up save. It returns the new slices and a report,
   or throws a `ClientSafeError`.
5. Apply the slices, debit resources, debit shiny, set `save.savetime = now`, flush once.
6. Respond `{ error: 0, ...yardState(save), completed, report }`.

**Errors** keep the planner's flat shape (`server/src/controllers/yardplanner/layoutRoute.ts:14-24`):
`{ error: "<message>", reason: "<key>", ...detail }` with the real HTTP status. 400 = the client
sent something malformed (bad id, bad type, count ≤ 0). 409 = the yard refuses right now, with one
`reason` key: `busy`, `damaged`, `townHall {have, need}`, `requirements [[type,count,level]]`,
`shortfall {r1..r4}`, `credits {have, need}`, `shinyLocked`, `workers {total, busy}`, `maxLevel`,
`locked`, `capacity`, and the per-feature keys listed with each route. Single-target actions refuse;
batch actions (hatch N, collect all, repair all) do what they can and report the rest, as Apply does
(`docs/design/planner-upgrades.md` §3.2).

**The state payload.** `yardState(save)` returns the slices the client draws from, with the same
names `/base/load` uses so the client can merge them into its `BaseLoadResponse` the way
`YardScene` already does after Apply (`web/src/app/scenes/YardScene.ts:852-862`):

```ts
{
  savetime, currenttime,
  resources, credits, caps: { r1, r2, r3, r4 },      // services/base/economy/resourceBudget.ts:369
  workers: { total, busy },                           // services/yardplanner/workers.ts:65-93
  buildingdata, buildinghealthdata, storedata,
  monsters, lockerdata, academy, champion, mushrooms, researchdata,
}
```

`completed` lists the jobs `catchUpYard` finished during this request (`{kind, id, t, detail}`), so
the client can show "Cannon Tower reached level 5" even when the finish happened on the server.

**The client side.** `web/src/game/yard/YardStore.ts` (new) holds the merged save, applies every
response, and runs actions through a one-at-a-time queue: a second click while a request is in
flight waits for the first answer, then re-checks its own preconditions against the new state.
Buttons are disabled while their own request runs. The store emits `changed` so the scene, the HUD,
the building panel and the Monsters screen redraw from one source.

**Shiny lock.** Accounts can lock Shiny spending (`server/src/services/user/shinyLock.ts`, used at
`server/src/services/base/updateCredits.ts:42-44`). Every route that spends Shiny refuses 409
`shinyLocked` for such an account; rewards still arrive.

### 2.2 The job model

Every timer in the yard is one of the jobs below. The table fixes, for each, where it is stored,
which clock it uses, and what completing it does. Completion is always done by the server in
`catchUpYard`; the client only predicts it for display (§2.4).

| Job | Stored in | Clock | On completion | Worker |
| --- | --- | --- | --- | --- |
| Build | `buildingdata[id].cB` (+ `prefab`, + `cL` once a server route starts builds) | seconds left at `savetime` | level 1 (or `prefab`); points `pointsForBuild` (`server/src/services/yardplanner/costs.ts:228`) | yes, except walls and traps (D13) |
| Upgrade | `cU` (+ `cL`, the job's length) | seconds left at `savetime` | level + 1, health full, points `pointsForUpgrade` (`costs.ts:215`); `cL` removed | yes |
| Repair | `rE` flag, `hp`, `buildinghealthdata` | heal rate from `savetime` | full health, entries removed | no |
| Harvester cycle | `st` buffer, `cP` (and `pr`) | seconds from `savetime` | buffer grows to `capacity` | no |
| Locker unlock | `lockerdata[id] = {t:1, s, e}` | absolute `e` | `t: 2`, `s`/`e` deleted, `academy[id] ??= {level: 1}` | no |
| Academy training | `academy[id].time`, `.duration`; academy building `upg` | absolute `time` | `level + 1`, `time`/`duration`/`upg` cleared | no |
| Lab research | lab building `upg`, `upt`, `upl` | absolute `upt` | `academy[upg].powerup = upl`, fields cleared | no |
| Hatchery production | `monsters.h`, `hid`, `hstage`, `hcc`, `saved` | seconds from `monsters.saved` | `housed[id] + 1`, next monster starts | no |
| Champion hunger | `champion[i].ft` | absolute while active, relative while frozen | starvation: one feed lost (or one food-bonus rank at level 6) | no |
| Mushroom respawn | `mushrooms.s` (last spawn) | absolute | new mushroom, 10 cap | no |
| Store buffs (BST, EXH, HOD*, CLOD, POD, protection) | `storedata[item].e` | absolute | expire (`clearExpiredStoreItems`) | no |

Relative building countdowns stay (T2). Everything the server writes uses the same convention the
old client read, so an old save and a new write are the same shape.

A build or upgrade the server starts also stores its length, `cL` (seconds, after Sharper Tools),
because the countdown alone cannot say how long the job was once Sharper Tools has shortened it
(#136). The catch-up and speed-ups leave `cL` alone; completion (`advanceBuildingTimers`) and
Cancel remove it. The client's progress (`countdownProgress`, `web/src/game/yard/jobs.ts`) is
`1 − remaining / cL`, falling back to the cost table's step time when `cL` is absent. The name is
not `cT` because `BEXPIRABLE` already stores its create time there
(`client/scripts/BEXPIRABLE.as:32`).

### 2.3 Offline catch-up

`catchUpYard(save, now)` in `server/src/services/yard/catchUp.ts` is one pure function (no DB, no
clock) that advances a main-yard save from `savetime` to `now`, clamped to 30 days like the original
load replay (BB §1 "Load and replay"; `advanceBuildingTimers.ts:37`). It is built in steps across
the phases; each step is its own module so WPs do not collide:

| Step | Module | Phase | What it does |
| --- | --- | --- | --- |
| 1 | `catchUpBuildings.ts` | 1 | `advanceBuildingTimers` plus points for each completion, the completed-job list, and `syncDerivedLevels` (§3.3). Store buffs past `e` expire. |
| 2 | `catchUpMonsters.ts` | 2 | Locker completion (with CLOD), HCC completion side effect, hatchery production into housing, housing overflow cull. |
| 3 | `catchUpHarvesters.ts`, `catchUpRepairs.ts`, `catchUpMushrooms.ts` | 3 | Harvester buffers grow; repairs heal; mushrooms respawn. |
| 4 | `catchUpTraining.ts` | 4 | Academy and Lab completion. |
| 5 | `catchUpChampions.ts` | 5 | Starvation. |

`catchUp.ts` itself only calls the step modules in order, so each WP that adds a step adds one
line there and owns its own module.

**Order inside one catch-up.** Buildings first, because a completed Housing upgrade changes the
space the hatcheries fill, and a finished hatchery build starts producing. Where a building
countdown ends inside the elapsed window, steps 2 and 3 split the window at that moment (production
before at the old level, after at the new level) rather than pretending the whole gap ran at one
level. Only building completions split the window; other jobs are independent.

**Where it runs.**

| Caller | What is caught up | Written? |
| --- | --- | --- |
| Every `/bm/yard/*` action (§2.1) | the caller's main yard | yes, in the same flush |
| `/base/load` in build mode, owner of the base (`server/src/controllers/base/load/baseLoad.ts`) | the caller's main yard | yes, one flush before responding, skipped while the yard is under attack |
| `POST /bm/yard/state` (§3.2) | the caller's main yard | yes |
| Attack entry, `baseModeAttack` (Phase 2) | the defender's yard, and each of the attacker's own yards whose monsters are in the attack roster | yes, before the attack session starts |
| Map cell reads for the viewer's own cells (`server/src/controllers/maproom/v2/cells/userCell.ts`) (Phase 2) | `m`, the monster blob, in memory only | no — map reads are frequent; the next write catches up for real from the same snapshot, so the numbers agree |
| `POST /worldmapv2/transferassets` (Phase 2) | both yards, before the transfer rules run | yes |

**Guarantees.** Catch-up is idempotent: running it twice at the same `now` changes nothing the
second time. It never charges anything. Credits it produces (refunds from an HCC completion) are
clamped to the cap (T3).

### 2.4 Timers on the client

The client keeps a 1 Hz tick (`YardScene.ts:378-381` already drives the panel countdown). Each tick
the `YardStore` checks every job's end time (`countdownOf`, `web/src/game/yard/yardModel.ts:187-200`,
extended with the monster jobs). When one reaches zero:

1. The display flips at once (the building redraws at the new level, the worker counter frees one,
   the locker tab shows the monster unlocked).
2. The store schedules one `POST /bm/yard/state` 1 second later, coalescing every job that finishes
   in that second, and replaces its state with the answer.
3. A notice is shown from the server's `completed` list (§3.1 "Notices").

The store also calls `state` when the tab becomes visible again (`visibilitychange`), so a player
returning after hours sees the server's catch-up, not a stale prediction.

On the player's own yard every running build or upgrade also shows a small progress bar with the
time left just above the building (#139, `web/src/game/yard/YardJobBars.ts`), redrawn once a second
from the same `countdownProgress` the building panel uses and rebuilt on every store change, so it
goes when the job finishes. At small zoom the time text is hidden and the bar kept. Visits and
attacks draw none.

### 2.5 Save format changes and migration

Everything not listed keeps its current shape.

| Field | Change | Migration of existing saves |
| --- | --- | --- |
| `save.flinger`, `save.catapult` | Recomputed from the buildings on every catch-up (§3.3). | Fixed the first time the account loads. |
| `buildingdata[hatchery].rPS/rCP/rIP/mq`, `[hcc].mq` | No longer read; `monsters.h/hid/hstage/hcc` is canonical (§9 item 6). The server deletes these keys when it writes a hatchery. | Lazy: dropped on the next write. |
| `monsters.saved`, `space`, `hcount`, `finishtime` | Written by the server on every catch-up (`saved = now`; `space` = derived capacity; `finishtime` = first busy worker's end). The map reads them (MH §10). | Next write. |
| `academy[id].time` | Always absolute. The original accepted ≤ 583,200 as relative (`client/scripts/com/monsters/player/Player.as:170-177`). | Catch-up converts a relative value once (`time + savetime`). |
| Legacy id `C100` | Rewritten to `C12` once in every monster field (MH §12.2 item 9). | Catch-up, once. |
| Radio (type 113) | Removed from `buildingdata`, its `costs[0]` refunded (capped). | Catch-up, once (§5.7). |
| Map Room (type 11) | Capped at level 2. A save with `mr2upgraded` gets level 2. A level 3 Map Room is written back to 2 (nothing refunded; level 3 was free). **Owner decision 2026-09-28:** a save on Map Room 2 (`mr2upgraded` or `mapversion` 2) with no Map Room at all is given one, level 2 and finished, on a free spot the server picks, reported as a `mapRoomAdded` job ("A Map Room was added to your yard"). | Catch-up, once (§5.7). |
| Empty main yard | **Owner decision 2026-09-28 (#154):** the original's starter base, as the Flash client placed it in a main yard that loaded empty (`client/scripts/BASE.as:1661-1702`): Town Hall, Twig Snapper holding 200 twigs, Pebble Shiner and General Store, all level 1, around the middle of the plot, plus 1,600 twigs and 1,600 pebbles (credited, capped). A new main save starts with it (`getDefaultBaseData`). Reported as a `starterBase` job ("Your yard is ready: a Town Hall and three starter buildings were placed"). Never for an outpost, Inferno yard or wild camp. | Catch-up, once, before the Map Room step (`services/yard/starterBase.ts`); the elapsed time is not replayed for that yard. |
| Hatchery queue stacks | Unchanged `[id, count]`. | — |
| `buildingdata[id].cL` | New: the running build or upgrade's length (§2.2, #136). | None: a job without it shows progress against the cost table's time, as before. |
| `monsterbaiter` | Kept verbatim, no longer read (Musk is dropped, §8.1). | — |

### 2.6 Shiny prices

One server module, `server/src/services/yard/shiny.ts`, prices everything. It wraps the functions
the audit already has (`timeCost`, `instantCost`, `topupCost`,
`server/src/services/base/economy/resourceBudget.ts:104-140`), which mirror the original
`STORE.GetTimeCost` (`client/scripts/STORE.as:162-171`) and `InstantUpgradeCost`
(`client/scripts/BFOUNDATION.as:2114-2128`). The web keeps its display copies
(`web/src/game/yard/buildingCosts.ts:156-182`) for labels only; a route always recomputes.

| Purchase | Price | Source |
| --- | --- | --- |
| Finish a building job now (SP4) | `timeCost(remaining)`; at ≤ 300 s left it is `SP1`, free, which the player presses (**Finish free**); nothing finishes for free on its own (#137) | BB §5 "Speed-ups" |
| SP2 / SP3 (−1 h / −2 h) | 20 / 40 | `server/src/game-data/store/storeItems.ts:55-70` |
| Instant upgrade / build | `int((ceil(sqrt((r1+r2+r3)/2)^0.75) + timeCost(t)) × 0.95)` | BB §6 "Instant upgrade" |
| Unlock / train / research instantly | `timeCost(t) + ceil(sqrt(putty/2)^0.75)` | MH §3, §4.1, §4.2 |
| Hatchery finish now (FQ) | `timeCost(total, false) × 4` | MH §5.5 |
| Repair all now (FIX) | `timeCost(sum of repair time over jobs > 300 s) + 10 × count` | BB §9 |
| Champion heal | `timeCost(missing/max × healtime, false)` | MH §7.5 |
| Fixed-price items (BST, EXH, HOD, CLOD, POD, …) | `storeItems[item].c` | `storeItems.ts` |

Shiny is never refunded (BB §5 "Cancel and refund").

---

## 3. Phase 1 — Foundation

Goal: the player can upgrade and cancel from the yard, sees timers finish, sees caps and workers,
and the Flinger/Catapult cache stops going stale.

### 3.1 Screens

**Amounts and costs (D22).** The mock-ups in this document write "120,000 twigs" or "58 shiny" so
they read as plain text. On screen, every amount and cost is drawn with the shared icon + amount
helper from issue #93, never the resource word: panel costs, gate messages ("Need [pebble icon] 40,000 more"),
refunds in confirmations, hatch and unlock prices, Shiny buttons, notices and reports. WPs that
build a screen import that helper and do not make their own.

**Building panel** (`web/src/ui/yard/BuildingPanel.ts`, today a list of save fields with a disabled
Upgrade button, `:52`, `:179`). It becomes an action panel, docked right as now:

```
┌ Cannon Tower · Level 4 ──────────────────── [×] ┐
│ Health 1,200 / 1,200                             │
│ Range 190 → 200 · Damage 80/s → 100/s            │  towers only
│ ┌ Upgrade to 5 ───────────────────────────────┐  │
│ │ 120,000 twigs · 120,000 pebbles · 6 h 0 m   │  │
│ │ [ Upgrade ]        [ Instant · 412 shiny ]  │  │
│ └─────────────────────────────────────────────┘  │
│ [ Move ] [ Recycle ]          (phase 3)          │
│ ▸ Details (every save field, as today)           │
└──────────────────────────────────────────────────┘

While upgrading:
│ Upgrading to 5 · 03:12:44  ▓▓▓▓▓▓▓░░░░░          │
│ [ Finish now · 58 shiny ] [ −1 h · 20 ] [ −2 h · 40 ] │
│ [ Cancel upgrade ]                               │
```

- **Upgrade** shows the next step's cost and time from `ladderFor`
  (`web/src/game/yard/planner/upgrades.ts`), already used by the planner inspector. When a gate
  fails, the button is disabled and one line says why, in the order the server checks: "Needs Town
  Hall 5", "Needs 2 Monster Lockers at level 3", "Need 40,000 more pebbles", "Need more silos: this
  costs more than your storage holds" (BB §4 "What happens when full"), "All 5 workers are busy",
  "Repair first", "Max level".
- **Instant / Finish now / SP2 / SP3** show the server-formula price. A Shiny button needs a
  second tap within 3 seconds ("Tap again to spend 58 shiny") instead of a dialog.
- **Cancel upgrade** opens one confirmation ("Cancel and get back 120,000 twigs, 120,000 pebbles?
  Progress is lost.") because progress is lost (BB §5 "Cancel and refund").
- **Per-type info rows** (all read from generated tables, nothing typed by hand): towers — range
  and damage per second now and next, damage shown as `int(damage × 40 / rate)` like the original
  upgrade text (`client/scripts/BTOWER.as:144-147`) from `TOWER_STATS`
  (`web/src/game/combat/rules/combatStatsData.ts:50`; see §10 Q1); Flinger — attack range in cells
  (4/6/8/10) and carry capacity; Catapult — which bombs it unlocks (twig L1, pebble L2, putty L3);
  Storage Silo — storage it adds; Town Hall — what the next level unlocks (count changes per type,
  from `quantity`); harvesters — rate per hour and buffer (Phase 3 adds Bank); Map Room — **Open
  map**; Yard Planner — **Open planner** (exists, `BuildingPanel.ts:167-181`); Monster buildings —
  **Open** (Phase 2 onwards).
- **Details** keeps today's exhaustive field list, collapsed by default.

**HUD** (`web/src/ui/Hud.ts`, today resources and Shiny, `:99-110`):

```
Twigs 1.2M / 4.0M ▓▓▓░  Pebbles …  Putty …  Goo …   Shiny 1,240   Workers 2 / 5   [Monsters]
```

- Each resource shows its icon and `amount / cap` with a thin fill bar; at the cap the bar turns
  amber and the tooltip says "Full: new income is lost. Build or upgrade Storage Silos." Hover shows
  the exact amounts, and each change (a charge, a refund, a bank) floats up as `+n` / `−n`; both
  come from issue #92, and WP1.6 builds the cap bars on top of that work rather than beside it.
- **Workers** shows free / total; clicking it pans the camera to the building of the job that ends
  soonest (the original `QUEUE` click only panned, BB §5).
- `[Monsters]` arrives in Phase 2; `[Collect all]` in Phase 3.

**Notices** (`web/src/ui/maproom/Notices.ts`, already used by the yard): one toast per completed
job from `completed`, grouped when several land together ("3 upgrades finished: Cannon Tower 5,
Sniper Tower 3, Silo 7"). Clicking a toast selects the building. What the owner's own
`/base/load` catch-up finished (its `completed`, #135) is one toast instead, every kind in it,
headed "While you were away: 2 upgrades finished: Cannon Tower 5, Silo 7"; the store announces it
once when it starts (`YardChangeReason.AWAY`). The map's own-yard load (to find the home cell) comes
first after a login and is usually the one that finishes those jobs, so every `loadOwnYard` keeps
its list until the yard takes it (`takeAwayJobs`, `web/src/api/base.ts`).

**Click counts, Phase 1.**

| Task | Flash | New |
| --- | --- | --- |
| Upgrade a building | 3 (building, Upgrade, pay in popup; BB §6 "Flow") | 2 (building, Upgrade) |
| Cancel an upgrade | 3 (building, Cancel, confirm) | 3 (building, Cancel, confirm) |
| Finish an upgrade with Shiny | 4+ (building, speed up, store item, confirm) | 3 (building, Finish now, tap again) |
| See storage caps | hover each bar | 0 (always shown) |

### 3.2 Server routes

All through `yardRoute` (§2.1). Bodies are form fields, like the planner routes.

| Route | Request | Rules checked (in order) | Response `report` | Extra errors |
| --- | --- | --- | --- | --- |
| `POST /bm/yard/state` | — | none | `null` | — |
| `POST /bm/yard/upgrade` | `id` | building exists and is not a wall/trap/decoration/mushroom; not `busy` (`cB`/`cU`/`cF`); not `damaged`; Town Hall exists; `level < maxLevel`; `costs[level].re` met; no `shortfall`; a free worker — for every step, however short: a step of ≤ 300 s runs a real countdown too, and its free finish is the player's own **Finish free** (`SP1`), never automatic (#137, owner review 2026-09-27) | `{ id, from, to, seconds, cost }` | `maxLevel`, `workers` |
| `POST /bm/yard/upgrade/cancel` | `id` | `cU` running | `{ id, refund }` (full `costs[level]`, `cancelRefund`, `resourceBudget.ts:331`, capped) | `notUpgrading` |
| `POST /bm/yard/upgrade/instant` | `id` | the upgrade checks except resources and worker; enough Shiny | `{ id, from, to, credits }` — level raised now, no resources charged, points awarded | — |
| `POST /bm/yard/speedup` | `id`, `item` = `SP1`\|`SP2`\|`SP3`\|`SP4` | a `cB`/`cU` is running; `SP1` only at ≤ 300 s, `SP2` only at ≥ 1 h, `SP3` only at ≥ 2 h, `SP4` only at > 300 s (`client/scripts/STORE.as:1071-1082`); enough Shiny | `{ id, item, credits, remaining }` | `notRunning`, `itemRefused` |

`upgrade` reuses the single-building part of `walkUpgrades`
(`server/src/services/yardplanner/startUpgrades.ts:206`): WP1.2 extracts `planOneUpgrade(save, id,
now)` from the walk so the planner and the panel share one rule set; the walk calls it per node.
Duration is `floor(time × bst)` with Sharper Tools (`workers.ts:108`).

Walls and traps are refused by `upgrade` with 400 `useBatchRoute`; they already have
`walls/upgrade` and `traps/rearm`.

### 3.3 Data changes

- **Flinger and Catapult levels.** `syncDerivedLevels(save)` sets `save.flinger` to the highest
  finished Flinger's level (0 if none) and `save.catapult` likewise for type 51, and runs at the end
  of every catch-up. Today only a Flash save wrote them (`save.model.ts:500-501`) while the range
  check reads `save.flinger` (`server/src/services/maproom/v2/validateRange.ts:94`) and map cells
  publish both (`userCell.ts:79-80`), so a Flinger upgraded from the web never extends range. WP1.0
  also calls it from the three existing planner routes, which is where the bug is reachable today.
- **Points on completion** (T5): `catchUpBuildings` adds `pointsForUpgrade`/`pointsForBuild` for
  each countdown it finishes.
- **Owner saves** (T1): `server/src/controllers/base/save/baseSave.ts` refuses a non-attack save on
  a main yard with 409 `ownerSaveRetired`, behind a config switch (`OWNER_SAVE_MODE=refuse|allow`,
  default `refuse`) so the owner can turn it back on for debugging. Outpost owner saves are refused
  the same way since the outposts plan (WP0b); outposts are edited through the action routes.

### 3.4 Work packages

| WP | Scope | Owns (files created or changed) | Depends on | Size |
| --- | --- | --- | --- | --- |
| WP1.0 | Flinger/Catapult cache fix | new `server/src/services/yard/derivedLevels.ts` (+ test); calls added in `controllers/yardplanner/applyLayout.ts`, `upgradeWalls.ts`, `rearmTraps.ts`, `controllers/base/load/baseLoad.ts` (one line each) | — | S |
| WP1.1 | Action framework, catch-up step 1, state route, load catch-up | new `server/src/controllers/yard/yardRoute.ts`, `controllers/yard/index.ts` (route registry, append-only), `controllers/yard/state.ts`, `services/yard/catchUp.ts`, `services/yard/catchUpBuildings.ts`, `services/yard/yardState.ts`, `schemas/YardSchemas.ts`; `app.routes.ts` (one loop over the registry); `baseLoad.ts` (catch-up + flush for owner build loads); `docs/server-api.md` (new "Yard actions" section) | WP1.0 (touches `baseLoad.ts` after it) | M |
| WP1.2 | Upgrade, cancel | new `services/yard/upgrade.ts`, `controllers/yard/upgrade.ts`; refactor `services/yardplanner/startUpgrades.ts` to call `planOneUpgrade`; registry lines | WP1.1 | M |
| WP1.3 | Shiny module, speed-ups, instant upgrade, shop-buy core | new `services/yard/shiny.ts`, `services/yard/speedup.ts`, `controllers/yard/speedup.ts`, `controllers/yard/shopBuy.ts` (allowlist starts with `BST`, `BEW`; later phases add items); registry lines | WP1.1 | M |
| WP1.4 | Client store and API | new `web/src/api/yard.ts`, `web/src/game/yard/YardStore.ts` (+ test), `web/src/game/yard/jobs.ts` (job end times for all kinds, + test); `web/src/api/types.ts` (state payload, `lockerdata`, `caps`); `web/src/app/scenes/YardScene.ts` (store wiring, 1 Hz completion, `visibilitychange`, passes store to panel and HUD) | WP1.1 contract (can start on a frozen payload shape) | M |
| WP1.5 | Building panel actions | `web/src/ui/yard/BuildingPanel.ts`, new `web/src/ui/yard/buildingActions.ts` (actions per type), `web/src/ui/yard/buildingInfo.ts` (per-type info rows), `web/src/ui/yard/ShinyButton.ts` (tap-again control), styles in `web/src/styles/` (new file `building-panel.css`) | WP1.4 interfaces; WP1.2/WP1.3 routes; the #93 icon + amount helper | M |
| WP1.6 | HUD caps, workers, timer notices | `web/src/ui/Hud.ts`, new `web/src/ui/yard/JobNotices.ts` | WP1.4 interfaces; #92 and #93 merged first (they also edit `Hud.ts`) | S |
| WP1.7 | Retire owner `/base/save` | `server/src/controllers/base/save/baseSave.ts`, `server/src/config/GameConfig.ts` (switch), test | WP1.1 (web must not need it — it never did, `web/src/api/base.ts:186-209`) | S |

**Parallelism.** WP1.0 first (small, fixes a live bug). WP1.1 next; once its payload shape and
`yardRoute` signature are frozen, WP1.2, WP1.3 and WP1.4 run in parallel (server files do not
overlap; each adds lines only to the append-only registry). WP1.5 and WP1.6 run in parallel after
WP1.4 defines `YardStore` and the panel/HUD hooks; `YardScene.ts` belongs to WP1.4 only. WP1.7 any
time after WP1.1.

**Tests.**

| WP | Unit tests |
| --- | --- |
| WP1.0 | Levels from a fixture yard; no Flinger → 0; a Flinger still under construction does not count. |
| WP1.1 | `catchUpBuildings`: completion awards points once; idempotent at the same `now`; 30-day clamp; paused while damaged (existing rule); `yardRoute` refuses a non-main save and a yard under attack; a thrown `ClientSafeError` gives the flat shape. Row lock: two concurrent `state` calls produce one consistent `savetime`. |
| WP1.2 | Every refusal reason in order; a step ≤ 300 s starts a countdown and holds a worker like any other (#137), and `SP1` finishes it for 0 Shiny; Sharper Tools duration; cancel refund full and capped; the planner walk's existing tests still pass unchanged. |
| WP1.3 | Price table in §2.6 against hand-computed values (24 h → 262); SP rules per remaining time; shiny lock refuses; credits never below 0 (the column has a check, `save.model.ts:174`). |
| WP1.4 | Job end times per kind; a finish triggers one coalesced `state` call; the action queue never has two requests in flight. |
| WP1.5 | Which actions show per type and state; gate message order; tower numbers from `TOWER_STATS`. |
| WP1.6 | Cap bar states; notice grouping. |
| WP1.7 | Owner main-yard save refused; attack save still accepted. |

**Browser verification** (local stack: server `http://localhost:3001`, client
`http://localhost:5173`; one shared headless playwright-cli session `bymr`; account
`yardtester@test.com` / `Dev12345!`, userid 2503). The account is shared and agents cannot write
the database, so the recipe uses only reversible actions:

1. Load the yard; the HUD shows four `amount / cap` bars and `Workers n / 5`.
2. Click a building whose panel offers Upgrade (not a wall). Note resources. Click Upgrade: the
   building shows the countdown, resources drop by the shown cost, workers free − 1.
3. Reload the page: the countdown continues from the server's value (not restarted).
4. Click Cancel upgrade, confirm: the countdown is gone and resources return (to the cap if they
   were at the cap). The row is back to its starting state except `savetime`.
5. Upgrade the Flinger only if its Upgrade is available **and** the owner has snapshotted the row
   (irreversible once finished). Otherwise check WP1.0 by unit test only.
6. Shiny speed-ups and instant upgrade are irreversible: run them only after the owner snapshots
   `bym.save` for userid 2503 — columns `buildingdata`, `buildinghealthdata`, `resources`,
   `credits`, `points`, `savetime`, `storedata`, `flinger`, `catapult` — and ask the owner to run
   `restore-test-rows.sh` afterwards.

---

## 4. Phase 2 — Monster chain

Goal: a web-only player can unlock monsters, hatch them in bulk, and see their army grow while
away. Today nothing in the web client adds to `housed` (inventory §2, row 15).

### 4.1 The Monsters screen

One full-height docked screen (bottom sheet on a phone), opened by the HUD `[Monsters]` button, or
by clicking a Monster Locker (→ Unlock), Hatchery or HCC (→ Hatch, that hatchery selected), Monster
Housing (→ Housing), Academy (→ Train, Phase 4), Lab (→ Lab, Phase 4). Tabs that have no building
yet show what to build and its Town Hall requirement instead of an empty list.

```
┌ Monsters ─ [Unlock] [Hatch] [Housing] [Train] [Lab] ─────────────── [×] ┐
│ Housing 1,240 / 2,160 ▓▓▓▓▓▓░░░   Goo 3.2M / 4.0M   Putty 900k / 4.0M │
├────────────────────────────────────────────────────────────────────────┤
│ (tab content)                                                           │
└────────────────────────────────────────────────────────────────────────┘
```

The header always shows housing used/total and the two monster resources, so every tab's decisions
("will this fit?", "can I afford it?") are answered without leaving it. The screen stays open after
every action (the original closed its popups on success, MH §12.2 item 5).

Monster pictures: `server/public/assets/monsters/<id>-portrait.jpg` for the selected monster and
`<id>-small.png` for list rows; both exist for C1–C19 except C18, which is never listed (§4.8).

### 4.2 Monster data on both sides

New generator `web/tools/gen-monster-catalogue.mjs` reads `client/scripts/CREATURELOCKER.as`
(`_mainCreatures`, `:100-824`) and `client/scripts/MONSTERLAB.as` (`_powerupProps`, `:77-188`) and
writes, with identical rows, `web/src/game/monsters/monsterCatalogue.ts` and
`server/src/game-data/monsterCatalogue.ts`: per monster `resource`, `time`, `level` (locker level),
`blocked`, `page`/`index` (list order), `trainingCosts`, `cResource`, `cTime`, `cStorage`, and the
lab ability costs and effects. The server's `monsterStats.ts` keeps combat stats; unlock and
training rules read the catalogue. This closes the one gap MH §12.3 names (no locker `level` on the
server; `server/src/game-data/stats/monsterStats.ts:24-31`). The generator applies the D7 override:
C16, C17 and C19 are written `blocked: false`; C18 stays hidden (spawned by C17, `fake: true`,
`dependent: "C17"`, MH §2.1) and C200 stays excluded.

**As built (WP2.1, issue #102).** `npm run gen:monster-catalogue` from `web/` writes the two files
byte for byte identical; `--check` compares without writing, and a sync test in each suite fails
if the copies differ. Exports (both copies): types `PaidStep`, `MonsterEntry`, `LabAbility`; data
`MONSTER_CATALOGUE` (C1–C19), `LAB_ABILITIES` (ten, lab order), `LISTED_MONSTERS`; helpers
`monsterEntry`, `labAbility`, `isListed`, `compareListOrder`, `atLevel`, `hatchCost`, `hatchTime`,
`housingSpace`, `maxTrainingLevel`, `trainingStep`, `labStep`. What differed from the plan above:

- **List order is `page` + `order`, not `page`/`index`.** The locker shows one page at a time
  sorted by `order` (`client/scripts/CREATURELOCKERPOPUP.as:113-120`); `index` is the hatchery
  and housing sort key (`CREATURELOCKER.as:1240`, `HOUSING.as:288`). The catalogue carries all
  three.
- **`index` is not unique:** C9 and C17 are both 10 (`CREATURELOCKER.as:301`, `:518`), which the
  original never hit because C17 was blocked. `compareListOrder` breaks the tie by locker slot
  (C9 first); `LISTED_MONSTERS` is already sorted that way.
- **Rezghul has no locker slot in the source** (`page: 0`, `order: 0`, `CREATURELOCKER.as:571-573`),
  so un-blocking alone would never show it in a paged locker. The generator places it at page 4,
  order 4, the one free slot (after D.A.V.E.; pages 2 and 3 are full at five). New, not original.
- **C18 is a row, not an omission:** `blocked: true`, `spawnedBy: "C17"`, so a lookup of the spawned
  child still resolves; it is never listed. The string table has no blurb for it (description `""`).
- **Names come from `server/public/gamestage/assets/english.json`**, the live string table; the
  archived `en.v612.txt` other generators read has no C16–C19 names and no lab strings. The game's
  own spellings are "Octo-ooze" and "Eye-ra" (MH §2.1 writes "Octo-Ooze", "Eye-Ra").
  Descriptions keep the original `<br>`/`<b>` markup.
- **Lab names:** each ability's `name` is its string-table title ("Teleportation", "Claws", …); the
  Flash `ability` field ("Blink Range") is kept as `effectLabel`, the text printed after the value.
- Every unlock, training and hatch number agrees with `server/src/game-data/stats/monsterStats.ts`
  for all 19 monsters; the server test keeps that true.

### 4.3 Unlock tab (Monster Locker)

```
│ Unlocking: Fang · 31:12:40 ▓▓▓░░░░  [Finish now · 214] [Cancel]          │
│ ┌──────────────────────────────┐ ┌──────────────────────────────────────┐ │
│ │ ✓ Pokey          unlocked    │ │  [portrait]  Brain                   │ │
│ │ ✓ Octo-ooze      unlocked    │ │  Locker level 3 · 1,024,000 putty    │ │
│ │ ⏳ Fang           31:12:40    │ │  Unlock time 52 h                    │ │
│ │ ● Brain          1.0M · 52 h │ │  Health 600 · Damage 100 · Space 30  │ │
│ │ 🔒 D.A.V.E.  needs Locker 4   │ │  [ Start unlocking ] [ Instant · 380]│ │
│ └──────────────────────────────┘ └──────────────────────────────────────┘ │
```

One scrolling list of every obtainable monster in `index` order (no four-per-page paging, MH §12.2
item 4), each row showing its state: unlocked, unlocking (countdown), available (price and time),
or locked behind a locker level. Selecting a row fills the detail card. Start is disabled with one
reason line: "Another unlock is running", "Needs Monster Locker level 3", "Need 124,000 more putty",
"Build a Monster Locker".

Rules (MH §3 "Unlock rules", `client/scripts/CREATURELOCKER.as:961-1025`) are unchanged: one unlock
at a time, full putty up front, `lockerdata[id] = {t:1, s:now, e:now+time}`, cancel refunds 100%,
completion on wall-clock time. The Monster Locker Overdrive (`CLOD`, 60 Shiny, 4 h) is a button on
this tab while an unlock runs.

| Route | Request | Rules | Report | Extra errors |
| --- | --- | --- | --- | --- |
| `POST /bm/yard/locker/start` | `monster` | obtainable id (catalogue, not blocked, `C` prefix — Inferno out of scope, D19); not already in `lockerdata`; no other `t: 1` entry with a `C` id; a Monster Locker exists and has finished building; locker level ≥ `level`; putty ≥ `resource` | `{ monster, endsAt, cost }` | `alreadyUnlocked`, `unlockRunning`, `noLocker`, `lockerLevel {have, need}` |
| `POST /bm/yard/locker/cancel` | — | an unlock is running | `{ monster, refund }` (capped) | `notUnlocking` |
| `POST /bm/yard/locker/finish` | — | an unlock is running; Shiny ≥ `timeCost(e − now)` | `{ monster, credits }` | `notUnlocking` |
| `POST /bm/yard/locker/instant` | `monster` | the `start` checks except putty; Shiny ≥ `timeCost(time) + ceil(sqrt(resource/2)^0.75)`; no putty charged (`client/scripts/CREATURELOCKERPOPUP.as:326-331`, `:365-443`) | `{ monster, credits }` | as `start` |
| `POST /bm/yard/shop/buy` `item=CLOD` | — | an unlock is running; not already active | `{ item, credits, endsAt }` | `alreadyActive` |

**CLOD in catch-up.** The original took 4 extra seconds off the unlock per client tick while the
buff was active (`client/scripts/CREATURELOCKER.as:905-907`), so each real second removed 5 seconds
of the countdown. Catch-up applies exactly that: `e -= 4 × (seconds of the window that overlap
CLOD's active period)`. (The store text says 4x; the arithmetic was 5x; this keeps the arithmetic.)

**As built (WP2.3, issue #104).** Completion and the CLOD adjustment are their own catch-up step,
`server/src/services/yard/catchUpLocker.ts`, not part of `catchUpMonsters.ts`, and it runs *before*
the buildings step, because that step removes an expired `storedata.CLOD` whose overlap with the
window must still be counted. Rules and prices are `services/yard/locker.ts`. Extra reason:
`409 notUnlocking` for cancel, finish and `shop/buy item=CLOD` with no unlock running. The client
predicts the Overdrive-shortened end (`unlockEndsAt`, `web/src/game/yard/jobs.ts`) and treats
`unlock` as a server-completed kind.

**Clicks.** Flash: building, Open Locker, page, row, Start, dismiss = 5–6 (MH §3 "Click flow").
New: Locker building (opens Unlock), row, Start = 3; from the HUD, Monsters, Unlock, row, Start = 4.

### 4.4 Hatch tab (Hatchery and Hatchery Control Centre)

```
│ Hatcheries: [#1 L3 · Bolt 00:12 · 58/80] [#2 L3 · idle · 0/80] [#3 L2 · stalled]  │
│ ┌ monster grid (unlocked monsters; locked ones greyed with the reason) ────────┐ │
│ │ [Pokey] [Octo] [Bolt] [Fink] [Eye-ra] …                                        │ │
│ └────────────────────────────────────────────────────────────────────────────────┘ │
│ Bolt · 350 goo · 23 s · space 15                                                  │
│   [−] [  20 ] [+] [Fill]      Adds 20 · 7,000 goo · 300 space      [ Add ]        │
│ Queue #1: ▶ Bolt 00:12 · Bolt ×20 [−1][×] · Fink ×5 [−1][×] · (1 stack free)       │
│ [ Finish now · 56 ]   [ Overdrive ▾ 4x 30 · 6x 50 · 10x 100 ]                      │
```

- **Hatchery chips** along the top, one per hatchery, each showing level, what it is producing,
  queued/limit and a state: idle, producing, **stalled — housing full** (MH §5.3 stage 2),
  **damaged** (below 50% health), or under construction. Clicking a hatchery building opens this
  tab with its chip selected. With an HCC, the chips are replaced by one shared queue (7 stacks ×
  20, MH §5.6) and a strip showing each hatchery's current monster, with a × to cancel it
  (`client/scripts/HATCHERYCCPOPUP.as:440-459`).
- **Quantity control** is the Army panel's row control (D9): a number box, `−`/`+` that step once
  on press and then repeat faster while held (`web/src/ui/attack/ArmyPanel.ts:40-45`), and Fill.
  WP2.6 extracts it into `web/src/ui/QuantityStepper.ts` and makes the Army panel use it too, so
  there is one control. The box's maximum is what the queue has room for:
  stack space in this hatchery (`(1 + level)` stacks of 20, merging into the first non-full stack
  of the same monster first, MH §5.2 step 4) and what the goo pays for.
- **Fill** (Max) sets the box to `min(queue room, goo ÷ price)`. Housing is not a limit (issue
  #169, owner 2026-09-28: "players can add more than the housing capacity, the monsters can hatch,
  just that it cant enter the housing"): the original let a queue exceed housing, and a monster that
  hatches with no room waits, finished, in its hatchery (stage 2) until there is some, MH §12.1
  rule 7. When the count is more than free housing (counting what every hatchery already holds or
  queues) the line under the box reads "Housing fits 12 of these; the rest will hatch and wait in
  the Hatchery until there is room", and the housing bar says how far over it goes.
- **Add** sends one request for the whole batch (D9, issue #31) and the queue redraws from the
  answer.
- **Queue rows**: `−1` removes one, `×` removes the stack; the in-production slot has × (refund,
  next starts; MH §5.4). Each removal is one request; `×` on a stack of 20 is one request, not 20.
- **Finish now** houses everything that fits, priced `timeCost(total, false) × 4` (MH §5.5);
  disabled with "Housing full" when nothing fits.
- **Overdrive** buys `HOD`/`HOD2`/`HOD3` (4x/6x/10x for 1 h; 30/50/100 Shiny; MH §5.5). One at a
  time; the active one shows its remaining time.

**Redesigned (issue #156, owner decision 2026-09-28).** The tab now follows the original's hatchery
popup (`HATCHERYPOPUP.as`, `HATCHERYCCPOPUP.as`) in style B, and the chips, the queue rows with
`−1`/`×` and the side-by-side Add row above are replaced: each hatchery's **line** on top (the
monster hatching now with its time and progress, a tap cancelling it after a confirm; one slot per
waiting stack with ×N, a tap taking one out; empty slots up to `1 + level`; the next locked slot
naming the upgrade), or with an HCC each hatchery's monster and the shared queue's seven slots; then
a sentence and a housing bar (housed, on the way, the chosen batch); then all monsters nine across,
where a **tap adds one** at once, beside an info panel (portrait, level, blurb, six numbers) holding
the one improvement, the batch add: the shared stepper with **Max** (Fill's number) and "Add 4 Bolts
· 1,400", previewed dashed in the slots it would fill. Finish now and the Overdrive sit behind one
small "Finish now or speed up" link. The screen widens to 1,160 px for this tab; on a phone the
same order, with the add controls in a bar fixed to the bottom of the sheet.

| Route | Request | Rules | Report | Extra errors |
| --- | --- | --- | --- | --- |
| `POST /bm/yard/hatchery/add` | `hatchery` (building id, or `hcc`), `monster`, `count` (1..400) | monster unlocked (`lockerdata[id].t == 2`) and obtainable; target exists, finished building; with an HCC present only `hcc` is accepted, without one `hcc` is refused; adds one at a time with the original stack rule until `count`, the stack limit, or goo runs out; charges `cResource(academy level)` per monster | `{ added, requested, stoppedBy: null \| "queue" \| "goo", cost }` — partial by design | `locked`, `noHatchery`, `useHcc`, `noHcc` |
| `POST /bm/yard/hatchery/remove` | `hatchery`, `slot` (0 = in production), `count` (≥ 1, or `all`) | slot exists | `{ removed, refund }` (full goo at current price, capped) | `noSlot` |
| `POST /bm/yard/hatchery/finish` | `hatchery` (or `hcc` = all hatcheries plus the shared queue) | something fits in housing; Shiny ≥ price | `{ housed: {id: n}, credits, finishedAll }` | `housingFull` |
| `POST /bm/yard/shop/buy` `item=HOD\|HOD2\|HOD3` | — | no hatchery overdrive active | `{ item, credits, endsAt }` | `alreadyActive` |

A hatchery that is damaged or under construction still accepts queue changes (the original popup
allowed it) but does not produce until repaired or built.

**As built (WP2.4, issue #105).** `services/yard/hatchery.ts`, `controllers/yard/hatchery.ts`;
contract in `docs/server-api.md` "Yard actions". Where it differs from or sharpens the table:

- **Charges and refunds at the paid level** (§10 Q2): add charges `hatchCost(id, academy level)`
  and stores that level on the stack; remove refunds it.
- **Two stack rules, both original.** A hatchery merges into its *first* non-full stack of the
  same monster (MH §5.2 step 4); the HCC merges only into its *last* stack
  (`client/scripts/HATCHERYCCPOPUP.as:328-345`), so the shared queue stays in the order monsters
  were added. Either way a stack merges only with one paid at the same level.
- **A batch fills exactly as clicks did.** After each monster, an idle hatchery starts the head of
  its queue, so an idle level 3 hatchery takes 81 (one in production, 80 queued); with an HCC,
  idle hatcheries that can work (built, at least half health, as `_canFunction`) take from the
  shared queue after each one. Goo is tested before the stack room, as `QueueAdd` did.
- **Remove with an HCC:** `hcc` names the shared stacks; a hatchery id names only slot 0 (the ×
  on its tile, `HATCHERYCCPOPUP.as:440-459`). `count` defaults to 1.
- **Finish** refuses `busy` (hatchery being built), `damaged` (below half health; an HCC at 10 or
  less) and `nothingToFinish` besides `housingFull`; with an HCC only `hcc` is accepted. Queued
  monsters are priced at their whole hatch time; a monster already waiting for housing costs 0.
- **Shop:** `HOD`/`HOD2`/`HOD3` are one stage at a time (any running one is `alreadyActive`);
  `EXH` has no extra rule.

**Clicks.**

| Task | Flash (MH §12.4) | New |
| --- | --- | --- |
| Queue 1 monster | 4 | 4 (hatchery, monster, +, Add) |
| Fill a level-3 hatchery (80) | 83, and 80 saves | 4 (hatchery, monster, Fill, Add), 1 request |
| Fill five level-3 hatcheries | 415 across five popups | 16 (4, then chip + Fill + Add per hatchery) |
| Remove a stack of 20 | 20 | 2 (open, ×) |

### 4.5 Housing tab

A read-only roster: one row per monster type with count, space each, space total, and the bar of
used/total housing, then one row per Housing building with its level and capacity (under-repair
buildings and buildings at 10 health or below count zero, MH §6.1). Hatcheries stalled on housing
are named at the top ("2 hatcheries are waiting for space"). The Juice action appears here in Phase 5;
Ascend to Inferno is not shown (D19). Housing Expansion (`EXH`, 375 Shiny, 1.25x for 24 h) is a
button here (`shop/buy item=EXH`).

**Overflow cull** runs in catch-up when capacity falls below usage because a Housing building was
recycled or destroyed or `EXH` expired: it removes one of every type per pass until the army fits,
no refund (MH §6.1, `client/scripts/HOUSING.as:161-199`). Capacity during a Housing upgrade counts
the old level, as the transfer rules already do (`server/src/services/monsters/transferRules.ts:301`),
so starting an upgrade never culls. The next load shows a notice naming what was lost.

### 4.6 Server production catch-up

`catchUpMonsters(save, from, to)` in `server/src/services/yard/catchUpMonsters.ts`, pure:

1. **Locker**: CLOD adjustment, then completion (§4.3).
2. **HCC completion hook**: when step 1 of catch-up reports an HCC build finished, every hatchery
   queue is emptied and refunded in goo (capped), each hatchery keeping its in-production monster,
   exactly as `BUILDING16.Constructed` (`client/scripts/BUILDING16.as:238-255`).
3. **Production**, event by event from `monsters.saved` to `to`:
   - A hatchery works when it has finished building and health ≥ 50%
     (`client/scripts/BUILDING13.as:262-267`); the HCC works when built with health > 10
     (`BUILDING16.as:107`).
   - Each working hatchery counts down its in-production monster (`cTime` at the monster's academy
     level), faster by the overdrive power while `HOD*` is active (MH §5.5).
   - At zero: if free housing ≥ `cStorage`, `housed[id] += 1` and the next monster starts from the
     hatchery's own queue, or with an HCC from the head of the shared queue (hatcheries served in
     `hid` order, `BUILDING16.as:96-137`); otherwise the hatchery **stalls** (stage 2) and waits.
     Nothing is lost and nothing is refunded (MH §12.1 rule 7).
   - The loop handles the earliest finishing hatchery next, so the output is the same as ticking
     second by second, but costs one step per monster (bounded by housing: at most ~300 events).
4. **Cull** if capacity < used (§4.5).
5. Write `saved = to`, `space`, `hcount`, `hstage`, and drop the building-field copies (§2.5).

**Attack entry and the attack save.** Today the attack save overwrites the attacker's `monsters`
with the blob the client sends (`server/src/controllers/base/save/handlers/monsterUpdateHandler.ts:36-51`),
which would throw away production that happened during the attack and trusts client counts. WP2.2
changes both ends:

- `baseModeAttack` catches up and writes the defender and the attacker's own yards in the roster,
  then stores each own yard's `housed` in the attack session
  (`server/src/services/base/attackSessionStore.ts`) as `entryHoused`.
- On the attack save, for each `monsterupdate` entry that is the caller's own base: `flung[id] =
  clamp(entryHoused[id] − sent.housed[id], 0, entryHoused[id])`; then catch up that row to now and
  subtract `flung` from `housed`. The sent blob is never written. A sent count above `entryHoused`
  is ignored (it cannot add monsters). This also closes the duplication slack MH §9 describes for
  attacks.

**Map and transfers.** `userCell.ts` publishes `m` for own cells from an in-memory catch-up (§2.3).
`transferMonsters.ts` catches up both yards before `planMonsterTransfer`, which checks the counts
moved against the caught-up `housed` rosters (the old production allowance is gone, #131) and
applies them to both as a delta, so a monster hatched since the map read is kept (#196).

### 4.7 Save format for Phase 2

No new fields. `monsters.h/hid/hstage/hcc/saved` stay as MH §10 describes and become canonical;
the per-building copies are dropped (§2.5). `lockerdata` unchanged.

### 4.8 Re-enabling Vorg, Slimeattikus and Rezghul

| Needed | State | Action |
| --- | --- | --- |
| Unlock price, time, locker level | In `CREATURELOCKER.as` (C16 `:485-516`, C17 `:517-543`, C19 `:570-603`); prices C16 384,000 / 36 h / L2, C17 2,048,000 / 36 h / L3, C19 2,048,000 / 36 h / L3 (MH §2.1) | Generated into the catalogue (§4.2) |
| Hatch cost, time, space; training table | In both stat tables (`monsterStats.ts:426`, `:455`, `:481`, `:504`) | none |
| List pictures | `C16/C17/C19-portrait.jpg`, `-medium.jpg`, `-small.png` exist in `server/public/assets/monsters/`; no `-150.png` (the hatchery-size icon C1–C15 have) | Use `-medium.jpg` in the grid; no new art needed |
| Battle sprite sheets | `vorg_anim.png`, `slimeattikus_anim.png`, `slimeattikusmini_anim.png`, `rezghul.png`, rows in `web/src/game/attack/monsterSpriteData.ts:470-560` | none |
| Combat stats | `web/src/game/combat/rules/combatStatsData.ts` has C16–C19 | none |
| **Combat abilities** | **Modelled (issue #129).** The shared engine splits a dead Slimeattikus into Minis, has Vorg and Zafreeti heal their own side, and has Rezghul raise the dead as zombies (`web/src/game/combat/rules/engine.ts`, `onDeath`, `tickHealer`, `tickRaise`). Projectiles still land instantly (note 1), and zombies are not drawn greyed. | none |
| Bunker, Baiter | C17 is bunkerable (MH §6.3); the Baiter roster stays C1–C14 (§8.1) | none |
| Lab abilities | none of the four has one (MH §4.2) | none |

### 4.9 Work packages

| WP | Scope | Owns | Depends on | Size |
| --- | --- | --- | --- | --- |
| WP2.1 | Monster catalogue generator and data | new `web/tools/gen-monster-catalogue.mjs`, `web/src/game/monsters/monsterCatalogue.ts`, `server/src/game-data/monsterCatalogue.ts` (+ tests) | — | S/M |
| WP2.2 | Monster catch-up, attack entry/save, map and transfer catch-up | new `server/src/services/yard/catchUpMonsters.ts`, `services/yard/production.ts`, `services/yard/housing.ts` (capacity, used, cull; reuses `deriveHousingCapacity`/`housingUsed`); `services/yard/catchUp.ts` (add step 2); `controllers/base/load/modes/baseModeAttack.ts`, `services/base/attackSessionStore.ts`, `controllers/base/save/handlers/monsterUpdateHandler.ts`, `controllers/maproom/v2/cells/userCell.ts`, `controllers/maproom/v2/transferMonsters.ts` | WP1.1, WP2.1 | L |
| WP2.3 | Locker routes | new `services/yard/locker.ts`, `controllers/yard/locker.ts`; `CLOD` added to the shop allowlist; registry lines | WP1.1, WP1.3, WP2.1 | M |
| WP2.4 | Hatchery routes (issue #31) | new `services/yard/hatchery.ts`, `controllers/yard/hatchery.ts`; `HOD*`, `EXH` added to the allowlist; registry lines | WP1.1, WP1.3, WP2.1; WP2.2's `production.ts` for the finish-now walk | M |
| WP2.5 | Monsters screen shell, Unlock tab, HUD entry, building routing | new `web/src/ui/monsters/MonstersScreen.ts`, `ui/monsters/LockerTab.ts`, `web/src/api/yardMonsters.ts`, styles `web/src/styles/monsters.css`; `web/src/ui/Hud.ts` (Monsters button); `web/src/ui/yard/buildingActions.ts` ("Open" for monster buildings) | WP1.4–WP1.6, WP2.1, WP2.3 | M |
| WP2.6 | Hatch tab and the shared quantity control | new `web/src/ui/QuantityStepper.ts` (+ test), `ui/monsters/HatchTab.ts`, `web/src/game/monsters/hatchPlan.ts` (queue room, Fill, stack merge preview, + test); `web/src/ui/attack/ArmyPanel.ts` (use `QuantityStepper`; its tests must pass unchanged) | WP2.5 shell, WP2.4 | M/L |
| WP2.7 | Housing tab | new `ui/monsters/HousingTab.ts`, `web/src/game/monsters/housing.ts` (+ test) | WP2.5 shell | S |

**Parallelism.** WP2.1 first (small, unblocks both sides). Then WP2.2, WP2.3 and WP2.4 in parallel
on the server (WP2.4 imports WP2.2's `production.ts`, so freeze its signature first:
`simulateProduction(input, from, to) → {monsters, events}`), and WP2.5 on the client. WP2.6 and
WP2.7 in parallel after WP2.5 creates the shell and the tab interface. Only WP2.5 edits `Hud.ts`
and `buildingActions.ts` in this phase.

**Tests.**

| WP | Unit tests |
| --- | --- |
| WP2.1 | Catalogue row count; C1 `resource` 4000/`time` 600 kept; C16/C17/C19 not blocked; C18 hidden; lab table has ten rows; generator fails loudly on a changed source. |
| WP2.2 | Production: single hatchery exact counts over a gap; stall when housing full and no refund; overdrive window partly overlapping; 50% health stops; HCC distributes in `hid` order; HCC completion refunds queues and keeps in-production; cull thins evenly; idempotence; attack save subtracts `flung` and ignores increases; map read equals the next write. |
| WP2.3 | Every refusal; one unlock at a time; cancel full refund capped; instant charges no putty; CLOD 5x arithmetic; completion creates `academy[id].level = 1`. |
| WP2.4 | Stack merge order identical to MH §5.2 for mixed batches; partial add reports `stoppedBy`; remove slot 0 starts the next; HCC-only mode; finish-now price and `finishedAll`; charges at the academy-level price. |
| WP2.6 | `QuantityStepper` hold timings (moved from `ArmyPanel.test.ts`); Fill = min of queue and goo, housing aside (#169); over-housing warning text. |
| WP2.7 | Used/total, per-building capacity, stalled count. |

**Browser verification** (`yardtester`, same stack). Reversible first:

1. HUD → Monsters opens on Unlock; the list shows every obtainable monster including Vorg,
   Slimeattikus and Rezghul with prices; Slimeattikus Mini is absent.
2. If a monster is still locked: Start unlocking, check putty dropped and the countdown shows;
   reload, countdown continues; Cancel, putty returns. (Reversible.)
3. Hatch tab: select a hatchery chip, a monster, press and hold `+` (count climbs faster), Fill
   (count = the smallest limit), then **remove** instead of adding if the owner has not
   snapshotted. With a snapshot: Add 20 → one network request, goo drops by 20 × price, the queue
   shows the stack; remove the stack (×) → goo returns (capped). Monsters that finished producing
   in between are irreversible — snapshot `monsters`, `resources`, `lockerdata`, `academy`,
   `credits`, `storedata`, `savetime` for userid 2503 first.
4. Offline production (needs the snapshot): queue a few C1 in an idle hatchery, close the tab,
   wait one minute, reopen: `housed.C1` has grown by the expected count and the hatchery chip is
   idle or producing; the map cell's army matches.
5. Attack check (with snapshot): open an attack on a wild camp, fling 5 C1, end; reload: `housed.C1`
   is lower by exactly 5 plus anything hatched meanwhile.

---

## 5. Phase 3 — Economy

Shorter detail; same route model, same verification approach (reversible first, snapshot for the
rest).

### 5.1 Harvesters and Collect all (D12)

- **Catch-up** (`catchUpHarvesters.ts`): each harvester's buffer `st` grows by
  `produce[l−1]` per completed cycle, cycle `cycleTime + ceil(cycleTime × (4 − 4 × health/max))`,
  up to `capacity[l−1]`; nothing below 50% health or while a countdown runs; POD multiplies
  `produce` while active (BB §4 "Production"). The audit already has this arithmetic
  (`harvestAllowance`, `server/src/services/base/economy/resourceBudget.ts:213`); WP3.1 moves it
  into a shared `production` helper both use.
- **Tap a harvester** with anything stored: it banks that one (one request) and opens its panel; the
  flying-number effect plays from the building. Empty: opens the panel only.
- **HUD `[Collect all · 12.4k]`** shows the total waiting and banks every eligible harvester in one
  request. Hidden when nothing is waiting.
  **Owner decision 2026-09-28:** the button may reappear within seconds as the harvesters refill
  (kept), but filling asks the server nothing: the total is the client's prediction (`harvest.ts`),
  a buffer reaching full is not a server job (`harvest` is not in `SERVER_COMPLETED_KINDS`), and
  the only harvester requests are a Collect all press and a tap on a harvester.
- Banking moves `min(st, capacity)` into the pool clamped to the cap; what does not fit **stays in
  the buffer** (the original lost it, BB §4 "What happens when full"; keeping it is a deliberate
  kindness because a full buffer also stops production, so nothing is gained by losing it — listed
  in §10 Q3). Points = amount banked, halved after tutorial stage 200 (BB §4 "Collection is manual").
- Routes: `POST /bm/yard/bank` `ids` (JSON array) or `all=1` → `{ banked: {r1..r4}, byBuilding,
  leftInBuffers }`.
- Clicks: collect everything 1 (Flash: building, Bank all = 2, plus finding a full harvester).

### 5.2 Storage caps

`creditResources(save, amounts)` (server) clamps every credit to `storageCap` and returns what did
not fit, used by bank, refunds, juice and cancel. The panel and build menu say "Need more silos"
when a cost exceeds the cap (BB §4). The HUD caps come from Phase 1.

### 5.3 Build menu, build, cancel build (D13, D19)

- A **Build** button in the yard toolbar opens a palette grouped by the original categories
  (resources, defences, monsters, buildings, decorations), each tile showing cost, time,
  `owned / allowed at this Town Hall`, and the reason it cannot be built. Inferno buildings,
  Radio (§5.7), Map Room 3 structures and event props are not listed.
- Picking a tile enters placement using the planner's placement and collision code
  (`web/src/game/yard/planner/placement.ts`) with the planner's click-to-carry: click to drop,
  refused drop stays in hand, Escape cancels. Walls and traps stay in hand after a drop so a line
  of walls is one click per block.
- `POST /bm/yard/build` `type`, `x`, `y` → checks `quantity[hall]`, `costs[0].re`, shortfall, plot
  bounds and overlap (the Apply rules, `server/src/controllers/yardplanner/applyLayout.ts:60-98`),
  a free worker unless wall/trap; writes a new id (max id + 1), `l: 0`, `cB = floor(time × bst)`
  (walls and traps: finished at level 1 at once, no worker, D13).
- `POST /bm/yard/build/cancel` `id` → full `costs[0]` refund (BB §5 "Cancel and refund").
- `POST /bm/yard/build/instant` `type`, `x`, `y` → `InstantBuildCost` Shiny, finished at once.
- Clicks: place a tower 3 (Build, tile, spot) vs Flash 4 (shop, category, tile, spot).

### 5.4 Recycle

`POST /bm/yard/recycle` `id` → 50% of all level costs paid (`refundOf`, `resourceBudget.ts:304`),
capped; decorations go to inventory (`researchdata`, BB §2 "Decorations"); reward buildings refund
nothing. Refused (409 with reason) for: the Town Hall; a Champion Cage holding a champion; a
Chamber holding frozen champions; a Lab researching; an Academy training; a Hatchery with a queue
or production (the player removes the queue first); a building with a running job. Recycling a
Housing building shows the cull that will follow before confirming. One confirmation dialog.

As built (#112): refusals are `isTownHall`, `mapRoom` (added: the Map Room's level is the map
version, D16), `busy`, `championInCage`, `championsFrozen`, `researching`, `training`,
`hatcheryBusy` (a Hatchery with production or a queue, or an HCC with a queue) and `unlocking`
(added: the original cancelled a running unlock as part of the recycle; here the player cancels
it first). The refund meets the storage cap the yard has without the building (the wrapper applies
the slices before the credit), so a Storage Silo's own refund can meet a smaller cap than the
original's `Fund` did. A Housing cull runs in the same request. The panel's Recycle button (Put in
storage for a decoration) sits at the foot of the actions, disabled with the reason where the
server would refuse, and opens one inline confirmation; the Town Hall offers none.

**Owner decision 2026-09-28:** a Monster Bunker's contents are lost with it, as in the original
(`client/scripts/BUILDING22.as:547-551`: `RecycleC` drops the capacity to 0 and culls everything),
so its confirmation lists them the way Housing lists its cull ("The monsters in this bunker go
with it. These are lost: 4 × Pokey, 2 × Eye-ra."), and the notice after names them. The server
already deletes them with the building entry (`buildingdata[id].m`).

### 5.5 Repair and repair all

`POST /bm/yard/repair` `ids` or `all=1` sets `rE` on each damaged building (free, no worker, heals at
`ceil(max / min(3600, repairTime))` per second, BB §9); catch-up heals. `POST /bm/yard/repair/instant`
(`FIX`) finishes every running repair for the §2.6 price. After a load with damaged buildings, one
banner "Your yard was attacked: 14 buildings damaged [Repair all]" replaces the original popup.
Clicks: repair everything 1.

As built (#113): `repairTime` per type comes from its own generated table
(`web/tools/gen-repair-times.mjs` → `server/src/game-data/repairTimes.ts` and
`web/src/game/yard/repairTimeData.ts`). `catchUpRepairs.ts` runs before the buildings step: a
repair that ends inside the window adds its paused seconds to the building's running countdown, so
step 1 resumes the build or upgrade from the repair's end. The harvester step splits its window at
the repair's end (old health before, full after); the monsters step reads the healed health for the
whole window (at most an hour early). `FIX` prices every damaged building, repairing or not, as the
original's Repair Now did after starting a repair on each. The building panel shows a repair block
above the upgrade (Repair, free; Repair all N now, Shiny, free when every repair is ≤ 300 s).

### 5.6 Mushrooms (D14)

- Catch-up respawns one mushroom per 17,280 s since `mushrooms.s`, at most 10 per catch-up and 10
  in total, on a free random spot in the plot (BB §2 "Mushrooms"); the server picks the spot.
  **Owner decision 2026-09-28:** the yard cap is 10, not 20, as the original's growth cap
  (`client/scripts/MUSHROOMS.as:135-137`). A yard already above 10 keeps what it has (nothing is
  removed; a stored list is still read up to 20, `MUSHROOMS.as:84`); it just grows no more.
- `POST /bm/yard/mushroom/pick` `id` → refused 409 `workers` if no worker is free (the pick costs a
  worker as the original did); otherwise the server removes the mushroom at once and decides the
  reward: 1 in 4 golden, then 8 Shiny with probability 1/3 and 3 Shiny with 2/3 (the original's
  variant roll, `client/scripts/MUSHROOMS.as:236-244`). The client plays the shake and the reward
  popup from the answer. The worker is not held afterwards (the original job lasted seconds).
- The golden decision moves from the position hash (`MUSHROOMS.as:223-224`, a Grant Skinner
  `Rndm` seeded by `x × y`) to a server random roll at pick time; the client's stand-in golden tint
  (`web/src/game/yard/yardModel.ts:202-217`) is removed, since the original showed no difference.

### 5.7 Map Room and Radio (D15, D16)

- **Map Room panel**: **Open map** goes to the Map Room 2 scene when the player has Map Room 2
  access; otherwise it says "Map Room 2 opens at Town Hall 6".
- **Levels**: the cost table caps type 11 at level 2 (generator override). The L1→L2 upgrade is the
  "move to Map Room 2" step: the upgrade route refuses it below Town Hall 6 (409 `townHall`); when
  catch-up completes it, the server runs the same world join as `setMapVersion` V2
  (`server/src/controllers/maproom/setMapVersion.ts:74-93`: join or create a world, set
  `mr2upgraded`, `mapversion = 2`). A save that already has `mr2upgraded` is set to level 2 by the
  §2.5 migration, so existing Map Room 2 players see no change.
- **Owner decision 2026-09-28: every yard on Map Room 2 has a Map Room.** Yards on Map Room 2 that
  hold no type-11 building at all (the owner's yard and agenttester are two) get one from the §2.5
  migration: level 2, finished, with the next building id (one above every id in `buildingdata`
  and `buildinghealthdata`), on the free spot nearest the middle of the plot, clear of every
  building and mushroom by the build route's own placement rule (`placementProblem`,
  `services/yard/build.ts`), tried on a 10-unit grid so the same yard always gets the same spot.
  It is reported as a `mapRoomAdded` job, so the next load's away toast says "A Map Room was added
  to your yard". A save not on Map Room 2 is given none (it builds one from the Build menu), a plot
  with no 90 × 90 gap is left alone until one opens, and the build menu then counts it (1 of 1).
- **Radio**: not in the build menu. Each existing Radio is removed by the §2.5 migration and its
  build cost refunded (capped); a notice on the next load says so.

### 5.8 Phase 3 work packages

| WP | Scope | Owns | Depends on | Size |
| --- | --- | --- | --- | --- |
| WP3.1 | Harvester catch-up, bank one / all, Collect all button | new `server/src/services/yard/catchUpHarvesters.ts`, `services/yard/bank.ts`, `controllers/yard/bank.ts`, `services/base/economy/production.ts` (shared with the audit); `web/src/ui/Hud.ts` (Collect all); `web/src/app/scenes/YardScene.ts` (tap-to-bank) | Phase 1 | M |
| WP3.2 | Storage cap enforcement | new `services/yard/credit.ts`; every earlier refund path switched to it (`upgrade.ts`, `locker.ts`, `hatchery.ts`) | WP3.1 | S |
| WP3.3 | Build menu, build, cancel build, instant build | new `services/yard/build.ts`, `controllers/yard/build.ts`; `web/src/ui/yard/BuildMenu.ts`, `web/src/game/yard/BuildPlacement.ts` | Phase 1 | L |
| WP3.4 | Recycle | new `services/yard/recycle.ts`, `controllers/yard/recycle.ts`; panel action in `buildingActions.ts` | WP3.2 | M |
| WP3.5 | Repair, repair all, FIX, attack banner | new `services/yard/repair.ts`, `controllers/yard/repair.ts`, `services/yard/catchUpRepairs.ts`; `web/src/ui/yard/DamageBanner.ts` | WP3.1 | M |
| WP3.6 | Mushrooms | new `services/yard/mushrooms.ts`, `catchUpMushrooms.ts`, `controllers/yard/mushrooms.ts`; `yardModel.ts` (remove the tint) | Phase 1 | S |
| WP3.7 | Map Room cap and world join, Radio removal | `web/tools/gen-building-costs.mjs` (cap 11 at 2, drop 113), regenerated tables; `services/yard/catchUpBuildings.ts` (Map Room completion hook, migrations); `buildingInfo.ts` (Open map) | Phase 1 | S |

**Parallelism.** WP3.1 and WP3.3 both touch `YardScene.ts` (tap-to-bank; the Build toolbar button
and placement mode), so WP3.3 goes after WP3.1 merges, or the same agent does both. WP3.2 follows
WP3.1. WP3.4–WP3.7 touch separate files and run in parallel with WP3.3; each adds one line to
`controllers/yard/index.ts` and, where it has a catch-up step, one line to `catchUp.ts`.

Browser checks: bank one harvester and Collect all (irreversible: snapshot `buildingdata`,
`resources`, `points`); place a tower then cancel the build (reversible: full refund); place a wall
(irreversible: snapshot); recycle only with a snapshot; repair needs a damaged building (after an
attack test, which the owner restores anyway); pick a mushroom only with a snapshot of `mushrooms`
and `credits`.

---

## 6. Phase 4 — Academy and Lab

**Train tab (Academy).** A list of every unlocked monster with its level 1–6, the next step's putty
and time, and a Train button; academies shown as slots at the top ("Academy 1: Fang → 4 · 11:20:03 ·
[Finish now] [Cancel]", "Academy 2: idle"). Two academies = two slots (MH §4.1 rule 1). No
carousel: reaching Teratorn is one scroll, not 13 clicks of Next (MH §4.1 "Click flow").

- Rules unchanged (MH §4.1 table, `client/scripts/ACADEMY.as:54-131`): academy idle, monster not
  training, unlocked, not max, `level ≤ academyLevel`, putty.
- Storage unchanged: `academy[id].time` (absolute), `.duration`, and the training academy's
  `buildingdata[id].upg = monsterId` (`client/scripts/BUILDING26.as:103-121`).
- Routes: `POST /bm/yard/academy/train` `academy` (building id, optional: the lowest-level idle academy that can train it, #180), `monster`;
  `academy/cancel` `monster` (full refund, capped); `academy/finish` `monster` (SP4 price);
  `academy/instant` `academy`, `monster` (`timeCost(t) + ceil(sqrt(putty/2)^0.75)`, no putty,
  level raised at once, `ITR`).
- Catch-up: `time ≤ now` → `level + 1`, clear `time`, `duration`, the academy's `upg`
  (`ACADEMY.as:148-174`).
- Clicks: train a monster 3 (Academy, monster row, Train) vs Flash 4 + up to 13 Next.

**Lab tab.** Ten rows (the monsters with an ability, MH §4.2), each showing rank 0–3, the next
rank's putty/time, effect now → next, and the gate ("Needs Lab level 2", "Needs Brain at level 3").
One research at a time (one lab).

- Storage (resolves inventory §7 item 4): in-progress research is on the Lab's own building entry,
  `buildingdata[labId].upg` (monster id), `upt` (absolute unix finish time), `upl` (rank being
  bought) (`client/scripts/MONSTERLAB.as:432-460`); the finished rank is `academy[id].powerup`
  (`MONSTERLAB.as:336`).
- Rules unchanged (MH §4.2): rank N needs lab level N and monster level N+1; the lab cannot be
  upgraded or recycled while researching (`MONSTERLAB.as:241-257`).
- Routes: `lab/start` `monster`; `lab/cancel` (full refund); `lab/finish` (SP4 on the lab);
  `lab/instant` `monster` (`GetShinyCost`, `IPU`).
- Catch-up: `upt ≤ now` → `powerup = upl`, fields cleared.

| WP | Scope | Owns | Depends on | Size |
| --- | --- | --- | --- | --- |
| WP4.1 | Academy server | new `services/yard/academy.ts`, `controllers/yard/academy.ts`, `services/yard/catchUpTraining.ts` (academy part); remove the level clamp duplication by reading the catalogue in `academyHandler.ts` | Phase 2 | M |
| WP4.2 | Train tab | new `web/src/ui/monsters/TrainTab.ts`, `web/src/game/monsters/training.ts` (+ tests) | WP4.1, WP2.5 | M |
| WP4.3 | Lab server | new `services/yard/lab.ts`, `controllers/yard/lab.ts`; lab part of `catchUpTraining.ts` | WP4.1 | M |
| WP4.4 | Lab tab | new `web/src/ui/monsters/LabTab.ts` | WP4.3, WP4.2 | S/M |

Verification: start training and cancel it (reversible); start research and cancel (reversible);
finish-now and instant only with a snapshot of `academy`, `buildingdata`, `resources`, `credits`.

---

## 7. Phase 5 — Bunker, champions, Juicer

### 7.1 Monster Bunker (D11)

- Storage (resolves inventory §7 item 5): each bunker's contents are on its own building entry,
  `buildingdata[bunkerId].m = { monsterId: count }` (`client/scripts/BUILDING22.as:665-676` on load,
  `:683-700` on save). Capacity uses the Map Room 2 table 380/450/540/660/800 (MH §6.3).
- **Bunker panel** (in the building panel, not the Monsters screen, per D4): two columns, "Housing"
  and "Bunker", both built from the `QuantityStepper`; a From Housing / Buy switch; one **Move to
  bunker** button for the whole selection. Only `BUNKERABLE_MONSTERS` (C1–C13, C17) are offered
  (`client/scripts/MONSTERBUNKERPOPUP.as:48-69`); the Buy prices are `BUYABLE_MONSTERS` (`:30-46`).
- Routes: `POST /bm/yard/bunker/fill` `bunker`, `monsters` (JSON `{id: n}`), `source` =
  `housing` (putty `cResource × 0.5 × n`, monsters leave housing) or `buy` (Shiny, monster must be
  unlocked); capacity checked against `cStorage` sum. `bunker/remove` `bunker`, `monster`, `count`
  → juiced (goo per §7.3) when a working Juicer exists, else deleted; never back to housing (D11).
- Clicks: fill a bunker with 50 of one type 5 (bunker, Open, monster, type 50, Move) vs Flash 54.
- Combat: the engine takes a defender's bunker contents as an option (`engine.ts` note 9, read by
  `bunkerGarrisons`), but no battle feeds them yet, and the engine has no fight-back, so a defender
  never falls (issue #195). What lands today (issue #130): a bunker that falls in the attack loses
  its garrison, on the final save and in the abandoned-attack finaliser, from the server's replay
  (`services/base/combat/bunkerGarrison.ts`), as Flash's `Export` leaves a fallen bunker empty
  (`BUILDING22.as:683-700`).

### 7.2 Champion Cage and Chamber (D11, D17)

- **Cage panel**: with no active basic champion, three cards (Gorgo, Drull, Fomor; Korath and
  Krallen not offered, MH §7.2) and **Raise** (free). Otherwise: portrait, level, health with heal
  countdown, feeds `2 / 6`, hunger countdown ("Hungry in 14:02:11", red during the 24 h grace), the
  feed recipe with what the player holds ("15 Octo-ooze — you have 40"), and buttons **Feed**
  (monsters), **Feed · 26 shiny**, **Evolve now · 158 shiny** (`feedShiny × 2 × feeds left`, MH
  §7.4), **Heal · n shiny**, **Rename**, **Juice** (Phase 5 Juicer, confirmation). The panel stays
  open after each action.
- Routes: `champion/raise` `type`; `champion/feed` `mode` = `monsters`|`shiny` (doubled price
  outside the feed window, MH §7.4); `champion/evolve`; `champion/heal`; `champion/rename` `name`
  (1–20 characters, filtered); `champion/juice`.
- Catch-up (`catchUpChampions.ts`): passive heal `max × 5 / healtime` per 5 s; starvation — past
  `ft + 24 h` below level 6 lose one feed and restart the timer, at level 6 lose one food-bonus
  rank (`client/scripts/com/monsters/monsters/champions/ChampionBase.as:1062-1109`); frozen champions do nothing.
- **Chamber panel**: list of frozen champions with **Thaw**; the cage panel gets **Freeze**.
  `champion/freeze` refuses when injured or hungry; `champion/thaw` refuses when the chamber is
  damaged or the cage is occupied (MH §7.6). Storage unchanged: `champion[i].status = 1`, `ft`
  relative while frozen, and the chamber's `fz` JSON string (`CHAMPIONCHAMBER.as:313-378`); the
  server writes both.

### 7.3 Monster Juicer (D10)

**Rate, from the Flash code.** Juicing a housed monster returns
`ceil(cResource × rate × healthFraction)` goo, where `cResource` is the monster's hatch cost at its
current academy level and `rate` is **0.6 at Juicer level 1, 0.8 at level 2, 1.0 at level 3**
(`client/scripts/BUILDING9.as:54-67`, credited by `BASE.Fund(4, …)` at `:65`; the same rates in the
housing preview, `client/scripts/HOUSINGPOPUP.as:254-268`; the upgrade text "60% → 80%" and
"80% → 100%", `BUILDING9.as:120-136`). `healthFraction` is `health / maxHealth` of the creep
(`client/scripts/com/monsters/monsters/creeps/CreepBase.as:1287`); Map Room 2 housed monsters are always at full
health (MH §2.2), so it is 1. The credit goes through `BASE.Fund` without the force flag, so it is
**clamped to the goo cap** (`BASE.as:4476-4536`). Juicing is refused while the Juicer is upgrading
or at 50% health or below (`HOUSINGPOPUP.as:311-323`, `MONSTERBUNKERPOPUP.as:702-704`), and Inferno
monsters are refused (`HOUSINGPOPUP.as:307-310`). Juicing a **champion returns no goo**: it only
plays the blend animation (`BUILDING9.as:70-73`, called from `client/scripts/com/monsters/monsters/champions/ChampionBase.as:995`) and sets the
champion's status to juiced (`ChampionBase.as:276`).

- Housing tab gains per-row `QuantityStepper` + **Juice selected · 12,400 goo** and **Select all**.
- Route: `POST /bm/yard/juice` `monsters` (JSON `{id: n}`) → `{ goo, lost }` (`lost` = what the cap
  swallowed); bunker juicing goes through `bunker/remove`; champions through `champion/juice`.

| WP | Scope | Owns | Depends on | Size |
| --- | --- | --- | --- | --- |
| WP5.1 | Bunker server | new `services/yard/bunker.ts`, `controllers/yard/bunker.ts` | Phase 2, WP5.3 (juice helper) | M |
| WP5.2 | Bunker panel | new `web/src/ui/yard/BunkerPanel.ts`; `buildingActions.ts` line | WP5.1 | M |
| WP5.3 | Juicer route and Housing juice UI | new `services/yard/juice.ts`, `controllers/yard/juice.ts`; `ui/monsters/HousingTab.ts` | Phase 2 | S |
| WP5.4 | Champion server (raise, feed, evolve, heal, rename, juice, starvation) | new `services/yard/champion.ts`, `controllers/yard/champion.ts`, `services/yard/catchUpChampions.ts`; reads `server/src/game-data/stats/championStats.ts` plus a generated feed-recipe table (add `feeds`, `feedShiny`, `feedCount` to the stats generator or a small generated file) | Phase 2 | L |
| WP5.5 | Cage panel | new `web/src/ui/yard/ChampionPanel.ts` | WP5.4 | M |
| WP5.6 | Chamber freeze/thaw (server + panel) | new `services/yard/chamber.ts`, `controllers/yard/chamber.ts`, `web/src/ui/yard/ChamberPanel.ts` | WP5.4, WP5.5 | S/M |

Verification: every Phase 5 action is irreversible (monsters consumed, Shiny spent); run only after
the owner snapshots `monsters`, `buildingdata`, `champion`, `resources`, `credits`, and restore
afterwards. Freeze followed by thaw is reversible and can be run freely on a full-health, fed
champion.

---

## 8. Phase 6 — Baiter, shop, decorations

### 8.1 Wild Monster Baiter as the defence simulator (D18)

**What the 7 levels do in Flash** (from the code, not the spec text alone):

| Level | Musk capacity (= attack size budget, in `cStorage`) | Attack directions |
| --- | --- | --- |
| 1 | 600 | 4 (corners) |
| 2 | 900 | 4 |
| 3 | 1,200 | 8 (corners and sides) |
| 4 | 1,500 | 8 |
| 5 | 2,100 | 8 |
| 6 | 3,200 | 8 |
| 7 | 4,800 | 8 |

Sources: capacity per level `client/scripts/YARD_PROPS.as:1962` (`produce` 2 at `:1961`, never
used, `client/scripts/MONSTERBAITER.as:143`), read at `MONSTERBAITER.as:142`; directions
`client/scripts/MONSTERBAITERPOPUP.as:61` (4 below level 3, 8 from level 3), spawn points at radius
400 (`:113`). The roster does **not** grow with level: it is always C1–C14
(`MONSTERBAITERPOPUP.as:49-52`; the longer list at `:45` is unused). One monster costs its
`cStorage` (`client/scripts/MonsterBaiterItem.as:37`, `:72`), and the total must fit in the current
Musk (`MONSTERBAITERPOPUP.as:168`). Musk refills to capacity every tick (`MONSTERBAITER.as:43-44`),
so it never limits anything beyond one attack's size.

**Proposal.** Keep the levels as exactly what they meant in practice: level sets the attack size
budget (600…4,800 `cStorage`) and the direction count (4 or 8). **Drop Musk as a resource**: no
stored amount, no refill, no `MUSK` store item; the budget line reads "Attack size 1,140 / 2,100".
The `monsterbaiter` save key is left as is and ignored.

**The simulator.** A client-only screen from the Baiter's panel: pick a direction (arrows around a
yard thumbnail), set counts per monster with `QuantityStepper` rows (budget-clamped, Fill), **Run**.
It opens the player's own yard in the attack scene's battle view (`web/src/app/scenes/AttackScene.ts`
renderer and `createBattle`), flings the chosen monsters at the direction's spawn point as wild
monsters, at 1x/2x, and ends with a summary (damage %, buildings destroyed, which towers fired,
traps that fired). **Nothing is saved**: no damage, no fired traps, no resources, no server call.
Players may run it as often as they like. The attackers use level 1 stats, not the player's
academy levels, because the original spawned them as a wild-monster custom attack
(`client/scripts/MONSTERBAITER.as:55-60`).

**Owner decisions (2026-09-29).** Three questions the Flash code left open, answered by the owner
for WP6.1 (#126):

1. **Strength: plain stats.** Flash multiplied every wild monster's health and damage by 0.4 to
   0.9 by the yard's base points and value (`client/scripts/WMATTACK.as:729-752`, then
   `CreepBase.as:88`, `:93`). The simulator does not: the attackers fight at level 1 or at the
   player's academy levels (the Q5 toggle), at 100%, and the combat engine gets no multiplier.
2. **Time limit: the attack's.** Flash's Baiter attack had no clock; it ran until the attackers died
   or the player scared them away (`MONSTERBAITER.End`). The simulator keeps the attack scene's
   5-minute countdown and its automatic ends (every attacker beaten, the yard flattened), and
   **Stop** ends it early.
3. **Starting yard: as it is now.** Damaged buildings start at their current health and traps that
   already fired stay spent (a fired trap is gone from `buildingdata` until it is re-armed).
   Nothing is saved either way.

**As built (#126).** The Baiter's panel offers **Bring an attack** on a built Baiter at full health
with no job running (`BUILDINGINFO.as:97-127`, `:210-211`), not on an outpost. Its controls
(`web/src/ui/yard/BaiterPanel.ts`) are a compass of the level's directions, the Level 1 / My
academy levels switch, "Attack size N / budget", C1–C14 steppers with Fill, Clear and **Run
attack**; the army, direction and switch are kept for the session. Run opens the Baiter scene
(`SceneName.BAITER`): the attack scene in practice mode with only the battle layer and the
Baiter's package (`web/src/game/baiter/baiterPlugin.ts`, `BAITER_PLUGINS`), fighting on the own
yard's load it was handed (`baiterSession.ts`, `baiterTarget`), so there is no attack load, no
checkpoint and no save. Every monster lands in one fling 1,000 yard units out at the direction's
angle (`WMATTACK.as:711`), the view turns to meet it, and the end shows damage, buildings
destroyed, attackers beaten, which towers fired and how many traps went off, with Run again and
Back to yard. `baiterPlugin.test.ts` runs a whole practice attack with every request stubbed to
fail and checks none is made.
The yard defends itself as it would against a real attack (issue #195): the Baiter hands the
scene the yard's own `defenderforces` (the shared `defenderForcesOf`), so its bunkers send their
garrisons out at the player's academy levels and its caged champion comes out to fight.

### 8.2 General Store as a Shiny shop (D15)

A **Shop** screen from the General Store panel (and the HUD Shiny counter), server-priced through
`shop/buy` (§3.2). Kept items, each with the original price and effect
(`server/src/game-data/store/storeItems.ts`): `BEW` extra worker (250/500/1,000/2,000, max 4),
`BST` Sharper Tools, `BIP` packing (10 steps), `ENL` yard expansion (6 steps), `POD` production
overdrive, `HOD`/`HOD2`/`HOD3`, `CLOD`, `EXH`, `PRO1`–`PRO3` damage protection, `FIX`. Dropped:
`MUSK` (§8.1), every Inferno `…I` item, `HAMS` (Map Room 3 healing), real-money top-ups. Items
whose effect this client does not model yet (`MDOD`, `MSOD` monster buffs; `BLK2`–`BLK5` Shiny wall
upgrades; Shiny decorations `BUILDING28…`) are held back until WP6.2 confirms their effect and
price formula against `client/scripts/STORE.as`, and listed there as "coming later" rather than
sold with no effect. Existing `storedata` entries of dropped items stay and do nothing.

**Decisions (2026-09-29, WP6.2, #127).** Questions 1-4 answered by the owner, 5-6 by the lead:

1. **Protection stacks.** `PRO1`–`PRO3` can always be bought; each adds its time on top of the
   protection left, new-player and post-attack protection included (`save.protected =
   max(protected, now) + du`), as the Flash save path did. One `storedata` entry stands for the
   stack and ends with it.
2. **Protection is main-yard only.** Sold in the main yard's Shop, protects only the main yard; an
   outpost's Shop does not list it and `shop/buy` refuses it there.
3. **Tower and Monster Overdrive come later.** `TOD` and `MOD` are "coming later" tiles, refused
   `notForSale`, like the held-back items below.
4. **No resource packs.** `BR11`–`BR43` are dropped; building panels already top up a shortfall.
5. **The held-back items stay held back.** `MDOD`, `MSOD`, `BLK2`–`BLK5` and the Shiny decorations
   are "coming later" tiles with no price; their effects and prices were not checked against
   `STORE.as`.
6. **Not in the Shop:** `SP1`–`SP4` and `IB` (used from building panels), `FQ` (no queue), `IBSW`,
   `BRAU`, `BRAB` (siege), and the dropped items above.

The yard state (§2) gains `protected`, the expiry `/base/load` already sends, so the Shop shows the
protection left and a purchase updates it without a reload.

### 8.3 Decoration inventory

Decorations recycled in Phase 3 go to `researchdata` inventory (BB §2 "Decorations",
`client/scripts/BASE.as:2712-2717`). The build menu's Decorations tab lists owned inventory counts
first; placing from inventory is free and may be outside the plot. Routes: `decor/place` `type`,
`x`, `y` (decrement inventory); recycle already stores. The planner drawer
(`web/src/ui/yard/InventoryPanel.ts`) starts showing real inventory items beside lifted buildings.

**Decisions (2026-09-29, WP6.3, #128).** Questions 1–3 and 5 answered by the owner, 4 and 6 by
the lead, and the plot question by the owner (option A):

1. **Storage only.** Only what is in storage is placed, owned Shiny decorations included; no
   decoration is bought (the Shop keeps them "coming later", §8.2).
2. **Apply stores what the layout leaves out**, as the Flash planner did
   (`BasePlanner.as:113-122`): every decoration not in the layout goes into storage as a recycle
   puts it, and a decoration in the drawer is a warning row, not a block. The drawer lists storage
   too; one put down is created by Apply (`fromStorage`).
3. **Placing is free and instant**, no worker, no points, no Town Hall limit (the count is the
   limit), **inside the plot only**, clear of buildings and mushrooms.
4. **Totems** come back at their stored `bl` level, else 1; `bl` goes with the last one.
5. **Main yard only**; `decor/place` is `notInOutpost` in an outpost.
6. **The Decorations tab** lists the stored types with their counts and a Place button; empty, it
   says how to fill it.
7. **Decorations are held to the plot** in the planner and on Apply and slot save, like every
   building, instead of Flash's 3240 x 2600 decoration area. One already outside the plot (a Flash
   save, an earlier Apply) may stay exactly at its saved spot; any move or new placement must land
   inside, and nothing is moved on its own.

| WP | Scope | Owns | Depends on | Size |
| --- | --- | --- | --- | --- |
| WP6.1 | Baiter simulator | new `web/src/app/scenes/BaiterScene.ts` (or a mode of `AttackScene`), `web/src/ui/yard/BaiterPanel.ts`, `web/src/game/baiter/baiterSession.ts` (+ tests) | Phase 2 (`QuantityStepper`), attack scene | M/L |
| WP6.2 | Shop screen, full allowlist | new `web/src/ui/yard/ShopScreen.ts`; `controllers/yard/shopBuy.ts` (allowlist and effects) | WP1.3 | M |
| WP6.3 | Decoration inventory | new `services/yard/decor.ts`, `controllers/yard/decor.ts`; `BuildMenu.ts` tab; `InventoryPanel.ts` | WP3.3, WP3.4 | M |

---

## 9. Spec gaps resolved

From inventory §7.

| # | Gap | Resolution |
| --- | --- | --- |
| 1 | Twig Snapper / Pebble Shiner resource labels swapped in BB §3 | BB §4 is right: type id = resource index (Twig Snapper fills r1). The generators already use the type id. BB §3's table text is fixed (#133). |
| 2 | Monster Locker "TH 3" vs quantity from TH 2 | Quantity rules: one from Town Hall 2 (`YARD_PROPS.as:998`); the generated `quantity` array is what the routes use. BB §3's TH column now says 2 (#133). |
| 3 | Juicer TH and costs unverified; no goo rate | Rate resolved (§7.3). Costs and gates come from the generated cost table (Map Room 2 override for id 9 is already applied by the generator, `web/tools/gen-building-costs.mjs:237`). |
| 4 | Where Lab in-progress research is saved | Lab building entry `upg`/`upt`/`upl` (`MONSTERLAB.as:432-460`), §6. |
| 5 | Where Bunker contents are saved | Bunker building entry `m` (`BUILDING22.as:665-700`), §7.1. |
| 6 | Hatchery state in `monsters.h` and in `rPS`/`rCP`/`rIP` | `monsters` is canonical: on load the original copied `h`/`hid`/`hstage`/`saved` over each hatchery's building fields (`client/scripts/BASE.as:1554-1580`) and `hcc` over the HCC's queue (`:1551-1553`); the building copies (`BFOUNDATION.as:3015-3021`, `BUILDING13.as:495`) were overwritten on every load. §2.5 drops them. |
| 7 | Server monster table has `resource`/`time`, lacks `level` | Catalogue (§4.2). |
| 8 | MR2 bunker capacity override without a cost override | Kept as the original ran: MR2 capacities with the base costs (MH §11 item 14). |

---

## 10. Known limitations and open questions

**Known limitations.**

- **New accounts below Town Hall 6 have no map.** Map Room 1 is a later project (D16); until then a
  new player builds and hatches but cannot attack or see the world until Town Hall 6. The Map Room
  panel says so.
- **Re-enabled monsters fight without their abilities** (§4.8).
- **Bunker defenders do not fight yet** (§7.1): a fallen bunker loses its garrison (#130), but
  defenders are neither dispatched nor killed until the engine's fight-back lands (#195).
- **Outposts** keep their current behaviour; this plan is main-yard only (as the planner is).

**Open questions** (each has a default the WPs build to):

| # | Question | Default |
| --- | --- | --- |
| Q1 | D20 asks to extend the cost-table generator with tower stats, but the web already has generated per-level tower stats (`TOWER_STATS`, `web/src/game/combat/rules/combatStatsData.ts:50`, from `web/tools/gen-combat-stats.mjs`). | **Read `TOWER_STATS`** in the panel (WP1.5) instead of duplicating the numbers in the cost table; the server does not need them. If the owner still wants them in the cost table, WP1.5 adds a `stats` column in `gen-building-costs.mjs` for types 20, 21, 23, 25, 115, 118. |
| Q2 | Hatchery refunds used the monster's price at its current academy level in the original (queue at level 1, train, cancel → more goo back than paid). | **Owner 2026-09-27: refund what was paid.** Queue stacks store the paid price level (`[id, count, level]`; a stack merges only with a stack of the same level; old two-element stacks read as the current level once). WP2.4 implements it. |
| Q3 | Banking more than the cap: the original lost the overflow. | **Owner 2026-09-27: leave the overflow in the buffer** (§5.1). |
| Q4 | Upgrading a Housing building: does its capacity drop during the upgrade (and cull)? | **No**: the old level counts until the upgrade finishes (§4.5), matching the server's transfer rules. |
| Q5 | Should the Baiter simulator use the player's academy levels for the attackers? | **Owner 2026-09-27: the player chooses** — a toggle in the simulator between level 1 (the original's wild attack) and the player's own academy levels. WP6.1 implements it. |

---

## 11. GitHub issues to file

One issue per WP. Labels: `area:server`, `area:client`, `area:monsters` as fits, plus the priority.
Issue #31 already exists for the hatchery bulk add: WP2.4 and WP2.6 link to it instead of a new
issue for the bulk-add part.

| WP | Title | Scope (one line) | Phase | Priority |
| --- | --- | --- | --- | --- |
| WP1.0 | Keep save.flinger and save.catapult in step with the buildings | Derive both from buildingdata on every server write; fixes range after a web upgrade | 1 | must |
| WP1.1 | Yard action framework and offline catch-up (buildings) | `yardRoute`, `catchUpYard` step 1, `/bm/yard/state`, catch-up on owner load, points on completion | 1 | must |
| WP1.2 | Upgrade and cancel upgrade from the building panel (server) | `/bm/yard/upgrade`, `/upgrade/cancel`; `planOneUpgrade` shared with the planner walk | 1 | must |
| WP1.3 | Server Shiny pricing, building speed-ups, instant upgrade | `shiny.ts`, `/speedup`, `/upgrade/instant`, `/shop/buy` core | 1 | should |
| WP1.4 | Client yard store, action queue, timers finishing in the client | `YardStore`, `jobs.ts`, `api/yard.ts`, YardScene wiring | 1 | must |
| WP1.5 | Building panel actions and info rows | Live Upgrade/Cancel/Finish now, gate reasons, tower stats, per-type info, Open map | 1 | must |
| WP1.6 | HUD storage caps, workers and job notices | Cap bars, worker counter, grouped completion toasts | 1 | must |
| WP1.7 | Refuse owner /base/save on the main yard | Config-switched refusal; attack saves unchanged | 1 | should |
| WP2.1 | Monster catalogue generator (unlock, training, lab data on both sides) | Generated tables incl. locker level; C16/C17/C19 enabled | 2 | must |
| WP2.2 | Server hatchery production catch-up and attack roster accounting | Production replay, stall, cull, HCC hook; attack entry/save delta; map and transfer catch-up | 2 | must |
| WP2.3 | Monster Locker routes | start, cancel, finish, instant, CLOD | 2 | must |
| WP2.4 | Hatchery and HCC routes (bulk add, #31) | add N in one request, remove, finish now, overdrive | 2 | must |
| WP2.5 | Monsters screen, Unlock tab, HUD entry | Tabbed screen shell, locker list and actions, building click routing | 2 | must |
| WP2.6 | Hatch tab and shared quantity control (#31) | `QuantityStepper` extracted from the Army panel; hatchery chips, Fill, queue | 2 | must |
| WP2.7 | Housing tab | Roster, used/total, stalled hatcheries, EXH | 2 | should |
| WP3.1 | Harvester production, bank one, Collect all | Server buffer catch-up, bank route, HUD button, tap-to-bank | 3 | must |
| WP3.2 | Storage cap enforcement on every credit | `creditResources`, "need more silos" messages | 3 | must |
| WP3.3 | Build menu, build, cancel build, instant build | Palette, placement, walls/traps instant, server build route | 3 | must |
| WP3.4 | Recycle | 50% refund, decorations to inventory, refusal rules | 3 | should |
| WP3.5 | Repair, repair all, Repair now | Repair routes, healing in catch-up, post-attack banner | 3 | must |
| WP3.6 | Mushrooms | Respawn in catch-up, pick route with server-decided reward | 3 | should |
| WP3.7 | Map Room level cap and Radio removal | Cap at L2, L2 completion joins Map Room 2, TH6 gate, Radio refund | 3 | should |
| WP4.1 | Academy server routes | train, cancel, finish, instant, catch-up completion | 4 | must |
| WP4.2 | Train tab | Monster list with levels, academy slots | 4 | must |
| WP4.3 | Monster Lab server routes | start, cancel, finish, instant, catch-up completion | 4 | should |
| WP4.4 | Lab tab | Ten abilities with gates and effects | 4 | should |
| WP5.1 | Monster Bunker server routes | fill from housing/buy, remove/juice, capacity | 5 | should |
| WP5.2 | Monster Bunker panel | Two-column transfer with quantity controls | 5 | should |
| WP5.3 | Monster Juicer route and Housing juice | 60/80/100% goo, capped, refused when upgrading/damaged | 5 | should |
| WP5.4 | Champion server routes and hunger | raise, feed, evolve, heal, rename, juice, starvation catch-up | 5 | should |
| WP5.5 | Champion Cage panel | Cards, feed recipe, timers, Shiny actions | 5 | should |
| WP5.6 | Champion Chamber freeze and thaw | Server routes and panel | 5 | could |
| WP6.1 | Wild Monster Baiter defence simulator | Client-only simulated attack on the own yard; 7 levels = size and directions; built in #126 | 6 | should |
| WP6.2 | General Store Shiny shop | Shop screen, full server allowlist, dropped items | 6 | could |
| WP6.3 | Decoration inventory | Place from inventory, recycle into it, planner drawer | 6 | could |

**Follow-ups** (not WPs of this plan):

| Title | Scope | Priority |
| --- | --- | --- |
| Combat: Rezghul zombies, Slimeattikus splits, Vorg healing | Model the three abilities in the shared rules engine (`engine.ts` note 8) | should |
| Combat: reduce defender bunker counts after an attack | Attack save writes bunker `m` from the battle's dispatch counts | should |
| Transfers: drop the production allowance once catch-up runs first | Strict conservation in `transferRules.ts`; done in #131 | could |
| Map Room 1 for players below Town Hall 6 | Separate project (D16) | backlog |
| Fix BB §3 harvester labels and Locker TH text | Spec text only (§9 items 1–2); done in #133 | could |
