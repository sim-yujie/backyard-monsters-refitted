# Yard Planner — Phase 1 Remainder, Implementation Plan

Dated 2026-09-23. This is the implementation plan for what is left of phase 1 of the Yard Planner
redesign (`docs/design/yard-planner-redesign.md` §6, as amended by the owner decisions in §8). It
covers the cost and time panel (F3), inventory search (F16), and the two batch actions decision Q1
introduced: batch wall upgrade and trap re-arm, both completing instantly under the free-finish rule
and charged server-side.

Every line number below cites the `revamp` branch as it stands today. Where the plan makes a choice
the owner has not ruled on, section 6 names the default taken and why.

Sections:

1. Scope
2. Server
3. Client
4. Tests and browser verification
5. Work packages
6. Open questions and defaults

---

## 1. Scope

### 1.1 What the live game does, and why it shapes the design

**There is no server-side cost logic today.** The server has no building cost table and no upgrade
handler. The Flash client charges itself and ships a resource delta plus the whole `buildingdata`
blob; the server adds the delta (`server/src/services/base/updateResources.ts:29-46`) and assigns the
blob verbatim on an owner save (`server/src/controllers/base/save/baseSave.ts:102-110`). The spec
lists this under "What is not checked" (`docs/specs/base-building.md:1442-1461`). The only yard
mutation the server makes itself is the planner's Apply
(`server/src/controllers/yardplanner/applyLayout.ts:47-84`), which writes `X` and `Y` only.

The batch routes are therefore the first server-authoritative cost logic in the project. They need a
cost table on the server as well as the client, and they need the prerequisite rules the Flash client
keeps in `BASE.CanUpgrade` (`client/scripts/BASE.as:3828-3932`).

**The free-finish rule.** `BFOUNDATION.FinishNowCost()` returns 0 when the remaining time is 300
seconds or less (`client/scripts/BFOUNDATION.as:2063-2083`), and `STORE.GetTimeCost` does the same
(`client/scripts/STORE.as:162-171`; spec `docs/specs/base-building.md:809-836`). Every wall build
and upgrade is 5 seconds (`client/scripts/YARD_PROPS.as:1722-1757`) and every trap build is 5
seconds (`:2695-2702` for the Booby Trap, `:6296-6303` for the Heavy Trap). Decision Q1 relies on
this: walls and traps complete with no worker and no countdown, so the server can write the finished
state in one step.

**Walls.** Type 17 (Wooden Block) has five levels; `costs[k]` is the cost of going from level `k` to
`k + 1`, so `costs[0]` is the build and `costs[4]` is the level 4 to 5 upgrade
(`client/scripts/BFOUNDATION.as:2668-2700`; spec `:924-928`). Each step's `re` is `[[14, 1, k + 2]]`:
one Town Hall at level `k + 2`, so level 5 needs Town Hall 6. Type 18 (Stone Block) is a legacy
entry: the Flash client rewrites any `t: 18` row to `t: 17, l: 2` on load
(`client/scripts/BASE.as:1523-1526`). The shiny `BLK2`..`BLK5` store items already raise every wall
to a level in one action (`client/scripts/STORE.as:1993-2011`), which is the closest precedent for a
batch wall upgrade.

**Traps.** Type 24 (Booby Trap) and 117 (Heavy Trap) have one level each. On firing, `BTRAP.Explode`
sets health to 0 (`client/scripts/BTRAP.as:88-151`, `setHealth(0)` at `:146`). The next save omits
the trap from `buildingdata` and writes `buildinghealthdata[id] = 0` instead
(`client/scripts/BFOUNDATION.as:439-441`), and the attack save drops any trap the attacker's client
no longer reports (`server/src/controllers/base/save/handlers/buildingDataHandler.ts:31-42`). After
that only the id survives, not the position. "Re-place every fired trap at its last position"
therefore needs a source of positions that does not exist yet; section 2.5 adds one.

Trap counts are capped by Town Hall level through `quantity`: `[0, 0, 8, 15, 20, 28, 35, 42, 50, 60,
75]` for type 24 (`client/scripts/YARD_PROPS.as:2723`) and `[0, 0, 0, 0, 4, 6, 8, 10, 12, 15, 18]`
for type 117 (`:6307`), indexed by Town Hall level.

