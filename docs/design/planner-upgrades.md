# Yard Planner — Upgrades from the Planner (F1), Implementation Plan

Dated 2026-09-24. This is the implementation plan for GitHub issue #1, "Planner: upgrade and
fortify from inside the planner (F1)": select a building, see its current and next level, plan an
upgrade, and have Apply start the planned jobs against the real yard up to the number of free
workers, reporting the rest. It is scoped by the owner decisions in
`docs/design/yard-planner-redesign.md` §8 — above all Q1 (`:867`): **no job queue**, towers and
other buildings keep one job per worker, and "Apply starts as many planned upgrades as there are
free workers and reports the rest".

Every line number below cites the `revamp` branch as it stands today. Where the plan makes a choice
the owner has not ruled on, section 8 names the default taken and why.

Sections:

1. Scope
2. Data: the `plan` field on a layout node
3. Server
4. The economy audit
5. Client
6. Tests and browser verification
7. Work packages
8. Open questions and defaults

---

## 1. Scope

### 1.1 What is already in place, and the rules this plan inherits

**The cost table and the batch pattern.** Phase 1 shipped a generated cost table on both sides
(`server/src/game-data/buildingCosts.ts`, `web/src/game/yard/buildingCostData.ts`) and the first
server-side charged action, the batch wall upgrade (`docs/design/yard-planner-phase1-remainder.md`
§2.4). Its shape is the template for everything in section 3: a pure service that reads a slice of
the save and returns a plan or throws (`server/src/services/yardplanner/wallUpgrade.ts:163-302`),
and a thin controller that advances the countdowns, applies the plan, debits resources, adds points,
moves `savetime` and flushes once (`server/src/controllers/yardplanner/upgradeWalls.ts:46-66`).
`debitOf` (`:86-87`) is exported and reused as is.

**Apply is already server-authoritative for positions.** `POST /bm/yardplanner/apply` checks
ownership, the hard block on unplaced buildings (decision Q4), plot bounds and overlaps, then writes
`X` and `Y` only (`server/src/controllers/yardplanner/applyLayout.ts:60-98`). It already advances
every countdown before `savetime` moves (`:74-79`), which is exactly the state an upgrade walk needs
to start from.

**Nodes carry `l` and `fort` as advisory fields.** `LayoutNodeSchema` accepts them and Apply never
writes them (`server/src/schemas/YardPlannerSchemas.ts:45-48`); the client round-trips them
(`web/src/game/yard/planner/layout.ts:34-41`) and phase 1 deferred `plan: { level, fort }`
explicitly (`docs/design/yard-planner-phase1-remainder.md:113-115`).

**Workers.** The main yard has `1 + storedata.BEW.q` workers, capped at five
(`client/scripts/QUEUE.as:42-53`, the five-busy message at `:103-104`; spec
`docs/specs/base-building.md:728-739`). The count is derived from the `BEW` purchase, never stored as
its own field (spec `:741-743`); the server holds it in `save.storedata`
(`server/src/database/models/save.model.ts:332`) and the web client receives it in
`BaseLoadResponse.storedata` (`web/src/api/types.ts:201`), the same blob `readYard` already reads
`ENL.q` out of (`web/src/game/yard/yardModel.ts:181`). There is no queue: `QUEUE` is a fixed array
of slots and a job is either given one or refused (spec `:745-752`). Every build, upgrade and fortify
countdown holds a worker (spec `:774-782`); repairs do not (`:784-786`). Picking a mushroom also
holds one (`client/scripts/MUSHROOMS.as:197-206`) but leaves no trace in the save, so the server
cannot see it; section 8, item 6.

**The free-finish rule.** A countdown of 300 seconds or less is free to finish
(`client/scripts/BFOUNDATION.as:2063-2083`, `client/scripts/STORE.as:162-171`; spec `:809-836`).
Decision Q1 built the wall route on it: a step that short is written as finished, with no countdown
and no worker (`wallUpgrade.ts:263-273`, `FREE_FINISH_SECONDS` at
`server/src/services/yardplanner/costs.ts:49`). Beyond walls, the only main-yard upgrade steps at or
under the threshold are the four harvesters' level 1 to 2 steps at exactly 300 seconds
(`buildingCostData.ts`, types 1 to 4, `costs[1]`); every tower step is longer, the Cannon Tower's
level 1 to 2 alone is 900 seconds (`:273`).

**Upgrade rules.** `BASE.CanUpgrade` refuses without a Town Hall, at max level, while any countdown
runs, when `costs[level].re` is unmet and when any resource is short (`client/scripts/BASE.as:3828-
3932`; spec `:911-929`). A damaged building shows Repair instead of Upgrade (spec `:926-928`). A
free worker is checked before `CanUpgrade` (`:929-930`). The duration is
`int(costs[level].time * GLOBAL._buildTime)` where `_buildTime` is 0.8 while Sharper Tools (`BST`)
is active (`BFOUNDATION.as:2295`, `STORE.as:2513-2519`; spec `:932-939`, `:854-857`). `UpgradeB`
charges all four resources and sets `cU` (`BFOUNDATION.as:2283-2329`). Completion awards
`floor((time + r1 + r2 + r3 + r4) / 3)` points (`:2434-2461`; server `costs.ts:215-218`).

**Fortification has no ladder here.** No building in the Map Room 2 main-yard table sets
`can_fortify` (spec `:998-1006`), the generator skips `fortify_costs` on purpose
(`web/tools/gen-building-costs.mjs:204-207`), and the audit records a `fort` change as
`fortifyUnpriced` and never enforces it (`docs/design/economy-save-validation.md:347-354`, §6 item
4 at `:720`). Confirmed: there is nothing to price a fortify with. **Fortify is deferred**; see 1.3.

**The economy audit.** Every owner save of the main yard is now audited against the cost table
before any key is applied (`server/src/controllers/base/save/baseSave.ts:95-119`). The audit
compares the submitted save with the *reference yard*, the stored row with its countdowns advanced
to now (`server/src/services/base/economy/referenceYard.ts:62-70`). Its transition rules define what
a legal upgrade looks like: a new `cU` on a building is charged `costs[from]`, must satisfy the
same gates as `CanUpgrade`, and must sit in `[floor(time * bst) - elapsed - TOL, floor(time * bst)]`
(`server/src/services/base/economy/transitions.ts:229-273`; design `economy-save-validation.md:226`).
A server route that starts an upgrade does not go through the audit, but the *next* client save
does, so the state the route writes has to be one those rules accept. Section 4 checks that.

### 1.2 In scope

