# Economy Save Validation — Implementation Plan (issue #24)

Dated 2026-09-23. This is the implementation plan for GitHub issue #24, "Server: validate economy
saves (costs, timers, storage caps, levels)". Today an owner save adds the client's resource delta
with no check and takes building levels, countdowns and placement verbatim
(`docs/specs/base-building.md:1450-1469`). The plan makes `/base/save` audit every owner save
against the cost table the batch routes already charge from, first in a log-only mode that changes
nothing the player sees, then in a mode that refuses saves that do not add up.

Every line number below cites the `revamp` branch as it stands today. Where the plan makes a choice
the owner has not ruled on, section 6 names the default taken and why. Attack saves are issues #23
and #25 and are out of scope except where one helper serves both.

Sections:

1. Scope
2. Rules: what the server derives and what it checks
3. Server design
4. Tests and verification
5. Work packages
6. Open questions and defaults

---

## 1. Scope

### 1.1 What the live game does, and why it shapes the design

**The client is authoritative over the whole economy.** The Flash client charges itself, starts its
own countdowns, replays them on load and banks its own harvesters; the server stores what it is
sent (`docs/specs/base-building.md:43-66`). On an owner save the server adds the resource delta
(`server/src/services/base/updateResources.ts:34-45`, called from
`controllers/base/save/handlers/resourceHandler.ts:44-51`), assigns `buildingdata` whole
(`controllers/base/save/baseSave.ts:102-110`), stores `points` and `basevalue` as whatever strings
arrive (`:86-92`), and copies `rNmax` verbatim (`updateResources.ts:37-38`). `updateResources`
does not even clamp the pool at zero (`:40-42`). The only refusal on the whole path is a caller who
neither owns the base nor holds an `attackid` on it (`baseSave.ts:62-67`); the anti-cheat hook at
`:69` is a no-op outside a private production module
(`scripts/anticheat/anticheat.ts:12-26`, `scripts/anticheat/pub/anticheat.stub.ts:31-35`).

**Who sends economy saves today.** Two mounts reach the same controller: `/base/save`
(`server/src/app.routes.ts:126`) and `/api/:apiVersion/bm/base/save` (`:135`). The callers are:

| Caller | What it sends | Evidence |
|---|---|---|
| The archived Flash client (the swf under `server/public/gamestage/`) | Every key in section 1.2's table, on a 1 Hz tick with a 3 s save delay, and a forced flush on any purchase. | `client/scripts/BASE.as:2507-2523`, `:3155-3324`, `:2609-2611` |
| The revamped web client | **Nothing.** It calls `/base/load` only (`web/src/api/base.ts:24-57`) plus the Yard Planner routes (`web/src/api/yardplanner.ts:30-105`). There is no `/base/save` call anywhere under `web/src`. | `grep` over `web/src` for `base/save` finds nothing |

So the Flash client is the only producer of economy saves, and it will stay that way until the web
client grows build, upgrade and bank actions. That is the constraint behind the rollout in section
3.2: the Flash client cannot be patched, cannot show a structured error, and on a rejected save
keeps its local state and delta and tries again (`client/scripts/BASE.as:3413-3416`,
`:3420-3428`).

**What the server already knows.** Today's work landed the pieces that make an audit possible
without a new data source:

- `server/src/game-data/buildingCosts.ts`, generated from `client/scripts/YARD_PROPS.as` with the
  Map Room 2 overrides applied (`:1-28`). `COSTS[type].costs[k]` is the step that leaves level `k`
  (`:13-16`), a `CostStep` is `[r1, r2, r3, r4, time, re]` (`:45-52`), `quantity[hall]` caps the
  count per Town Hall level (`:20-21`), and `maxLevel(type)` is `costs.length` (`:820`).
- `server/src/services/yardplanner/costs.ts`: `levelOf` (`:92-97`, a running `cB` reads as level
  0), `townHallLevel` (`:111-118`), `countOfType` (`:121-130`), `requirementsMet` (`:140-154`),
  `upgradeSteps` (`:163-174`), `sumCosts` (`:177-187`), `shortfall` and `isShort` (`:196-205`),
  `pointsForUpgrade` and `pointsForBuild` (`:215-231`), `FREE_FINISH_SECONDS = 300` (`:49`).
- `wallUpgrade.ts` and `trapRearm.ts`, the style to mirror: a pure `plan*` function over a slice of
  the save that throws `layoutInvalidErr` (400) for a malformed request and `batchBlockedErr` (409)
  for state the yard cannot support (`wallUpgrade.ts:163-302`, `trapRearm.ts:157-301`), with a thin
  controller that advances timers, applies the plan and flushes once
  (`controllers/yardplanner/upgradeWalls.ts:38-77`).
- `advanceBuildingTimers` (`services/base/advanceBuildingTimers.ts:42-79`), which brings `cB`,
  `cU` and `cF` forward by an elapsed time clamped to 30 days (`:32`) and pauses damaged buildings
  (`:90-91`). Run over the stored save it yields the yard as it should look now with no player
  action: the **reference yard** every rule below compares against.
- `Report` rows and `logReport` (`services/base/reportManager.ts:18-29`, `:84-101`), an existing
  per-user violation counter the anti-cheat stub also points at (`anticheat.stub.ts:19-23`).

**What the server does not know yet.** The cost table carries no harvester `produce`, `cycleTime`
or `capacity` arrays and no silo `capacity`, so production and storage caps cannot be worked out
from it (`docs/specs/base-building.md:361-364`). The generator reads each entry's `quantity` array
with `readIntArray` (`web/tools/gen-building-costs.mjs:134-141`, `:175-188`); the same call reads
`produce`, `cycleTime` and `capacity` (`client/scripts/YARD_PROPS.as:150-155` for the harvesters,
`:869` for the silo). Section 3.6 adds them.

### 1.2 The save keys this plan reads

From `BASE.SaveB()` (`client/scripts/BASE.as:3155-3200`, `:2643-2653`), as `BaseSaveSchema`
parses them (`server/src/schemas/BaseSaveSchema.ts`):

| Key | Parsed at | Used for |
|---|---|---|
| `buildingdata` | `BaseSaveSchema.ts:55-58` | Every building rule in section 2. Fields per `BFOUNDATION.Export` (`client/scripts/BFOUNDATION.as:2968-3030`) plus the harvester's `st`, `pr`, `cP` (`client/scripts/BRESOURCE.as:481-493`). |
| `buildinghealthdata` | `:65-68` | Pause detection, damaged-cannot-upgrade. |
| `resources` | `:96-99` | The **delta** `r1..r4` and absolute `r1max..r4max`. |
| `purchase` | `:30-35` | The one voucher a save can carry: `[itemKey, quantity]`. |
| `points`, `basevalue` | raw body, `baseSave.ts:86-92` | Section 2.9. |
| `researchdata` | raw body, default branch `:134-142` | Decorations placed from inventory (section 2.2). |