**Prerequisites.** `re` entries are `[type, count, level]`: at least `count` buildings of `type` at
`level` or above (`client/scripts/BASE.as:3884-3932`). The design doc's `[requiredType, ?,
requiredLevel]` in F1 has `count` in the middle. `CanUpgrade` also refuses without a town hall
(`:3863-3866`), at max level (`:3867-3870`), and while any countdown runs (`:3871-3882`).

**Completion side effects.** `Upgraded()` increments the level, heals to full and awards empire points
`floor((time + r1 + r2 + r3 + r4) / 3)` for the step completed
(`client/scripts/BFOUNDATION.as:2434-2461`, points at `:2455-2457`). `Constructed()` awards
`floor(time / 2 + (r1 + r2 + r3 + r4) / 10)` (`:2892-2921`; spec `:970-973`). Points are stored on
the save as a string and the base level is derived from them
(`server/src/services/base/calculateBaseLevel.ts:11-20`).

**Ids.** A new building takes `++BASE._buildingCount`, where `_buildingCount` is the highest id seen
at load (`client/scripts/BFOUNDATION.as:1668-1669`, `client/scripts/BASE.as:1591-1592`).

**Timers.** Stored `cB`, `cU` and `cF` are seconds remaining as of `savetime`
(`server/src/services/base/advanceBuildingTimers.ts:3-24`). Any server-side write that moves
`savetime` forward has to bring the countdowns forward first, as the attack path does
(`baseSave.ts:213-218`). `applyLayout.ts:80` moves `savetime` without doing so; the new routes do it
right and the same one-line fix is folded into the server package.

### 1.2 In scope

| Item | Summary |
|---|---|
| Cost table generator | One script emitting the same rows to the web client and the server. |
| Server: batch wall upgrade | `POST /bm/yardplanner/walls/upgrade`, instant, charged server-side. |
| Server: trap re-arm | `POST /bm/yardplanner/traps/rearm`, instant, charged server-side, plus recording fired trap positions on the attack save. |
| F3 cost and time panel | Bottom bar: resources held, cost and time of the selection's next level, shortfall in red, breakdown by type, shiny-to-finish shown but not purchasable. |
| Batch wall upgrade UI | Select walls, choose target level, preview, confirm, server call, plan and yard updated in place. |
| Trap re-arm UI | One button with a count badge, confirm, server call, same refresh loop. |
| F16 search | Search over placed buildings by name or type id, category chips with counts, stacked rows, click selects and frames. |

### 1.3 What "inventory search" means in phase 1

There is no inventory in phase 1. Every building is in the plan from the moment the planner opens
(`web/src/game/yard/planner/plan.ts:64-99`) and nothing can be stored; `checklist.ts:12-16` says as
much about the "placed" row. So F16 is delivered as **search over placed buildings**: a text box
matching the localised name and the type id, chips for the categories the props table defines,
stacked rows so 400 walls are one row ("Wooden Block L1 x400"), a count badge per category, and
clicking a row selects and frames those buildings. The "needs placing" filter and stack badges over
unplaced items are deferred to the store tool.

### 1.4 Deferred

- Planned upgrades stored on nodes (`plan: { level, fort }`, F1), tower upgrades, and starting jobs
  at Apply. Nodes keep `l` and `fort` as advisory fields only
  (`server/src/schemas/YardPlannerSchemas.ts:45-48`).
- Fortification, and any shiny purchase, including instant finish (design §3 F1, "Instant finish").
- Outposts and Inferno yards. The planner opens the main yard only (`web/src/api/base.ts:24-37`).
- Storing, paint mode, the inventory panel proper (design §8 Q9, last sentence).
- Highlighting search matches on hover; it needs a renderer hook the planner does not have yet.

---

## 2. Server

### 2.1 Files

New:

| File | Contents |
|---|---|
| `server/src/game-data/buildingCosts.ts` | Generated (section 3.1). `COSTS: Record<number, BuildingCost>` where `BuildingCost = { name, kind, group, costs: CostStep[], quantity: number[] }` and `CostStep = { r1, r2, r3, r4, time, re: [type, count, level][] }`. Exports `costOf(type)`, `maxLevel(type)`, `WALL_TYPES = [17, 18]`, `TRAP_TYPES = [24, 117]`. |
| `server/src/services/yardplanner/costs.ts` | Pure helpers: `FREE_FINISH_SECONDS = 300`, `townHallLevel(buildingdata)`, `countOfType(buildingdata, type)`, `requirementsMet(re, buildingdata)`, `upgradeSteps(type, from, to)`, `sumCosts(steps)`, `shortfall(pool, cost)`, `pointsForUpgrade(step)`, `pointsForBuild(step)`. No database access, like `validateLayout.ts`. |
| `server/src/services/yardplanner/wallUpgrade.ts` | `planWallUpgrade(save, ids, level): WallUpgradePlan` returning `{ buildingdata, cost, points, upgraded }` or throwing a `ClientSafeError`. |
| `server/src/services/yardplanner/trapRearm.ts` | `planTrapRearm(save, traps): TrapRearmPlan` returning `{ buildingdata, cost, points, ids, firedtraps }` or throwing. |
| `server/src/controllers/yardplanner/upgradeWalls.ts` | Thin controller in the style of `applyLayout.ts:47-84`. |
| `server/src/controllers/yardplanner/rearmTraps.ts` | Same. |
| `server/src/database/migrations/Migration<stamp>-firedtraps.ts` | Adds `save.firedtraps jsonb not null default '[]'`. |
| `server/src/game-data/buildingCosts.test.ts`, `server/src/services/yardplanner/costs.test.ts`, `wallUpgrade.test.ts`, `trapRearm.test.ts` | Section 4.1. |

Modified:

| File | Change |
|---|---|
| `server/src/app.routes.ts:174-177` | Two `router.post` lines after `apply`, each wrapped in `layoutRoute(...)` so a rejection comes back flat (`server/src/controllers/yardplanner/layoutRoute.ts:14-24`). |
| `server/src/schemas/YardPlannerSchemas.ts` | `WallUpgradeSchema`, `TrapRearmSchema`, `TrapPlacementSchema`, `BATCH_TRAP_MAX = 200` (section 2.3). |
| `server/src/errors/errors.ts:459-479` | Add `batchBlockedErr(message, data)` at 409 beside `layoutUnplacedErr`; reuse `layoutInvalidErr` (400) for malformed or unowned input. |
| `server/src/database/models/save.model.ts` | `firedtraps` property next to `mushrooms` (`:360`), `@FrontendKey` so it rides on `/base/load`. **Not** added to `saveKeys` (`:443-500`): the client must not be able to write it. |
| `server/src/controllers/base/save/handlers/buildingDataHandler.ts:34-38` | When a trap key is dropped, push `{ t, X, Y, at }` onto `save.firedtraps`, keeping the last 200. |
| `server/src/controllers/yardplanner/applyLayout.ts:79-80` | Advance timers before moving `savetime` (section 2.4, "Timers"). |
| `docs/server-api.md:228-236` | Two rows in the Yard Planner table, and a sentence on `firedtraps` under the `Save` model (`:286-299`). |

### 2.2 Route contracts

Both routes are form-encoded, Bearer-authenticated, and mounted with `apiVersion`, `verifyUserAuth`
and `logRequest`, matching `server/src/app.routes.ts:174-177`. They act on the caller's main save
(`ctx.authUser.save`, populated as in `applyLayout.ts:48-50`).

| Method | Path | Request fields | Response |
|---|---|---|---|
| POST | `/api/:apiVersion/bm/yardplanner/walls/upgrade` | `ids` (JSON string of `number[]`, 1 to 1200 entries), `level` (integer target level) | `{ error: 0, upgraded: number, level: number, cost: { r1, r2, r3, r4 }, resources, buildingdata }` |
| POST | `/api/:apiVersion/bm/yardplanner/traps/rearm` | `traps` (JSON string of `{ t, x, y }[]`, 1 to 200 entries) | `{ error: 0, placed: number, ids: number[], cost: { r1, r2, r3, r4 }, resources, buildingdata, firedtraps }` |

`resources` and `buildingdata` are the save as the server now holds it, so the client re-reads them
rather than assuming its own arithmetic won, as `applyLayout` already does with `buildingdata`
(`web/src/api/yardplanner.ts:57-66`).

Rejections are `{ error: "<message>", ...detail }` with the real HTTP status, the shape the
`layouts` routes use (`docs/server-api.md:223-226`). Detail keys:

| Status | Key | Meaning |
|---|---|---|
| 400 | `unknown: number[]` | Ids not in the caller's `buildingdata`. |
| 400 | `notWalls: number[]` | Ids whose type is not 17 or 18. |
| 400 | `alreadyAtLevel: number[]` | Walls at or above the target. |
| 400 | `busy: number[]` | Walls with `cB`, `cU` or `cF`. |
| 400 | `damaged: number[]` | Walls with `hp` or a `buildinghealthdata` entry. |
| 400 | `level: unknown` | Target outside `[2, maxLevel(17)]`. |
| 400 | `notTraps: number[]` | Indexes of `traps` entries whose `t` is not 24 or 117. |
| 400 | `outOfBounds: number[]` | Indexes of trap entries outside the plot. |
| 400 | `overlapping: number[]` | Indexes of trap entries on another building, a mushroom or each other. |
| 409 | `shortfall: { r1, r2, r3, r4 }` | Resources missing, per type, after summing the cost. |
| 409 | `townHall: { have, need }` | An `re` gate on Town Hall level failed. |
| 409 | `requirements: [type, count, level][]` | Any other `re` gate failed. |
| 409 | `capReached: { type, have, max }` | Trap count would exceed `quantity[townHallLevel]`. |

Both routes are **all-or-nothing**. The client pre-filters walls already at the target and positions
it can see are blocked, so a refusal always names a real disagreement between the two sides.

### 2.3 Schemas

In `server/src/schemas/YardPlannerSchemas.ts`, following `SaveLayoutSchema` and `ApplyLayoutSchema`
(`:79-87`), which fall back to the empty string so the service can report a missing field in words:

```ts
export const WallUpgradeSchema = z.object({
  ids: z.string().catch(""),
  level: z.coerce.number().int().catch(0),
});