| Item | Summary |
|---|---|
| `plan` on layout nodes | `plan: { level, order }`, optional, in the version 2 format; validated on save; read on apply. |
| Inspector | A right-hand panel for one selected building: level, health now and next, the upgrade ladder with cost, time, shiny and gates; plan or clear. Multi-selection keeps today's cost summary. |
| Plan-based F3 bar | The bottom bar sums planned upgrades, shows worker time, wall-clock lower bound, `free / total` workers, jobs that start now versus wait, and the unplaced count. |
| Apply with upgrades | `POST /apply` gains `startUpgrades`; after moving, the server walks the planned nodes in the player's order, finishes free steps, starts one long step per building while workers and resources last, charges and reports. Partial by design. |
| Apply dialog | Itemised moves, upgrades that start, upgrades that wait, total deducted and what is left, "save first" (design §4.5). |
| Badges | A queued-upgrade mark on the canvas and the blueprint tile label (design §4.3). |
| Audit compatibility | Verified against the reference-yard rules (section 4). |

### 1.3 Deferred

- **Fortification.** No ladder exists (1.1). The node field is `plan: { level }` only; `fort` stays
  advisory. When Map Room 3 content arrives, `plan.fort` is an additive optional field and the walk
  in 3.4 gains a `cF` branch; nothing here has to change shape.
- **Shiny.** Instant finish is shown, never purchasable (design `yard-planner-redesign.md:152-157`,
  phase 1 §6 item 6).
- **Batch upgrade for towers (F2).** Q1 scopes F2 to walls and traps. The inspector plans one
  building; the wall panel stays the batch path.
- **Tower range and damage in the inspector.** The props table has `stats` (range, damage, rate,
  speed, splash) on thirteen tower types (`client/scripts/YARD_PROPS.as:1979`, `:2200`, `:2423`,
  `:2498`, `:2739`, `:6045`, `:6337`, `:6886`, `:7157`, `:7457`, `:7566`, `:7678`, `:7791`; the
  Flash upgrade text shows damage as `int(damage * 40 / rate)`, `client/scripts/BTOWER.as:144-147`),
  but neither generated table carries them (`buildingArtData.ts:70-78` has `hp` and `size`;
  `buildingCostData.ts` has `stats` only for the harvesters and the silo). The inspector therefore
  shows level, health, cost, time and shiny. Adding tower stats is a generator change; section 8,
  item 8.
- **Outposts.** Main yard only, as phase 1 (`web/src/api/base.ts:24-37`).
- **Keeping the planner open after Apply.** Apply closes the planner today
  (`web/src/app/scenes/YardScene.ts:581-598`); this plan keeps that and persists waiting jobs in the
  saved layout instead. Section 8, item 4.

---

## 2. Data: the `plan` field on a layout node

### 2.1 Shape

One optional object per node, in the version 2 layout format (design `yard-planner-redesign.md:
669-670`, `:681-682`):

```json
{ "id": 32, "t": 20, "x": 180, "y": -480, "l": 3, "plan": { "level": 5, "order": 2 } }
```

| Field | Meaning |
|---|---|
| `plan.level` | Target level. Integer, `2 <= level <= maxLevel(t)`, and above the node's current level. |
| `plan.order` | Position in the player's queue, a non-negative integer. Apply starts jobs in ascending `order`, ties by `id`. Assigned when the plan is set as `max(existing) + 1`, so the order the player planned in is the order they get. |

`fort` is not planned (1.3). Absent `plan` means no change, exactly as the design table says.

**No version bump.** The field is additive and optional. `LAYOUT_VERSION` stays 2
(`YardPlannerSchemas.ts:20`): a phase 1 server would strip it silently (`z.object` drops unknown
keys) and a phase 1 client would ignore it, and neither outcome is wrong, only lossy. Bumping to 3
would refuse every layout saved today for a field most nodes will not have.

### 2.2 Server schema and validation

`YardPlannerSchemas.ts`, beside `l` and `fort` (`:45-48`):

```ts
export const PlanSchema = z.object({
  level: z.number().int().min(2),
  order: z.number().int().nonnegative().default(0),
});
// in LayoutNodeSchema:
  /** Planned upgrade. Read by Apply when `startUpgrades` is set; validated on save. */
  plan: PlanSchema.optional(),
```

A new `checkPlans(nodes, buildingdata)` in `server/src/services/yardplanner/validateLayout.ts`,
called by both `saveLayout` (after `checkNodesOwned`, `saveLayout.ts:37`) and `applyLayout`:

| Rule | Detail | Failure |
|---|---|---|
| Ladder | `costOf(t)` exists and `plan.level <= maxLevel(t)` (`buildingCosts.ts`, `costs.length`) | 400 `planLevel: number[]` |
| Above current | `plan.level > levelOf(building)` measured against the caller's *save*, not the node's advisory `l` (`costs.ts:92-97`; a building under construction is level 0) | 400 `planCaughtUp: number[]` on save; on apply the node is **skipped** with reason `caughtUp` instead, because a layout saved before a job finished is not the client's fault |
| Type | The node's `t` is a type with a cost row (`kind` is not `decoration`, `mushroom`, `immovable`, `placeholder`) | 400 `planLevel` |

Save keeps the field verbatim; `makeLayout` (`server/src/services/yardplanner/layoutStorage.ts`)
copies nodes through, so no storage change is needed beyond the schema. The v1 conversion never
produces a `plan` (`layoutStorage.ts:44-52` builds `{ id, t, x, y }` only).

### 2.3 Client: `PlanNode`, save, load, apply, rebase

`PlanNode` (`web/src/game/yard/planner/placement.ts:61-75`) gains a mutable
`plan: { level: number; order: number } | null`. `Plan.fromYard` starts every node at `null`
(`plan.ts:95-130`).

