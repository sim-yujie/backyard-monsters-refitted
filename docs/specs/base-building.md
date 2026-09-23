# Base Building and Economy — Rules and Data Specification

Reverse-engineered from the Refitted client (ActionScript 3) and server (TypeScript). This document
describes the **rules and data** of the yard — grid, placement, buildings, resources, workers,
upgrades, the Yard Planner and the save cycle — not its Flash rendering. It is written for a rebuild
of the yard as a web client.

All citations are `path:line` relative to the repository root. Endpoint shapes and the `Save` model
are documented in `docs/server-api.md` and are referenced rather than repeated.

Contents:

1. [Overview](#1-overview)
2. [Grid and placement](#2-grid-and-placement)
3. [Buildings](#3-buildings)
4. [Resources and storage](#4-resources-and-storage)
5. [Workers and build queue](#5-workers-and-build-queue)
6. [Upgrades](#6-upgrades)
7. [Town hall and progression](#7-town-hall-and-progression)
8. [Yard Planner](#8-yard-planner)
9. [Repair and healing](#9-repair-and-healing)
10. [Server validation](#10-server-validation)
11. [UNVERIFIED](#11-unverified)
12. [Redesign notes](#12-redesign-notes)

---

## 1. Overview

### What the yard is

A **yard** is one editable base: a rectangular plot of ground holding buildings, walls, traps,
decorations and mushrooms. A player owns one **main yard** and, on Map Room 2, up to 3500 captured
**outposts** (`client/scripts/GLOBAL.as:440`). Each yard is one `save` row on the server
(`server/src/database/models/save.model.ts`); `save.type` distinguishes `main`, `outpost`, `tribe`
and `inferno`.

The yard is opened with `POST /base/load` and checkpointed with `POST /base/save`
(see `docs/server-api.md` §2 "Base / Yard"). The yard screen is entered in one of several **modes**
(`GLOBAL.e_BASE_MODE`): `build` is the only editable one. Everything in this document applies to
`build` mode unless stated otherwise.

### Authority model

**The client is authoritative over almost everything in the yard.** The server stores and echoes
what the client sends.

| Concern | Who decides | Evidence |
| --- | --- | --- |
| Building placement, footprint, overlap | Client only | `client/scripts/GRID.as:81-113`; no server-side grid exists |
| Build / upgrade / fortify cost charged | Client only | `client/scripts/BFOUNDATION.as:1694-1697`, `:2283-2294` |
| Build / upgrade / fortify duration | Client only | `client/scripts/BFOUNDATION.as:1670-1674`, `:2295-2296` |
| Countdown ticking | Client, replayed from `savetime` | `client/scripts/BFOUNDATION.as:1359-1397` |
| Resource production and banking | Client only | `client/scripts/BRESOURCE.as:291-345`, `:441-467` |
| Resource pool | Client sends a **delta**; server adds it unchecked | `server/src/controllers/base/save/handlers/resourceHandler.ts:44-51`, `server/src/services/base/updateResources.ts:34-45` |
| Storage caps (`rNmax`) | Client sends absolute values; server overwrites | `server/src/services/base/updateResources.ts:37-38` |
| Shiny (premium currency) | Server, via the purchase handler | `docs/server-api.md` §2, `server/src/controllers/base/save/handlers/purchaseHandler.ts` |
| Town hall level → Map Room 2 unlock | Server, read from `buildingdata` | `server/src/controllers/base/load/baseLoad.ts:155-158` |
| Base level / empire points | Both compute it; server recomputes for display | `client/scripts/BASE.as:4867-4931`, `server/src/services/base/calculateBaseLevel.ts:11-20` |
| Countdown advance across an attack save | Server | `server/src/services/base/advanceBuildingTimers.ts:42-79` |
| Damage / destroyed / loot from attacks | Server-mediated, see `docs/specs/maproom2.md` and the combat spec | `server/src/controllers/base/save/baseSave.ts:74-200` |

The only thing the server actively refuses on a yard save is a caller who neither owns the base nor
holds an active `attackid` on it (`server/src/controllers/base/save/baseSave.ts:62-67`). Cheat
detection is delegated to a module that is a **no-op in open-source builds**
(`server/src/scripts/anticheat/pub/anticheat.stub.ts:31-35`). See §10.

### The save cycle

The yard screen runs a 1 Hz tick (`client/scripts/BASE.as:2507`). Two independent server calls come
out of it.

**Checkpoint save.** Any state change calls `BASE.Save()`, which only bumps a counter and stamps
`_lastSaveRequest` (`client/scripts/BASE.as:2591-2615`). The next tick flushes it through `SaveB()`
once `now - _lastSaveRequest >= saveDelay` (`client/scripts/BASE.as:2523`). `saveDelay` defaults to
2 seconds and is overridden by the server flag `savedelay`, currently **3**
(`client/scripts/BASE.as:2508-2511`, `server/src/game-data/flags.ts:44`). In attack modes the rule
is `> saveDelay * 2` or a 15 s / 20 s hard ceiling (`client/scripts/BASE.as:2514`, `:2519`).
A pending purchase forces an immediate flush (`client/scripts/BASE.as:2609-2611`, `:2523`).

**Heartbeat.** Every 25 to 34 seconds (`int(random*10)+25`, overridden by the `pageinterval` flag,
currently 25) the client calls `BASE.Page()`, which posts `/base/updatesaved`
(`client/scripts/BASE.as:2545-2558`, `client/scripts/BASE.as:3440`, `:3633-3636`,
`server/src/game-data/flags.ts:46`). This is read-only: it refreshes flags, resources and credits
and accepts no yard data (`docs/server-api.md` §2).

**Save suppression.** `SaveB()` returns immediately while `_blockSave` is set (during a building
move, `client/scripts/BASE.as:2762`), during any view/help mode, while loading, while another save
is in flight, and during catch-up replay (`client/scripts/BASE.as:3135-3148`).

### What a save contains

`SaveB()` builds a flat form body (`client/scripts/BASE.as:3155-3324`). The keys that matter for
base building:

| Key | Meaning | Built by |
| --- | --- | --- |
| `baseid`, `basesaveid` | Identify the yard and the last known save id | `BASE.as:3189`, `:3197` |
| `buildingdata` | Every building: position, type, level, countdowns, fortification, hp | `BASE.as:3161`, `BFOUNDATION.as:2968-3030` |
| `buildinghealthdata` | Current HP, only for buildings below full health | `BASE.as:3169` |
| `buildingkeydata` | Written but never read server-side (`docs/server-api.md` §3) | `BASE.as:3170` |
| `resources` | **Delta** since the last save, plus absolute `r1max..r4max` | `BASE.as:3172`, `:2643` |
| `iresources` | Same for the Inferno pool | `BASE.as:3228-3231` |
| `researchdata` | Buildings held in storage (decorations recycled into inventory) | `BASE.as:3181`, `:2712-2717` |
| `mushrooms` | Surviving yard mushrooms | `BASE.as:3183`, `:2746` |
| `buildingresources` | Outpost auto-bank income snapshot plus a `t` timestamp | `BASE.as:3238`, `com/monsters/autobanking/AutoBankManager.as:44-52` |
| `storedata` | Owned/active store purchases (via `purchase`, see below) | `docs/server-api.md` §2 |
| `purchase` | `[itemKey, quantity]`, charged server-side | `BASE.as:3292-3295` |
| `points`, `basevalue`, `empirevalue` | Progression scalars, stored as strings | `BASE.as:3194-3195`, `:3208` |
| `catapult`, `flinger` | Cached levels of those two buildings, used by the world map | `BASE.as:3179-3180` |
| `damage`, `destroyed`, `over` | Attack outcome | `BASE.as:3300-3312` |
| `tutorialstage`, `quests`, `achieved`, `stats` | Progression bookkeeping | `BASE.as:3185`, `:3196`, `:3210`, `:3171` |
| `clienttime`, `timeplayed`, `version` | Telemetry | `BASE.as:3198`, `:3296`, `:3201` |

Note that `savetemplate` (the Yard Planner slots) is **not** in `Save.saveKeys`
(`server/src/database/models/save.model.ts:441-500`), so `/base/save` cannot write it. Only
`/bm/yardplanner/savetemplate` can.

### Load and replay

`/base/load` returns `savetime` (when the yard was last saved) and `currenttime`. The client sets
`_lastProcessed = savetime` and replays the yard forward to `currenttime`, clamping the gap to
**30 days** (`client/scripts/BASE.as:773-781`). The replay runs in 10 ms slices across frames
(`client/scripts/BASE.as:1863-1874`) and advances every building's countdowns, production and
repair exactly as live ticking would (`client/scripts/BASE.as:1876-1900`). Outpost income is
credited in one lump at the start of the replay
(`client/scripts/BASE.as:1845-1847`).

The server mirrors the same 30-day clamp when it has to move timers itself
(`server/src/services/base/advanceBuildingTimers.ts:32`, `:43`).

---

## 2. Grid and placement

### Coordinate systems

There are three coordinate spaces and the code moves between them constantly.

| Space | Units | Used for |
| --- | --- | --- |
| **Yard coordinates** (`X`, `Y`) | Logical plot units, origin at plot centre | What `buildingdata` stores |
| **Isometric screen coordinates** (`_mc.x`, `_mc.y`) | Screen pixels, origin at plot centre | Live building positions in memory |
| **Grid cells** | 5 yard units per cell | The occupancy bitmap |

Conversion (`client/scripts/GRID.as:135-144`):

```
ToISO(x, y)   -> { x: floor(x - y),        y: floor((x + y) * 0.5) }
FromISO(x, y) -> { x: ceil(x * 0.5 + y),   y: ceil(y - x * 0.5) }
```

`Export()` writes `FromISO(_mc.x, _mc.y)` into `X`/`Y` (`client/scripts/BFOUNDATION.as:2970-2972`);
`Setup()` reads `ToISO(building.X, building.Y, 0)` back (`client/scripts/BFOUNDATION.as:3040`).

### Yard dimensions

The plot is a rectangle in yard units centred on the origin, so it spans
`[-width/2, width/2) x [-height/2, height/2)`.

| Property | Value | Source |
| --- | --- | --- |
| Base plot | 1000 x 800 yard units | `client/scripts/STORE.as:2346-2347` |
| Per "More Yardage" purchase | both axes x 1.1, then rounded up to a multiple of 20 | `client/scripts/STORE.as:2357-2365` |
| Max purchases | 6 (`ENL` price ladder has 6 entries) | `server/src/game-data/store/storeItems.ts:39-46`, `client/scripts/com/monsters/baseplanner/popups/BasePlannerPopup.as:341` |
| Resulting max plot | 1780 x 1420 | `client/scripts/com/monsters/baseplanner/PlannerDesignView.as:106` |
| Hard defaults before purchases load | 800 x 800 | `client/scripts/GLOBAL.as:802-803` |

The 800 x 800 default at `GLOBAL.as:802-803` is overwritten by `STORE.ProcessPurchases()` on every
load, so the effective minimum is 1000 x 800.

The Yard Planner hardcodes the same ladder as a lookup table indexed by `ENL.q`, which confirms
every step of the 1.1x-rounded-to-20 sequence
(`client/scripts/com/monsters/baseplanner/PlannerDesignView.as:106`):

```
[1000x800, 1100x880, 1220x980, 1340x1080, 1480x1180, 1620x1300, 1780x1420]
```

It also carries a separate, much larger bound for decorations,
`MAX_YARD_DIMENSIONS = 3240 x 2600`
(`client/scripts/com/monsters/baseplanner/PlannerDesignView.as:104`, applied at `:576-579`). That is
the planner's own limit; the live yard instead lets decorations go anywhere inside the 2600 x 2600
grid bitmap (`client/scripts/GRID.as:102-106`), so the two bounds do not agree on the X axis.

The Inferno yard uses the separate `ENLI` ladder (`client/scripts/STORE.as:2350-2356`).

### The occupancy grid

`GRID` holds a flat `Vector.<uint>` bitmap covering a fixed **2600 x 2600** area at **5 units per
cell**, i.e. 520 x 520 cells (`client/scripts/GRID.as:8-12`, `:117-121`). Bit 0 of each cell means
"occupied". The bitmap is larger than any possible plot, so plot bounds are checked separately.

- `Block(rect, true/false)` sets or clears bit 0 over a footprint, stepping 5 units at a time
  (`client/scripts/GRID.as:25-49`).
- `Blocked(point, checkBounds, allowOutside)` returns `3` when outside the bitmap, `2` when outside
  the **plot** (only if `checkBounds` and not `allowOutside`), else the occupancy bit
  (`client/scripts/GRID.as:102-113`).
- `FootprintBlocked(footprint, point, checkBounds, allowOutside)` tests every 5-unit sample inside
  every footprint rectangle (`client/scripts/GRID.as:81-100`).

`BASE.BuildBlockers(building, isDecoration)` is the single placement gate. It returns `"overlap"` if
the footprint is blocked and `""` otherwise; **decorations pass `allowOutside = true`, so they may
be placed outside the plot boundary** (`client/scripts/BASE.as:4635-4640`).

A building writes its own occupancy with `GridCost(true)` and clears it with `GridCost(false)`
(`client/scripts/BFOUNDATION.as:2616-2623`). Walls additionally register with the pathing system
(`client/scripts/BWALL.as:11-15`).

### Footprints

Footprint rectangles are defined per building class in yard units, not in the stats table. The
`size` field in the stats table is used for build-menu presentation and is the footprint **only for
decorations** (`client/scripts/BDECORATION.as:23-26`).

| Footprint | Buildings (class file) |
| --- | --- |
| 20 x 20 | Wooden Block 17, Stone Block 18, Booby Trap 24, Heavy Trap 117 |
| 40 x 40 | Simple Sign 52 |
| 70 x 70 | Harvesters 1–4, General Store 12, Cannon 20, Sniper 21, Laser 23, Tesla 25, Flak 115, Railgun 118, Inferno towers 129/130/132, Spurtz 136 |
| 80 x 80 | Silo 6, Monster Juicer 9, Radio 113, Wild Monster Baiter 19 |
| 90 x 90 | Flinger 5, Map Room 11, Monster Bunker 22, Catapult 51 |
| 100 x 100 | Monster Locker 8, Yard Planner 10, Monster Academy 26, Champion Chamber 119, Monster Lab 116, Siege buildings 133/134 |
| 130 x 130 | Town Hall 14 (160 x 160 in Inferno), Outpost core 112, Stronghold 138, Resource Outpost 139, Outpost Defender 140 |
| 140 x 140 | Trojan Horse 27 |
| 160 x 160 | Monster Housing 15, Champion Cage 114, Housing Bunker 128 |
| 190 x 160 | Inferno Portal 127 |

Sources: `client/scripts/BUILDING*.as` (each class sets `_footprint` in its constructor, e.g.
`BUILDING1.as:21`, `BUILDING14.as:18`, `BUILDING15.as:21`), plus `CHAMPIONCAGE.as:274`,
`GuardTower.as:31`, `HOUSINGBUNKER.as:41`, `INFERNOPORTAL.as:37`,
`com/monsters/siege/SiegeBuilding.as:22`.

Monster Housing and Monster Bunker have a **hollow** grid cost: only their perimeter strips block
movement, so monsters can walk through the middle (`client/scripts/BUILDING15.as:22`,
`client/scripts/BUILDING22.as:70`). Most other buildings use a two-band cost, cheap on the outer
ring and 200 in the interior (`client/scripts/BUILDING1.as:22`).

### Placing a new building

1. `BASE.addBuildingB(type)` checks that a worker is free (unless build time is 0 or the building
   comes out of storage) and runs `CanBuild` (`client/scripts/BASE.as:4132-4164`).
2. On success the building is instantiated, set to 50% alpha, and attached to the cursor
   (`client/scripts/BASE.as:4146-4152`, `client/scripts/BFOUNDATION.as:1546-1555`).
3. While following the cursor the position snaps to **10 px horizontally and 5 px vertically** in
   isometric screen space, and the footprint tints red when blocked
   (`client/scripts/BFOUNDATION.as:1557-1579`).
4. `MOUSE_UP` on the ground calls `Place()`. It re-runs `BuildBlockers` and `CanBuild`, and cancels
   if either fails (`client/scripts/BFOUNDATION.as:1634-1653`).
5. A drag of the map (`MAP._dragged`) suppresses the placement click
   (`client/scripts/BFOUNDATION.as:1634`).

`CanBuild(type, freeOfCharge)` rejects in this order (`client/scripts/BASE.as:3640-3826`):

| Check | Message key | Line |
| --- | --- | --- |
| Tutorial stage below the building's `tutstage` | `base_builderr_locked` | `:3679-3682` |
| Taunt/gift item in own yard | `base_builderr_ownyard1` | `:3683-3686` |
| Non-taunt building outside build mode | `base_builderr_ownyard2` | `:3687-3690` |
| `quantity[townHallLevel] == 0` | `base_builderr_thlevelreqd` with the first level that allows it | `:3729-3739` |
| Already at `quantity[townHallLevel]` of this type | `base_builderr_uth` (more at a higher hall) or `base_builderr_onlybuildx` | `:3740-3757` |
| Prerequisite buildings from `costs[0].re` not met | `requirements_notmet` | `:3759-3787` |
| Not enough of any resource | "You need N more X" | `:3788-3820` |

`re` entries are `[buildingType, countRequired, minLevel]`: the player must own at least `count`
buildings of that type at level `minLevel` or higher (`client/scripts/BASE.as:3770-3781`).

`quantity` is an 11-entry array indexed by **town hall level**, so `quantity[0]` is the count
allowed with no town hall and `quantity[6]` the count at hall 6
(`client/scripts/BASE.as:3692-3728`). Decorations always use `quantity[0]`
(`client/scripts/BASE.as:3720-3722`).

### Moving an existing building

`btn_move` on the building info panel calls `StartMove()`
(`client/scripts/BUILDINGINFO.as:557-559`). `StartMove` sets `BASE._blockSave = true`, clears the
building's grid occupancy and attaches the same cursor-follow handler
(`client/scripts/BFOUNDATION.as:2760-2781`). `StopMoveB()` re-tests `BuildBlockers`; **if the new
spot is blocked the building snaps back to `_oldPosition`** and an error sound plays
(`client/scripts/BFOUNDATION.as:2797-2810`). It then re-blocks the grid, resets pathing costs,
clears `_blockSave` and saves (`client/scripts/BFOUNDATION.as:2815-2823`).

Buildings flagged `isImmobile` have no Move button (`client/scripts/BUILDINGINFO.as:257-259`).
Stronghold, Resource Outpost and Outpost Defender are immobile
(`client/scripts/YARD_PROPS.as:7788`, `:7864`, `:7903`), as are the Trojan Horse and the Inferno
Portal (`:3041`, `:6791`).

Moving is free and instant. There is no cooldown and no cost.

`GRID.FindSpace(building)` is a fallback that scans a 120 x 100 lattice at 10-unit steps for the
first unblocked spot (`client/scripts/GRID.as:51-79`).

### Walls

Walls (types 17 Wooden Block and 18 Stone Block) are 20 x 20 buildings with a 5-second build time
and a 40 x 40 "soft" grid cost ring around the hard 20 x 20 core
(`client/scripts/BUILDING17.as:13-14`, `client/scripts/BUILDING18.as:12-13`). The soft ring's cost
scales with level: `100 + level * 25` (`client/scripts/BFOUNDATION.as:3150-3152`). There is **no
adjacency bonus and no auto-joining rule in the game logic** — walls are independent 20 x 20 blocks
and only the pathing cost field makes a solid line expensive to cross
(`client/scripts/BWALL.as:11-15`).

Wall counts are generous and hall-gated: 30 wooden blocks at hall 2 rising to 400 at hall 10, and
10 stone blocks at hall 2 rising to 90 (`client/scripts/YARD_PROPS.as:1710`, `:1831`, `quantity`
arrays).

Walls can be bulk-upgraded with shiny through the `BLK2`..`BLK5` store items: buying one
immediately finishes any in-progress wall work and raises **every** wall to that level
(`client/scripts/STORE.as:1993-2026`). The button is `btn_upgradeall`
(`client/scripts/BUILDINGINFO.as:246-248`, `client/scripts/BUILDINGINFO.as:573-580`).

### Decorations

Decorations are ids 28–50 and 55–111, plus 120, 121, 131, 135 (`group == 4`). They differ from
normal buildings in four ways:

- Footprint equals the `size` stat, taken straight from the props table
  (`client/scripts/BDECORATION.as:23-26`).
- They may be placed **outside** the plot boundary (`client/scripts/BASE.as:4635-4636` with
  `param2 == true` from `BFOUNDATION.as:1635`).
- Their allowance is `quantity[0]`, independent of town hall level
  (`client/scripts/BASE.as:3720-3722`).
- Recycling them returns them to **inventory** rather than refunding resources
  (`client/scripts/BFOUNDATION.as:2609-2611`,
  `client/scripts/com/monsters/inventory/InventoryManager.as:13-21`). Inventory is persisted in the
  `researchdata` save key (`client/scripts/BASE.as:2712-2717`, `:973-976`).

### Mushrooms (yard obstacles)

Mushrooms are building type 7, 30 x 30, one grid band of cost 10
(`client/scripts/BUILDING7.as:9-10`). They exist only in the **main yard** and only while the
`mushrooms` flag is on (`client/scripts/MUSHROOMS.as:37-42`, `server/src/game-data/flags.ts:63`).

| Rule | Value | Source |
| --- | --- | --- |
| First-ever seeding | 5 rings x 4 mushrooms = 20, on radii `i*100 + 300` at angles `i*60 + twist` | `client/scripts/MUSHROOMS.as:51-79` |
| Stored cap | first 20 entries of `BASE._mushroomList`; the rest are deleted | `client/scripts/MUSHROOMS.as:84`, `:115-121` |
| Respawn rate | one per `17280` seconds (4.8 hours) since `_lastSpawnedMushroom` | `client/scripts/MUSHROOMS.as:129` |
| Respawn burst cap | 10 per load, and never above 10 mushrooms total | `client/scripts/MUSHROOMS.as:132-137` |
| Out-of-plot mushrooms | replaced with a fresh random one | `client/scripts/MUSHROOMS.as:93-111` |
| Spawn placement | random point in the plot, up to 5000 attempts, must not overlap a 30 x 30 footprint | `client/scripts/MUSHROOMS.as:171-181` |

Clearing a mushroom **costs no resources but costs a worker**. `btn_pick` calls
`MUSHROOMS.PickWorker`, which enqueues the mushroom like a build job; if no worker is free the
"worker busy" popup appears (`client/scripts/MUSHROOMS.as:197-206`). The worker walks over, the
mushroom shakes for 60 ticks, and then resolves (`client/scripts/BMUSHROOM.as:67-84`).

One mushroom in four is **golden**, decided deterministically from its position:
`new Rndm(int(x * y)).random() * 4 == 0` (`client/scripts/MUSHROOMS.as:223-224`). A golden mushroom
awards **3 or 8 shiny** depending on a random variant roll, charged as a `MUSHROOM1` / `MUSHROOM2`
purchase (`client/scripts/MUSHROOMS.as:275-285`). Ordinary mushrooms give nothing but a worker
quip.

Mushrooms are skipped by the Yard Planner entirely (`client/scripts/BASE.as:5097-5109`) and are
excluded from the worker's "shortest job" search (`client/scripts/QUEUE.as:129`).

---

## 3. Buildings

### Where the numbers live

**There is no building stat table on the server.** `server/src/game-data/stats/` holds only monster,
champion and XP data. Every building stat comes from the client:

| Yard | Table | File |
| --- | --- | --- |
| Main yard, Map Room 3 | `YARD_PROPS._yardProps` | `client/scripts/YARD_PROPS.as:9` |
| Main yard, Map Room 2 | a shallow copy of the above with four entries overwritten | `client/scripts/GLOBAL.as:614-711`, `:730-740` |
| Outposts | `OUTPOST_YARD_PROPS._outpostProps` | `client/scripts/OUTPOST_YARD_PROPS.as` |
| Inferno | `INFERNOYARDPROPS._infernoYardProps` | `client/scripts/INFERNOYARDPROPS.as` |

Selection happens in `GLOBAL.SetBuildingProps()` (`client/scripts/GLOBAL.as:714-750`). The array is
indexed by `id - 1` (`client/scripts/BFOUNDATION.as:547`).

**Map Room 2 overrides** (`client/scripts/GLOBAL.as:614-711`) replace the cost ladder and some
arrays for exactly four buildings. Since this project runs Map Room 2 as the default overworld,
these are the live numbers for those four:

| Id | Building | What changes | Line |
| --- | --- | --- | --- |
| 5 | Flinger | cost ladder cut to 4 levels; `capacity` = `[500, 1000, 1750, 2250, 3000, 4000]` | `GLOBAL.as:684-713` |
| 9 | Monster Juicer | cost ladder replaced (3 levels, 1,000,000 of r1/r2/r3 at level 1, 12 h) | `GLOBAL.as:616-637` |
| 15 | Monster Housing | cost ladder cut to 6 levels; `capacity` = `[200, 260, 320, 380, 450, 540]` | `GLOBAL.as:639-682` |
| 22 | Monster Bunker | `capacity` = `[380, 450, 540, 660, 800]` | `GLOBAL.as:683` |

Note the index arithmetic in that function is `_buildingProps[id - 1]`, so `_buildingProps[8]` is id
9, `_buildingProps[14]` is id 15 and `_buildingProps[21]` is id 22.

### Stat field reference

Each props entry carries (`client/scripts/YARD_PROPS.as:10-155` is a complete example):

| Field | Meaning |
| --- | --- |
| `id` | Building type id, matches the `t` field in `buildingdata` |
| `group` | Build-menu tab: 1 resource, 2 buildings, 3 defence, 4 decoration, 999 non-buildable |
| `order` | Sort order inside the tab |
| `type` | `resource`, `special`, `tower`, `wall`, `trap`, `cage`, `decoration`, `mushroom`, `enemy`, `taunt`, `immovable`, `placeholder` |
| `size` | Build-menu size class; the actual footprint for decorations only |
| `tutstage` | Tutorial stage that unlocks it (only enforced below stage 200) |
| `cls` | The AS3 class that implements it |
| `costs[]` | One entry per level: `r1..r4`, `time` (seconds), `re` (prerequisites) |
| `quantity[]` | Max count allowed, indexed by town hall level 0..10 |
| `hp[]` | Max health per level |
| `repairTime[]` | Full-repair duration per level, in seconds |
| `produce[]`, `cycleTime[]` | Harvester output per cycle and cycle length |
| `capacity[]` | Harvester buffer, silo storage, housing space or flinger capacity depending on the building |
| `stats[]` | Tower range/damage/rate/speed/splash per level |
| `can_fortify`, `fortify_costs[]` | Fortification ladder, Map Room 3 only in practice |

`costs` length is the **max level**. `CanUpgrade` refuses when `level >= costs.length`
(`client/scripts/BASE.as:3867-3870`).

### Master building table (Map Room 2 main yard)

Cost and time columns are for **level 1 (initial build)**. "TH" is the first town hall level at
which `quantity` becomes non-zero. Full ladders for the core economy buildings follow the table.

| Id | Name | Group | Type | Footprint | Max lvl | TH | r1 | r2 | r3 | Build time | Prereqs | What it does |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Twig Snapper | resource | resource | 70 | 10 | 1 | 0 | 750 | 0 | 15 s | TH 1 | Produces twigs (r2) |
| 2 | Pebble Shiner | resource | resource | 70 | 10 | 1 | 750 | 0 | 0 | 15 s | TH 1 | Produces pebbles (r1) |
| 3 | Putty Squisher | resource | resource | 70 | 10 | 1 | 525 | 224 | 0 | 20 s | TH 1 | Produces putty (r3) |
| 4 | Goo Factory | resource | resource | 70 | 10 | 1 | 247 | 577 | 0 | 20 s | TH 1 | Produces goo (r4) |
| 5 | Flinger | buildings | special | 90 | 4 (MR2) | 1 | 1,000 | 1,000 | 500 | 15 min | TH 1 | Sets attack range and monster carry capacity on the world map |
| 6 | Storage Silo | resource | special | 80 | 10 | 1 | 3,010 | 1,855 | 0 | 20 min | TH 1, one of each harvester | Raises all four storage caps |
| 7 | Mushroom | — | mushroom | 30 | — | — | — | — | — | — | — | Yard obstacle, see §2 |
| 8 | Monster Locker | buildings | special | 100 | 4 | 3 | 1,800 | 2,300 | 0 | 10 min | TH 2 | Unlocks new monster species |
| 9 | Monster Juicer | buildings | special | 80 | 3 | 1 | 1,000,000 | 1,000,000 | 1,000,000 | 12 h | TH 3, Housing | Converts monsters back into goo |
| 10 | Yard Planner | buildings | special | 100 | 1 | 3 | 250,000 | 250,000 | 0 | 12 h | TH 3 | Unlocks the Yard Planner, see §8 |
| 11 | Map Room | buildings | special | 90 | 3 | 1 | 2,000 | 2,000 | 0 | 15 min | TH 1 | Opens the world map; level 2/3 are free but take 4 days each |
| 12 | General Store | buildings | special | 70 | 1 | 1 | 1,080 | 720 | 0 | 10 s | TH 1 | Opens the shiny store |
| 13 | Hatchery | buildings | special | 100 | 3 | 1 | 2,000 | 2,000 | 0 | 15 min | TH 1, Housing | Produces monsters |
| 14 | Town Hall | buildings | special | 130 | 10 | 0 | 0 | 0 | 0 | 10 s | — | Gates everything, see §7 |
| 15 | Monster Housing | buildings | special | 160 | 6 (MR2) | 1 | 2,160 | 2,160 | 0 | 5 min | TH 1 | Housing space for monsters |
| 16 | Hatchery Control Centre | buildings | special | 100 | 1 | 3 | 4,000,000 | 4,000,000 | 4,000,000 | 25 h | TH 3, 2 x Hatchery lvl 3 | Batch monster production |
| 17 | Wooden Block | defence | wall | 20 | 5 | 2 | 1,000 | 0 | 0 | 5 s | TH 2 | Wall segment |
| 18 | Stone Block | defence | wall | 20 | 1 | 2 | 0 | 2,000 | 0 | 5 s | TH 3 | Heavier wall segment |
| 19 | Wild Monster Baiter | buildings | special | 80 | 7 | 4 | 25,000 | 25,000 | 15,000 | 5 h | TH 4, Locker | Triggers wild monster attacks for rewards |
| 20 | Cannon Tower | defence | tower | 70 | 10 | 1 | 2,000 | 1,500 | 500 | 30 s | TH 1 | Single-target defence |
| 21 | Sniper Tower | defence | tower | 70 | 10 | 1 | 1,500 | 2,000 | 500 | 30 s | TH 1 | Long-range defence |
| 22 | Monster Bunker | defence | tower | 90 | 5 | 3 | 250,000 | 187,500 | 62,500 | 6 h | TH 3, Housing | Garrisons defending monsters |
| 23 | Laser Tower | defence | tower | 70 | 8 | 4 | 500,000 | 250,000 | 100,000 | 5 h | TH 4 | Splash defence |
| 24 | Booby Trap | defence | trap | 20 | 1 | 2 | 1,000 | 1,000 | 1,000 | 5 s | TH 2 | One-shot trap |
| 25 | Tesla Tower | defence | tower | 70 | 8 | 4 | 187,500 | 250,000 | 62,500 | 5 h | TH 4 | Chain/slow defence |
| 26 | Monster Academy | buildings | special | 100 | 5 | 3 | 100,000 | 100,000 | 0 | 3 h | TH 3, 2 x Locker | Levels up monster species |
| 27 | Trojan Horse | — | enemy | 140 | 1 | — | — | — | — | 5 s | — | Event prop, not player-buildable |
| 51 | Catapult | buildings | special | 90 | 4 | 3 | 75,000 | 75,000 | 75,000 | 90 min | TH 3, Flinger | Long-range siege on the world map |
| 52 | Simple Sign | — | taunt | 40 | 1 | — | 100,000 x4 | | | 0 s | — | Message left in another player's yard |
| 112 | Outpost core | buildings | special | 130 | 1 | — | — | — | — | — | — | The town-hall equivalent inside an outpost |
| 113 | Radio | buildings | special | 80 | 1 | 1 | 2,000 | 2,000 | 2,000 | 5 min | TH 1 | Music player |
| 114 | Champion Cage | defence | cage | 160 | 1 | 4 | 500,000 | 500,000 | 250,000 | 24 h | TH 4 | Houses a champion |
| 115 | Flak Tower | defence | tower | 70 | 8 | 4 | 215,000 | 280,000 | 62,500 | 5 h | TH 4 | Anti-air defence |
| 116 | Monster Lab | buildings | special | 100 | 3 | 5 | 100,000 | 100,000 | 0 | 3 h | TH 5, 3 x Locker, 2 x Academy | Monster research |
| 117 | Heavy Trap | defence | trap | 20 | 1 | 4 | 50,000 | 50,000 | 50,000 | 5 s | TH 4 | Heavier one-shot trap |
| 118 | Railgun Tower | defence | tower | 70 | 8 | 5 | 2,000,000 | 2,400,000 | 1,600,000 | 12 h | TH 5 | Highest-tier tower |
| 119 | Champion Chamber | defence | special | 100 | 1 | 4 | 500,000 | 500,000 | 250,000 | 24 h | TH 4, Champion Cage | Freezes/stores champions |
| 120 | Golden Big Gulp | decoration | decoration | 70 | 1 | any | — | — | — | — | — | Reward decoration |
| 121, 131 | Totems | decoration | decoration | 40 | 6 | any | — | — | — | — | — | Wild Monster Invasion reward |
| 127 | Inferno Entrance | — | enemy | 190 x 160 | 5 | — | — | — | — | 5 s | — | Portal to the Inferno yard |
| 128 | Housing Bunker | buildings | tower | 160 | — | — | — | — | — | — | — | Inferno housing |
| 129, 130, 132 | Quake / Inferno Cannon / Magma tower | defence | tower | 70 | 6 | — | 312,500 / — / 187,500 | | | 5 h | Underhall 1 | Inferno-only towers |
| 133 | Siege Factory | buildings | special | 100 | 1 | — | 1,500,000 | 1,500,000 | 0 | 24 h | Underhall, Siege Lab | Inferno siege |
| 134 | Siege Works | buildings | special | 100 | 10 | — | 600,000 | 600,000 | 0 | 12 h | Underhall | Inferno siege research |
| 136, 137 | Spurtz Cannons | defence | tower | 70 | 5 | — | — | — | — | — | — | Inferno event towers |
| 138 | Stronghold | defence | tower | 130 | 3 | — | 5 x4 | | | 1 s | — | Map Room 3 capturable structure |
| 139 | Resource Outpost | defence | cage | 130 | 1 | — | 5 x4 | | | 1 s | — | Map Room 3 capturable structure |
| 140 | Outpost Defender | defence | special | 130 | 5 | — | 5 x4 | | | 1 s | — | Map Room 3 capturable structure |
| 28–50, 55–111, 135 | Flags, gnomes, statues, plants, trophies | decoration | decoration | 20–100 | 1 | any | shiny or reward | | | 0 s | — | Cosmetic only |
| 53, 54 | Halloween pumpkins | — | immovable | 10 | — | — | — | — | — | — | — | Event props |
| 122–126 | placeholder | — | placeholder | 1 | 1 | — | — | — | — | — | — | Unused slots |

Row sources: each id's entry in `client/scripts/YARD_PROPS.as` (line numbers: id 1 at `:10`, 2 at
`:157`, 3 at `:304`, 4 at `:451`, 5 at `:598`, 6 at `:713`, 7 at `:873`, 8 at `:901`, 9 at `:1002`,
10 at `:1063`, 11 at `:1110`, 12 at `:1170`, 13 at `:1216`, 14 at `:1299`, 15 at `:1553`, 16 at
`:1663`, 17 at `:1710`, 18 at `:1831`, 19 at `:1875`, 20 at `:1966`, 21 at `:2187`, 22 at `:2410`,
23 at `:2487`, 24 at `:2682`, 25 at `:2728`, 26 at `:2923`, 27 at `:3029`, 51 at `:3849`, 52 at
`:3937`, 112 at `:5934`, 113 at `:5949`, 114 at `:5993`, 115 at `:6033`, 116 at `:6225`, 117 at
`:6283`, 118 at `:6324`, 119 at `:6521`, 127 at `:6779`, 128 at `:6857`, 129 at `:6872`, 132 at
`:7142`, 133 at `:7312`, 134 at `:7358`, 138 at `:7775`, 139 at `:7851`, 140 at `:7890`), with the
Map Room 2 overrides for ids 5, 9, 15 and 22 at `client/scripts/GLOBAL.as:616-713`.

### Full ladders — harvesters (ids 1–4)

All four share the same `produce`, `cycleTime`, `capacity`, `hp` and `repairTime` arrays; only the
cost currency differs (`client/scripts/YARD_PROPS.as:10-155` and the three parallel entries).

| Level | produce/cycle | cycleTime | buffer capacity | hp | repairTime | upgrade time |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 2 | 10 s | 720 | 500 | 30 s | 15 s (build) |
| 2 | 4 | 10 s | 2,160 | 950 | 60 s | 5 min |
| 3 | 7 | 10 s | 5,670 | 1,800 | 120 s | 20 min |
| 4 | 11 | 10 s | 13,365 | 3,400 | 240 s | 1 h |
| 5 | 16 | 10 s | 29,160 | 6,500 | 480 s | 2 h |
| 6 | 22 | 10 s | 60,142 | 12,000 | 960 s | 5 h |
| 7 | 29 | 10 s | 118,918 | 24,000 | 1,920 s | 12 h |
| 8 | 37 | 10 s | 227,584 | 45,000 | 3,840 s | 24 h |
| 9 | 46 | 10 s | 424,414 | 85,000 | 7,680 s | 48 h |
| 10 | 56 | 10 s | 775,018 | 165,000 | 15,360 s | 72 h |

Upgrade costs, Twig Snapper (r2 only): 1,575 / 3,300 / 6,950 / 14,500 / 30,600 / 64,300 / 135,000 /
283,600 / 600,000 for levels 2–10. Pebble Shiner is identical in r1. Putty Squisher pays
r1 and r2 in a 70/30 split; Goo Factory pays r1 and r2 in a 30/70 split
(`client/scripts/YARD_PROPS.as:304`, `:451`).

Town hall prerequisites climb with level: levels 1–3 need TH 1, 4–5 need TH 2, 6–7 need TH 3, 8–9
need TH 4, 10 needs TH 5 (`re` entries in the same blocks).

### Full ladder — Storage Silo (id 6)

| Level | Capacity added per resource | r1 | r2 | time | hp | TH |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 7,500 | 3,010 | 1,855 | 20 min | 750 | 1 |
| 2 | 15,000 | 7,421 | 3,710 | 30 min | 1,400 | 2 |
| 3 | 30,000 | 14,843 | 7,421 | 45 min | 2,550 | 2 |
| 4 | 60,000 | 29,687 | 14,843 | 67.5 min | 4,750 | 3 |
| 5 | 120,000 | 59,375 | 29,687 | 101 min | 8,800 | 3 |
| 6 | 240,000 | 118,750 | 59,375 | 152 min | 16,250 | 3 |
| 7 | 480,000 | 237,500 | 118,750 | 3.8 h | 30,000 | 4 |
| 8 | 960,000 | 475,000 | 237,500 | 5.7 h | 55,600 | 4 |
| 9 | 1,920,000 | 950,000 | 475,000 | 8.5 h | 105,000 | 5 |
| 10 | 3,840,000 | 1,900,000 | 950,000 | 12.8 h | 190,000 | 6 |

Source `client/scripts/YARD_PROPS.as:713`. Silo count allowed per town hall level:
`[0,1,2,3,4,5,5,5,5,6,6]`.

### Full ladder — Town Hall (id 14)

| Level | r1 = r2 | time | hp | repairTime |
| --- | --- | --- | --- | --- |
| 1 | 0 | 10 s | 4,000 | 480 s |
| 2 | 7,000 | 10 min | 8,800 | 1,920 s |
| 3 | 42,000 | 4 h | 20,000 | 3,840 s |
| 4 | 240,000 | 16 h | 42,000 | 7,680 s |
| 5 | 1,400,000 | 48 h | 94,000 | 15,360 s |
| 6 | 7,560,000 | 96 h | 200,000 | 30,720 s |
| 7 | 11,340,000 | 144 h | 300,000 | 64,800 s |
| 8 | 14,420,000 | 192 h | 400,000 | 86,400 s |
| 9 | 18,680,000 | 288 h | 500,000 | 172,800 s |
| 10 | 25,000,000 | 336 h | 600,000 | 345,600 s |

Source `client/scripts/YARD_PROPS.as:1299`. Each level requires the previous one, so the ladder is
strictly sequential.

### Full ladder — Monster Housing (id 15, Map Room 2 values)

| Level | Housing space | r1 = r2 | time | Prereqs |
| --- | --- | --- | --- | --- |
| 1 | 200 | 2,160 | 5 min | TH 1 |
| 2 | 260 | 8,640 | 75 min | TH 3, Locker |
| 3 | 320 | 34,560 | 3 h | TH 4, Locker |
| 4 | 380 | 138,240 | 8 h | TH 5, Locker |
| 5 | 450 | 552,960 | 20 h | TH 6, Locker |
| 6 | 540 | 2,211,840 | 40 h | TH 6, Locker |

Costs and times from `client/scripts/GLOBAL.as:639-682`; capacity from
`client/scripts/GLOBAL.as:682`. The Map Room 3 table in `YARD_PROPS.as:1553` goes to level 10 with
capacities up to 1,680 and is **not** used on Map Room 2.

Housing count allowed per town hall level: `[0,1,1,2,2,3,3,3,4,4,4]`.

---

## 4. Resources and storage

### The four resources

| Key | Name | Produced by | Name key |
| --- | --- | --- | --- |
| `r1` | Twigs | Twig Snapper (id 1) | `#r_twigs#` |
| `r2` | Pebbles | Pebble Shiner (id 2) | `#r_pebbles#` |
| `r3` | Putty | Putty Squisher (id 3) | `#r_putty#` |
| `r4` | Goo | Goo Factory (id 4) | `#r_goo#` |

`client/scripts/BRESOURCE.as:45-70`. In the Inferno yard the same four slots are relabelled Bone,
Coal, Sulfur, Magma (`BRESOURCE.as:20-26`, `:46-48`) and live in the separate `iresources` pool.

Harvester **type id** equals the **resource index it produces**: Twig Snapper is type 1 and fills
`r1`, Pebble Shiner is type 2 and fills `r2`, Putty Squisher is type 3 and fills `r3`, Goo Factory
is type 4 and fills `r4` — no mismatch. Confirmed by `client/scripts/GLOBAL.as:890`
(`_resourceNames = ["#r_twigs#", "#r_pebbles#", "#r_putty#", "#r_goo#", ...]`, indexed `r1..r4`),
`GLOBAL.as:911-925` (`getResourceFrame`: `r1` → `"twig"`, `r2` → `"pebble"`, `r3` → `"putty"`, `r4`
→ `"goo"`), `client/scripts/BRESOURCE.as:47-60` (`GetResourceNameKey`, 0-indexed the same way —
every call site passes `3` for the monster attack cost, which Backyard Monsters pays in Goo, i.e.
`r4`), and `client/scripts/BASE.as:4741-4774` (`CalcResources`: harvester `_type` 1 drives
`r1Rate`, `_type` 2 drives `r2Rate`, `_type` 3 drives `r3Rate`, `_type` 4 drives `r4Rate`). Note
that harvesters do *not* cost the resource they themselves produce: Twig Snapper's build/upgrade
price is denominated in `r2` and Pebble Shiner's in `r1` (see the cost ladder above), which is a
separate fact from which resource each one fills.

**Shiny** is the premium currency, held on `save.credits` (DB-constrained to ≥ 0,
`docs/server-api.md` §3) and mirrored client-side as `BASE._credits`. New accounts start with 1,000
(`server/src/game-data/getDefaultBaseData.ts:30`). Shiny is only ever changed server-side, through
`purchase: [itemKey, quantity]` on `/base/save`
(`client/scripts/BASE.as:3292-3295`, `server/src/controllers/base/save/handlers/purchaseHandler.ts`).

### Production

Each harvester runs a cycle: after `productionTimeout` seconds it adds `productionValue` to its own
buffer (`_stored`), up to `productionCapacity`.

```
productionTimeout = cycleTime[lvl-1] + ceil(cycleTime[lvl-1] * (4 - 4 / maxHealth * health))
```
(`client/scripts/BRESOURCE.as:384-386`)

At full health that reduces to `cycleTime[lvl-1]`, which is **10 seconds at every level**
(`client/scripts/YARD_PROPS.as:152`). At half health the multiplier is 3x, i.e. a 30-second cycle.

```
productionValue = produce[lvl-1]
                  (x altitude adjustment, outposts only)
                  (x harvesterOverdrivePower, while the POD buff is active)
                  (x 1.5, Inferno main yard with the terrain bonus flag)
```
(`client/scripts/BRESOURCE.as:424-439`, `:388-396`, `:40-44`)

Hourly rate as shown in the resource bar is `produce / cycleTime * 3600`
(`client/scripts/BASE.as:4747`), so **level 1 = 720/hour and level 10 = 20,160/hour** per harvester.

A harvester **stops producing entirely below 50% health** (`_canFunction = health >= maxHealth*0.5`,
`client/scripts/BRESOURCE.as:302`) and is halted while any build, upgrade or fortify countdown is
running (`client/scripts/BRESOURCE.as:301`).

The buffer cap is `capacity[lvl-1]` (`client/scripts/BRESOURCE.as:497`), so a level 1 harvester
fills its 720-unit buffer in one hour and then idles until collected.

### Collection is manual

There is **no auto-collect for main-yard harvesters**. When a harvester is full it shows an alert
icon (`client/scripts/BRESOURCE.as:363-381`), and the player must click the building and press one
of two buttons (`client/scripts/BUILDINGINFO.as:129-141`):

- `btn_bank` — banks that one harvester (`client/scripts/BUILDINGINFO.as:454-457`).
- `btn_bankall` — loops every `BRESOURCE` that is at full health with no countdown running and banks
  each (`client/scripts/BUILDINGINFO.as:458-466`). Only available past tutorial stage 200.

`Bank()` moves `min(_stored, capacity[lvl-1])` into the pool via `BASE.Fund`, spawns the flying
resource packages, and awards empire points equal to the amount banked (halved after tutorial stage
200) (`client/scripts/BRESOURCE.as:441-467`).

**Outposts are different.** Outpost harvesters never buffer; they feed a continuous "gross income
per second" figure that is credited to the main yard automatically. `AutoBankManager.autobank()`
runs every 10 seconds from the yard tick (`client/scripts/BASE.as:2539-2543`) and funds
`GIP * overdrive * seconds / 10` into the pool, awarding `ceil(total * 0.375)` empire points
(`client/scripts/com/monsters/autobanking/AutoBankManager.as:299-330`). On load, the whole offline
gap is credited in one call, clamped to **2 days** (`AutoBankManager.as:79-82`,
`client/scripts/BASE.as:1845-1847`). Outpost income is stored in the `buildingresources` save key.

Outpost production is scaled by terrain altitude:
`max(produce * 125 / cellHeight, 1)` where 125 is the reference altitude
(`client/scripts/BRESOURCE.as:40-44`, `client/scripts/GLOBAL.as:805`). Lower ground produces more.

### Storage caps

`BASE.CalcResources()` recomputes all four caps from scratch on every change
(`client/scripts/BASE.as:4705-4828`):

```
cap = 10000                                    // base, BASE.as:4720-4723
    + sum over silos of capacity[siloLevel-1]  // BASE.as:4776-4785
cap = floor(cap * upgradePacking)              // BASE.as:4805-4806
cap = cap + outpostCount * 2,000,000           // Map Room 2 only, BASE.as:4818
```

`upgradePacking` is `1 + 0.1 * BIP.q`, clamped to two decimals
(`client/scripts/STORE.as:2520-2524`). `BIP` ("Improved packing skills") has 10 purchase steps
(`server/src/game-data/store/storeItems.ts:31-38`), so the maximum multiplier is **2.0**.

`GLOBAL._outpostCapacity` is 2,000,000 per owned outpost (`client/scripts/GLOBAL.as:806`).

A maxed main yard (base 10,000 + six level 10 silos at 3,840,000) reaches 23,050,000 per resource
before packing, 46,100,000 with full packing, plus 2 million per outpost.

**Outposts do not recompute caps.** `CalcResources` returns early for outposts outside build mode,
and the server strips `rNmax` from any save that came from an outpost session
(`client/scripts/BASE.as:4714-4718`,
`server/src/controllers/base/save/handlers/resourceHandler.ts:45-48`).

### What happens when full

`BASE.Fund(resource, amount)` clamps to the cap and returns the amount actually added
(`client/scripts/BASE.as:4494-4536`). The overflow is silently lost. When the pool is already at the
cap and nothing can be added, the client shows an "overcharge" flash on the resource bar
(`client/scripts/BASE.as:4542-4544`).

A harvester that is full simply stops producing (`_producing = 0`,
`client/scripts/BRESOURCE.as:372-382`), so nothing accumulates beyond the buffer.

The build UI distinguishes the two failure modes: if a cost exceeds the player's **cap** the message
is "you need more silos" rather than "you need more resources"
(`client/scripts/BUILDINGOPTIONSPOPUP.as:472-478`, `:513-520`).

### Loss on being attacked

Two paths take resources out of the pool during an attack.

**Harvester buffers** are looted directly. `BRESOURCE.Loot(n)` removes up to `n` from `_stored` and
hands it to the attacker; once emptied the harvester is marked looted and stops functioning
(`client/scripts/BRESOURCE.as:93-121`). Destroying a harvester loots the full buffer
(`client/scripts/BRESOURCE.as:123-128`).

**Storage buildings** (Town Hall 14, Silo 6, Outpost core 112) drop a percentage of the whole pool
when destroyed (`client/scripts/BSTORAGE.as:94-150`):

| Building | Percentage of pool | Per-resource cap | Cap when hitting an outpost |
| --- | --- | --- | --- |
| Town Hall (14) | 10% | 10,000,000 | 2,000,000 |
| Storage Silo (6) | 4% | 4,000,000 | 500,000 |
| Outpost core (112) | 5% | 10,000,000 | — |
| any other storage | 4% | none | — |

Goo (`r4`) is additionally halved outside Map Room 3 (`_LOOT_GOO_LIMITER = 0.5`,
`client/scripts/BSTORAGE.as:24`, `:124-126`). A storage building that is merely *damaged* rather
than destroyed leaks a random one of the four resources per hit, at 90% efficiency for the attacker
(50% when the target is an outpost, and one fifth of that in a wild-monster attack)
(`client/scripts/BSTORAGE.as:30-92`).

Server side, the defender's reported loss is applied by `defenderLootHandler`, which **only ever
subtracts**, caps each resource at 10,000,000 per save, and clamps to zero
(`server/src/controllers/base/save/handlers/defenderLootHandler.ts:29-46`).

---

## 5. Workers and build queue

### Worker count

| Rule | Value | Source |
| --- | --- | --- |
| Base workers, main yard | 1 | `client/scripts/QUEUE.as:42-43` |
| Where workers are created | one `QUEUE.Spawn(0)` per base load | `client/scripts/BASE.as:1498` |
| Extra workers | `+ STORE._storeData.BEW.q` | `client/scripts/QUEUE.as:44-52` |
| Extra-worker price ladder (shiny) | 250, 500, 1,000, 2,000 | `server/src/game-data/store/storeItems.ts:15-22` |
| Maximum workers | 5 (1 base + 4 purchases) | `server/src/game-data/store/storeItems.ts:19`, `client/scripts/QUEUE.as:103-104`, `client/scripts/STORE.as:1175`, `client/scripts/UI_WORKERS.as:43` |
| Total shiny for all four | 3,750 | `server/src/game-data/store/storeItems.ts:19` |
| Workers in an outpost | always 1, regardless of `BEW` | `client/scripts/QUEUE.as:32-39`, `:45-49`, `client/scripts/UI_WORKERS.as:44-46` |
| Workers in attack/view modes | none spawned | `client/scripts/QUEUE.as:57` |

Buying `BEW` calls `QUEUE.Spawn(1)` immediately, so the new worker appears without a reload
(`client/scripts/STORE.as:1990-1992`). The purchase is persisted as `storedata.BEW.q` by the server
purchase handler, so worker count is **derived from store data, not stored as its own field**.

### There is no queue

Despite the class name, `QUEUE` is **not** a queue. It is a fixed-size array of worker slots
(`_stack`), one entry per worker (`client/scripts/QUEUE.as:55-72`). A job either gets a free slot
immediately or is refused.

`QUEUE.CanDo()` walks `_stack` and returns `{error: false}` on the first inactive slot; otherwise it
returns an error with a "workers busy" message (`client/scripts/QUEUE.as:77-116`).

`QUEUE.Add(id, building)` assigns the nearest idle worker via `WORKERS.Assign`, marks the slot
active and records a timestamp (`client/scripts/QUEUE.as:152-187`). `WORKERS.Assign` picks the free
worker closest to the building, within 3000 units (`client/scripts/WORKERS.as:65-102`).

`QUEUE.Remove(id, wasCompleted, building)` frees the slot and sends the worker wandering
(`client/scripts/QUEUE.as:189-208`, `client/scripts/WORKERS.as:104-135`).

Three details a reimplementation should not copy:

- **`_items[id]` is written before the `CanDo()` check**, so the bookkeeping map grows even when the
  job is refused (`client/scripts/QUEUE.as:156-165`).
- **`Add` returns true even when `WORKERS.Assign` returns null.** `Assign` only considers workers
  within 3000 units (`client/scripts/WORKERS.as:70-79`); if none qualifies it returns null, `Add`
  skips the slot-writing loop but still falls through to `return true`
  (`client/scripts/QUEUE.as:165-185`). The caller treats the job as started, but no slot is marked
  active and `_hasWorker` never becomes true, so the countdown never ticks.
- **`QUEUE.Move(from, to)` is an empty stub** (`client/scripts/QUEUE.as:280-281`). Manual worker
  reassignment was never implemented; clicking a worker icon only pans the camera
  (`client/scripts/QUEUE.as:275-278`, `client/scripts/UI_WORKERS.as:107-109`).

Jobs that consume a worker slot:

| Job | Enqueued at |
| --- | --- |
| New building under construction | `client/scripts/BFOUNDATION.as:1701-1703` |
| Upgrade | `client/scripts/BFOUNDATION.as:2321` |
| Fortify | `client/scripts/BFOUNDATION.as:2203` (via `FortifyB`) |
| Picking a mushroom | `client/scripts/MUSHROOMS.as:199` |
| Restoring an in-progress job on load | `client/scripts/BFOUNDATION.as:3154-3182` |

Repairs do **not** take a worker: `Repair()` just sets `_repairing = 1`
(`client/scripts/BFOUNDATION.as:2017-2022`), and every damaged building repairs in parallel.

Buildings with a zero build time skip the worker requirement entirely
(`client/scripts/BASE.as:4136-4139`), which is how walls (5 s) and traps still need one but
zero-time items do not.

### Worker travel

A worker must physically walk to the site. Until it arrives, `_hasWorker` is false and the countdown
does not tick (`client/scripts/BFOUNDATION.as:1376-1393`). The worker's own movement tick calls
`HasWorker()` on arrival (`client/scripts/WORKER.as:263-265`), which sets `_hasWorker = true` and
spawns one resource-delivery package per non-zero cost component
(`client/scripts/BFOUNDATION.as:2034-2054`). `_hasResources` flips true when the first package lands
(`client/scripts/ResourcePackage.as:104-106`), or immediately when the job is re-registered on load
(`client/scripts/BFOUNDATION.as:3160`, `:3166`, `:3172`).

During catch-up replay both flags are forced true so the walk does not cost simulated time
(`client/scripts/BFOUNDATION.as:2317-2320`, `client/scripts/WORKERS.as:89-95`).

### Reload behaviour, and a destructive edge case

On load, `BFOUNDATION.Setup()` re-registers each in-progress job
(`client/scripts/BFOUNDATION.as:3154-3182`). If `QUEUE.Add` fails because there are not enough
worker slots:

- a building still under construction is **deleted** (`RecycleC()`, `BFOUNDATION.as:3165`);
- an upgrade is **cancelled and refunded** (`UpgradeCancelB()`, `BFOUNDATION.as:3170`);
- a fortification is cancelled and refunded (`FortifyCancelB()`, `BFOUNDATION.as:3176`).

This is reachable whenever the number of saved in-progress jobs exceeds the current worker count,
for example after an outpost session (1 worker) loads a save written with 5 workers.

### Speed-ups

Four store items act on `GLOBAL._selectedBuilding` (`client/scripts/STORE.as:2043-2100`):

| Item | Effect | Shiny cost | Refused when |
| --- | --- | --- | --- |
| `SP1` "Close enough" | subtract 5 minutes, i.e. finish | 0 | remaining > 5 min (`STORE.as:1071-1073`) |
| `SP2` | subtract 1 hour (3600 s) | 20 | remaining < 1 h (`STORE.as:1074-1076`) |
| `SP3` | subtract 2 hours (7200 s) | 40 | remaining < 2 h (`STORE.as:1077-1079`) |
| `SP4` "Finish now" | set the countdown to 0 | computed, see below | remaining ≤ 5 min (`STORE.as:1080-1082`) |

Costs from `server/src/game-data/store/storeItems.ts:47-78`. The effect durations are hardcoded at
`client/scripts/STORE.as:2046-2055`. Note the UI label keys say "30 minutes" / "60 minutes" for
SP2/SP3 (`client/scripts/STORE.as:1354-1359`) while both the code and the server item text say 1 h
and 2 h — the labels are stale.

SP4's price is written into `_storeItems.SP4.c` on every store refresh from the selected building's
remaining time (`client/scripts/STORE.as:352-381`). The formula is:

```
GetTimeCost(t):
  if t <= 300: return 0
  return min( ceil(t * 20 / 60 / 60), int(sqrt(t * 0.8)) )
```
(`client/scripts/STORE.as:162-171`; duplicated verbatim in `BFOUNDATION.FinishNowCost()`,
`client/scripts/BFOUNDATION.as:2063-2083`)

So a job under 5 minutes is free, and the price is the **lower** of a linear term (20 shiny per
hour) and a square-root term. The two cross at 10,368 seconds (2.88 hours); below that the linear
term wins, above it the square-root term caps growth. A 24-hour job costs
`min(480, 277) = 277` shiny.

`QUEUE.GetFinishCost()` applies the same function to the shortest-remaining job
(`client/scripts/QUEUE.as:142-150`).

Two other timers modify build time globally:

- `BST` "Sharper tools" (225 shiny, 7 days) sets `GLOBAL._buildTime = 0.8`, a flat 20% cut applied
  to upgrade and fortify durations (`client/scripts/STORE.as:2513-2519`,
  `client/scripts/BFOUNDATION.as:2295`). New builds get the same 20% applied separately
  (`client/scripts/BFOUNDATION.as:1670-1673`).
- Friend "help" shaves 5% off the remaining countdown per helper, up to 5 helpers per job
  (`client/scripts/BFOUNDATION.as:2337-2399`). This path is dead on this server: `UPDATES.CreateB`
  returns early in build mode when `GLOBAL._friendCount == 0`
  (`client/scripts/UPDATES.as:483-485`), and the `invites` and `gifts` flags are 0
  (`server/src/game-data/flags.ts:57-58`).

### Cancel and refund

| Action | Button | Refund | Source |
| --- | --- | --- | --- |
| Cancel a build in progress | `btn_stopbuild` → `Recycle()` | Full level 1 cost (the `lvl == 0` branch of `RecycleCost`) | `client/scripts/BUILDINGINFO.as:506-508`, `BFOUNDATION.as:2511-2519`, `:2639-2645` |
| Cancel an upgrade | `btn_stopupgrade` → `UpgradeCancel()` | Full cost of the level being upgraded to | `client/scripts/BUILDINGINFO.as:509-511`, `BFOUNDATION.as:2401-2432` |
| Cancel a fortification | `btn_stopfortify` | Full fortify cost | `client/scripts/BFOUNDATION.as:2218-2247` |
| Recycle a finished building | confirm dialog → `RecycleB()` | **50%** of the sum of all level costs paid so far | `client/scripts/BFOUNDATION.as:2625-2666` |
| Recycle a decoration | confirm dialog | No resources; the item returns to inventory | `client/scripts/BFOUNDATION.as:2526-2530`, `:2609-2611` |
| Recycle a reward building (`rewarded` flag) | — | Nothing | `client/scripts/BFOUNDATION.as:2636-2638` |

Cancelling a build and cancelling an upgrade each show a confirmation dialog first
(`client/scripts/BFOUNDATION.as:2517`, `:2402`).

Why cancelling a build refunds 100%: an unfinished building is level **0**, both when freshly placed
(`client/scripts/BFOUNDATION.as:368`) and after a reload
(`if (this._countdownBuild.Get() > 0 && !this._prefab) { this._lvl.Set(0); }`,
`client/scripts/BFOUNDATION.as:3121-3123`), and `RecycleCost` takes the full `costs[0]` on the
`lvl == 0` branch rather than the 50% branch (`client/scripts/BFOUNDATION.as:2639-2664`).

**Shiny is never refunded.** There is no refund branch for `IB`, `IU`, `IF` or any `SP` purchase
anywhere in `BFOUNDATION.as` or `STORE.as`. Elapsed build time is also never compensated — cancelling
returns the resources and discards the progress.

**Outposts cannot recycle or cancel builds at all** — both paths show a refusal message
(`client/scripts/BFOUNDATION.as:2513-2515`, `:2538-2540`), and every building placed in an outpost
is flagged `_blockRecycle` once constructed (`client/scripts/BFOUNDATION.as:2893-2895`).

---

## 6. Upgrades

### Flow

1. Click the building. `BFOUNDATION.Click` selects it and opens the info panel
   (`client/scripts/BFOUNDATION.as:2833-2848`, `client/scripts/BASE.as:4346`).
2. The info panel shows `btn_upgrade` when the building is idle, undamaged, not a decoration, not a
   Map Room, and not a Map Room 3 outpost (`client/scripts/BUILDINGINFO.as:246-250`).
3. Clicking it opens `BUILDINGOPTIONS.Show(building, "upgrade")`, the upgrade confirmation popup
   (`client/scripts/BUILDINGINFO.as:560-569`).
4. The popup has two buttons: pay resources (`ActionResourceUpgrade`) or pay shiny
   (`ActionInstantUpgrade`) (`client/scripts/BUILDINGOPTIONSPOPUP.as:176`, `:54`).
5. `ActionResourceUpgrade` re-runs `CanUpgrade`. On a shortfall it offers a "get resources" shiny
   top-up instead (`client/scripts/BUILDINGOPTIONSPOPUP.as:491-541`).
6. `BFOUNDATION.Upgrade()` checks `QUEUE.CanDo()` first, then `BASE.CanUpgrade`, then calls
   `UpgradeB()` and saves (`client/scripts/BFOUNDATION.as:2249-2269`).

### Preconditions

`BASE.CanUpgrade(building)` refuses when (`client/scripts/BASE.as:3828-3978`):

| Condition | Message key | Line |
| --- | --- | --- |
| No town hall in the yard | `base_uperr_th` | `:3863-3866` |
| `level >= costs.length` (already max) | `base_uperr_fully` | `:3867-3870` |
| Build countdown running | `base_uperr_stillbuilding` | `:3871-3874` |
| Upgrade countdown already running | `base_uperr_alreadyupgrading` | `:3875-3878` |
| Fortify countdown running | `base_uperr_stillfortifying` | `:3879-3882` |
| `costs[level].re` prerequisites unmet | `base_uperr_buildings` with a list | `:3884-3932` |
| Any resource short | `base_uperr_resources` | `:3939-3967` |

Additionally, a damaged building shows Repair instead of Upgrade
(`client/scripts/BUILDINGINFO.as:98-107`), and the countdown itself refuses to tick unless
`health == maxHealth` (`client/scripts/BFOUNDATION.as:1375`).

A free worker is required, checked before `CanUpgrade`
(`client/scripts/BFOUNDATION.as:2251`, `:2265-2267`).

### Cost and duration

Cost is `costs[currentLevel]` verbatim — the array is indexed by the level you are leaving, so
`costs[0]` is the initial build and `costs[1]` is the level 1→2 upgrade
(`client/scripts/BFOUNDATION.as:2668-2700`).

Duration is `int(costs[currentLevel].time * GLOBAL._buildTime)`
(`client/scripts/BFOUNDATION.as:2295`), where `_buildTime` is 1 or 0.8 with the Sharper Tools buff.

On confirmation `UpgradeB()` charges all four resources, sets `_countdownUpgrade`, clears
`_hasResources`/`_hasWorker`, enqueues the job and fires a `BuildingEvent.UPGRADED` event
(`client/scripts/BFOUNDATION.as:2283-2329`).

### Instant upgrade ("finish now" before starting)

`InstantUpgradeCost()` prices skipping the whole upgrade
(`client/scripts/BFOUNDATION.as:2114-2128`):

```
c   = costs[lvl]
t   = c.time <= 300 ? 0 : c.time
res = c.r1 + c.r2 + c.r3                  // note: r4 is NOT counted
a   = ceil( pow( sqrt(res / 2), 0.75 ) )  // resource component
b   = GetTimeCost(t)                      // time component, see §5
cost = int( (a + b) * 0.95 )              // 5% bundle discount
```

`InstantBuildCost()` is the same function over `costs[0]`
(`client/scripts/BFOUNDATION.as:2085-2096`) and `InstantFortifyCost()` over `fortify_costs`
(`:2098-2112`). The r4 omission is in all three.

`DoInstantUpgrade()` checks the shiny balance, calls `Upgraded()` directly (skipping the countdown
entirely) and records the purchase as `IU` (`client/scripts/BFOUNDATION.as:2130-2140`).

The pure-resource shortfall helper uses `ceil(pow(sqrt(shortfall / 2), 0.75))` — the same curve
without the time term (`client/scripts/BUILDINGOPTIONSPOPUP.as:474`, `:517`;
`client/scripts/STORE.as:183-185`).

### Completion

`Upgraded()` (`client/scripts/BFOUNDATION.as:2434-2461`):

1. zeroes the countdown, increments `_lvl` and `_hpLvl`;
2. sets `maxHealth = hp[newLevel-1]` and **heals the building to full**;
3. recalculates resource rates and caps;
4. awards empire points equal to
   `floor((time + r1 + r2 + r3 + r4) / 3)` of the level just completed;
5. releases the worker.

Compare new-build completion, `Constructed()`, which awards
`floor(time / 2 + (r1+r2+r3+r4) / 10)`, plus a flat 100 for a town hall
(`client/scripts/BFOUNDATION.as:2892-2921`).

### What changes per level

| Building family | Per-level effect | Source |
| --- | --- | --- |
| Harvesters 1–4 | `produce` up, buffer `capacity` up, `hp` up, `repairTime` up | `client/scripts/BRESOURCE.as:247-272` |
| Storage Silo 6 | `capacity` added to all four caps | `client/scripts/BASE.as:4776-4785` |
| Monster Housing 15 / Bunker 22 | housing space | `client/scripts/GLOBAL.as:682-683` |
| Town Hall 14 | `quantity` allowances for every other building, plus hp | `client/scripts/BASE.as:3692-3728` |
| Flinger 5 | world-map attack range and monster carry capacity | `client/scripts/GLOBAL.as:713`, `docs/specs/maproom2.md` §4 |
| Walls 17/18 | `hp`, and the soft grid cost `100 + lvl * 25` | `client/scripts/BWALL.as:16-31`, `BFOUNDATION.as:3150-3152` |
| Towers | `stats[lvl]`: range, damage, rate, speed, splash | `client/scripts/YARD_PROPS.as:2498-2520` and siblings |
| Everything | `hp[lvl-1]` and `repairTime[lvl-1]` | `client/scripts/BFOUNDATION.as:2443`, `:1369` |

### Fortification

A parallel ladder to upgrading, driven by `can_fortify` and `fortify_costs`
(`client/scripts/BFOUNDATION.as:2153-2247`, `:2702-2740`). It has its own countdown (`cF`), its own
worker slot, its own instant-buy price and its own cancel-with-full-refund. `btn_fortify` only
appears past tutorial stage 200 and never in a Map Room 3 outpost
(`client/scripts/BUILDINGINFO.as:250-252`). No building in the Map Room 2 main-yard table sets
`can_fortify`, so in practice this is Map Room 3 / Inferno content.

---

## 7. Town hall and progression

### Town hall

The Town Hall is building type 14. Exactly one is allowed at every level
(`quantity = [1,1,1,1,1,1,1,1,1,1,1]`, `client/scripts/YARD_PROPS.as:1299`), and
`BASE.RebuildTH()` recreates it if it is ever missing (`client/scripts/BASE.as:5127`).

Its level is the master gate. Two mechanisms depend on it:

1. **`quantity[townHallLevel]`** caps how many of each building type may exist
   (`client/scripts/BASE.as:3695-3728`).
2. **`re` prerequisites** of the form `[14, 1, N]` require the hall to be at level N
   (`client/scripts/BASE.as:3770-3781`, `:3885-3901`).

The server reads the hall level out of `buildingdata` by scanning for `t === 14`
(`server/src/utils/extractTownHall.ts:24-31`) and uses it for exactly one decision:

```ts
flags.maproom2 = userSave.mr2upgraded || (townHall && townHall.l >= 6) ? 1 : 0;
```
(`server/src/controllers/base/load/baseLoad.ts:157`)

So **Town Hall 6 unlocks Map Room 2**, and once `mr2upgraded` is set the unlock is permanent
regardless of later hall changes.

### What each hall level unlocks

Derived from the first non-zero index of each building's `quantity` array plus the `re` entries.

| Hall level | New building types available | Notable allowance increases |
| --- | --- | --- |
| 1 | Twig Snapper, Pebble Shiner, Putty Squisher, Goo Factory, Flinger, Storage Silo, Monster Juicer, Map Room, General Store, Hatchery, Monster Housing, Radio, Cannon Tower (2), Sniper Tower (2) | — |
| 2 | Monster Locker, Wooden Block (30), Stone Block (10), Booby Trap (8) | harvesters 1→2, silos 1→2, towers 2→3 |
| 3 | Yard Planner, Monster Bunker, Monster Academy, Catapult, Hatchery Control Centre | harvesters 2→4, silos 2→3, walls 30→60, towers 3→4, housing 1→2 |
| 4 | Wild Monster Baiter, Laser Tower, Tesla Tower, Flak Tower, Heavy Trap, Champion Cage, Champion Chamber | harvesters 4→5, silos 3→4, towers 4→5 |
| 5 | Monster Lab, Railgun Tower | harvesters 5→6, silos 4→5, towers 5→6, housing 2→3 |
| 6 | **Map Room 2 access** | silos 5 (stays), bunkers 1→2 |
| 7 | — | walls 200→220, traps 28→35 |
| 8 | — | bunkers 2→3, walls 220→280, housing 3→4 |
| 9 | — | bunkers 3→4, silos 5→6 |
| 10 | — | walls 340→400, traps 60→75 |

Sources: the `quantity` arrays at `client/scripts/YARD_PROPS.as` for each id, and
`client/scripts/GLOBAL.as:638` for the Monster Juicer override.

### Base level and empire points

The player's level comes from **empire points**, not the town hall.

```
points = _basePoints + _baseValue
```
(`client/scripts/BASE.as:4877`, mirrored at
`server/src/services/base/calculateEmpirePoints.ts:8-10`)

`_baseValue` is recomputed from the yard on every save:
`ceil(0.1 * sum over non-decoration, non-enemy, non-trap, finished buildings of
(time + r1 + r2 + r3 + r4) of their current level)`
(`client/scripts/BASE.as:4830-4861`). It is a **high-water mark** for the main yard: it only ever
rises (`client/scripts/BASE.as:4857-4859`).

`_basePoints` accumulates from actions: banking resources, completing builds and upgrades, buying
resources with shiny, and outpost auto-banking (`client/scripts/BASE.as:4863-4865`, called from
`BFOUNDATION.as:2457`, `:2916`, `BRESOURCE.as:457-462`, `STORE.as:2029-2035`,
`AutoBankManager.as:329`).

The level thresholds are a 56-entry table, identical on both sides
(`client/scripts/BASE.as:289`, `server/src/game-data/stats/experiencePoints.ts:7`):

| Level | Points | Level | Points |
| --- | --- | --- | --- |
| 1 | 0 | 10 | 40,337 |
| 2 | 900 | 20 | 8,785,167 |
| 3 | 3,500 | 30 | 254,115,040 |
| 4 | 5,000 | 40 | 5,250,282,723 |
| 5 | 7,500 | 50 | 55,345,069,884 |
| 6 | 10,500 | 56 | 212,613,620,467 |

Levelling up shows a popup and forces a save (`client/scripts/BASE.as:4895-4927`). The level is sent
to chat as a display-name update (`client/scripts/BASE.as:4924-4926`).

There is a server-side cap on empire value for map purposes:
`empire_value_limit: 831186222` (`server/src/game-data/flags.ts:48`).

### Tutorial stages

`TUTORIAL._stage` gates a second axis, independent of the town hall. Stage 200 is "tutorial
finished"; below it, buildings whose `tutstage` exceeds the current stage are locked
(`client/scripts/BASE.as:3679-3682`). Most buildings carry `tutstage: 200`, meaning "after the
tutorial". The ones with lower values are the guided-build sequence: harvesters 1 and 2 at 0,
Sniper Tower at 28, Housing at 50, Flinger at 60, Putty/Goo/Map Room at 80, Hatchery at 140, Silo
and most others at 200.

---

## 8. Yard Planner

### Which implementation is live

There are two, selected by the server flag `yp_version` (`client/scripts/PLANNER.as:34-45`):

| `yp_version` | Behaviour |
| --- | --- |
| 0 | Planner disabled, shows an error message (`PLANNER.as:36-38`) |
| 1 | Old planner: `PLANNERPOPUP` (`PLANNER.as:51-56`) |
| 2 | New planner: `com.monsters.baseplanner.BasePlanner` (`PLANNER.as:57-63`) |

**The server sets `yp_version: 2` (`server/src/game-data/flags.ts:78`), so the live planner is
`com/monsters/baseplanner/`.** `PLANNERPOPUP.as`, `plannerBuilding.as`, `plannerBuildingSquare.as`
and `plannerRange.as` are the old version and are dead on this server (the class default
`_useOldPlanner = true` at `PLANNER.as:16` is overwritten before use).

Entry points: clicking the Yard Planner building (type 10) and pressing `btn_yardplanner`
(`client/scripts/BUILDINGINFO.as:164-166`, `:500-502`), or a front-page news item
(`client/scripts/com/monsters/frontPage/messages/news/News05YardPlanner2.as:30`). The building costs
250,000 r1 + 250,000 r2 and 12 hours, and needs Town Hall 3
(`client/scripts/YARD_PROPS.as:1063`).

### What the planner does today

It is a **scaled-down 2D plan view of the yard** in a popup, with a sidebar listing every building
by category. Opening it snapshots the live yard into a `PlannerTemplate`
(`client/scripts/com/monsters/baseplanner/BasePlanner.as:45-47`, `client/scripts/BASE.as:5082-5095`).

| Operation | Handler | Notes |
| --- | --- | --- |
| Move a building (drag) | `onBuildingClick` → `dragBuilding` → `stopDragBuilding` with `TOOL_SELECTMOVE` (`PlannerDesignView.as:377-395`, `:430-508`) | Default tool; snaps on a 5-unit threshold (`MOUSE_POSITION_SNAP_THRESHHOLD`, `PlannerDesignView.as:52`) |
| Put a building into the sidebar inventory | `TOOL_STORE` → `storeBuilding` (`PlannerDesignView.as:50`, `:391-392`, `:407-411`) | Removes it from the plan; it must be replaced before Apply |
| Place a building from inventory | `onExplorerItemClick` → `addInventoryItem` / `addMode` (`popups/BasePlannerPopup.as:645-650`, `PlannerDesignView.as:309-357`) | Includes decorations held in real storage |
| Cancel a placement or drag | `cancelAddInventory`, `cancelDragBuilding`, `removeSelection` (`PlannerDesignView.as:344-352`, `:510-525`, `:371-375`) | — |
| Overlap and bounds validation | `validateBuilding` (`PlannerDesignView.as:558-582`) | Bitmap hit-test against every other item, plus the `YARD_EXPANSIONS` bound (`:106`) or `MAX_YARD_DIMENSIONS` for decorations (`:104`) |
| Pan the canvas | `canvasDragStart` / `canvasDrag` / `canvasDragStop` (`PlannerDesignView.as:247`, `:257`, `:264`) | — |
| Zoom | `setZoom` (`PlannerDesignView.as:212`), buttons at `popups/BasePlannerPopup.as:519-535`, wheel at `:510-517` | Range 0.25 to 2.0 in steps of 0.25 (`PlannerDesignView.as:76-80`). The slider handler `onZoomScroll` is an empty stub (`:537-538`) |
| Toggle range overlays | checkboxes (`popups/BasePlannerPopup.as:307-320`, `:498-504`) → `toggleView` → `drawRanges` (`PlannerDesignView.as:642-712`) | Separate ground, air and trap overlays |
| Toggle level and fortification labels | `toggleMoreInfo` (`PlannerDesignView.as:659-668`, `components/BuildingItem.as:137-161`) | Display only |
| Expand the yard | `onStoreOpen` opens the `ENL` store item (`popups/BasePlannerPopup.as:346-352`, `:484-491`) | Hidden outside the main yard, disabled once `ENL.q == 6` (`:341-356`) |
| Fullscreen | `popups/BasePlannerPopup.as:373-377` | — |
| Save the layout to a slot | `clickedSave` → `BasePlannerService.saveTemplate` (`BasePlanner.as:82-95`, `BasePlannerService.as:16-20`) | Server round-trip |
| Rename a slot | inline field, 15 characters (`popups/transfer/BasePlannerTransferRow.as:26-33`) | — |
| Load a layout from a slot | `clickedLoad` → `loadTemplateAtSlot` (`BasePlanner.as:97-110`, `:57-59`) | Purely client-side once the list is fetched |
| Apply the layout to the real yard | `clickedApply` → `BASE.applyTemplate` (`BasePlanner.as:112-126`, `BASE.as:5025-5041`) | The only action that touches the live yard |
| Clear the layout | `onClearClick` with a confirmation popup (`popups/BasePlannerPopup.as:574-592`) → `clear()` (`:615-633`) | Moves everything except misc nodes into the inventory |

**Not present anywhere in `com/monsters/baseplanner/`:** rotate, upgrade, sell or delete-by-choice,
undo/redo, copy/paste, multi-select, instant-finish. `BaseTemplateNode` carries only `x`, `y`, `id`
and `type` (`BaseTemplateNode.as:6-12`), so rotation could not be persisted even if it were added to
the UI.

**It is client-only rearrangement.** Nothing moves in the real yard while the player drags; the plan
is a parallel data structure of `PlannerNode` objects. Contrast the old planner, which wrote
`_building._mc.x/y` on every drag frame (`client/scripts/plannerBuilding.as:135-145`).

There are exactly three server interactions: `gettemplates` on open
(`BasePlanner.as:43`, `BasePlannerService.as:30-33`), `savetemplate` on Save-to-slot
(`BasePlannerService.as:16-20`), and the ordinary `/base/save` after Apply. All three go through
`URLLoaderApi` as form-urlencoded POSTs with a bearer token
(`client/scripts/URLLoaderApi.as:95-132`); `gettemplates` sends no variables, so Flash degrades it to
a GET, which is why the route is registered with `router.get`.

Save-to-slot persists the template and moves nothing. Apply moves buildings and writes no slot. The
two are independent.

`Apply` is what writes back:

```as3
BASE.applyTemplate(template):
  for each node: building = getBuildingByID(node.id); building.moveTo(ToISO(node.x, node.y))
  Save()
```
(`client/scripts/BASE.as:5025-5041`)

`moveTo` clears the building's grid occupancy, sets `_mc.x/_mc.y`, then calls `StartMove()` followed
by `StopMove(null)` (`client/scripts/BFOUNDATION.as:3601-3613`). The planner then closes and a
normal `/base/save` carries the new `buildingdata` to the server
(`client/scripts/com/monsters/baseplanner/BasePlanner.as:123-125`).

Two consequences of that `StartMove`/`StopMove` pair are worth knowing before reimplementing Apply.

- `StopMove` only runs `StopMoveB()` on its **second** invocation, because it toggles a
  `_mouseClicked` latch that starts false (`client/scripts/BFOUNDATION.as:334`, `:2783-2793`). A
  building moved once by Apply therefore never reaches `StopMoveB`, so its grid occupancy is never
  re-blocked (`GridCost(true)` lives only in `PlaceB` and `StopMoveB`,
  `client/scripts/BFOUNDATION.as:1920`, `:2815`) and `BASE._blockSave` is left set
  (`:2762`). Occupancy is rebuilt from scratch on the next yard load
  (`client/scripts/BASE.as:2023-2027`), and `PLANNER.Hide()` clears the flag for whichever building
  was selected last (`client/scripts/PLANNER.as:69-71`), so the state self-heals — but between
  Apply and the next reload the grid does not reflect the new layout.
- Because `StopMoveB` is skipped, Apply also skips its overlap re-check
  (`client/scripts/BFOUNDATION.as:2799-2807`). Validity is enforced earlier, inside the planner's
  own drag handling, not at Apply time.

Apply is blocked if any **non-decoration, non-misc** node is still sitting in the sidebar
inventory — every real building must be placed somewhere
(`client/scripts/com/monsters/baseplanner/popups/BasePlannerPopup.as:127-142`, `:557-563`).
Decorations left in inventory are recycled into real storage on Apply
(`BasePlanner.as:113-122`), and decorations taken *out* of storage are materialised into real
buildings by `BASE.getBuildingFromNode`, which instantiates them and decrements
`_buildingsStored["b" + type]` (`client/scripts/BASE.as:5043-5080`).

`Apply` triggers two saves, because `BASE.applyTemplate` ends with `Save()`
(`client/scripts/BASE.as:5040`) and `clickedApply` calls `BASE.Save()` again immediately after
(`BasePlanner.as:125`). Both are coalesced by the save counter, so the effect is one request, but a
reimplementation should not copy the double call.

Mushrooms (type 7) are excluded from the plan (`client/scripts/BASE.as:5097-5109`) and buildings
whose class is `enemy` are excluded from a saved template
(`client/scripts/BASE.as:5111-5113`, `PlannerTemplate.as:33-37`).

### Server side

Two endpoints, both under `/api/:apiVersion/bm/yardplanner/`
(`server/src/app.routes.ts:169-170`):

| Endpoint | Request | Response | Implementation |
| --- | --- | --- | --- |
| `GET gettemplates` | none | `{ error: 0, ...save.savetemplate }` | `server/src/controllers/yardplanner/getTemplates.ts:12-23` |
| `POST savetemplate` | `slotid`, `name`, `data` (JSON string) | `{ error: 0, ...save.savetemplate }` | `server/src/controllers/yardplanner/saveTemplate.ts:21-46` |

Storage is one `jsonb` array column, `save.savetemplate`
(`server/src/database/models/save.model.ts:393-395`). Each element is the raw request body
`{ slotid, name, data }`. `saveTemplate` finds the element with a matching `slotid` and overwrites
it, or appends a new one (`saveTemplate.ts:28-38`).

The layout `data` is a plain object keyed by array index, each value
`{ x, y, id, type }` (`client/scripts/com/monsters/baseplanner/BaseTemplateNode.as:22-29`,
`BaseTemplate.as:27-35`). `x`/`y` are **yard coordinates** (post-`FromISO`), `id` is the per-yard
building instance id, `type` is the building type.

Known gaps:

- **No validation at all.** `saveTemplate` is cast, not zod-parsed, and there is no bound on
  `slotid` or on the array length (`saveTemplate.ts:22`).
- **The response is a spread array.** `{...save.savetemplate}` turns the array into an object with
  numeric string keys, so the client receives `{"0": {...}, "1": {...}}` and iterates it with
  `for each` (`getTemplates.ts:20-23`, `BasePlannerService.as:41-52`).
- **`deletetemplate` does not exist.** `BasePlannerService.clearSlot()` posts to
  `bm/yardplanner/deletetemplate` (`BasePlannerService.as:64-67`) but no such route is registered
  (`server/src/app.routes.ts:169-170`). Nothing calls `clearSlot` today, so the dead call is not
  reachable, but the endpoint is missing if it ever is.
- `savetemplate` is not in `Save.saveKeys` (`server/src/database/models/save.model.ts:441-500`), so
  a normal `/base/save` can neither read nor clobber it. That is correct behaviour and worth
  keeping.

### Slots

| Rule | Value | Source |
| --- | --- | --- |
| Default slots | 2 | `client/scripts/com/monsters/baseplanner/BasePlanner.as:20-24` |
| With the subscription reward | 10 | `client/scripts/com/monsters/subscriptions/rewards/YardPlannerExtraSlotsReward.as:19`, `SubscriptionHandler.as:152` |
| Empty slots | filled with a placeholder named `Slot<N>` | `BasePlannerService.as:53-59` |
| Slots the transfer popup draws | `maxNumberOfSlots`, locked above `slots` | `popups/transfer/BasePlannerTransferPopup.as:33-36` |

The reward id is `yardPlannerExtraSlots` (`server/src/enums/Rewards.ts:18`), granted in the default
base data when `unlockAllEventRewards` is on
(`server/src/game-data/getDefaultBaseData.ts:64`).

### Limits

| Limit | Behaviour | Source |
| --- | --- | --- |
| Outposts | Save and Load are disabled; Apply still works | `BasePlanner.as:41`, `popups/BasePlannerPopup.as:268-269`, `:282-284` |
| Buildings under construction / upgrading | Included in the plan and **movable** | No countdown check exists anywhere in `com/monsters/baseplanner/`, and `BFOUNDATION.moveTo` has none either (`client/scripts/BFOUNDATION.as:3601-3613`). The old planner did lock them (`client/scripts/plannerBuilding.as:37-44`) |
| `enemy`-class buildings | Not clickable in the plan, not saved | `PlannerDesignView.as:383-385`, `BASE.as:5111-5113` |
| Mushrooms | Absent from the plan | `BASE.as:5104` |
| Attack and view modes | `PLANNER.Show()` itself has no mode check; the gate is the entry point, whose buttons are only built inside `if (GLOBAL.mode == GLOBAL.e_BASE_MODE.BUILD)` — note that is `build` exactly, not `ibuild` | `client/scripts/PLANNER.as:25-65`, `client/scripts/BUILDINGINFO.as:97`, `:164-166` |
| Yard Planner building itself damaged or busy | The `btn_yardplanner` button is not built at all, because the branch that adds it requires the idle/undamaged flag | `client/scripts/BUILDINGINFO.as:98-127`, `:143` |
| Slot ids outside the allowed range | Dropped silently when the template list is parsed | `BasePlannerService.as:40`, `:48-50` |
| Unsaved changes on close | Confirmation popup offering Save or Discard | `popups/BasePlannerPopup.as:701-713` |

Note the contrast with the **old** planner, which moved the real buildings live as you dragged
(`client/scripts/plannerBuilding.as:95`, `:109`, `:117-158` call `StartMove`/`StopMoveB` on the real
`BFOUNDATION`). The new planner deliberately does not.

### What "upgrade from inside the planner" would need

The planner already has most of what it needs in scope and is missing only the actions.

**Already present:**

- `PlannerNode` holds a live reference to the real `BFOUNDATION` (`PlannerNode.as:32`, `:56`), plus
  `level`, `fortification`, `range` and the full `props` object
  (`PlannerNode.as:61-64`, `:105`). It already renders "Name Level N" in the sidebar
  (`PlannerNode.as:75`), and a "more info" toggle adds the fortification tier
  (`components/BuildingItem.as:137-161`).
- Because `node.building` is the real object, `node.building.Upgrade()` would work unchanged for
  anything already standing in the yard.
- `BASE.CanUpgrade`, `UpgradeCost` and `InstantUpgradeCost` are static/instance helpers with no UI
  dependency (`client/scripts/BASE.as:3828`, `client/scripts/BFOUNDATION.as:2668`, `:2114`).

**Missing:**

1. **No upgrade affordance.** `PlannerDesignView` has exactly two tools, `TOOL_SELECTMOVE` and
   `TOOL_STORE` (`PlannerDesignView.as:48-50`). There is no third tool and no per-building context
   action. `onBuildingClick` branches only on those two (`PlannerDesignView.as:376-392`).
2. **No cost display.** `PlannerNode` never reads `costs`, so the plan view has no notion of what an
   upgrade would cost or how long it would take. It would need `props.costs[level]` and the
   resource pool.
3. **No worker check surfaced.** `Upgrade()` calls `QUEUE.CanDo()` and, on failure in build mode,
   opens `POPUPS.DisplayWorker` (`client/scripts/BFOUNDATION.as:2251`, `:2265-2267`). That popup is
   a yard-screen popup; it would need to render above the planner or be replaced.
4. **Apply-time coupling.** Moves are deferred to Apply but an upgrade started inside the planner
   would take effect immediately (it charges resources and starts a countdown on the real building).
   That mixes two models. Either upgrades also have to be deferred into the template and replayed at
   Apply, or the planner has to accept that upgrades commit immediately while moves do not, and say
   so in the UI.
5. **Applicability check interaction.** `checkIfApplicable` refuses Apply while any real building is
   in the inventory (`popups/BasePlannerPopup.as:132-142`). A building upgraded while stored would
   be in an inconsistent state; storing should be disallowed for anything with a running countdown.
6. **Inventory items are not real buildings.** A node that came out of storage wraps a synthetic
   `BFOUNDATION` that was constructed and then immediately removed from the instance manager, with
   only `_id = 1000000`, `_type`, `_lvl`, `_fortification` and `_range` set and **no `_buildingProps`
   at all** (`PlannerTemplate.as:160-176`). Calling `UpgradeCost()` or `Upgrade()` on one would throw.
   Any upgrade affordance has to be hidden for inventory nodes, or the stub has to be given props.
7. **No server work is required.** Upgrades never touch the yardplanner endpoints; they ride the
   normal `/base/save` `buildingdata` blob. The planner's own save format
   (`{x, y, id, type}`) carries no level and does not need to — but that also means a saved layout
   cannot describe an intended upgrade, so deferring upgrades to Apply would need a new node field.

The cheapest version: add a third tool (or a click-through on the selected node) that opens the same
`BUILDINGOPTIONS` upgrade popup the yard screen uses, scoped to `node.building`, and disable the
Store tool for buildings with a live countdown.

---

## 9. Repair and healing

### Building repair

Damage persists between sessions in `buildinghealthdata` (a map of building id to current HP, only
for buildings below full) and, outside Map Room 3, also as an `hp` field inside `buildingdata`
(`client/scripts/BFOUNDATION.as:3023-3025`, `client/scripts/BASE.as:3169`).

Repair is **free** — no resource or shiny cost — but takes time and is opt-in.

`Repair()` sets `_repairing = 1`, clears the destroyed flag and saves
(`client/scripts/BFOUNDATION.as:2017-2022`). While repairing, the building heals every tick at:

```
rate = ceil( maxHealth / min(3600, repairTime[lvl-1]) )   HP per second
```
(`client/scripts/BFOUNDATION.as:1367-1370`)

The `min(3600, ...)` clamp means **no building ever takes longer than one hour to repair**, however
large its `repairTime` stat. A level 10 Town Hall with `repairTime = 345600` repairs at
`ceil(600000/3600) = 167` HP/s, i.e. full in about an hour.

`Repaired()` restores full health, recomputes housing space for housing buildings, and refreshes the
UI (`client/scripts/BFOUNDATION.as:2024-2032`).

**Repair blocks everything else.** A building with `_repairing == 1` heals instead of advancing its
build, upgrade or fortify countdown, because the repair branch is checked first and the countdown
branch requires `health == maxHealth` (`client/scripts/BFOUNDATION.as:1367-1394`). The server models
the same pause when it advances timers (`server/src/services/base/advanceBuildingTimers.ts:90-91`).

A damaged harvester also produces at a reduced rate and stops entirely below 50% health
(`client/scripts/BRESOURCE.as:302`, `:384-386`).

### How a repair is started

There is no auto-repair. Three entry points:

1. **Per building.** Click it, then `btn_repair` (`client/scripts/BUILDINGINFO.as:98-102`,
   `:523-525`).
2. **The post-attack popup.** On loading a yard with damage, a popup offers "Repair All", which
   loops every building below full health and calls `Repair()` on each
   (`client/scripts/BASE.as:2064-2081`).
3. **"Repair Now" with shiny.** The same popup's second button does the free repair-all *and* opens
   the `FIX` store item (`client/scripts/BASE.as:2082-2096`).

`FIX` "Repair all buildings now" instantly sets every damaged building to full health
(`client/scripts/STORE.as:2149-2161`). Its price is recomputed on every store refresh:

```
FIX.c = GetTimeCost( sum of _repairTime over buildings repairing with > 300 s left )
        + 10 * (count of those buildings)
```
(`client/scripts/STORE.as:381-395`)

It is refused when nothing is repairing (`client/scripts/STORE.as:1094-1098`).

`SP1`..`SP4` also work on a repairing building: they add
`ceil(maxHealth / _repairTime) * seconds` of healing, and SP1/SP4 snap to full
(`client/scripts/STORE.as:2056-2066`).

Map Room 3 outposts additionally get a floor: several code paths call
`repairAllBuildingsToMinimumPercentage(0.25)`, which raises anything below 25% to 25%
(`client/scripts/BASE.as:2355-2367`, called at `:2068`, `:2085`).

### Monster healing

Separate system, listed here because it shares the shiny-shortfall pattern. Healing the whole
monster roster costs **goo (r4)**; if the player is short, the difference is offered for
`ceil(pow(sqrt(shortfall / 2), 0.75))` shiny as a `MHTOPUP` purchase
(`client/scripts/BASE.as:2369-2470`). `HAMS` heals everything instantly for shiny
(`client/scripts/STORE.as:2162-2166`).

---

## 10. Server validation

### anticheat.ts

`server/src/scripts/anticheat/anticheat.ts` is a **loader, not a validator**. It picks a module at
first use:

```ts
if (process.env.ENV !== Env.PROD)
  return antiCheatModule = await import('./pub/anticheat.stub.js');   // :15-16
try   { antiCheatModule = await import('./priv/anticheat.private.js'); }  // :20
catch { antiCheatModule = await import('./pub/anticheat.stub.js');    }   // :22
```
(`server/src/scripts/anticheat/anticheat.ts:12-26`)

`validateSave(user, save, rawBody)` delegates to whichever module loaded
(`anticheat.ts:33-36`). The public stub **performs no checks and returns immediately**
(`server/src/scripts/anticheat/pub/anticheat.stub.ts:31-35`). The private implementation is not in
this repository, and `server/src/scripts/anticheat/priv/` does not exist here.

So on any open-source build, and on any non-production environment, **there is no save validation
whatsoever**. The contract the stub documents for a private implementation is: set `user.banned`,
write a `Report` row, and throw `antiCheatBanErr()`
(`anticheat.stub.ts:20-23`).

`validateSave` is called once per save, before any key is applied
(`server/src/controllers/base/save/baseSave.ts:69`).

### What the save path does check

| Check | Line |
| --- | --- |
| The save row exists for `basesaveid` | `server/src/controllers/base/save/baseSave.ts:60` |
| Caller owns the base, or holds a non-zero `attackid` on it | `baseSave.ts:62-67` |
| Only `Save.saveKeys` (own save) or `Save.attackSaveKeys` (attack) are read from the body | `baseSave.ts:74` |
| On an attack, `buildingdata` is taken from the DB except for removing a triggered trap | `baseSave.ts:102-110`, `handlers/buildingDataHandler.ts:24-40` |
| On an attack, champion `hp` can only go down | `handlers/championHandler.ts` |
| Defender loot only ever subtracts, capped at 10,000,000 per resource per save | `handlers/defenderLootHandler.ts:29-46` |
| Academy monster levels clamped to 6 | `handlers/academyHandler.ts` |
| Shiny-locked accounts cannot buy non-shiny-gain store items | `handlers/purchaseHandler.ts`, `docs/server-api.md` §2 |
| Countdowns advanced across an attack save, clamped to 30 days | `services/base/advanceBuildingTimers.ts:42-79` |

### What is not checked

- **Build and upgrade costs are never validated.** The client charges itself and reports a resource
  delta; the server adds the delta with `saveResources[key] += delta`
  (`server/src/services/base/updateResources.ts:40-42`). A positive delta on an owner save is
  accepted. Nothing compares the delta to the buildings that changed.
- **Storage caps are client-supplied.** `rNmax` is assigned verbatim
  (`server/src/services/base/updateResources.ts:37-38`).
- **Countdowns and levels are client-supplied.** On an owner save, `buildingdata` is assigned whole
  (`server/src/controllers/base/save/baseSave.ts:107`). A client can report any level, any `cU`, or
  no countdown at all.
- **Placement is never checked.** There is no grid on the server; `x`/`y` are opaque.
- **Building counts are never checked** against `quantity` or the town hall level.
- **Shiny prices are trusted for the quantity, not the item.** `purchaseHandler` looks the item up
  in the catalogue but the client chooses which item key to send.
- **The Yard Planner endpoints have no schema.** `saveTemplate`'s body is cast, not parsed
  (`server/src/controllers/yardplanner/saveTemplate.ts:22`), with no slot-count bound.
- **`points` and `basevalue` are stored as whatever string the client sends**
  (`server/src/controllers/base/save/baseSave.ts:86-92`), and the level is derived from them
  (`server/src/services/base/calculateBaseLevel.ts:11-20`).

### Rate limits

`/base/load`, `/base/save`, `/base/updatesaved` and both yardplanner routes carry **no rate limiter**
(`server/src/app.routes.ts`, and `server/src/middleware/rateLimiters.ts` defines limiters only for
`getarea`, public reads, debug data, terrain, snapshot, alliances, `getcells`, alliance search and
invites, registration, username change and login). The only per-request middleware on the base
routes is `verifyUserAuth` and `logRequest`.

---

## 11. UNVERIFIED

1. **Monster Juicer (id 9) Map Room 2 costs.** `client/scripts/GLOBAL.as:616-637` gives level 1 a
   cost of 1,000,000 of each of r1/r2/r3 and a 12-hour build, while levels 2 and 3 cost 250,000 and
   500,000 of r1/r2 — the initial build is more expensive than either upgrade. The index arithmetic
   (`_buildingProps[8]` = id 9) is unambiguous, but the numbers look like they were authored for a
   different building. Not verified against live play.
2. **Decoration costs.** The master table marks decorations "shiny or reward". I did not enumerate
   the per-decoration `costs[0]` and `sale` fields for ids 28–50 and 55–111; several appear to be
   store purchases (`STORE._storeItems["BUILDING" + type]`,
   `client/scripts/BFOUNDATION.as:1698-1700`) rather than resource buys.
3. **Tower `stats` ladders.** Range, damage, rate, speed and splash per level are present in
   `YARD_PROPS.as` for each tower but are combat data and are not tabulated here. See the combat
   spec.
4. **Wall adjacency.** I found no adjacency, chaining or connection bonus anywhere in `BWALL.as`,
   `BUILDING17.as`, `BUILDING18.as` or `GRID.as`. If the original game had one it is not in this
   client.
5. **`buildStatus` field.** Every entry in `YARD_PROPS.as` has `buildStatus: 0`. It is used as a
   sort key in the build menu (`client/scripts/BUILDINGSPOPUP.as:216`) but I did not find anything
   that sets it non-zero.
6. **`size` vs footprint.** `size` is the footprint only for decorations. For other buildings it
   appears to be a build-menu size class, but I did not trace every consumer; it may also feed
   attack targeting.
7. **SP2/SP3 label mismatch.** The store item text says 1 h and 2 h and the code subtracts 3600 and
   7200 seconds, but the client's label keys are `str_30minutes` and `str_60minutes`
   (`client/scripts/STORE.as:1354-1359`). Which is shown to the player depends on the language pack,
   which I did not read.
8. ~~Max yard size.~~ **Resolved.** The full ladder is hardcoded in the Yard Planner as
   `YARD_EXPANSIONS` (`client/scripts/com/monsters/baseplanner/PlannerDesignView.as:106`) and agrees
   with the runtime computation: 1000x800 through 1780x1420. What remains unverified is the
   3240 x 2600 decoration bound in the planner (`:104`) versus the 2600 x 2600 grid bitmap the live
   yard uses (`client/scripts/GRID.as:8-10`); the two disagree on the X axis and I did not determine
   which one a player actually hits first.
9. **Empire value high-water mark.** `_baseValue` only rises for main yards
   (`client/scripts/BASE.as:4857-4859`). Whether the server ever resets it (for example on takeover)
   was not traced.
10. **Anticheat in production.** The private module is not in this repository, so what production
    actually validates is unknown. Everything in §10 describes the open-source build.
11. **The Apply-time `_mouseClicked` latch.** The claim in §8 that `moveTo` never reaches
    `StopMoveB` is read off the control flow at `client/scripts/BFOUNDATION.as:2783-2793` with
    `_mouseClicked` defaulting to false (`:334`). It was not observed in a running client, and a
    building that had already been dragged by hand in the same session would have the latch set and
    would behave differently.

---

## 12. Redesign notes

### Rules that must be preserved

These are load-bearing and a new client that changes them will diverge from existing saves.

1. **The save is a snapshot plus a `savetime`, and countdowns are *remaining* time, not deadlines.**
   `cB`, `cU`, `cF` are seconds left as of the last save
   (`client/scripts/BFOUNDATION.as:2978-2992`). Whoever loads the yard replays it forward. Any
   change to absolute timestamps has to keep deriving the legacy relative fields, exactly as
   `advanceBuildingTimers.ts`'s header note describes
   (`server/src/services/base/advanceBuildingTimers.ts:3-24`).
2. **Countdowns pause while a building is damaged or repairing.** Both sides implement this
   (`client/scripts/BFOUNDATION.as:1375`, `server/src/services/base/advanceBuildingTimers.ts:90-91`).
3. **Resource saves are deltas, not absolutes.** The server adds them
   (`server/src/services/base/updateResources.ts:40-42`). A client that starts sending absolute
   pools will multiply everyone's resources.
4. **`quantity` is indexed by town hall level, and `re` is `[type, count, minLevel]`.** These two
   arrays are the entire unlock system (`client/scripts/BASE.as:3692-3786`).
5. **Town Hall 6 unlocks Map Room 2, and `mr2upgraded` makes it permanent**
   (`server/src/controllers/base/load/baseLoad.ts:157`).
6. **The 30-day replay clamp** on both sides (`client/scripts/BASE.as:776-781`,
   `server/src/services/base/advanceBuildingTimers.ts:32`).
7. **Recycle refunds 50% of cumulative cost; cancelling an in-progress job refunds 100%**
   (`client/scripts/BFOUNDATION.as:2625-2666`, `:2410-2432`).
8. **Repair is free and capped at one hour** (`client/scripts/BFOUNDATION.as:1369`).
9. **Outposts: one worker, no recycling, no cap recalculation, income auto-banks to the main yard**
   (`client/scripts/QUEUE.as:32-39`, `client/scripts/BFOUNDATION.as:2893-2895`,
   `client/scripts/BASE.as:4714-4718`,
   `client/scripts/com/monsters/autobanking/AutoBankManager.as:299-330`).
10. **The finish-now price curve.** `min(ceil(t*20/3600), int(sqrt(t*0.8)))` with a free window
    below 300 s (`client/scripts/STORE.as:162-171`). Players know this curve; changing it changes
    the economy.
11. **Decorations may sit outside the plot boundary** (`client/scripts/BASE.as:4635-4636`). Existing
    yards have them there.
12. **Building ids and the `buildingdata` field names** (`X`, `Y`, `id`, `t`, `l`, `cB`, `cU`, `cF`,
    `fort`, `hp`, `rE`, `st`, `pr`, `cP`, `prefab`). These are the wire format
    (`client/scripts/BFOUNDATION.as:2968-3030`, `client/scripts/BRESOURCE.as:483-493`).

### Flash-era constraints to drop

- **Isometric screen coordinates as the storage format.** The client stores `_mc.x`/`_mc.y` in
  screen space and converts to yard space only on export
  (`client/scripts/GRID.as:135-144`). A new client should work in yard coordinates throughout and
  treat the isometric projection as a rendering concern.
- **The 5-unit grid quantisation and the 2600 x 2600 fixed bitmap**
  (`client/scripts/GRID.as:8-12`). A modern spatial index does not need a preallocated 270k-entry
  vector sized for a plot nobody can reach.
- **Snap granularity of 10 px horizontal / 5 px vertical in screen space**
  (`client/scripts/BFOUNDATION.as:1560-1561`). That is an artefact of the isometric tile aspect; in
  yard space it should be a single uniform step.
- **`SecNum` obfuscated numbers.** Every gameplay value is wrapped in `com.cc.utils.SecNum` as a
  client-side anti-tamper measure. With a server-authoritative design this is pure overhead.
- **Worker walk time.** A worker must physically reach the building before its countdown starts
  (`client/scripts/BFOUNDATION.as:1376-1393`). This is a rendering flourish that silently steals
  seconds and complicates the replay.
- **`_dataAge`-style render gating and the 10 ms replay slices**
  (`client/scripts/BASE.as:1863-1874`). Replay should be an O(1) arithmetic step per building, not a
  simulated tick loop.
- **The 2-worker default planner slot limit tied to a subscription reward**
  (`client/scripts/com/monsters/baseplanner/BasePlanner.as:20-24`) can be reconsidered; the storage
  is a `jsonb` array with no bound.
- **Dead code to not port:** `PLANNERPOPUP.as`, `PLANNERPOPUP_CLIP.as`, `plannerBuilding.as`,
  `plannerBuilding_CLIP.as`, `plannerBuildingSquare.as` and `plannerRange.as` (old planner,
  `yp_version` 1); `PLANNER.Update()`, which is a no-op under the new planner and makes its two
  callers `client/scripts/STORE.as:2244` and `:2248` do nothing; the friend "help" system
  (`client/scripts/BFOUNDATION.as:2337-2399`, dead because `_friendCount` is always 0);
  `buildingkeydata` (written, never read); `QUEUE.Move` (empty stub,
  `client/scripts/QUEUE.as:280-281`); the dead empty branch in `QUEUE.Tick`
  (`client/scripts/QUEUE.as:221-222`); and `BasePlannerService.clearSlot`, which posts to a
  nonexistent endpoint and is never called.

### Manual clicks to remove

Counting from "I want this to happen" to "it happens", in the current client.

**Collect resources from one harvester: 2 clicks.**
1. Click the harvester (`client/scripts/BFOUNDATION.as:2833`).
2. Click `btn_bank` (`client/scripts/BUILDINGINFO.as:135`, `:454-457`).

With six harvesters per resource and four resources, a full manual round is **up to 48 clicks**.
`btn_bankall` cuts it to 2 but is only unlocked past tutorial stage 200
(`client/scripts/BUILDINGINFO.as:137-139`) and only banks harvesters that are at full health with no
countdown running (`client/scripts/BUILDINGINFO.as:461`). *Outposts already auto-bank
(`AutoBankManager.as:299-330`) — the main yard should too, or at minimum default to bank-all with a
single always-visible control.*

**Build one building: 5 clicks plus a drag.**
1. Open the build menu (`client/scripts/BUILDINGS.as:36-56`).
2. Pick the category tab (`client/scripts/BUILDINGSPOPUP.as:95-97`).
3. Page through if the tab has more than 10 entries (`client/scripts/BUILDINGSPOPUP.as:133`,
   `:267-278`).
4. Click the building thumbnail to open the info pane
   (`client/scripts/BUILDINGBUTTON.as:40`, `:120-122`; tabs are wired at
   `client/scripts/BUILDINGSPOPUP.as:32-38`).
5. Click the resource-cost button (`client/scripts/BUILDINGOPTIONSPOPUP.as:89`, `:415`).
6. Move the mouse to position, then click to place
   (`client/scripts/BFOUNDATION.as:1552`, `:1624`).

If resources are short, step 5 instead opens a second dialog offering a shiny top-up
(`client/scripts/BUILDINGOPTIONSPOPUP.as:478-484`), adding 2 more clicks.

**Upgrade one building: 3 clicks.**
1. Click the building.
2. Click `btn_upgrade` (`client/scripts/BUILDINGINFO.as:246-248`, `:560-569`).
3. Click the resource button in the confirm popup
   (`client/scripts/BUILDINGOPTIONSPOPUP.as:176`, `:491`).

There is no way to queue an upgrade behind another, no "upgrade all harvesters", and no repeat of
the last upgrade. The only bulk action in the whole system is `btn_upgradeall` for walls, and that
one is **shiny-only** (`client/scripts/BUILDINGINFO.as:573-580`).

**Finish a job early: 3 to 4 clicks.**
1. Click the building.
2. Click `btn_speedup` (`client/scripts/BUILDINGINFO.as:586-588`).
3. The streamlined popup appears with a single "Finish now" button
   (`client/scripts/STORE.as:673-706`) — unless `GLOBAL._showStreamlinedSpeedUps` is off or the
   tutorial is unfinished, in which case the full store panel opens at the speed-up tab and needs a
   further item click (`client/scripts/STORE.as:830-832`).

**Repair after an attack: 1 to 2 clicks if the popup appears**, since the post-attack popup offers
Repair All (`client/scripts/BASE.as:2064-2081`). Otherwise **2 clicks per damaged building**
(`client/scripts/BUILDINGINFO.as:101`, `:523-525`). There is no auto-repair setting.

**Pick a mushroom: 2 clicks** (click the mushroom, click `btn_pick`,
`client/scripts/BUILDINGINFO.as:289`, `:585-587`), and it consumes a worker for the duration of the walk
plus 60 ticks (`client/scripts/BMUSHROOM.as:67-84`).

**Rearrange the yard: open the planner, drag, Apply, and the planner closes**
(`client/scripts/com/monsters/baseplanner/BasePlanner.as:112-126`). Reaching the planner itself
takes 2 clicks on the Yard Planner building first
(`client/scripts/BUILDINGINFO.as:164-166`, `:500-502`), and there is no keyboard shortcut or HUD
button.

The clearest wins for a redesign, in order of clicks saved per session: auto-bank the main yard,
add a single always-available bulk-upgrade path, make the build menu a searchable palette rather
than tabs-and-pages, and let the planner start upgrades so a layout pass and a progression pass are
one visit instead of two.