export const TrapPlacementSchema = z.object({
  t: z.number().int(),
  x: z.number().int(),
  y: z.number().int(),
});

export const BATCH_TRAP_MAX = 200;

export const TrapRearmSchema = z.object({
  traps: z.string().catch(""),
});
```

`ids` and `traps` are parsed the way `parsePayload` parses `data` (`validateLayout.ts:57-86`):
`JSON.parse`, then a zod array schema, with the first five issues echoed under `issues`.

### 2.4 Batch wall upgrade

`planWallUpgrade(save, ids, level)` in `server/src/services/yardplanner/wallUpgrade.ts` runs these
checks in order and throws on the first failure:

1. **Shape.** `ids` is a non-empty array of integers with no duplicates and at most
   `LAYOUT_NODE_MAX` entries (`YardPlannerSchemas.ts:30`). `level` is an integer.
2. **Ownership and type.** Every id is a key of `save.buildingdata` (the model is `checkNodesOwned`,
   `validateLayout.ts:95-133`) and its `t` is 17 or 18. A type 18 row is treated as a wall at
   `max(l ?? 1, 2)`, matching the Flash conversion at `BASE.as:1523-1526`, and is written back as
   `t: 17`.
3. **Target.** `2 <= level <= maxLevel(17)`, which is 5. Every wall is below `level`
   (`alreadyAtLevel`), has none of `cB`, `cU`, `cF` (`busy`, mirroring `BASE.as:3871-3882`), and has
   no `hp` and no `buildinghealthdata` entry (`damaged`, mirroring the countdown guard at
   `BFOUNDATION.as:1375` and the repair-instead-of-upgrade rule in spec `:917-919`).
4. **Prerequisites.** A town hall exists (`BASE.as:3863-3866`). For every wall and every step `k`
   from its level to `level - 1`, `requirementsMet(costs[k].re, buildingdata)` holds, where an entry
   `[type, count, need]` requires `count` buildings of `type` with `l >= need` and no `cB`
   (`BASE.as:3884-3932`). When the failing entry is type 14 the error carries `townHall: { have,
   need }`, otherwise `requirements`.
5. **Free-finish guard.** Every step's `time` is at most `FREE_FINISH_SECONDS`. Walls are 5 s, so
   this never fires for them; it is what stops the route being widened to a slow building later
   without a design change.
6. **Cost.** `cost = sumCosts(all steps of all walls)`. If any `save.resources.rN` is below `cost.rN`
   the error carries `shortfall`. Resources are read from the main save's `resources` column
   (`docs/server-api.md:288`).

The returned plan holds a new `buildingdata` with `l = level` (and `t = 17`) on every listed wall,
`cost`, `points = sum(pointsForUpgrade(step))` over every step, and `upgraded = ids.length`.

The controller then applies it atomically:

```ts
const now = getCurrentDateTime();
const elapsed = now - save.savetime;
save.buildingdata = advanceBuildingTimers(save.buildingdata, save.buildinghealthdata, elapsed);
const plan = planWallUpgrade(save, ids, level);
save.buildingdata = plan.buildingdata;
save.resources = updateResources(plan.cost, save.resources ?? {}, Operation.SUBTRACT);
save.points = String(Number(save.points ?? "0") + plan.points);
save.savetime = now;
postgres.em.persist(save);
await postgres.em.flush();
```

**Timers.** `advanceBuildingTimers` (`advanceBuildingTimers.ts:42-79`) runs before the plan is
computed so the `busy` check sees countdowns as they are now, and so moving `savetime` does not hand
every in-progress job the elapsed time twice. This is the same sequence the attack path uses
(`baseSave.ts:213-218`). Resource production over the same gap is not credited, which is the
existing limitation of every server-side write (`advanceBuildingTimers.ts:19`).

**Atomicity.** All changes land on one row in one `flush`, which MikroORM wraps in a transaction, so
a failure leaves resources and levels untouched together. There is no reservation step and no second
table. A Flash client saving at the same instant would overwrite the row with its own blob, exactly
as it can with Apply today; that race is pre-existing and out of scope.

**Points.** Mirrors `Upgraded()` at `BFOUNDATION.as:2455-2457`. See section 6.

### 2.5 Trap re-arm

**Recording fired traps.** `buildingDataHandler.ts:34-38` is the one place the server knows a trap
fired: the attacker's submission no longer includes it. When a trap key is dropped there, append
`{ t, X, Y, at: now }` to `save.firedtraps` and keep the newest 200. `firedtraps` is a new jsonb
column on `Save` (section 2.1), `@FrontendKey` so the web client receives it on `/base/load`, and
deliberately absent from `Save.saveKeys` so a client cannot write it.

`planTrapRearm(save, traps)` in `server/src/services/yardplanner/trapRearm.ts`:

1. **Shape.** `traps` is a non-empty array of `{ t, x, y }`, at most `BATCH_TRAP_MAX`, with `x` and
   `y` on the 5-unit grid (`docs/specs/base-building.md` §2, "The occupancy grid").
2. **Type.** Every `t` is 24 or 117 (`buildingDataHandler.ts:5-8`).
3. **Prerequisites.** A town hall exists; `requirementsMet(costs[0].re, buildingdata)` for each type
   used (`[[14, 1, 2]]` for 24, `[[14, 1, 4]]` for 117).
4. **Cap.** For each type, `countOfType(buildingdata, t) + requested(t) <= quantity[townHallLevel]`
   (`YARD_PROPS.as:2723`, `:6307`; spec `:400`).
5. **Placement.** Build a `FootprintRect` for every existing building with `rectOf`
   (`server/src/services/yardplanner/layoutGeometry.ts:76-79`) plus `mushroomRects(save.mushrooms)`
   (`:113-126`), then run the sweep from `checkNodePlacement` (`validateLayout.ts:140-198`) over
   existing rects plus the new ones, with bounds from `currentExpansion(save.storedata)`
   (`layoutGeometry.ts:60-65`). Footprints come from `footprintOf` in
   `server/src/game-data/buildingFootprints.ts` so client and server agree on trap size. Factor the
   sweep into a shared `sweepOverlaps(rects)` helper rather than copying it.
6. **Free-finish guard** on `costs[0].time`, then **cost** `sum(costs[0])` per trap against
   `save.resources`, with `shortfall` on failure.

The plan allocates ids `max(existing ids) + 1, + 2, ...` (`BFOUNDATION.as:1668-1669`,
`BASE.as:1591-1592`), writes each trap as `{ id, t, X, Y }` with no `l` (absent means 1,
`web/src/api/types.ts:113-118`) and no `cB` (a 5 s build finishes now under the free-finish rule),
computes `points = sum(pointsForBuild(costs[0]))`, and returns `firedtraps` with every entry whose
`{ t, X, Y }` matched a placed trap removed. The controller applies it with the same timer advance,
debit, points, `savetime` and single flush as walls.

Stale `buildinghealthdata` entries at 0 for the old ids are left alone; the Flash client keys health
by the buildings it has and ignores the rest, and pruning them is not this route's job.

### 2.6 Documentation

`docs/server-api.md:228-236` gains two rows:

| Method | Path | Middleware | Request fields | Response | Description |
|---|---|---|---|---|---|
| POST | `/api/:apiVersion/bm/yardplanner/walls/upgrade` | apiVersion, verifyUserAuth, logRequest | `ids` (JSON string, `number[]`), `level` | `{ error: 0, upgraded, level, cost, resources, buildingdata }` | Raises every listed wall (type 17, or legacy 18) to `level` at once, charging `costs[k]` for each step server-side and completing instantly under the 300-second free-finish rule (decision Q1). All-or-nothing: `400` for unknown, non-wall, busy or damaged ids or a bad level; `409 { shortfall }`, `{ townHall }`, `{ requirements }` for state. Countdowns are advanced to now before `savetime` moves. |
| POST | `/api/:apiVersion/bm/yardplanner/traps/rearm` | apiVersion, verifyUserAuth, logRequest | `traps` (JSON string, `{ t, x, y }[]`) | `{ error: 0, placed, ids, cost, resources, buildingdata, firedtraps }` | Builds a Booby Trap (24) or Heavy Trap (117) at each position, charging `costs[0]`, capped by `quantity[townHallLevel]`, checked against the plot, every building and every mushroom. New ids continue from the highest existing id. Matching entries are removed from `save.firedtraps`, which the attack save fills when a trap fires. |

---

## 3. Client

### 3.1 Cost table generator

New `web/tools/gen-building-costs.mjs`, run as `node tools/gen-building-costs.mjs` from `web/`. It
reuses the approach of `web/tools/gen-building-art.mjs`:

- strip `//` comments before parsing, keeping original line numbers for citations (`:41-50`);
- `matchBrace` to find the end of a block (`:52-70`);
- locate each entry by the nearest earlier `"id":` (`:79-84`), and its `"name"`, `"type"` and
  `"group"` the same way;