The stored side is the `Save` row: `savetime` (`server/src/database/models/save.model.ts:83`),
`resources` (`:300`), `storedata` (`:332`, for `BST`, `BIP`, `ENL`), `buildingresources` (`:356`,
outpost income), `outposts` (the `[x, y, baseid][]` list, `docs/server-api.md:512`),
`buildingdata`, `buildinghealthdata`, `points`, `basevalue`.

### 1.3 In scope

| Item | Summary |
|---|---|
| Audit service | Pure `auditEconomySave(stored, submitted, purchase, now)` returning a verdict: derived fields plus a list of violations. No database access. |
| Reference yard | Advance the stored countdowns to now, then compare, so a countdown that merely ticked is never a violation. |
| Building rules | New buildings paid at `costs[0]`, capped and gated; level changes explained by a completed countdown, a free finish, or a purchase; countdown magnitudes from the cost table times the Sharper Tools multiplier. |
| Resource rules | Positive deltas bounded by harvester production, outpost income, refunds and shiny top-ups; pools never negative; positive deltas never cross the storage cap. |
| Derived fields | `rNmax` and `basevalue` computed by the server; in reject mode the client's values are ignored. |
| Rollout | `ECONOMY_SAVE_VALIDATION=off\|log\|reject`, defaulting to `log`. Log mode writes nothing differently and records violations; reject mode refuses the save in the shape the Flash client can show. |
| Generator additions | `produce`, `cycleTime`, `capacity` rows for the harvesters and the silo, in both generated files. |
| Tests and a curl script | `bun:test` over the sandbox fixture; a shell script that drives a real server through the accept and reject paths. |

### 1.4 Out of scope and deferred

- **Attack saves** (`isAttack` branch of `baseSave.ts:74`, `:154-205`): issues #23 and #25. The
  reference-yard helper (section 3.1) is written so an attack audit can reuse it.
- **Placement.** `X`/`Y` and overlap are geometry, not economy. `sweepOverlaps`
  (`services/yardplanner/layoutGeometry.ts`) could run over the submitted yard in log mode at small
  cost; section 6 lists it as an option, off by default.
- **Health and repair** (`hp`, `rE`, `buildinghealthdata` values, the `FIX` purchase). Repairs are
  free (`docs/specs/base-building.md:1336-1365`); only the pause they cause matters here.
- **Monsters, champions, the academy, the juicer.** Goo and putty move through them
  (`docs/specs/monsters-and-hatchery.md:45`, `:707`, `:792-794`; `client/scripts/ACADEMY.as:144`),
  which is why section 2.6 bounds twigs and pebbles strictly and putty and goo loosely.
- **Outpost yards' buildings.** Outposts use `OUTPOST_YARD_PROPS` and prefab kits
  (`docs/specs/base-building.md:361-372`), which the generator does not read. Outpost owner saves
  get the resource rules only (section 2.6, "outpost sessions").
- **Inferno** (`iresources`, type `inferno`), Map Room 3 buffs, and the tutorial's `tutstage` gate.
- **Shiny prices.** `purchaseHandler` keeps trusting the item key
  (`docs/specs/base-building.md:1462-1464`); this plan only checks that a voucher is large enough
  for the step it explains (section 2.4).

---

## 2. Rules: what the server derives and what it checks

Notation: **S** is the stored save, **T** the submitted one, `now` the server clock in unix seconds
(`server/src/utils/getCurrentDateTime.ts`), `elapsed = clamp(now - S.savetime, 0, 30 days)`
(`advanceBuildingTimers.ts:32`, `:43`), and **R** the reference yard
`advanceBuildingTimers(S.buildingdata, S.buildinghealthdata, elapsed)`. `TOL = 10` seconds is the
timer tolerance (three seconds of save delay, one second of tick, and clock skew; section 6).
`bst` is `0.8` when `S.storedata.BST.e > now` and `1` otherwise
(`client/scripts/STORE.as:2513-2519`; the item lasts seven days,
`server/src/game-data/store/storeItems.ts:23-29`).

A rule either **derives** a field (the server writes its own value) or **checks** one (the server
compares and records a violation). Each violation is `{ rule, ids?, detail }`; the rule names below
are the wire names in section 3.5.

### 2.1 Which saves are audited

| Save | Audited | Why |
|---|---|---|
| Owner save of a `main` yard (`isOwner && !isAttack && baseSave.type === MAIN`) | Every rule | The only yard the cost table describes. |
| Owner save from an outpost session (`isOutpostOwner`, `baseSave.ts:63`, `:79-80`) | Section 2.6 only, with no harvester allowance | The delta lands on the main pool (`resourcesHandler(userSave, ...)`), so a cheat could route through an outpost; but outpost buildings have their own props table. |
| Attack save | None | Issues #23 and #25. |
| Inferno save | None | Separate pool and props. |
| Map Room 1 tribe save (`baseSave.ts:51-58`) | None | Returns before the key loop. |

### 2.2 Buildings: identity, removal, new buildings

Keyed by id over `S.buildingdata`, `R` and `T.buildingdata`. `T` is parsed by the schema; a value
that is not an object, or has no numeric `t` and `id`, is `malformed` (400, section 3.5).

**Type.** An id present in both must keep its `t`, except the legacy `18 -> 17, l >= 2` rewrite the
Flash client makes on load (`client/scripts/BASE.as:1523-1526`, mirrored at
`wallUpgrade.ts:87-90`). Rule `typeChanged`.

**Removed** (in S, not in T). Always allowed: recycling and cancelling are the player's right and
only refund resources (`docs/specs/base-building.md:864-892`). The refund it earns feeds the
budget in section 2.6:

| State in R | Refund | Source |
|---|---|---|
| `cB > 0` (never finished) | 100% of `costs[0]` | `RecycleCost`, `lvl == 0` branch, `client/scripts/BFOUNDATION.as:2639-2645` |
| Finished at level `l` | 50% of `sum(costs[0..l-1])`, each resource floored | `:2647-2664` |
| A `decoration` kind | Nothing; it goes to `researchdata` | `:2526-2530`, `:2609-2611` |
| A trap | Nothing beyond the 50% rule; a trap gone on an owner save is a recycle, a fired one leaves on an attack save (`handlers/buildingDataHandler.ts:46-58`) | — |

**New** (in T, not in S). `costOf(t)` must exist (`buildingCosts.ts:814`), else `unknownType`.
Then exactly one of these explanations must hold, else `unpaidBuild`:

1. **A build in progress**: `cB` present, `l` absent or 1. `cB <= floor(costs[0].time * bst)` and
   `cB >= floor(costs[0].time * bst) - elapsed - TOL` (`client/scripts/BFOUNDATION.as:1670-1673`;
   the worker walk only ever makes it slower, `:1376-1393`). Charged `costs[0]` (`:1694-1699`).