| Path | Behaviour |
|---|---|
| **Set** | `Plan.setPlan(id, level \| null)`: refuses a fixed node, a busy node (F1 rule 3, design `:131-134`: the yard's `countdown !== null`, `yardModel.ts:63-64`), a damaged node (`condition !== HEALTHY`, `:58`), a level at or below the current one, and a level past `maxLevel`. Returns the previous value so the command can revert it. `order` is `max(order over planned nodes) + 1` on a new plan and kept on a change of level. |
| **Undo** | A new `planCommand(id, before, after, apply)` in `commands.ts` beside `moveCommand` (`:18-34`), label "Plan Cannon Tower to L5" / "Clear plan". Pushed through `stack.pushApplied` like a move (`PlannerSession.ts:558-560`), so it dirties the plan and undoes like everything else (F8). |
| **Save** | `toLayoutNode` (`layout.ts:34-41`) adds `...(node.plan ? { plan: node.plan } : {})`. |
| **Load** | `planLoad` (`layout.ts:100-143`) reads `saved.plan`; if `plan.level > node.level` and `<= maxLevel(node.type)` and the node is not busy or damaged, it is included in the returned `LoadResult` as `plans: { id, before, after }[]`, else counted in `plansDropped`. `PlannerSession.load` (`:328-350`) pushes one composite command (moves plus plans) so a load stays one undo entry; the banner (`YardPlanner.ts:293-299`) adds "N planned upgrades were dropped because those buildings have caught up". A preview applies plans too and restores them on dismiss (`:353-359` keeps positions today; extend the map to hold `plan`). |
| **Apply** | `payloadFor` (`layout.ts:28-32`) emits `plan` as part of the node. The client also sends `startUpgrades=1`. |
| **Rebase** | `Plan.absorb` (`plan.ts:298-346`) already copies level and fort; it now clears `plan` when `building.level >= plan.level`, and reports those ids in a new `AbsorbResult.plansDropped`. |
| **Mark** | `PlannerState` (`PlannerSession.ts:41-76`) gains `plannedCount`; `refresh` (`:576-584`) passes `planned: ReadonlyMap<id, level>` to the view for the badge (5.4). |

---

## 3. Server

### 3.1 Files

New:

| File | Contents |
|---|---|
| `server/src/services/yardplanner/workers.ts` | `WORKER_CAP = 5`, `workerCount(storedata)`, `busyWorkers(buildingdata)`, `sharperToolsMultiplier(storedata, now)`. Pure. |
| `server/src/services/yardplanner/startUpgrades.ts` | `walkUpgrades(save, nodes, now): UpgradeWalk` (section 3.4). Pure, throws only for malformed input. |
| `server/src/services/yardplanner/workers.test.ts`, `startUpgrades.test.ts` | Section 6.1. |

Modified:

| File | Change |
|---|---|
| `server/src/schemas/YardPlannerSchemas.ts:36-49, 85-87` | `PlanSchema`, `plan` on the node; `startUpgrades: z.coerce.number().int().min(0).max(1).catch(0)` on `ApplyLayoutSchema`. |
| `server/src/services/yardplanner/validateLayout.ts` | `checkPlans` (2.2). |
| `server/src/controllers/yardplanner/saveLayout.ts:37-38` | Call `checkPlans` after `checkNodesOwned`. |
| `server/src/controllers/yardplanner/applyLayout.ts:74-98` | After the move loop, when `startUpgrades === 1`: run the walk, debit, add points, respond with the report (3.3). |
| `server/src/services/base/economy/auditEconomySave.ts:277-278` | `sharperToolsActive` moves to `workers.ts` and is imported back, so the audit and the walk read `BST` from one place. |
| `docs/server-api.md:539-559` | The `apply` row grows the new field and response; a paragraph on the partial contract. |

`layoutRoute` (`server/src/controllers/yardplanner/layoutRoute.ts:14-24`) already wraps `apply`
(`server/src/app.routes.ts:179`), so rejections keep the flat shape.

### 3.2 Route contract

**Extension of `POST /api/:apiVersion/bm/yardplanner/apply`, not a new route.** One request moves
the buildings and starts the jobs in one flush, which is what makes "Apply" one transaction for the
player and one `savetime` move for the timers. A separate route would need two requests, two timer
advances and a client that has to explain a success followed by a failure. Design §5.3 sketched
exactly this shape (`startUpgrades` on apply, `yard-planner-redesign.md:720`).

| Field | Meaning |
|---|---|
| `data` | As today: JSON string of `{ version: 2, expansion, nodes }`, nodes now carrying `plan`. |
| `startUpgrades` | `1` to walk the plans after moving, `0` or absent to move only. A layout with plans sent with `0` moves and starts nothing. |

Response on success:

```ts
{
  error: 0,
  moved: number,
  buildingdata,                  // the save as the server now holds it
  resources,                     // likewise, so the HUD re-reads rather than subtracts
  upgrades: {
    started:  { id, t, from, to, seconds, cost }[],   // one long step, cU set
    finished: { id, t, from, to, cost }[],            // free-finish steps, written complete
    waiting:  { id, t, from, to, reason: "workers" }[],
    skipped:  { id, t, reason, detail? }[],            // see below
    cost: { r1, r2, r3, r4 },                          // total actually charged
    points: number,
    workers: { total, busyBefore, busyAfter },
  } | null,                                            // null when startUpgrades was 0
}
```

`skipped[].reason` is one of `shortfall` (with `{ r1..r4 }` still missing for that job), `busy`,
`damaged`, `townHall` (`{ have, need }`), `requirements` (`[type, count, level][]`), `caughtUp`
(the yard is already at or past `plan.level`), `noLadder` (no cost row). The detail keys are the
ones the batch routes already use (`docs/server-api.md:539-547`), so the client reads them the same
way.

Rejections, `{ error: message, ...detail }` with the real status, as every planner route:

| Status | Key | Meaning |
|---|---|---|
| 400 | existing keys | Everything `apply` refuses today (`unknown`, `mismatched`, `duplicated`, `outOfBounds`, `overlapping`, `blocked`). |
| 409 | `unplaced` | Unchanged (`errors.ts:474-482`). |
| 400 | `planLevel: number[]` | A `plan.level` past the ladder, or on a type with no ladder. |

**Partial by design.** Moves are all-or-nothing as today (any placement failure throws before
anything is written). Upgrades are walked and reported: a job the yard cannot do now is a row in
`waiting` or `skipped`, never a refusal of the whole request. This is decision Q1 verbatim and
design F1's "report started, skipped-for-resources, skipped-for-workers and
skipped-for-prerequisites" (`yard-planner-redesign.md:146-150`). Only *shape* faults are 400s,
mirroring `wallUpgrade.ts:171-211`, which treats a bad id or level as the client's fault and a
shortfall as the yard's state.

### 3.3 The controller

`applyLayout.ts`, after the move loop (`:82-89`) and before the write (`:91`):

```ts
let upgrades: UpgradeWalk | null = null;
if (body.startUpgrades === 1) {
  checkPlans(payload.nodes, buildingdata);           // 400 on a plan past the ladder
  upgrades = walkUpgrades(
    { buildingdata, buildinghealthdata: save.buildinghealthdata,
      resources: save.resources, storedata: save.storedata },
    payload.nodes, now);
  buildingdata = upgrades.buildingdata;
  save.resources = updateResources(debitOf(upgrades.cost), { ...(save.resources ?? {}) },
    Operation.SUBTRACT);
  save.points = String(Number(save.points ?? "0") + upgrades.points);
}
save.buildingdata = buildingdata;
save.savetime = now;
```

`buildingdata` here is the copy `advanceBuildingTimers` returned at `:75-79`, with the moves
applied, so the walk sees countdowns as they are now and positions as the layout has them. Ordering
matters for nothing in the walk (an upgrade does not read `X`/`Y`), but it keeps the report and the
returned `buildingdata` consistent.

`debitOf` is imported from `upgradeWalls.ts:86-87`. The whole change lands in one `flush`, which
MikroORM wraps in a transaction, the same atomicity argument as phase 1 §2.4.

### 3.4 The upgrade walk

`walkUpgrades(save, nodes, now)` in `startUpgrades.ts`:

1. **Candidates.** Every node with a `plan`, sorted by `plan.order` then `id`. The building is
   looked up in `buildingdata`; `checkNodesOwned` has already proved it exists and has the right
   type (`validateLayout.ts:107-146`), so a miss here is a programming error, not a 400.
2. **Workers.** `total = workerCount(storedata) = min(WORKER_CAP, 1 + (storedata.BEW?.q ?? 0))`
   (`QUEUE.as:42-53`, `:103-104`; `storeItems.ts:15-22` caps `BEW` at four purchases).
   `busy = busyWorkers(buildingdata)`, the count of buildings with `cB`, `cU` or `cF` above zero
   *after* the timer advance (spec `:774-782`). `free = max(0, total - busy)`. Outposts get one
   worker regardless (`QUEUE.as:45-49`) but the planner is main-yard only.
3. **Sharper Tools.** `bst = storedata.BST.e > now ? 0.8 : 1`, the reading the audit already uses
   (`auditEconomySave.ts:277-278`, `:390`; `STORE.as:2513-2519`).
4. **Per candidate**, with `level = levelOf(building)` (`costs.ts:92-97`):
   - `plan.level <= level` → `skipped: caughtUp`.
   - any of `cB`, `cU`, `cF` → `skipped: busy` (`BASE.as:3871-3882`; `wallUpgrade.ts:93-94`).
   - `hp` set or an entry in `buildinghealthdata` → `skipped: damaged` (spec `:926-928`;
     `wallUpgrade.ts:101-102`).
   - no Town Hall → `skipped: townHall { have: 0, need: 1 }` (`BASE.as:3863-3866`).
   - Then walk the steps `upgradeSteps(t, level, plan.level)` (`costs.ts:163-174`) **one at a
     time**, against the yard as this walk has changed it so far:
     - `requirementsMet(step.re, buildingdata)` else `skipped` with `requirementDetail`'s key
       (`transitions.ts:123-135` gives the same `townHall` / `requirements` split as
       `checkRequirements`, `wallUpgrade.ts:312-330`). The step *before* this one may already have
       been finished for free; that is fine, it was legal.
     - `shortfall(pool, step)` names anything → `skipped: shortfall` with the missing amounts.
       The pool is the save's `resources` minus everything this walk has charged so far.
     - `step.time <= FREE_FINISH_SECONDS` → **finished**: `l = level + 1`, no countdown, charged
       `step`, `pointsForUpgrade(step)` awarded now (`costs.ts:215-218`), no worker used, and the
       walk continues to the next step of the same building. This is the wall route's rule
       (`wallUpgrade.ts:263-273`) applied wherever it holds; for a Block planned to level 5 it
       reproduces the batch route exactly.
     - otherwise → needs a worker. `free === 0` → `waiting: workers`, stop this building.
       Else **started**: `cU = floor(step.time * bst)` (`BFOUNDATION.as:2295`; audit
       `transitions.ts:258`), charged `step`, `free -= 1`, no points yet (they are awarded at
       completion, `BFOUNDATION.as:2434-2461`), stop this building — one job per building, no
       queue. The remaining steps stay in the layout's `plan` for a later Apply.
5. **Result.** New `buildingdata`, the four totals actually charged, points, the four lists and the
   worker figures.

Two deliberate choices, both recorded in section 8:

- **The walk continues past a shortfall.** A cheaper job later in the queue still starts. Design
  F1 says "until workers or resources run out"; stopping at the first unaffordable job would make
  one expensive Town Hall plan silence every wall behind it. The client's preview (5.5) simulates
  the same walk in the same order, so the dialog already says what will happen.
- **Free steps do not consume a worker, long steps do.** In Flash a five-second wall still needed
  a worker (spec `:787-789`); Q1 removed that for walls and traps, and this plan applies the same
  reading to any step under the threshold rather than inventing a third category.

### 3.5 Timers, points and what the Flash client sees afterwards

`cU` is seconds remaining as of `savetime` (`server/src/services/base/advanceBuildingTimers.ts:3-24`).
The controller writes `cU = floor(time * bst)` and `savetime = now` in the same flush, so the job
starts ticking at `now`. On the next load the Flash client's `Setup()` re-registers it with
`QUEUE.Add` (`BFOUNDATION.as:3154-3182`) and, in catch-up, forces `_hasWorker` true
(`:2317-2320`), so the worker walk is not charged again.

**The destructive edge case is unchanged.** If the number of saved in-progress jobs ever exceeds
the loading session's worker count, Flash cancels and refunds the extras (spec `:804-815`). The walk
never starts more than `total - busy` jobs, so it cannot create that state on the main yard; an
outpost session (one worker) loading a main save with five jobs was already reachable before this
plan and stays out of scope.

**Points for started jobs are awarded by whoever completes them.** A free-finish step is complete
when written, so the walk awards its points at once, as the wall route does. A long step completes
later, either in the Flash client, which awards points in `Upgraded()` and saves them, or in
`advanceBuildingTimers` on the server (`:53-59`), which raises the level and awards nothing. The
second case is a pre-existing gap for every countdown that finishes between saves and is not
widened here; section 8, item 7.

### 3.6 Documentation

`docs/server-api.md:554` (the `apply` row) gains: request field `startUpgrades` (`0`/`1`); response
`resources` and `upgrades`; a sentence that upgrades are walked in `plan.order` and reported rather
than refused, with the `skipped` reasons; and the free-finish rule. The paragraph at `:539-547`
grows one line naming `apply` as the third route where the server decides a cost.

---

## 4. The economy audit

The walk writes server-side, so the audit does not run on it. The question is whether the *next*
owner save from a Flash client passes. Notation as in `economy-save-validation.md` §2 (`:139-152`):
**S** the stored save (what the walk wrote), **R** the reference yard, **T** the submitted save,
`TOL = 10`.

**A started job, saved 60 seconds later.** Cannon Tower (type 20) at level 1, plan level 2:
`costs[1]` is 10,000 twigs, 7,500 pebbles, 2,500 putty, 900 seconds (`buildingCostData.ts:273`).
The walk writes `l` absent (still 1), `cU = 900`, debits the three resources, `savetime = now`.
Sixty seconds on, the client saves `cU = 840`, `l` absent, and a resource delta measured from the
pool it loaded, which is the debited pool.

| Rule | Check | Result |
|---|---|---|
| Countdown shape (`transitions.ts:153-184`) | `sent (840) <= before (900)`; `R.cU = 840`, `earliest = 840 - 10 - 0 = 830 <= 840` | passes |
| Transition (`:295-361`) | `from = to = 1`; `R.cU > 0` so `running = "cU"`; `T.cU > 0` so not a cancel; `R.cU !== 0` so `startUpgrade` is **not** entered | charged nothing |
| Budget (`economy-save-validation.md:295-326`) | `spend_r = 0`; the delta is harvest only | passes |

The step was charged once, by the walk. Had the client instead been the one to start it, the audit
would have charged `costs[1]` through `startUpgrade` (`:272`) and checked `cU` against
`floor(900 * bst)` (`:258-270`); the walk sets exactly that value, so a save made in the same second
as the apply would pass that branch too.

**The same job, saved after it completes.** 900 seconds on, R has advanced the countdown to zero
and raised the level (`advanceBuildingTimers.ts:53-59`): `R.l = 2`, no `cU`. The client saves
`l = 2`, no `cU`. `from = to = 2`, nothing running, nothing charged, no violation. Points: the
client added `floor((900 + 20000) / 3) = 6966`; the audit's `completionPoints` is zero for this
building because the transition is `to === from` (`auditEconomySave.ts:408-414`, `:649-660`), so
the gain has to fit under the harvest term of the points budget. That is the pre-existing gap of
3.5 and it applies equally to a job the Flash client started itself.

**A free-finish step.** Twig Snapper (type 1) level 1 to 2, 300 seconds. The walk writes `l = 2`,
no countdown, charges `costs[1]`, awards points. The next save has `l = 2` in both S and T:
nothing to explain, nothing charged, and the points were added to `save.points` by the controller
so `points_S` already includes them. Passes.

**Sharper Tools.** With `BST.e > now` the walk writes `cU = floor(900 * 0.8) = 720`. The audit's
`bst` is read from the *stored* `storedata` at audit time (`auditEconomySave.ts:390`), which is the
same blob, so the shape check's upper bound is 720 and the first save after apply passes. If the
buff expires between apply and the client's save, the audit reads `bst = 1`, the bound is 900, and
a countdown of at most 720 is still under it. Safe in both directions.

**Resources.** The walk debits through `updateResources` (`updateResources.ts:29-46`), the same
call every save's `resourcesHandler` makes, and the response returns the pool so the web client
never subtracts on its own (5.6). The Flash client loads the debited pool. A Flash session open at
the same instant could overwrite the row with its own blob; that race exists for every planner
route today (phase 1 §2.4, "Atomicity") and is not widened.

**Reject mode.** Nothing above depends on `ECONOMY_SAVE_VALIDATION` (`server/src/config/
EconomyConfig.ts:31`): the state the walk writes is the state an honest client would have written,
so `log` and `reject` read it the same way.

---

## 5. Client

### 5.1 Files

New:

| File | Contents |
|---|---|
| `web/src/game/yard/planner/upgrades.ts` | Pure: `ladderFor(node, yard)`, `planTotals(nodes, yard)`, `previewApply(nodes, yard)` (5.5). Mirrors `startUpgrades.ts` rule for rule. |
| `web/src/game/yard/workers.ts` | `workerCount(storedata)`, `busyWorkers(yard)`; the client copy of `server/.../workers.ts`. |
| `web/src/ui/yard/InspectorPanel.ts` | The right-hand inspector (5.2). |
| Tests | Section 6.2. |

Modified:

| File | Change |
|---|---|
| `web/src/api/types.ts:343-352, 387-392` | `LayoutNode.plan?`, `ApplyLayoutResponse.resources`, `ApplyLayoutResponse.upgrades`, `UpgradeReport` types, `planLevel` in `ApplyConflictDetails` (`:402-416`). |
| `web/src/api/yardplanner.ts:72-73` | `applyLayout(payload, { startUpgrades })` posts `startUpgrades: "1"`. `CONFLICT_KEYS` (`:76-84`) gains `planLevel`. |
| `web/src/game/yard/yardModel.ts:94-108, 180-266` | `Yard.workers: { total, busy }` read from `storedata.BEW.q` and the countdowns. |
| `web/src/game/yard/planner/placement.ts:61-75` | `plan` on `PlanNode`. |
| `web/src/game/yard/planner/plan.ts` | `setPlan`, `plannedNodes()`, `absorb` clears caught-up plans. |
| `web/src/game/yard/planner/commands.ts` | `planCommand`, composite load command. |
| `web/src/game/yard/planner/layout.ts:28-41, 100-143` | Save and load `plan` (2.3). |
| `web/src/game/yard/planner/PlannerSession.ts` | `setPlan(id, level)`, `plannedCount` in state, `planned` map to the view, `selectedNode()` for the inspector. |
| `web/src/game/yard/planner/checklist.ts:49-103` | Two warning rows (5.5). |
| `web/src/game/yard/planner/PlannerOverlay.ts:22-33, 60-148` | `planned` badge (5.4). |
| `web/src/game/yard/planner/blueprint.ts:166-170` | Label "L3→5" for a planned tile. |
| `web/src/ui/yard/PlannerBar.ts:188-259, 313-342` | Plan-based cells, workers cell, unplaced cell (5.3). |
| `web/src/ui/yard/PlannerDialogs.ts` | `applyPanel` (5.5). |
| `web/src/app/scenes/YardPlanner.ts:172-185, 316-347, 498-504` | Inspector wiring, the dialog, the new apply call, results notice. |
| `web/src/app/scenes/YardScene.ts:581-598` | `onApplied` also takes `resources` and refreshes the HUD (`hud.setResources`, `web/src/ui/Hud.ts:99`). |
| `web/src/ui/styles/planner.css` | Inspector, badge and dialog styles. |

### 5.2 The inspector

**Where.** A `Panel` docked on the right of the canvas (design §4.1, `yard-planner-redesign.md:
500-545`), opened whenever exactly one building is selected and closed when the selection is empty or
plural. It replaces nothing: the read-only `BuildingPanel` (`web/src/ui/yard/BuildingPanel.ts`)
stays the yard's inspector outside planner mode, and its disabled Upgrade button (`:28`, `:61-63`)
stays disabled there, because the yard screen is read-only and the planner is where upgrades live.
For a multi-selection the panel shows `summariseSelection` (`summary.ts:158-214`) as a cost table,
which is today's bottom-bar content moved up, plus the "Upgrade walls" button when walls are in it.

**Content for one building**, top to bottom:

| Row | Source |
|---|---|
| Name, type id, position | `buildingName` (`buildingArt.ts:74`), node `x`, `y`. |
| Level `n` of `max` | `node.level`, `maxLevel(type)` (`buildingCosts.ts:95`). Level 0 reads "under construction". |
| Health | `maxHealth(type, level)` (`buildingArt.ts:94-99`), and current `hp` from the yard when damaged. |
| State | "Upgrading, 3h 12m left" from the yard's `countdown` (`yardModel.ts:63-64`), "Damaged: repair first", or nothing. Either state disables the ladder with the reason as the button titles. |
| Next level | Health at `level + 1`, and `costOf(type, level)` as cost, time (`formatCountdown`, `web/src/ui/format.ts:36-46`) and shiny (`instantCost`, `buildingCosts.ts:169-174`). |
| Upgrade ladder | One button per target from `level + 1` to `max`, the last labelled "Max". Each button's title carries the cumulative cost and time from the current level (`upgradeSteps` + `sumCosts`, `:122-146`) and, where a step's `re` is unmet now, "needs Town Hall 8" or the requirement list (`requirementsMet`, `:184-192`; `townHallLevel`, `:200-201`). The selected target is `aria-pressed`. |
| Plan line | "Planned: L3 → L5, 2 steps, 1d 2h, 300.0K twigs…" or "Nothing planned". A "Clear" button. |
| Gate note | When the target passes an unmet gate: "The first step can start now; later steps wait until Town Hall 8." When the *first* step is gated: "Nothing will start until Town Hall 8. It stays planned." |

**Gated levels stay clickable.** A player planning past a Town Hall they are also planning to
raise wants both in the queue; Apply reports what it could not start (3.4). This differs from the
wall panel, which disables gated levels (`WallUpgradePanel.ts:113-117`), because that panel *acts*
on Confirm and this one only plans. What is refused outright is a busy or damaged building (F1 rule
3) and a level at or below the current one.

**Logic** lives in `upgrades.ts`:

```ts
export interface LadderStep {
  readonly level: number;            // the target this button sets
  readonly cost: CostTotals;         // cumulative from the current level
  readonly shiny: number;
  readonly gate: { townHall?: { need: number }; requirements?: CostRequirement[] } | null;
  readonly firstStepGated: boolean;
}
export const ladderFor = (node: PlanNode, yard: Yard): {
  readonly current: number; readonly max: number;
  readonly healthNow: number | null; readonly healthNext: number | null;
  readonly blocked: "busy" | "damaged" | "maxed" | null;
  readonly steps: readonly LadderStep[];
};
```

Clicking a level calls `session.setPlan(id, level)`, which pushes the command and refreshes; the
panel re-renders from `state()` and the node, never from its own copy.

### 5.3 The plan-based F3 bar

The six cells in the bottom bar (`PlannerBar.ts:192-205`, `setSummary` at `:313-342`) change
meaning from "the selection's next level" to "the plan" (design F3 table, `yard-planner-redesign.md:
173-196`; phase 1 §6 item 5 said this is what happens when F1 lands).

| Cell | Value | Source |
|---|---|---|
| Twigs, Pebbles, Putty, Goo | needed / held, `--short` when needed exceeds held | `planTotals(plan.plannedNodes(), yard)`: `sumCosts` over `upgradeSteps(type, level, plan.level)` per planned node; held from `yard.resources` (`summary.ts:112-117`). Tooltip breakdown by type as today (`:386-402`). |
| Time | total worker seconds; tooltip "lower bound `max(longest chain, ceil(total / max(free, 1)))` with `free` workers; jobs do not parallelise perfectly" | design table row "Wall-clock time". |
| Shiny | `instantCost` summed over every step | shown, not purchasable. |
| **Workers** (new) | "2 free / 5" | `yard.workers` (5.1). Tooltip: "N jobs start on Apply, M wait for a worker, K finish instantly" from `previewApply` (5.5). |
| **Unplaced** (new) | count of non-decoration buildings not placed | today always 0: nothing can be unplaced (phase 1 §1.3). The cell reads the same `unplaced` list the checklist takes (`checklist.ts:52`), so the store tool turns it on rather than adds it. Hidden at zero to keep the bar short. |

`refreshBar` (`YardPlanner.ts:498-504`) calls `bar.setSummary(planTotals(...), preview)` instead of
`summariseSelection`. The selection sentence (`PlannerBar.ts:404-419`) gains "N planned". The wall
count and the "Upgrade walls" button are unchanged.

### 5.4 The badge

Design §4.3 (`yard-planner-redesign.md:578-595`): "small upward chevron badge on the building,
tinted green, with the target level", and colour never the only channel. `PlannerVisuals`
(`PlannerOverlay.ts:22-33`) gains `planned: ReadonlyMap<number, number>`; `draw` (`:60-148`) adds
one more batched path: a small chevron polygon at the top corner of each planned footprint, green
fill, dark stroke. The level number is not drawn on the canvas (text in a `Graphics` batch is a
different cost class); the blueprint's tile label, which already prints the level
(`blueprint.ts:166-170`), prints "3→5" for a planned tile, and the isometric tooltip is the
inspector. `PlannerView.draw` (`PlannerView.ts:88-95`) passes the map through.

### 5.5 Apply: preview, dialog, call, result

**Preview.** `previewApply(nodes, yard)` in `upgrades.ts` runs the walk of 3.4 on the client, in
the same order, against `yard.workers.total - yard.workers.busy` and `yard.resources`, returning
`{ started, finished, waiting, skipped, cost, remaining }` with the same shapes as the response.
It is not authoritative; it exists so the dialog and the bar say what the server will do, and so a
test can assert the two agree on the fixture.

**Checklist.** `buildChecklist` (`checklist.ts:49-103`) gains two **warning** rows from the preview,
the ones F17 lists as warnings (`yard-planner-redesign.md:465-467`): "Enough resources for the
planned upgrades" listing `skipped: shortfall` ids, and "Enough free workers" listing `waiting`
ids. A third, "No planned upgrade is blocked by a prerequisite", lists `skipped: townHall |
requirements`. Warnings do not block Apply (`Checklist.ok` stays the blocking rows' `every`); the
panel (`PlannerDialogs.ts:29-77`) draws them with a distinct mark and the Apply button badge counts
blocking rows only.

**Dialog.** `applyPanel` in `PlannerDialogs.ts`, opened by `apply()` (`YardPlanner.ts:316-347`)
once the blocking checklist passes, in the shape of design §4.5 (`yard-planner-redesign.md:
609-640`):

- "N buildings will move" from `plan.movedIds()` (`plan.ts:164-170`);
- "K upgrades will start now", itemised by building name, from → to, cost and time, and "F will
  finish at once" for free steps;
- "M will wait for a free worker" and "S cannot start" with each reason;
- "Total deducted now" and "You will have left", per resource, red where the remainder is short of
  a later job;
- a checkbox "Save to '<slot name>' first", shown when a slot is loaded and the plan is dirty,
  defaulting on. It calls `YardPlannerLayouts.save(slot, name)` (`YardPlannerLayouts.ts:101`) and
  waits for it before applying. Without a loaded slot the line reads "Waiting upgrades are kept
  only in a saved layout" with a "Save as…" link that opens the layouts panel.
- Cancel, Apply.

A plan with no upgrades shows the one-line moves summary and no itemisation, matching the design's
"Moves alone need no dialog beyond a summary line".

**Call.** `applyLayout(this.session.payload(), { startUpgrades: true })`.

**Result.** `onApplied(buildingdata, moved, resources, upgrades)`: `YardScene.onApplied`
(`YardScene.ts:581-598`) merges `resources` as `onYardChanged` does (`:612-624`), updates the HUD,
rebuilds the yard and closes the planner as today. The notice reads, for example, "Moved 42
buildings. Started 3 upgrades for 21.0M twigs, 15.8M pebbles and 1.5M putty; 1 finished at once;
2 are waiting for a worker; 1 skipped: needs Town Hall 8." built with `describeCost`
(`YardPlanner.ts:581-592`). Failures go through `applyConflictIds` (`yardplanner.ts:117-134`) as
today, with `planLevel` added to the keys.

### 5.6 Read-only sessions

A read-only planner (design §8 Q5; `PlannerSession.ts:87-93`) may open the inspector and read the
ladder, but `setPlan` returns without pushing, the ladder buttons are disabled with the read-only
reason, and Apply is already absent from the bar (`PlannerBar.ts:237-244`).

---

## 6. Tests and browser verification

### 6.1 Server (`bun test` from `server/`)

The fixture is `web/test/fixtures/baseload-sandbox-yard.json` as `wallUpgrade.test.ts:11-38` loads
it: 575 buildings, `storedata.BEW.q = 4` (five workers), no countdowns, no damage, a level 10 Town
Hall, six Cannon Towers at level 1, and resources in the billions.

| File | Cases |
|---|---|
| `services/yardplanner/workers.test.ts` | `workerCount`: absent `BEW` is 1, `q: 4` is 5, `q: 9` is still 5. `busyWorkers`: counts `cB`, `cU` and `cF`, ignores `rE` and `hp`. `sharperToolsMultiplier`: 0.8 while `BST.e > now`, 1 after. |
| `services/yardplanner/startUpgrades.test.ts` | Six Cannon Towers planned to level 2 in order: five `started` with `cU = 900`, one `waiting`; `cost` is exactly five times `costs[1]`; `buildingdata` for the waiting tower is untouched. Order: reversing `plan.order` reverses which one waits. A Block planned 1 to 5: four `finished` steps, `l = 5`, no `cU`, no worker used, points equal to the wall route's. Cannon planned 1 to 3: one `started` (level 2 step), the level 3 step reported nowhere and the plan left for later. `BST.e > now`: `cU = 720`. Busy (`cU` preset), damaged (`hp`), `caughtUp` (`plan.level` at the current level), `townHall` (hall set to level 1, a step wanting 2), `requirements` (a non-hall gate), `shortfall` (`r2` set to 1,000: the first job skipped, a cheaper wall behind it still finishes), `noLadder`. Malformed: `plan.level` past the ladder throws `layoutInvalidErr` with `planLevel`. |
| `services/yardplanner/validateLayout.test.ts` | `checkPlans`: past the ladder, on a decoration, at or below the save's level. |
| `services/base/economy/transitions.test.ts` (extend) | **Audit compatibility (section 4).** Build S as the walk's output for a Cannon Tower (`cU = 900`, resources debited); T sixty seconds later with `cU = 840`: `explainTransition` charges nothing and reports no violation. T 900 seconds later with `l = 2`, no `cU`: no violation. The same pair with `bst = 0.8` and `cU = 720`. |

Controllers stay thin enough that the service tests cover the rules, as in phase 1; a controller
test would need a database.

### 6.2 Web (`vitest run` from `web/`)

| File | Cases |
|---|---|
| `src/game/yard/workers.test.ts` | Mirrors the server file over a `readYard` yard. |
| `src/game/yard/planner/upgrades.test.ts` | `ladderFor`: steps, cumulative cost and shiny read by hand from `buildingCostData.ts` (Cannon 1 to 3 is 60,000 twigs, 45,000 pebbles, 15,000 putty, 3,600 s); gates from a level 1 hall; `blocked` for busy, damaged, maxed. `planTotals`: sums and shortfall. `previewApply`: agrees with the server test's expectations on the same buildings, including the shortfall-then-cheaper case and the worker cut-off. |
| `src/game/yard/planner/plan.test.ts` (extend) | `setPlan` refuses fixed, busy, damaged, at-level, past-max; assigns `order`; `plannedNodes` order; `absorb` drops a caught-up plan and reports it. |
| `src/game/yard/planner/layout.test.ts` (new) | `payloadFor` writes `plan`; `planLoad` applies a valid plan, drops one the yard has caught up on and one on a busy building, and counts them. |
| `src/game/yard/planner/PlannerSession.test.ts` (extend, jsdom harness `:1-60`) | A plan is one undo entry and dirties the stack; undo clears it; a load with plans undoes in one step; `state().plannedCount`; read-only refuses. |
| `src/ui/yard/InspectorPanel.test.ts` (jsdom) | One building: rows, ladder buttons with titles, gated level enabled with the reason, busy building disabled with the reason, click calls `setPlan`, Clear. Multi-selection: the cost table and the wall button. |
| `src/ui/yard/PlannerBar.test.ts` (extend) | Plan cells from `planTotals`, the workers cell text, unplaced hidden at zero. |
| `src/ui/yard/PlannerDialogs.test.ts` (new, jsdom) | `applyPanel`: itemised rows, totals, remaining, the save-first checkbox present only with a loaded dirty slot, Apply calls through with the flag. |
| `src/api/yardplanner.test.ts` (extend) | `applyLayout` posts `startUpgrades: "1"`; `applyConflictIds` reads `planLevel`. |

### 6.3 Browser verification

Use the sandbox account from the local dev notes (`yardtester@test.com`, `Dev12345!`, userid 2503):
Town Hall 10, five workers (`BEW.q = 4`), 400 level 1 walls, six Cannon Towers at level 1, resources
in the billions. Every step below mutates the yard, so **snapshot `bym.save` for userid 2503 first
and restore afterwards**, as the notes require:

```sh
docker exec bymr-database pg_dump -U postgres -d bym -t save --data-only \
  --column-inserts -f /tmp/save-2503.sql            # then filter to userid 2503, or
docker exec bymr-database psql -U postgres -d bym \
  -c "create table save_snapshot_2503 as select * from save where userid = 2503;"
# restore:
docker exec bymr-database psql -U postgres -d bym -c \
  "update save s set buildingdata = t.buildingdata, resources = t.resources, points = t.points,
   savetime = t.savetime, savetemplate = t.savetemplate, storedata = t.storedata
   from save_snapshot_2503 t where s.userid = 2503 and t.basesaveid = s.basesaveid;"
```

1. Start Docker `db` and `redis`, `bun run dev` in `server/`, `npm run dev` in `web/`. Log in, open
   the yard, press P. The bottom bar reads "Workers 5 free / 5", every cost cell 0 / held.
2. Click one Cannon Tower. The inspector shows "Level 1 of 10", health 6,000 now and 9,000 next
   (`buildingArtData.ts:195`), next step 10.0K twigs, 7.5K pebbles, 2.5K putty, 15m 0s. Click
   "L3": the plan line reads two steps, 3,600 s; the bar's cells move by the cumulative cost; a
   green chevron sits on the tower; Undo lists "Plan Cannon Tower to L3".
3. Plan the other five Cannon Towers to L2 (six planned). The Workers tooltip reads "5 start on
   Apply, 1 waits". Press Tab: the blueprint tiles read "1→3" and "1→2".
4. Plan the Town Hall to L11: the button is absent (max is 10). Plan a Sniper Tower to L9 and hover
   "L9": the title names the Town Hall level its last step needs; the plan line says the first step
   starts now and later steps wait.
5. Press F, find "Block", select all 400, plan them to L5 through the inspector's multi-selection
   wall button *or* leave them for the batch route; this plan uses the batch route for walls, so
   confirm the inspector offers "Upgrade walls" and not a per-wall ladder for a multi-selection.
6. Save to slot 0 as "F1 test". Apply. The dialog itemises 0 moves, 5 upgrades starting, 1
   waiting, the total deducted and the remainder; the save-first box is unchecked because the slot
   is clean. Apply. The planner closes; the notice reports 5 started and 1 waiting; the HUD drops
   by five times the Cannon step; the building panel on a started tower shows "Upgrading" with a
   countdown near 15 minutes; the waiting tower shows none.
7. In psql, read the row: five `cU` values within a few seconds of 900, `resources` reduced,
   `savetime` current, `points` unchanged (long steps award on completion).
8. Reopen the planner and load "F1 test": the five started towers are still level 1 with `cU`
   running, so the banner reports their plans dropped as busy, and the sixth stays planned. The
   Workers cell reads "0 free / 5". Apply: the dialog says the one job waits; Apply reports 0
   started, 1 waiting.
9. In psql, set `storedata.BST = { "e": <now + 3600> }` and clear one tower's `cU`. Reload, plan
   that tower to L2, Apply: its `cU` is 720.
10. In psql, set one Twig Snapper's `l` absent (level 1). Plan it to L2 (300 s step). Apply: it is
    in `finished`, `l = 2` at once, no worker used, `points` rose by `floor((300 + r1 + r2 + r3 +
    r4) / 3)` for that step.
11. Negative: set `r2` to 1,000 and plan a Cannon Tower to L2 and a Block to L2 behind it. The
    checklist shows the resources warning on the tower; the dialog lists it as skipped and the wall
    as finishing; Apply reports exactly that.
12. Negative: force a `plan.level` of 99 from devtools: 400 with `planLevel`, and the tower gets
    the red outline.
13. Audit check: with the server in `log` mode (the default, `EconomyConfig.ts:31`), load the yard
    in the archived Flash client and let it save once, or replay a captured `/base/save` body with
    `cU` reduced by the elapsed seconds; the log shows no `countdownJumped`, `unpaidUpgrade` or
    `resourceBudget` line for the account.
14. Restore the snapshot.

---

## 7. Work packages

| # | Package | Contents | Depends on |
|---|---|---|---|
| WP0 | Schema and shared rules | `PlanSchema`, `plan` on `LayoutNodeSchema`, `startUpgrades` on `ApplyLayoutSchema`; `checkPlans`; `server/.../workers.ts` and `web/.../workers.ts` with tests; `LayoutNode.plan` and the response types in `web/src/api/types.ts`; `Yard.workers`. Fixes the wire contract so WP1 and WP2 can run in parallel. | Nothing. Small; land first. |
| WP1 | Server walk | `startUpgrades.ts` and its tests, `applyLayout.ts` extension, `saveLayout.ts` call, `sharperToolsActive` move, `transitions.test.ts` audit-compatibility cases, `docs/server-api.md` row. | WP0 |
| WP2 | Client core | `PlanNode.plan`, `Plan.setPlan` / `plannedNodes` / `absorb` change, `planCommand` and the composite load command, `layout.ts` save and load, `PlannerSession` plan API and state, `upgrades.ts` (`ladderFor`, `planTotals`, `previewApply`), checklist warning rows, `applyLayout` option; pure and session tests. | WP0 |
| WP3 | Client UI | `InspectorPanel`, plan-based `PlannerBar` cells, badge in `PlannerOverlay` and the blueprint label, `applyPanel`, `YardPlanner` and `YardScene` wiring, `planner.css`, jsdom tests. | WP2 signatures (can start against them before WP2 lands) |
| WP4 | Verification and docs | The browser script in 6.3 against the running server with snapshot and restore, fix-ups on both sides, a dated note under `docs/design/yard-planner-redesign.md` §8 pointing at this plan, and a line in `docs/design/yard-planner-phase1-remainder.md` §1.4 marking the first bullet delivered. | WP1, WP3 |

WP1 and WP2 run in parallel once WP0 lands. WP3 can start alongside them if WP2's exported
signatures (`ladderFor`, `planTotals`, `previewApply`, `setPlan`, `plannedCount`, the response
types) are fixed up front, which WP0 does for the wire types.

---

## 8. Open questions and defaults

Each item below states the default this plan takes; the owner can overturn any of them.

| # | Question | Default and reason |
|---|---|---|
| 1 | New route or extend `apply`? | **Extend `POST /apply` with `startUpgrades`.** One request, one timer advance, one `savetime`, one flush; design §5.3 sketched this shape (`yard-planner-redesign.md:720`). A separate route would make "Apply" two transactions the player has to reason about. |
| 2 | Player's order or cost order? | **Player's order**, stored as `plan.order` and assigned as the player plans. The design says "in the player's chosen order" (`:147-148`). Cost order is a sort the dialog could offer later without a data change. |
| 3 | Stop at the first unaffordable job, or continue? | **Continue.** A cheaper job further down still starts; the preview shows the same outcome before the click, so nothing is a surprise. Stopping would let one expensive plan silence every wall behind it. |
| 4 | Keep the planner open after Apply? | **No, close it as today** (`YardScene.ts:581-598`). Waiting jobs survive in the saved layout, which the dialog offers to save first; keeping the planner open needs `rebase` to reconcile started jobs against plans and is a separate change with its own undo questions. |
| 5 | Should planning refuse gated levels? | **No; mark them.** A player planning Town Hall 8 and Cannon L8 together wants both queued. Apply reports the gate (`skipped: townHall`); the checklist warns before that. Busy and damaged buildings *are* refused, per F1 rule 3. |
| 6 | Workers held by a mushroom pick | **Ignored.** The pick holds a Flash worker (`MUSHROOMS.as:197-206`) but leaves nothing in the save, so neither side can count it; the web client cannot pick mushrooms at all. Worst case the Flash client, on next load, finds one more job than workers and cancels-and-refunds it (spec `:804-815`), which is the existing outpost edge case. |
| 7 | Points for a long step that completes in `advanceBuildingTimers` | **Not addressed here.** The server raises the level (`advanceBuildingTimers.ts:53-59`) and awards nothing; the Flash client awards on completion and the audit's `completionPoints` misses reference-completed jobs (`auditEconomySave.ts:408-414`, `:649-660`). Pre-existing for every countdown that finishes between saves; belongs to the audit's follow-up, and this plan does not widen it. |
| 8 | Tower range and damage in the inspector | **Deferred.** Thirteen tower types carry `stats` in the props file (1.3) but neither generated table does. Adding `[range, damage, rate]` per level to the cost generator is one afternoon and would let the inspector print range and `int(damage * 40 / rate)` as the Flash upgrade text does (`BTOWER.as:144-147`); it is not needed for anything Apply does. |
| 9 | Free-finish steps beyond walls | **Finished on the spot, no worker**, the same reading Q1 gave walls. The only main-yard cases are the harvesters' 300-second level 1 to 2 steps; the guard is per step, so a regenerated table cannot widen it silently. |
| 10 | Multi-level plans | **One long step per Apply, the rest stays planned.** One job per building and no queue (Q1); free steps before a long one are finished in the same walk. The inspector says so on the plan line. |
| 11 | Version bump for `plan` | **No.** Additive optional field; a bump would refuse every layout saved today. |
| 12 | Fortify | **Deferred until a ladder exists** (1.1, 1.3). `plan.fort` is an additive field when it comes. |