- display names from the string table `server/public/gamestage/assets/archived/en.v612.txt`
  (`:27-28`, `:204`);
- first occurrence of an id wins, matching `_buildingProps[id - 1]` (`:190-196`).

Per entry it reads `"costs": [ ... ]` (a `matchBrace` over the array), then each step's `r1`..`r4`
and `time` with a `new SecNum\((\d+)\)` regex and `re` as a nested integer array, plus `"quantity"`
as an integer array. Map Room 2 overrides for ids 5, 9, 15 and 22
(`client/scripts/GLOBAL.as:614-711`; spec `docs/specs/base-building.md:379-388`) are applied from a
hand-maintained block inside the generator, each cited by line, because this project runs Map Room 2
as the default overworld and the props table alone would price the Flinger, Juicer, Housing and
Bunker wrong. Walls and traps are unaffected by the overrides.

It writes two files with identical rows and a header naming the generator and the source lines:

| Output | Consumer |
|---|---|
| `web/src/game/yard/buildingCostData.ts` | `web/src/game/yard/buildingCosts.ts` |
| `server/src/game-data/buildingCosts.ts` | `server/src/services/yardplanner/costs.ts` |

Row shape, one per type, in the tuple style of `BUILDING_ART_ROWS`
(`web/src/game/yard/buildingArtData.ts:70-85`):