2. **Finished on the spot**: no `cB`, `l` absent or 1, and `costs[0].time <= FREE_FINISH_SECONDS`
   (walls, traps and anything under five minutes finish for free, `:2063-2083`), or
   `costs[0].time == 0` (decorations). Charged `costs[0]`.
3. **Instant build**: no `cB`, and the save's voucher is `["IB", n]`. Not charged in resources;
   `n >= instantCost(costs[0])` (section 2.4). One voucher per save, so at most one building this
   way (`client/scripts/BFOUNDATION.as:1702-1707`, `BASE.as:2609-2611`).
4. **From inventory**: `kind === "decoration"` and `S.researchdata` held that type, or the voucher
   is `["BUILDING<t>", 1]`. Charged nothing (`BFOUNDATION.as:1690-1692`).
5. **The tutorial bootstrap**: `S.buildingdata` is empty and T contains exactly a Town Hall, a Twig
   Snapper with `st <= 200`, a Pebble Shiner and a General Store, all at level 1, with the delta
   `+1600 r1, +1600 r2` (`client/scripts/BASE.as:1604-1703`; a new account's stored pool is zero,
   `server/src/game-data/getDefaultBaseData.ts:35-44`).

Every new building also passes **prerequisites and caps** (section 2.5). Ids are not checked for
order: `_buildingCount` restarts from the highest id at load (`BASE.as:1591-1592`), so a recycled
top id can legitimately come back later.

### 2.3 Levels and countdowns

For an id in both S and T, with `from = levelOf(R[id])`, `to = levelOf(T[id])` (`costs.ts:92-97`)
and the countdowns of R and T:

**A countdown may only get shorter by time, or vanish.** `cU_T <= cU_S` (never grows), and
`cU_T >= cU_R - TOL - speedup`, where `speedup` is what the voucher buys: 3600 for `SP2`, 7200 for
`SP3`, everything for `SP4`, and nothing otherwise (`client/scripts/STORE.as:2043-2055`;
`docs/specs/base-building.md:817-833`). The same for `cB` and `cF`. A countdown that is *longer*
than R's is fine: damage and the worker walk pause it and R only models the first. Rule
`countdownJumped`.

**Levels move one ladder step at a time, and each step is paid.** Walk from R's state to T's:

| Transition | Allowed when | Charged |
|---|---|---|
| `to == from`, same countdown state | Always | Nothing |
| `to == from + 1` and R still had `cU` | `cU_R <= TOL` (the countdown finished within tolerance), or `cU_R <= FREE_FINISH_SECONDS` (finish-now is free under five minutes, `STORE.as:162-171`), or the voucher is `SP4` or `SP1`, or `SP2`/`SP3` bring it under `TOL` | Nothing: the step was charged when it started |
| `to == from + 1` and R had no countdown | The voucher is `["IU", n]` with `n >= instantCost(costs[from])` (`BFOUNDATION.as:2130-2140`) | Nothing in resources |
| `to == from` and T has a new `cU` where R had none | `from < maxLevel(t)` (`BASE.as:3867-3870`), R had no `cB`/`cU`/`cF` (`:3871-3882`), R was undamaged (`wallUpgrade.ts:101-102`), a Town Hall exists (`:3863-3866`), `requirementsMet(costs[from].re, R)` (`:3884-3932`), and `floor(costs[from].time * bst) - elapsed - TOL <= cU_T <= floor(costs[from].time * bst)` (`BFOUNDATION.as:2295`) | `costs[from]` (`:2283-2294`) |
| `to == from + k`, `k >= 2` | The voucher is `BLK<n>` and `t` is a wall going to `n` (`STORE.as:1993-2026`; every wall may jump, in-progress wall work finishes), or the sum of `floor(time * bst)` over the steps is `<= elapsed + TOL` (a lost save between two five-second wall steps) | Each step, unless `BLK` |
| `to < from` | Never | `levelDropped` |
| A `cB` building whose `l` jumps past 1 | Never (`Constructed()` sets 1, `BFOUNDATION.as:2892-2901`) | `levelJumped` |

A `cU` may not appear on a building that R shows under construction or fortifying, and a `cB` may
never appear on a building S already had. Rule names: `levelJumped`, `unpaidUpgrade`,
`upgradeBlocked` (with the same `townHall`/`requirements`/`busy`/`damaged` detail keys the batch
routes use), `countdownTooLong`.

`prefab` and `cR` (rebuild) are outpost and Map Room 3 fields
(`server/src/types/BuildingData.ts:13`, `BFOUNDATION.as:2968-3030`); on a main-yard save they are
copied through untouched.

### 2.4 Vouchers: the purchase that explains a jump

`saveData.purchase` is one `[itemKey, quantity]` (`BaseSaveSchema.ts:30-35`) and a pending
purchase forces an immediate flush (`BASE.as:2609-2611`), so a save carries at most one. The audit
treats it as a voucher that can be spent once. The keys that matter and what they excuse:

| Key | Excuses | Amount check |
|---|---|---|
| `IB` | One new building finished with no `cB` and no resource charge | `quantity >= instantCost(costs[0])` |
| `IU` | One level step with no countdown and no resource charge | `quantity >= instantCost(costs[from])` |
| `IF` | One fortification step (section 2.8) | none until fortify ladders are generated |
| `SP1` | One countdown of `<= 300` s finishing | none (free) |
| `SP2`, `SP3` | One countdown shortened by 3600 or 7200 s | none (fixed price, `storeItems.ts:55-70`) |
| `SP4` | One countdown finishing | `quantity` is 1; the shiny price is computed client-side (`STORE.as:352-381`), out of scope |
| `BLK2`..`BLK5` | Every wall to that level | none |
| `BRTOPUP` | A positive delta equal to the shortfall of the step being started (section 2.6) | `quantity >= ceil(pow(sqrt(shortfall / 2), 0.75))` (`client/scripts/BUILDINGOPTIONSPOPUP.as:662-690`; spec `:964-967`) |
| `BUILDING<t>` | One new decoration of type `t` | none |
| anything else | Nothing | — |

`instantCost(step)` is the spec's formula (`docs/specs/base-building.md:947-958`), with
`timeCost` from `STORE.as:162-171`:

```
timeCost(t)       = t <= 300 ? 0 : min(ceil(t * 20 / 3600), int(sqrt(t * 0.8)))
instantCost(step) = int((a + b) * 0.95)
  where t = step.time <= 300 ? 0 : step.time
        a = ceil(pow(sqrt((r1 + r2 + r3) / 2), 0.75))   // r4 is not counted, as in the client
        b = timeCost(t)
```

A voucher that is too small is `voucherShort`; a purchase-explained change with no voucher is the
rule it would have excused. `purchaseHandler` is not touched: it still records the item and debits
the shiny (`handlers/purchaseHandler.ts:19-52`, `services/base/updateCredits.ts:47-70`).