```ts
/** `[type, name, kind, group, costs, quantity]`; a cost step is `[r1, r2, r3, r4, time, re]`. */
export type CostStep = readonly [
  r1: number, r2: number, r3: number, r4: number, time: number,
  re: readonly (readonly [type: number, count: number, level: number])[],
];
export type CostRow = readonly [
  type: number, name: string, kind: string, group: number,
  costs: readonly CostStep[], quantity: readonly number[],
];
```

Size estimate: about 131 types with a mean of six levels; 30 to 45 KB per file.

Client helpers in `web/src/game/yard/buildingCosts.ts`:

| Export | Meaning |
|---|---|
| `costOf(type, level)` | `costs[level]`, the step that leaves `level`; `null` past the ladder. |
| `maxLevel(type)` | `costs.length` (spec `:412-413`). |
| `upgradeSteps(type, from, to)` | The steps `from .. to - 1`. |
| `sumCosts(steps)` | `{ r1, r2, r3, r4, time }`. |
| `instantCost(step)` | `int((ceil(sqrt((r1 + r2 + r3) / 2) ** 0.75) + timeCost(t)) * 0.95)` with `t = 0` when `time <= 300` (`BFOUNDATION.as:2114-2128`) and `timeCost` from `STORE.as:162-171`. |
| `requirementsMet(re, yard)` | Same rule as the server, over `Yard.buildings`. |
| `townHallLevel(yard)` | From `yard.townHall` (`web/src/game/yard/yardModel.ts:104-105`). |
| `kindOf(type)`, `quantityOf(type, hall)` | Props `type` and `quantity[hall]`. |
| `WALL_TYPES`, `TRAP_TYPES`, `FREE_FINISH_SECONDS` | Constants shared with the server by value. |

### 3.2 F3 cost and time panel

**Where.** The existing bottom bar (`web/src/ui/yard/PlannerBar.ts:99-119`) holds a single
`summary` span filled by `summarise` (`:169-183`). Replace the span with a `PlanSummary` element
that lays out, left to right: four resource cells reading "needed / held" with a `--short` class
when needed exceeds held; a time cell; a shiny cell; then the existing selection sentence. The bar
stays stateless: `update(state)` keeps the sentence, and a new `setSummary(summary)` rewrites the
cells.

**What.** Phase 1 nodes carry no `plan`, so the panel is selection-based: for the current selection,
the cost, worker time and shiny to take every selected building one level up, skipping those at
max level. Hovering the needed cells shows a breakdown by building type. Pure logic in a new
`web/src/game/yard/planner/summary.ts`:

```ts
export interface SelectionSummary {
  readonly needed: { r1: number; r2: number; r3: number; r4: number };
  readonly held: { r1: number; r2: number; r3: number; r4: number };
  readonly shortfall: { r1: number; r2: number; r3: number; r4: number };
  readonly seconds: number;
  readonly shiny: number;
  readonly byType: readonly { type: number; name: string; count: number; needed: Resources }[];
  readonly maxed: number;
}
export const summariseSelection = (nodes: readonly PlanNode[], yard: Yard): SelectionSummary;
```

`YardPlanner.ts:67` already rebuilds the bar on every session change; that callback also calls
`bar.setSummary(summariseSelection(session.selectedNodes(), yard))`. `selectedNodes()` is a new
accessor beside `selectedIds()` (`web/src/game/yard/planner/PlannerSession.ts:168-170`) returning
the `PlanNode`s of the selection. Summarising 400 walls per pointer move is a few hundred additions
and well inside the budget the drag already spends.

Formatting: extract `formatAmount` from `web/src/ui/Hud.ts:103-114` and `formatCountdown` from
`web/src/ui/yard/BuildingPanel.ts` into `web/src/ui/format.ts` so the bar, the panels and the HUD
share one spelling. Note the wall-clock time row from the design table is left out: with no
planned jobs there is nothing to divide by free workers.

### 3.3 Batch wall upgrade

1. **Entry.** The bottom bar gains "Upgrade walls" beside Checklist (`PlannerBar.ts:112-118`),
   enabled when the selection contains at least one wall; the tooltip says how many. New action
   `onUpgradeWalls` in `PlannerBarActions` (`:17-27`).
2. **Panel.** New `web/src/ui/yard/WallUpgradePanel.ts`, a `Panel` (`web/src/ui/Panel.ts`) opened
   through `openDialog` (`web/src/app/scenes/YardPlanner.ts:247-255`). Content: the selected walls
   grouped by current level; a target-level choice from 2 to `maxLevel(17)`, with levels above the
   town hall gate disabled and the reason as the button's title; the preview sentence from the
   design ("34 of 40 walls will go from level 4 to level 6; 6 already at level 6 or higher"); cost
   rows with shortfall in red; Confirm, disabled on any shortfall, and Cancel. The preview comes
   from `wallBatchPreview(nodes, target, yard)` in `summary.ts`, returning
   `{ eligible: number[], skipped: number[], steps, cost, shortfall, gate: { level, need } | null }`.
3. **Call.** Confirm calls `upgradeWalls(ids, level)` in `web/src/api/yardplanner.ts`, added beside
   `applyLayout` (`:65-66`):

   ```ts
   export const upgradeWalls = (ids: number[], level: number): Promise<WallUpgradeResponse> =>
     post<WallUpgradeResponse>(WALLS_UPGRADE_PATH, { ids: JSON.stringify(ids), level });
   ```

   Types in `web/src/api/types.ts` near the layout types (`:336-380`): `WallUpgradeResponse`,
   `TrapRearmResponse`, `TrapPlacement = { t, x, y }`, `FiredTrap = { t, X, Y, at }`, and
   `BaseLoadResponse.firedtraps?: FiredTrap[]` (`:183-202`). `applyConflictIds` (`:76-93`) learns
   the new detail keys (`notWalls`, `alreadyAtLevel`, `busy`, `damaged`) so refused ids get the red
   outline through `session.faultIds` (`PlannerSession.ts:281-284`).
4. **Refresh.** On success `YardPlanner` calls a new option `onYardChanged(buildingdata,
   resources)` (`YardPlannerOptions`, `YardPlanner.ts:28-42`). `YardScene` merges both into
   `this.save`, rebuilds the yard with `readYard`, calls `renderer.show(yard)` so the wall art
   changes level (type 17 has image levels 1 to 5), updates the HUD with `setResources`, and,
   unlike `onApplied` (`YardScene.ts:408-426`), does **not** close the planner. It then calls
   `planner.rebase(yard)`.
5. **Rebase.** `PlannerSession.rebase(yard)` is the new piece: `Plan.absorb(yard)` updates `level`
   and `fort` on existing nodes (make those two fields mutable in `PlanNode`,
   `web/src/game/yard/planner/placement.ts:55-68`), adds nodes for ids the yard has and the plan
   lacks (with `origin` set to their yard position), removes nodes the yard no longer has (erasing
   their occupancy), and leaves every position, `origin` entry and the undo stack alone. Then
   `view.syncAll()` and `view.resort()` put the freshly rebuilt sprites back where the plan has them
   (`web/src/game/yard/planner/PlannerView.ts:44-62`), and `refresh()` redraws the chrome.
6. **Notice.** "Upgraded 400 walls to level 5 for 280.0M twigs and 284.0M pebbles." Failures show
   the server's message through `describe` (`YardPlanner.ts:280-284`).

### 3.4 Trap re-arm

1. **Sources.** The count on the button is the union of `save.firedtraps` from the load response
   and, when a layout is loaded, the trap nodes `planLoad` reported as `missing`
   (`web/src/game/yard/planner/layout.ts:96-100`). `LoadResult.missing` becomes
   `{ id, t, x, y }[]` so the positions survive; the banner text at `YardPlanner.ts:167-172` keeps
   using the count. Positions are de-duplicated by `(t, x, y)`.
2. **Entry.** Bottom bar button "Re-arm traps" with a count badge, disabled at zero. Action
   `onRearmTraps`.
3. **Confirm.** A panel built in `web/src/ui/yard/PlannerDialogs.ts`, beside `checklistPanel`
   (`:22-70`): count per trap type, cost, shortfall, and any position the local check finds blocked
   (`Occupancy.blockedBy` and `inBounds` from `placement.ts`, the same calls `planLoad` makes at
   `layout.ts:106-115`) listed with a "show me" that frames the spot, so the player can clear it
   first. Confirm is disabled while anything is blocked or short.
4. **Call.** `rearmTraps(traps)` in `web/src/api/yardplanner.ts`, posting
   `traps: JSON.stringify(traps)`.
5. **Refresh.** Same `onYardChanged` and `rebase` path as walls; the new traps appear in the plan
   as unselected nodes at their positions and the HUD drops by the cost.

### 3.5 F16 search

1. **Entry.** Toolbar gains "Find" (`PlannerBar.ts:88-97`), shortcut `F`, added as
   `{ kind: "find" }` to `web/src/game/yard/planner/shortcuts.ts` and to the sheet in
   `PlannerDialogs.ts:80-96`. `PlannerInput` already lets keys typed into inputs through
   (`web/src/game/yard/planner/PlannerInput.ts:256-262`), so typing in the box does not switch
   tools.
2. **Panel.** New `web/src/ui/yard/SearchPanel.ts`, a `Panel` docked like the layouts panel
   (`web/src/app/scenes/YardPlannerLayouts.ts:53-63`): a text input with focus on open, six chips
   for the props kinds present in the yard (tower, special, resource, trap, wall, decoration) with
   count badges, and stacked rows "Name Lx x N" sorted by name then level, which is today's order
   in the Flash inventory (design F16). Clicking a row calls `selectAndFrame(ids)`
   (`YardPlanner.ts:237-245`); Enter selects every match. Empty state: "No buildings match 'xyz'."
   with a clear-search link (design §4.4).