### 2.5 Quantity caps and prerequisites

`hall = townHallLevel(R)` (`costs.ts:111-118`). For every type `t` that T holds more of than R:
`countOfType(T, t) <= COSTS[t].quantity[hall]` (`docs/specs/base-building.md:1011-1033`,
`trapRearm.ts:194-205`). Rule `capReached` with `{ type, have, max }`. A type with an empty
`quantity` array is uncapped (`buildingCosts.ts:20-21`).

For every new building and every new `cU`: `requirementsMet(costs[k].re, R)` with `k = 0` or
`from`, reported through `checkRequirements` so a Town Hall gate reads as `townHall: { have, need }`
and anything else as `requirements` (`wallUpgrade.ts:312-330`). The gate is checked against R, not
T, because a building that only appears in this save cannot have unlocked anything yet
(`levelOf` returns 0 while `cB` runs, `costs.ts:85-97`).

### 2.6 Resources: the delta budget

`T.resources.rN` is a delta since the last successful save (`BASE.as:2643-2653`, accumulated in
`SaveDeltaResources`, `:4598-4620`, and cleared on success, `:3348`). For each resource `r`:

**Never negative.** `S.r + delta_r >= 0`, else `negativePool`. `updateResources` would happily
store a negative number (`updateResources.ts:40-42`).

**Positive deltas need a source.** `delta_r <= budget_r`, else `resourceBudget` with
`{ resource, delta, budget }`, where

```
budget_r = harvest_r + outposts_r + refunds_r + topup_r + bootstrap_r - spend_r + slack_r
```