3. **Logic.** Pure module `web/src/game/yard/planner/search.ts`:

   ```ts
   export interface SearchGroup {
     readonly type: number; readonly name: string; readonly level: number;
     readonly kind: string; readonly ids: readonly number[];
   }
   export const searchNodes = (
     nodes: Iterable<PlanNode>, query: string, kinds: ReadonlySet<string>,
   ): SearchGroup[];
   ```

   Matches case-insensitively on `buildingName(type)` (`web/src/game/yard/buildingArt.ts:74`) and
   on the type id as digits; an empty query with no chips returns everything grouped.

### 3.6 Styles and wiring summary

All new classes go in `web/src/ui/styles/planner.css`. Files touched on the client:

| File | Change |
|---|---|
| `web/src/game/yard/buildingCostData.ts` | Generated. |
| `web/src/game/yard/buildingCosts.ts` | New helpers (3.1). |
| `web/src/game/yard/planner/summary.ts`, `search.ts` | New pure modules. |
| `web/src/game/yard/planner/placement.ts:55-68` | `level` and `fort` mutable. |
| `web/src/game/yard/planner/plan.ts` | `absorb(yard)`; `add` stays private. |
| `web/src/game/yard/planner/PlannerSession.ts` | `selectedNodes()`, `rebase(yard)`, `find` action. |
| `web/src/game/yard/planner/layout.ts:52-67, 96-100` | `missing` carries `t`, `x`, `y`. |
| `web/src/game/yard/planner/shortcuts.ts` | `F` → `find`. |
| `web/src/api/types.ts`, `web/src/api/yardplanner.ts` | Types, `upgradeWalls`, `rearmTraps`, conflict keys. |
| `web/src/ui/format.ts` | Extracted `formatAmount`, `formatCountdown`. |
| `web/src/ui/yard/PlannerBar.ts` | Summary cells, three buttons, three actions. |
| `web/src/ui/yard/WallUpgradePanel.ts`, `SearchPanel.ts` | New. |
| `web/src/ui/yard/PlannerDialogs.ts` | Re-arm confirm panel, shortcut row. |
| `web/src/app/scenes/YardPlanner.ts` | Open the three panels, the two calls, `rebase`, `onYardChanged`. |
| `web/src/app/scenes/YardScene.ts` | `onYardChanged` handler that keeps the planner open. |
| `web/src/ui/styles/planner.css` | Styles. |

---

## 4. Tests and browser verification

### 4.1 Server (`bun test` from `server/`, `bun:test`)

The pattern is `server/src/game-data/buildingFootprints.test.ts`, which reads the sandbox fixture
`web/test/fixtures/baseload-sandbox-yard.json` (`:14-25`). That fixture is a real save with 575
buildings: 400 walls at level 1, 75 Booby Traps, 18 Heavy Traps, a level 10 Town Hall, no
damage, and resources in the billions.

| File | Cases |
|---|---|
| `game-data/buildingCosts.test.ts` | Every type in the fixture has a row; type 17 has five steps, each 5 s, with `re` `[[14, 1, k + 2]]`; types 24 and 117 have one step each at 5 s; the four Map Room 2 overrides match `GLOBAL.as`; every `time`, `rN` and `quantity` entry is a non-negative integer. |
| `services/yardplanner/costs.test.ts` | `upgradeSteps` and `sumCosts`; `requirementsMet` against a hand-built `buildingdata` for a met gate, an unmet level, an unmet count and a building under `cB`; `townHallLevel` with and without a hall; both points formulas against the values in the spec. |
| `services/yardplanner/wallUpgrade.test.ts` | Over the fixture: 400 walls level 1 to 5 costs 280,000,000 twigs and 284,000,000 pebbles and nothing else, writes `l: 5` on every id and touches nothing else; each rejection with its detail key; a type 18 row upgrades from level 2 and comes back as type 17; level 5 refused at Town Hall 5 with `townHall: { have: 5, need: 6 }`; `shortfall` names only the short resources. |
| `services/yardplanner/trapRearm.test.ts` | Ids continue from 601 on the fixture; cap refused at `quantity[hall]`; overlap with a building, with a mushroom and between two requested traps; out of plot for the current expansion; `firedtraps` loses only matched entries; points and cost. |
| `controllers/base/save/handlers/buildingDataHandler.test.ts` | A dropped trap lands in `firedtraps` with its `X`, `Y` and `t`; the list is capped at 200. |

The controllers stay thin enough that the service tests cover the rules; a controller test would
need a database.

### 4.2 Web (`vitest run` from `web/`)

| File | Cases |
|---|---|
| `src/game/yard/buildingCosts.test.ts` | Table integrity (mirrors the server test); `instantCost` returns 0 time component at or under 300 s and the design's example values above it; `WALL_TYPES` and `TRAP_TYPES`. |
| `src/game/yard/planner/summary.test.ts` | `summariseSelection` over a small yard: sums, shortfall, `byType`, `maxed`; `wallBatchPreview` eligible and skipped sets, gate at the town hall level, shortfall. |
| `src/game/yard/planner/search.test.ts` | Name match, id match, chip filter, grouping by type and level, sort order, empty query. |
| `src/api/yardplanner.test.ts` | Extend `applyConflictIds` for the new keys. |
| `src/game/yard/planner/PlannerSession.test.ts` | `rebase` keeps positions and the undo stack after a move, updates levels, adds a new trap node, removes a vanished node; `F` opens find without changing the tool. Uses the existing jsdom harness (`:1`, `:80-140`). |
| `src/ui/yard/WallUpgradePanel.test.ts` (jsdom) | Levels above the gate are disabled with a reason; the preview sentence; Confirm disabled on shortfall. |
| `src/ui/yard/SearchPanel.test.ts` (jsdom) | Rows and counts; empty state; Enter selects all matches. |

### 4.3 Browser verification

Use the sandbox account from the local dev notes (`yardtester@test.com`, `Dev12345!`): Town Hall
10, 400 walls at level 1, 75 Booby Traps, 18 Heavy Traps, resources in the billions.

1. Start Docker `db` and `redis`, `bun run dev` in `server/`, `npm run dev` in `web/`. Log in, open
   the yard, press P.
2. The bottom bar shows four "needed / held" cells at 0 with the held amounts. Select one Cannon
   Tower: its next-level cost, time and shiny appear; hover shows one row in the breakdown.
3. Press F, type "wooden": one row "Wooden Block L1 x400", wall chip count 400. Click it: 400
   selected, camera on the first.
4. Click "Upgrade walls", pick level 5. Preview reads 400 of 400; cost 280.0M twigs and 284.0M
   pebbles; Confirm. Walls redraw with level 5 art, the HUD drops by that amount, the notice
   reports 400 upgraded, Undo still lists the earlier moves, and the bar now reads 0 needed with
   every wall maxed.
5. Reload the page: the building panel on any wall shows level 5.
6. In psql, delete two Booby Trap rows from the account's `buildingdata` and append their
   `{ t, X, Y }` to `firedtraps`. Reload: "Re-arm traps" shows 2; Confirm; both reappear at those
   positions, resources drop by 2,000 of each of twigs, pebbles and putty, `firedtraps` is empty.
7. Save a layout, delete one Heavy Trap in psql without touching `firedtraps`, reload, load the
   layout: the banner reports 1 missing, "Re-arm traps" shows 1, and re-arming restores it.
8. Negative: set `r2` to 1,000 in psql, repeat step 4: the panel shows the pebble shortfall in red
   and Confirm is disabled; forcing the call from devtools returns 409 with `shortfall`.
9. Negative: in psql set the Town Hall to level 5; the level 5 button in the wall panel is disabled
   with "needs Town Hall 6", and forcing the call returns 409 with `townHall`.

---

## 5. Work packages

| # | Package | Contents | Depends on |
|---|---|---|---|
| WP0 | Cost table | `web/tools/gen-building-costs.mjs`; both generated files; `web/src/game/yard/buildingCosts.ts`; `server/src/services/yardplanner/costs.ts`; both integrity tests. | Nothing. Small; land first. |
| WP1 | Server | Schemas, `batchBlockedErr`, `wallUpgrade.ts`, `trapRearm.ts`, the two controllers, routes, `firedtraps` column and migration, `buildingDataHandler` change, the `applyLayout` timer fix, service tests, `docs/server-api.md` rows. | WP0 |
| WP2 | Client core | API types and functions, `summary.ts`, `search.ts`, `Plan.absorb`, `PlannerSession.rebase` and `selectedNodes`, `LoadResult.missing` positions, `format.ts`, shortcut, pure and session tests. | WP0 |
| WP3 | Client UI | Bottom-bar summary cells and buttons, `WallUpgradePanel`, re-arm confirm panel, `SearchPanel`, `YardPlanner` and `YardScene` wiring, `planner.css`, jsdom tests. | WP2 signatures (can start against them before WP2 lands) |
| WP4 | Verification and docs | The browser script in 4.3 against the running server, fix-ups on both sides, a dated note under `docs/design/yard-planner-redesign.md` §8 pointing at this plan. | WP1, WP3 |

WP1 and WP2 run in parallel once WP0 lands. WP3 can start alongside them if WP2's exported
signatures (`summariseSelection`, `wallBatchPreview`, `searchNodes`, `rebase`, the two API
functions and their types) are fixed up front.

---

## 6. Open questions and defaults

Each item below states the default this plan takes; the owner can overturn any of them.

| # | Question | Default and reason |
|---|---|---|
| 1 | Award empire points server-side for batch steps? | **Yes.** `Upgraded()` and `Constructed()` award them in the Flash client (`BFOUNDATION.as:2455-2457`, `:2892-2921`); skipping them would make a wall-maxed yard read a lower base level than the same yard built in Flash. |
| 2 | Record fired trap positions in a new `firedtraps` column? | **Yes.** It is the only way "last position" can be true for a player who never saved a layout; it is one column, one migration and six lines in `buildingDataHandler.ts`. If declined, the layout-derived source alone still drives the button and the route contract is unchanged. |
| 3 | Legacy type 18 walls | **Accepted as walls at level at least 2 and rewritten to type 17 on upgrade**, matching the Flash conversion (`BASE.as:1523-1526`). The web client's `readYard` keeps `t: 18` for display; that is a separate art question. |
| 4 | All-or-nothing or partial batch? | **All-or-nothing.** The client pre-filters walls already at the target and blocked trap spots, so a refusal always names a real disagreement, and the layout routes already work this way. |
| 5 | F3 content with no planned upgrades | **Selection-based next-level summary plus held resources.** It is what the wall flow needs anyway and it is meaningful for towers today; it becomes the plan summary when F1 lands. The wall-clock row is omitted until there are jobs to divide. |
| 6 | Shiny in F3 | **Shown, not purchasable**, per the design's own note (`docs/design/yard-planner-redesign.md:154-157`). |
| 7 | Sharper Tools (`BST`) build-time multiplier | **Ignored.** 5 s times 0.8 is still under the free-finish threshold, so it changes nothing for walls or traps. |
| 8 | Outposts | **Main yard only.** The planner has no outpost entry today (`web/src/api/base.ts:24-37`). |
| 9 | Stale `buildinghealthdata` zeros for old trap ids | **Left in place.** The Flash client ignores health for buildings it does not have; pruning belongs to a wider health cleanup. |
| 10 | The `applyLayout` `savetime` bump without advancing timers (`applyLayout.ts:80`) | **Fixed in WP1** with the same `advanceBuildingTimers` call the new routes use; it is a one-line change in the same file family. |