| Term | Value | Source |
|---|---|---|
| `harvest_r` | Over every harvester `h` of type `r` in S (type id equals resource index, spec `:578-590`): `max(0, min(cap_h, st_S + (floor(elapsed / cycle_h) + 1) * produce_h) - st_T)`, with `cap_h`, `produce_h`, `cycle_h` from the generated arrays at `max(l_S, l_T)` and `st_T = 0` if the harvester is gone | `client/scripts/BRESOURCE.as:384-386`, `:424-439`, `:441-467`; spec `:598-627` |
| `outposts_r` | Over every `b<baseid>` entry in `S.buildingresources` (not T's): `gip_r * min(elapsed, 2 days) / 10 * OVERDRIVE_MAX` | `client/scripts/com/monsters/autobanking/AutoBankManager.as:79-82`, `:299-330`; spec `:643-651` |
| `refunds_r` | Section 2.2's table for removed buildings, plus 100% of `costs[from]` for a `cU` that vanished with `to == from` (cancelled upgrade) and 100% of the fortify step for a vanished `cF` | `BFOUNDATION.as:2401-2432`, `:2218-2247` |
| `topup_r` | With a `BRTOPUP` voucher: `max(0, charged_r - S.r)` over the steps charged this save | `BUILDINGOPTIONSPOPUP.as:670-690` |
| `bootstrap_r` | 1600 for `r1` and `r2` in the tutorial bootstrap (section 2.2, item 5), else 0 | `BASE.as:1695-1703` |
| `spend_r` | Every step charged in sections 2.2 and 2.3 | — |
| `slack_r` | `max(1, floor(0.01 * (harvest_r + outposts_r)))`: one cycle of rounding per resource | section 6 |

Deltas more negative than `-spend_r` are **not** violations: monsters, champions and the academy
spend goo and putty outside this model, and under-reporting only ever costs the player.

**`r3` and `r4` in reject mode.** Goo comes back from the Monster Juicer and from cancelled
hatchings, and putty from cancelled academy training (`docs/specs/monsters-and-hatchery.md:707`,
`:792-794`; `client/scripts/BUILDING9.as:65`, `BUILDING13.as:103`, `ACADEMY.as:144`). None of that
is derivable until monster accounting exists, so `resourceBudget` on `r3` and `r4` is **recorded in
both modes but only enforced for `r1` and `r2`**. Section 6, item 1.

**Outpost sessions.** `harvest_r = 0` (outposts do not buffer, spec `:643-645`), `refunds_r = 0`
(no recycling in an outpost, `BFOUNDATION.as:2513-2515`), the other terms as above.

**Harvester buffers.** `st_T <= min(cap_h, st_S + (floor(elapsed / cycle_h) + 1) * produce_h)` for
every harvester in both S and T, else `bufferJumped`. Without this the `harvest_r` bound could be
fed by an inflated `st`.

### 2.7 Storage caps

**Derived**, not checked (`BASE.as:4705-4828`; spec `:655-679`):

```
cap = floor((10000 + sum over finished silos of capacity[l - 1]) * packing)
    + outposts * 2000000
packing  = int((1 + 0.1 * (S.storedata.BIP?.q ?? 0)) * 100) / 100
outposts = S.outposts?.length ?? 0
```

Silos with `cB` are level 0 and add nothing. In reject mode `rNmax` is written from this formula
and the client's value is ignored; in log mode a mismatch is recorded as `capMismatch` with
`{ resource, sent, derived }` and the client's value is stored as today. A stored pool above the
cap is not a violation (sandbox yards and the past are what they are; `overworldYard.ts` seeds
11,163,050,000), but a positive delta may not carry a pool from at or below the cap to above it:
`S.r <= cap_r` implies `S.r + delta_r <= cap_r` (`BASE.Fund` clamps, `BASE.as:4494-4536`). Rule
`overCap`.

### 2.8 Fortification

No building in the Map Room 2 main-yard table sets `can_fortify`
(`docs/specs/base-building.md:998-1006`), and the generator skips `fortify_costs`
(`gen-building-costs.mjs:148-150`). Until a fortify ladder is generated, the server can only check
shape: `cF_T <= cF_S`, `cF_T >= cF_R - TOL - speedup`, and `fort_T` is `fort_R` or `fort_R + 1` when
R's `cF` finished or the voucher is `IF`. A new `cF` or a `fort` increase with no ladder is recorded
as `fortifyUnpriced` and **never enforced** in this phase (section 6, item 4).

### 2.9 Points and base value

**`basevalue` is derived.** It is a high-water mark of
`ceil(0.1 * sum(time + r1 + r2 + r3 + r4 of costs[l - 1]))` over finished buildings whose kind is
not `decoration`, `enemy`, `immovable` or `trap`, with `l = max(l, 1)`
(`client/scripts/BASE.as:4830-4859`). Every input is in the cost table (`kind` is the props `type`
string, `buildingCosts.ts:57-58`). In reject mode the server writes
`max(Number(S.basevalue), computed(T))`; in log mode a client value that differs is
`basevalueMismatch`.

**`points` is checked.** `_basePoints` only grows (`BASE.as:4863-4865`), from banking (the banked
amount, halved after tutorial stage 200, `BRESOURCE.as:452-457`), completions (`pointsForUpgrade`,
`pointsForBuild`, plus 100 for a Town Hall, `costs.ts:215-231`), buying resources with shiny
(`STORE.as:2029-2035`) and outpost auto-banking (`ceil(total * 0.375)`,
`AutoBankManager.as:329`). So `0 <= points_T - points_S <= harvest_total + outposts_total +
completions + topup_total + slack`, where the harvest and outpost terms are section 2.6's budgets
summed over the four resources. Rule `pointsJumped`. Points are strings on the wire and the row
(`baseSave.ts:86-88`); non-numeric values are `malformed`.

### 2.10 What is deliberately not compared

`X`, `Y`, `hp`, `rE`, `hl`, `ti`/`sid`/`snm`/`spc`/`sbj` (the Simple Sign's message fields), `rPS`,
`rCP`, `rIP` (hatchery production), `fz` (the Champion Chamber's blob) and every unknown key are
copied through as today. The audit reads them only where a rule above names them.

---

## 3. Server design

### 3.1 Files

New:

| File | Contents |
|---|---|
| `server/src/services/base/economy/referenceYard.ts` | `referenceYard(save, now): { buildingdata, elapsed }`: the clamp and `advanceBuildingTimers` call the attack path and both batch controllers already make (`baseSave.ts:213-215`, `upgradeWalls.ts:46-52`), factored so an attack audit (#23) can share it. |
| `server/src/services/base/economy/auditEconomySave.ts` | `auditEconomySave(input: AuditInput): EconomyVerdict`. Pure. Runs sections 2.2 to 2.9 in that order over one pass of the two yards and returns `{ violations, derived: { rNmax, basevalue }, charged, refunds, budgets }`. Never throws for a violation; throws `layoutInvalidErr`-style `ClientSafeError` only for `malformed` input, the same split `wallUpgrade.ts` makes between 400 and 409. |
| `server/src/services/base/economy/transitions.ts` | `explainTransition(before, after, elapsed, voucher, bst): Transition`: the ladder walk of section 2.3 for one building, returning the steps charged or the violation. Kept apart so it can be tested on hand-built buildings. |
| `server/src/services/base/economy/resourceBudget.ts` | `harvestAllowance`, `outpostAllowance`, `refundOf`, `storageCap`, `baseValueOf`, `instantCost`, `timeCost`. Each a pure function over the cost table and a save slice. |
| `server/src/services/base/economy/voucher.ts` | `readVoucher(purchase): Voucher` and the table in section 2.4. |
| `server/src/services/base/economy/recordVerdict.ts` | `recordEconomyVerdict(ctx, user, save, verdict, mode)`: logs, writes the `Report` row, throws in reject mode. The one file in the set that touches the database and the logger. |
| `server/src/config/EconomyConfig.ts` | `economyValidation: { mode, timerTolerance, overdriveMax }` read from the environment (section 3.2). |
| `server/src/errors/errors.ts` addition | `economySaveRejectedErr(violations)` (section 3.5). |
| `server/src/services/base/economy/*.test.ts` | Section 4.1. |
| `server/scripts/verify-economy-save.sh` | Section 4.2. |

Modified:

| File | Change |
|---|---|
| `server/src/controllers/base/save/baseSave.ts` | Section 3.3: one call before the key loop, one after the purchase handler; `now` hoisted above the loop. |
| `web/tools/gen-building-costs.mjs` | Section 3.6: emit `produce`, `cycleTime`, `capacity` for types 1 to 4 and `capacity` for type 6. |
| `server/src/game-data/buildingCosts.ts`, `web/src/game/yard/buildingCostData.ts` | Regenerated. |
| `server/src/game-data/buildingCosts.test.ts`, `web/src/game/yard/buildingCosts.test.ts` | Assert the new arrays against the spec ladders (`docs/specs/base-building.md:484-526`). |
| `server/example.env` | `ECONOMY_SAVE_VALIDATION=log` with a comment. |
| `docs/server-api.md` | Section 3.7. |
| `docs/specs/base-building.md` §10 | A dated note under "What is not checked" pointing at this plan. |

### 3.2 Configuration and rollout

```ts
// server/src/config/EconomyConfig.ts
export type EconomyValidationMode = "off" | "log" | "reject";

export const economyConfig = {
  /** off: today's behaviour. log: audit, record, never refuse. reject: refuse. */
  mode: (process.env.ECONOMY_SAVE_VALIDATION ?? "log") as EconomyValidationMode,
  /** Seconds of countdown slack: save delay, tick, clock skew. */
  timerTolerance: 10,
  /** Upper bound on the outpost income multiplier a POD buff can reach. */
  overdriveMax: 2,
};
```

The environment variable follows `DEV_SANDBOX` and `USE_VERSION_MANAGEMENT` in living in
`server/.env` and being read once (`config/GameConfig.ts:39-41`,
`config/VersionManifestConfig.ts:17`). An unknown value is treated as `log` and logged at startup.

**Rollout:**

1. **Land in `log`.** Nothing the player sees changes: the loop at `baseSave.ts:74-146` runs as
   today, `rNmax`, `basevalue` and `points` are stored as sent. Every violation is written as one
   structured `logger.warn` per save with the rule list as properties (JSON Lines in production,
   `server/src/utils/logger.ts:29-36`, so `jq` can count by rule and by user) and one `logReport`
   row per save with violations (`reportManager.ts:18-29`), which increments
   `Report.violations` (`database/models/report.model.ts:24-25`) and keeps the summary under
   `report`.
2. **Read the logs for a week of Flash play.** Every rule that fires on honest play is a bug in
   this plan, not in the player. Section 4.2's script gives the expected-positive cases; the log
   gives the false positives.
3. **Switch to `reject`.** Rejections come back as section 3.5 describes. The Flash client shows
   the message once and keeps its local state (`BASE.as:3413-3416`); on its next save it sends the
   same delta and is refused again until the player reloads, at which point `/base/load` hands
   back the server's copy. That is the intended outcome for a tampered client and the reason log
   mode comes first for an honest one.
4. **`off`** exists as the emergency switch and is never the default.

**What `DEV_SANDBOX` means for this.** Nothing is exempted. `DEV_SANDBOX=true` only changes what
a new account's first `Save` row holds (`getDefaultBaseData.ts:17-18`,
`utils/sandbox/overworldYard.ts`): 575 buildings, resources of 11,163,050,000 and `savetime: 0`.
Three consequences the rules already handle: the first save from such a yard sees `elapsed` clamped
to 30 days, so its harvest budget is large but finite; its pool sits far above the derived cap of
23,050,000, so `overCap` never fires (section 2.7) and the Flash client's own `CalcResources` will
send the derived value anyway; and its `storedata.IB.q` of 13,122 is a purchase count with no
bearing on the audit. The sandbox yard is also the test corpus (section 4).

The anti-cheat hook (`baseSave.ts:69`) is left alone. It is a private production module with a
different contract (ban and throw); this audit runs in every environment and only ever refuses.

### 3.3 Where the checks go in `baseSave.ts`

Two insertions and one hoist. The controller stays a sequence of calls; every rule lives in the
services above.

Before the key loop, after the ownership check and the anti-cheat hook (`:62-69`), with `now`
hoisted from `:209`:

```ts
const now = getCurrentDateTime();

// Owner saves are audited before anything is written, so a refusal leaves the
// row untouched and a log-mode verdict can still derive fields after the loop.
const verdict = isAttack
  ? null
  : auditEconomySave({
      kind: isOutpostOwner ? "outpost" : baseSave.type === BaseType.MAIN ? "main" : "none",
      stored: baseSave,
      pool: isOutpostOwner ? userSave : baseSave,
      submitted: {
        ...saveData,
        points: body.points,
        basevalue: body.basevalue,
        researchdata: body.researchdata,
      },
      now,
      config: economyConfig,
    });

if (verdict) await recordEconomyVerdict(ctx, user, baseSave, verdict, economyConfig.mode);
```

`recordEconomyVerdict` returns normally in `off` (it is not even called: `auditEconomySave` is
skipped when the mode is `off`) and `log`, and throws `economySaveRejectedErr` in `reject` when
`verdict.violations` names an enforced rule. Because nothing has been assigned yet, the throw
leaves the entity clean; `logReport` flushes only its own row (`reportManager.ts:26-28`), which is
also why it runs here and not after the loop.

After the purchase handler (`:148`) and before `savetime` moves (`:217-218`):

```ts
if (verdict && economyConfig.mode === "reject") applyDerivedFields(baseSave, verdict.derived);
```

`applyDerivedFields` writes `resources.r1max..r4max` and `basevalue`. `points` is checked, not
derived, so it is never rewritten. In `log` mode the derived values are only compared.

The `case SaveKeys.RESOURCES` branch (`:78-84`) is unchanged: the delta is still added by
`resourcesHandler`, because in reject mode the audit has already proved it fits the budget, and
the pool the client sees in the response (`buildSaveData`, `:227`) is still the server's row.

### 3.4 The verdict

```ts
export interface EconomyViolation {
  rule: EconomyRule;            // the names in section 2, e.g. "resourceBudget"
  ids?: number[];               // building ids, first MAX_LISTED (validateLayout.ts)
  detail?: Record<string, unknown>;
  enforced: boolean;            // false for r3/r4 budgets, fortify, and log-only rules
}

export interface EconomyVerdict {
  violations: EconomyViolation[];
  derived: { r1max: number; r2max: number; r3max: number; r4max: number; basevalue: string };
  charged: ResourceAmounts;     // what this save should have spent
  budget: Record<"r1" | "r2" | "r3" | "r4", number>;
  elapsed: number;
}
```

`enforced` is decided by the rule, not the mode, so the same verdict serves both modes and the
log line says which violations would have rejected. The order of checks inside
`auditEconomySave` is the order of section 2, and unlike the batch routes it does **not** stop at
the first violation: a log-mode verdict is only useful if it names everything.

### 3.5 Error contract

Written in the style of `docs/server-api.md` §1 "Errors" (`:72-104`).

A rejected owner save is a `ClientSafeError` with `status: 409`, `data: { violations, elapsed }`
and **`isClientFriendly: false`**, added to `server/src/errors/errors.ts` beside
`baseUnderAttackErr` (`:143`):

```ts
export const economySaveRejectedErr = (violations: EconomyViolation[]) =>
  new ClientSafeError({
    message:
      `This save does not add up (${violations.map((v) => v.rule).join(", ")}). ` +
      "Reload your yard.",
    status: Status.CONFLICT,
    data: { violations },
    isClientFriendly: false,
  });
```

`isClientFriendly: false` is the deliberate choice. The interceptor then answers **HTTP 200** with
`error` set (`middleware/clientSafeError.ts:50`, `:92-93`), which is the one shape the Flash client
turns into a message the player can read (`handleLoadSuccessful`, `BASE.as:3413-3416`). A real
`409` would instead reach `handleLoadError` (`:3420-3428`): five silent retries, then a generic
"BASE.Save HTTP" popup, and `URLLoaderApi` logs it as "Other status"
(`client/scripts/URLLoaderApi.as:134-175`). The web client already reads the intended status from
`errorDetails.status` (`web/src/api/http.ts:19-22`, `serverStatus`).

Body:

```json
{
  "error": "This save does not add up (resourceBudget). Reload your yard.",
  "errorDetails": {
    "status": 409,
    "message": "This save does not add up (resourceBudget). Reload your yard.",
    "data": {
      "violations": [
        {
          "rule": "resourceBudget",
          "detail": { "resource": "r1", "delta": 1000000000, "budget": 43200 },
          "enforced": true
        }
      ],
      "elapsed": 61
    }
  }
}
```

| Status | Rule (`violations[].rule`) | Detail keys | Meaning |
|---|---|---|---|
| 400 | `malformed` | `issues` | `buildingdata` is not a map of `{ t, id }` objects, or `points`/`basevalue`/`resources` are not numeric. Uses `layoutInvalidErr` (`errors.ts:459-465`) with `isClientFriendly` left true, since only a broken client sends it. |
| 409 | `typeChanged` | `ids` | A building changed type other than 18 to 17. |
| 409 | `unknownType` | `ids` | A new building with no cost row. |
| 409 | `unpaidBuild` | `ids` | A new finished building with no free finish, voucher or inventory source. |
| 409 | `levelJumped`, `levelDropped` | `ids`, `from`, `to` | A level change no ladder walk explains. |
| 409 | `unpaidUpgrade` | `ids` | A finished step with no countdown, free finish or `IU`. |
| 409 | `upgradeBlocked` | `ids`, plus `townHall`, `requirements`, `busy`, `damaged`, `maxLevel` | A new countdown the yard cannot start (the batch routes' keys, `docs/server-api.md:378-397`). |
| 409 | `countdownJumped`, `countdownTooLong` | `ids`, `field`, `expected`, `sent` | A countdown that shrank faster than time or started above `time * bst`. |
| 409 | `capReached` | `type`, `have`, `max` | More of a type than `quantity[hall]` allows. |
| 409 | `voucherShort` | `item`, `quantity`, `needed` | An `IB`/`IU`/`BRTOPUP` voucher below the derived price. |
| 409 | `negativePool` | `resource` | The delta would take a pool below zero. |
| 409 | `resourceBudget` | `resource`, `delta`, `budget` | A positive delta above section 2.6's budget. Enforced for `r1`, `r2`; recorded for `r3`, `r4`. |
| 409 | `bufferJumped` | `ids`, `sent`, `max` | A harvester buffer above what it can have produced. |
| 409 | `overCap` | `resource`, `cap`, `pool` | A positive delta carrying a pool over the derived cap. |
| log only | `capMismatch`, `basevalueMismatch` | `resource`/`sent`/`derived` | Client value differs from the derived one. Derived in reject mode, so never a rejection. |
| 409 | `pointsJumped` | `delta`, `budget` | `points` grew by more than banking, completions and income allow, or shrank. |
| log only | `fortifyUnpriced` | `ids` | A fortify step with no ladder to price it. |

### 3.6 Cost table generator additions

`web/tools/gen-building-costs.mjs` gains three `readIntArray(after, key)` calls next to `quantity`
(`:175-188`) for `produce`, `cycleTime` and `capacity`, and the row type grows one optional
trailing element `stats?: { produce, cycleTime, capacity }` so the 131 rows without them are
unchanged on the wire. The server copy adds `productionOf(type)` and `siloCapacity(level)` beside
`costOf` (`buildingCosts.ts:814-832`). The sources are `client/scripts/YARD_PROPS.as:151-153`
for type 1 (and the parallel entries for 2 to 4) and `:869` for type 6; the values must match the
ladders at `docs/specs/base-building.md:484-526` and both integrity tests assert them.

### 3.7 Documentation

`docs/server-api.md`: a paragraph after the "Save write keys" table (`:175-218`) headed
**Economy audit**, stating the mode variable, that the audit precedes every write, the derived
fields in reject mode, and a pointer to this plan; the rejection shape and the rule table from
section 3.5 under §1 "Errors" as the seventh `isClientFriendly: false` case (`:88-95` lists the
other six); and a line under the `Save` model (`:471-520`) that `resources.rNmax` and `basevalue`
are server-derived when the audit is in reject mode.

`docs/specs/base-building.md` §10 "What is not checked" (`:1450-1469`): a dated note that the
first five bullets are addressed by this plan and which mode is live.

---

## 4. Tests and verification

### 4.1 Server (`bun test` from `server/`, `bun:test`)

The pattern is `services/yardplanner/wallUpgrade.test.ts:1-50`: read
`web/test/fixtures/baseload-sandbox-yard.json` (575 buildings, a level 10 Town Hall, 400 walls at
level 1, 6 of each harvester, 6 silos, `buildinghealthdata: {}`, `savetime: 0`, `points: "0"`,
resources of 11,163,050,000 with `r3` at 1,163,050,000), `structuredClone` it into a stored save S,
clone again and mutate for T. A helper `at(seconds)` sets `S.savetime = now - seconds` so `elapsed`
is controlled rather than the fixture's 30-day clamp.

| File | Cases |
|---|---|
| `economy/referenceYard.test.ts` | Elapsed clamps at 0 and 30 days; a `cU` of 100 at `elapsed = 60` becomes 40; at 120 the level rises and `cU` is gone; a damaged building keeps its countdown. |
| `economy/transitions.test.ts` | Hand-built buildings: same level no change; countdown finished within `TOL`; free finish under 300 s; `IU` voucher; new `cU` charged at `costs[from]` with `bst` 1 and 0.8; `cU` above `time * bst` is `countdownTooLong`; `cU` shrinking faster than `elapsed` is `countdownJumped`; `SP2` excuses 3600; level drop; two-level jump with and without `BLK`; a `cB` building reporting level 3. |
| `economy/resourceBudget.test.ts` | `harvestAllowance` for one level 1 harvester at `st: 0` over 3600 s is 720 + one cycle; for one at `st: 720` it stays 720 (capped); `storageCap` over the fixture is 10,000 + 6 × 3,840,000 with `BIP` absent and `ENL` ignored, and doubles with `BIP.q = 10`; `baseValueOf` over the fixture matches a hand sum, counts walls, and skips only `decoration`, `trap`, `enemy` and `immovable`; `instantCost` reproduces the spec's 24 h example (277 shiny time term); `refundOf` for a level 3 Cannon Tower is half the first three steps, floored. |
| `economy/auditEconomySave.test.ts` | Over the fixture at `elapsed = 60`: an identical T with a zero delta has no violations and derives `rNmax` = 23,050,000 and `basevalue` = the hand sum. Then one case per rule in section 3.5, each asserting the rule, its detail and `enforced`: +1,000,000,000 `r1` is `resourceBudget` enforced; the same on `r4` is recorded, not enforced; a new Cannon Tower at `cB: 30` charged 2,000/1,500/500 with delta `-2000/-1500/-500` passes and with a zero delta passes too (spending less is not a violation) while a delta of `+1` on `r1` fails the budget; a 76th Booby Trap is `capReached { type: 24, have: 76, max: 75 }`; a Railgun Tower at a level 4 Town Hall (Town Hall edited in S) is `upgradeBlocked` with `townHall: { have: 4, need: 5 }`; removing a level 1 wall lets `+500 r1` through as refund; the tutorial bootstrap from an empty S passes and from a non-empty S is `unpaidBuild`; `points: "-1"` and `points: "abc"` are `pointsJumped` and `malformed`; an outpost-kind audit ignores building changes and still bounds the delta. |
| `economy/voucher.test.ts` | Each key in section 2.4 maps to its excuse; unknown keys excuse nothing; `IU` below `instantCost` is `voucherShort`. |
| `economy/recordVerdict.test.ts` | Mode `log` returns; mode `reject` throws `ClientSafeError` with status 409, `isClientFriendly` false and the violations in `data`; a verdict with only unenforced violations does not throw in `reject`. `logReport` and `logger` are stubbed with `mock.module`. |
| `game-data/buildingCosts.test.ts` (extended) | Types 1 to 4 carry `produce` `[2, 4, 7, 11, 16, 22, 29, 37, 46, 56]`, `cycleTime` all 10, `capacity` ending 775,018; type 6 `capacity` ending 3,840,000; no other row has `stats`. |

`baseSave` itself needs a database and stays uncovered by unit tests; the controller change is
two calls, and section 4.2 exercises it end to end.

### 4.2 curl verification script

`server/scripts/verify-economy-save.sh`, run against a local server (`docker compose up -d db
redis`, `bun run dev`, `DEV_SANDBOX=true`; account `yardtester@test.com` / `Dev12345!` from the
local dev notes). It uses `curl` and `jq` only. Steps, each printing PASS or FAIL:

1. Log in: `POST /api/v1/player/getinfo` with `email`, `password`, `sessionType=game`
   (`docs/server-api.md:136`); keep `token`.
2. `POST /base/load` with `type=build`, `userid=<id>`, `baseid=0`; keep `basesaveid`, `baseid`,
   `buildingdata`, `buildinghealthdata`, `points`, `basevalue`, `resources`.
3. **Identity save**: `POST /base/save` with the loaded `buildingdata` and `buildinghealthdata`
   re-encoded as JSON strings, `resources` = `{ r1: 0, r2: 0, r3: 0, r4: 0 }` plus `r1max..r4max`
   as loaded, `points` and `basevalue` as loaded. Expect `error: 0`, and in `reject` mode
   `resources.r1max` in the response equal to 23,050,000 rather than the loaded 11,163,050,000.
4. **Cheat delta**: the same body with `resources.r1 = 1000000000`. In `log` mode expect
   `error: 0` and one `economy save` warning line on the server console naming `resourceBudget`;
   in `reject` mode expect HTTP 200, `error` non-zero, `errorDetails.status == 409` and
   `errorDetails.data.violations[0].rule == "resourceBudget"`. Then `POST /base/load` again and
   assert `resources.r1` is unchanged from step 2.
5. **Level jump**: set the first Cannon Tower (`t: 20`) to `l: 10` with no `cU`. Expect
   `levelJumped` the same way.
6. **New wall**: add `{ id: 601, t: 17, X: 1000, Y: 1000 }` with a zero delta. Walls finish for
   free (5 s) and cost 1,000 `r1`, and a delta that spends less than the charge is allowed, so
   expect `error: 0`. Then add a 401st wall the same way and expect `capReached`
   (`quantity[10]` for type 17 is 400).
7. **Honest upgrade**: set the first Cannon Tower's `cU` to `costs[l].time`, delta minus that step's
   cost. Expect `error: 0`. Re-save one second later with the same `cU`: expect `error: 0`
   (slower is fine). Re-save with `cU` reduced by 3600 and no purchase: expect `countdownJumped`;
   with `purchase=["SP2",1]`: expect `error: 0`.
8. Restore the account: `psql` snapshot of `bym.save` for the user taken at step 0 is written
   back, as the local dev notes require for any test that mutates the sandbox yard.

The script takes the mode as its first argument and asserts the matching expectation, so it runs
once per mode in a session.

---

## 5. Work packages

| # | Package | Contents | Depends on |
|---|---|---|---|
| WP0 | Cost table stats | Generator change, both regenerated files, `productionOf`/`siloCapacity`, both integrity tests. Small; land first. | Nothing |
| WP1 | Pure audit services | `referenceYard.ts`, `transitions.ts`, `resourceBudget.ts`, `voucher.ts`, `auditEconomySave.ts`, `EconomyConfig.ts`, the `EconomyVerdict` and `EconomyViolation` types, and their tests (section 4.1, all but `recordVerdict`). No controller change. | WP0 for `productionOf`; can start against its signature |
| WP2 | Controller and rollout | `recordVerdict.ts` and its test, `economySaveRejectedErr`, the two `baseSave.ts` insertions and the `now` hoist, `example.env`, the startup log of the mode. | WP1 |
| WP3 | Docs and verification | `docs/server-api.md` (section 3.7), the §10 note, `verify-economy-save.sh`, a run of it in both modes against the sandbox account with the results pasted into the PR. | WP2 |
| WP4 | Log review | After a week of Flash play in `log`: a short note under this plan's section 6 listing every rule that fired, whether each was a false positive, and the fix or the tolerance change; then the switch to `reject`. | WP3 in production |

WP0 and WP1 can run in parallel if WP1 codes against `productionOf(type): { produce, cycleTime,
capacity } | undefined` and `siloCapacity(level): number` before WP0 lands. WP2 is small and
sequential. WP3 can draft the documentation alongside WP2 and run the script once WP2 lands.

---

## 6. Open questions and defaults

Each item below states the default this plan takes; the owner can overturn any of them.

| # | Question | Default and reason |
|---|---|---|
| 1 | Enforce the positive-delta budget on `r3` and `r4`? | **Recorded, not enforced**, until monster accounting lands. Goo returns from the juicer and cancelled hatchings and putty from cancelled academy training (`docs/specs/monsters-and-hatchery.md:707`, `:792-794`), none of it derivable from the yard. Twigs and pebbles have no such source and are the currency of every building ladder, so they are enforced. |
| 2 | Trust `S.buildingresources` for outpost income? | **Yes, with an `overdriveMax` of 2.** The per-outpost figure is client-written (`AutoBankManager.as:44-52`) and bounding it needs `OUTPOST_YARD_PROPS`, which the generator does not read. The bound uses the stored copy, not the submitted one, so a save cannot raise its own allowance; a follow-up can price outposts. |
| 3 | Reject with a real 409 or the Flash-friendly 200? | **200 with `error` set (`isClientFriendly: false`).** The Flash client shows the message once (`BASE.as:3413-3416`); a 409 gives it five silent retries and a generic popup (`:3420-3428`). The web client reads `errorDetails.status` either way (`web/src/api/http.ts:21-22`). |
| 4 | Fortification rules? | **Shape checks only, `fortifyUnpriced` never enforced.** No Map Room 2 main-yard type can fortify (`docs/specs/base-building.md:998-1006`) and the generator emits no `fortify_costs`; Map Room 3 sessions may write `fort` on the main yard, and refusing those needs a ladder first. |
| 5 | Timer tolerance | **10 seconds.** The save delay is 3 s (`server/src/game-data/flags.ts:44`), the tick 1 s, and the worker walk only ever makes a countdown longer. Section 5's WP4 revisits it from the log. |
| 6 | Resource slack | **1% of the production terms, at least 1 unit per resource.** Production is integer per cycle and the bound already adds a whole cycle; the slack covers the client's per-tick rounding without hiding a real gain. |
| 7 | Return the server's `resources` and `buildingdata` in a rejection so the web client can resync without reloading? | **No.** The Flash client cannot use them and `buildingdata` is 50 KB; the web client calls `/base/load` when it gets `serverStatus === 409`. Revisit when the web client sends economy saves. |
| 8 | Log mode: derive `rNmax` and `basevalue` anyway? | **No.** The promise of log mode is that nothing written changes, which is what makes it safe to turn on in production without notice. |
| 9 | Placement overlap check on owner saves? | **Not in this issue.** `sweepOverlaps` could run in log mode for one afternoon's work, but placement is neither cost, timer, cap nor level, and decorations may legitimately sit outside the plot (`docs/specs/base-building.md:1560-1561`). |
| 10 | Multi-step transitions without a voucher | **Allowed when the summed step times fit inside `elapsed + TOL`.** A lost save between two five-second wall steps is the honest case; anything slower than a wall cannot fit two steps into one save interval. |
| 11 | `Report` rows for log-mode violations | **Yes, one per save with violations**, through `logReport` (`reportManager.ts:18-29`). It is the existing audit trail the anti-cheat stub names; the `report` list grows by one summary entry per save, so a persistent cheat is visible by count without reading logs. |
| 12 | Where the `points` bound's banking term comes from | **The same harvest and outpost budgets as the delta**, summed over resources. Banking awards points equal to the banked amount (`BRESOURCE.as:452-457`), so the resource budget is also the points budget; it over-allows after tutorial stage 200 (halved) and that is fine for an upper bound. |
