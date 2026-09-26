# Yard Planner — Redesign Proposal

A proposal for the Yard Planner in the revamped web client (TypeScript client, evolving TypeScript
server). It is a design document, not a rules specification: where it describes current behaviour it
cites the Flash client or the server, and where it proposes something new it says explicitly what
changes relative to today.

All citations are `path:line` relative to the repository root. Current-behaviour statements come
from a source audit of `client/scripts/com/monsters/baseplanner/` and the two server controllers;
tower numbers come from `client/scripts/YARD_PROPS.as` and `client/scripts/BTOWER.as`.

Contents:

1. [Problem statement](#1-problem-statement)
2. [Design goals](#2-design-goals)
3. [Feature proposals](#3-feature-proposals)
4. [UI and UX design](#4-ui-and-ux-design)
5. [Data and server changes](#5-data-and-server-changes)
6. [Phased delivery plan](#6-phased-delivery-plan)
7. [Open questions](#7-open-questions)

## 1. Problem statement

### 1.1 What the Yard Planner is today

The Yard Planner is a full-screen popup that lets a player rearrange their base without moving the
real buildings, save the arrangement to a slot, and later push it onto the live yard in one action.

Two implementations exist in the client. The live one is `com/monsters/baseplanner/*`, selected by
the server flag `yp_version`, which is always `2` (`server/src/game-data/flags.ts:78`, dispatched at
`client/scripts/PLANNER.as:34-44`, served through `server/src/controllers/base/load/baseLoad.ts:152,314`).
The older `PLANNERPOPUP.as` / `plannerBuilding.as` path is unreachable dead code. The object graph is
`BasePlanner.setup()` to `BasePlannerPopup` (`BasePlanner.as:73`) to `PlannerDesignView` plus
`PlannerExplorer` (`BasePlannerPopup.as:196-252`).

Editing touches only `PlannerNode` and `BuildingItem` display objects; the real `BFOUNDATION`s are
untouched until Apply, which converts grid coordinates to isometric and calls `BFOUNDATION.moveTo`
per node (`BASE.applyTemplate`, `client/scripts/BASE.as:5025-5041`). The planner talks to the server
exactly three times: a template list on open (`BasePlannerService.as:30-33`), a single-slot save
(`:16-20`), and the base save Apply triggers (`BasePlanner.as:123-125`).

### 1.2 Why it is plain and awkward

| Problem | Evidence | Why it hurts |
|---|---|---|
| Only two tools exist | `TOOL_SELECTMOVE` and `TOOL_STORE`, `PlannerDesignView.as:48-50`; `onToolClick` handles only those two plus the store shortcut, `BasePlannerPopup.as:456-464` | Every layout change is drag-one-building or store-one-building. There is no third verb. |
| No multi-select, no groups | No selection set in `PlannerDesignView`; `_selectMoveTarget` is a single `BuildingItem` (`:56`) | Shifting a wall ring of forty segments by one cell is forty drags. |
| No undo or redo | No history stack anywhere in `com/monsters/baseplanner/` | A misplaced drag is unrecoverable except by reloading the slot, which throws away everything since the last save. |
| No cost or time information | `PlannerNode.props` is `GLOBAL._buildingProps[type-1]` and carries `costs`, but the planner never reads it (`PlannerNode.as:105`) | The player cannot tell what a layout would cost to realise, or how long it would take. |
| No upgrading | `grep -rni upgrade client/scripts/com/monsters/baseplanner/` returns zero hits. Level and fortification are read-only labels (`PlannerNode.as:61-62`, `BuildingItem.toggleMoreInfo:137-161`) | Planning a base and upgrading a base are the same activity for the player, and the tool only does half of it. |
| The zoom slider is dead | `BasePlannerPopup.onZoomScroll:537-538` is an empty function body. Only the two step buttons (`:519-535`) and the mouse wheel (`:510-517`) work, at a fixed 0.25 step between 0.25 and 2.0 (`PlannerDesignView.as:76-80`) | The control that looks most like a zoom control does nothing. |
| Apply is all or nothing | `checkIfApplicable` blocks Apply while any non-decoration, non-misc building is still in the inventory (`BasePlannerPopup.as:132-143`); the failure is a single message, `basePlanner_cantApply` (`:557-563`) | The message does not say which buildings are unplaced, so the player hunts through the inventory. |
| No defence feedback | Range rings only. `toggleView:642-657` calling `drawRanges:681-712` draws ground, air and trap circles; nothing aggregates them | A player cannot see gaps, overlaps, or whether a corner is defended at all. |
| No pathing feedback | Nothing in the planner touches `com/monsters/pathing/PATHING.as` | Walls and gaps are the core of base design, and the tool shows nothing about how attackers would move through them. |
| Inventory is a flat accordion | Six fixed category headers built in the constructor (`PlannerExplorer.as:41-46`), sorted by name then level (`plannerNodeSort:60-73`). No search, no filter, no count badge | Finding one building among a hundred stored decorations means scrolling. |
| Saved layouts are almost anonymous | A slot holds `slotid`, `name` (15 characters, `BasePlannerTransferRow.as:29`) and `data`. Nodes are `{x, y, id, type}` only (`BaseTemplateNode.as:6-12`) | No thumbnail, no notes, no date, no level information. Two slots called "def" and "def2" are indistinguishable. |
| Two slots | `DEFAULT_NUMBER_OF_SLOTS = 2` (`BasePlanner.as:20-24`); subscribers get 10 (`SubscriptionHandler.as:152`, `YardPlannerExtraSlotsReward.as:19`). Enforced client-side only | Two is below the number of layouts a serious player actually keeps. |
| Outposts cannot save or load | `canSave = !BASE.isOutpost` (`BasePlanner.as:41`, getter `BASE.as:5397`); Save and Load disabled at `BasePlannerPopup.as:268-270,282-284` | Outposts are where most players have the most yards, and they get the least tool. |
| Save is a dead end for one operation | `BasePlannerService.clearSlot:64-67` posts to `bm/yardplanner/deletetemplate`, which does not exist on the server and is never called from the client | A slot cannot be emptied, only overwritten. |
| The server validates nothing | `saveTemplate` stores the spread request body with no schema, no `slotid` bounds, no size cap (`server/src/controllers/yardplanner/saveTemplate.ts:28-40`); the column is `jsonb` typed `any[]` (`server/src/database/models/save.model.ts:393-395`) | Any client can write arbitrary payloads and unlimited slots. Also documented at `docs/server-api.md:378-383`. |
| The response shape is wrong | Both controllers reply `{ error: 0, ...save.savetemplate }`, spreading an array into index keys (`getTemplates.ts:19-23`) | A new TypeScript client has to reproduce a bug to read its own data. |

Taken together: the planner is a two-verb drag editor with no memory, no arithmetic, and no opinion
about whether the layout the player just built is any good.

## 2. Design goals

| # | Goal | Measure |
|---|---|---|
| G1 | Rebuilding a full base layout is fast | A 60-building layout can be rearranged from scratch in under 6 minutes by a player who knows the tool |
| G2 | Every common action is reachable in at most two clicks from the canvas | Audit the final interaction map; zero actions above two clicks, excluding confirmations |
| G3 | Mistakes are free | Every destructive edit is undoable; undo depth of at least 100 steps; no edit requires reloading a slot |
| G4 | The player knows what a layout costs before committing | Resource totals, build and upgrade time, worker demand and shiny cost for instant finish are visible without opening a sub-panel |
| G5 | The planner gives an opinion about defence quality | Coverage percentage and dead-zone highlighting for ground and air, computed from real tower stats, within 100 ms of any edit |
| G6 | Planning and executing are one activity | Upgrades and fortifications can be queued inside the planner and started by Apply, with no trip to the live yard |
| G7 | The tool works on a phone | Every feature except box-select is usable with touch; the canvas holds 30 fps while panning on a mid-range 2022 phone |
| G8 | The server owns the rules | No layout can be saved or applied that the server has not validated for ownership, bounds, overlap and slot limits |

## 3. Feature proposals

### 3.0 Overview

| # | Feature | Priority | Effort |
|---|---|---|---|
| F1 | Upgrade and fortify from inside the planner | Must | L |
| F2 | Batch upgrade | Should | M |
| F3 | Build cost and time summary panel | Must | M |
| F4 | Defence coverage view | Should | M |
| F5 | Attack path preview | Could | L |
| F6 | Multi-select and box select | Must | M |
| F7 | Move, mirror, align and distribute groups | Should | M |
| F8 | Undo and redo | Must | S |
| F9 | Copy a layout between main yard and outposts | Should | M |
| F10 | Layout sharing by code or link | Could | M |
| F11 | Community template gallery with rating | Could | L |
| F12 | Compare two layouts side by side | Could | M |
| F13 | Keyboard shortcuts | Must | S |
| F14 | Touch and mobile gestures | Should | M |
| F15 | Working zoom slider and minimap | Must | S |
| F16 | Inventory search and filter | Must | S |
| F17 | Pre-Apply checklist | Must | S |
| F18 | Saved-layout metadata | Must | M |

### F1. Upgrade and fortify from inside the planner — Must, L

**For the player.** Select a tower, see its current level, its next level's stats, what the upgrade
costs and how long it takes, and queue it. Apply then starts the queued jobs against the real yard.
The player never leaves the planner to improve a base.

**How it works.** Two new tools, Upgrade and Fortify, plus the same actions in the inspector. The
inspector shows a level ladder from the building's current level to its maximum; picking a target
level stores a *plan* on the node and changes nothing else.

All the data already exists client-side. Cost and time per level live in `costs[level]` as
`{r1, r2, r3, r4, time, re}` (`client/scripts/YARD_PROPS.as:2040-2107`, the Cannon Tower), where
`r1` to `r4` are twigs, pebbles, putty and goo, `time` is seconds, and `re` lists
`[requiredType, ?, requiredLevel]` prerequisites. Fortification uses `fortify_costs` alongside it
(`:2110-2138`), gated on `can_fortify`. `PlannerNode.building` is already a live `BFOUNDATION`
reference (`PlannerNode.as:32,56`), so `UpgradeCost()` (`BFOUNDATION.as:2668`) and
`InstantUpgradeCost()` (`:2114`) are in scope today and simply never called. Prerequisite and
blocking rules exist in `BASE.CanUpgrade` (`BASE.as:3828-3900+`).

**What changes in rules or data.**

1. `BaseTemplateNode` gains `level`, `fort` and an optional `plan: {level, fort}`. Today it is only
   `{x, y, id, type}` (`BaseTemplateNode.as:6-12`), so an upgrade cannot be represented in a saved
   layout at all. This is the single blocking data change.
2. Inventory items are synthetic stubs with no props and no cost data
   (`PlannerTemplate.getNodesFromStoredBuildings:134-182` builds a bare `BFOUNDATION` with only
   `_id = 1000000`, `_type`, `_lvl`, `_fortification = 0`, `_range = 0`). The new client must
   resolve props by type for every node, so a stored building can be planned before it is placed.
3. **New rule:** respect the countdown state the planner currently ignores. The live planner has no
   countdown check anywhere and `BFOUNDATION.moveTo:3601-3613` has no guard, so a building
   mid-upgrade can be dragged; the old planner did lock them (`plannerBuilding.as:37-44`). Block
   queueing an upgrade on a building already counting down, but keep allowing it to be moved.
4. **New rule:** queued upgrades are pending until Apply. They cost nothing and reserve nothing
   while the planner is open.

**Workers.** The yard has `1 + STORE._storeData.BEW.q` workers on the main yard, capped at five
(`client/scripts/QUEUE.as:42-53`, five-busy message at `:100-103`). Outposts get exactly one,
because `BEW` extras are main-yard only (`QUEUE.as:44-52`). `WORKERS.Assign` returns `null` when
every worker is busy (`WORKERS.as:65-102`), and there is no queue. The planner shows a `free/total`
meter and marks jobs beyond that count as waiting. See Q1: either the planner starts only as many
jobs as there are workers, or the game gains a real queue.

**On Apply.** Apply becomes a three-part transaction: move and place every node (today's behaviour,
`BASE.applyTemplate:5025-5041`), then attempt each planned upgrade in the player's chosen order
until workers or resources run out, then report started, skipped-for-resources,
skipped-for-workers and skipped-for-prerequisites. The confirmation dialog itemises the exact
resource total deducted and the number of jobs started. Apply never spends silently.

**Instant finish.** Shiny cost is computable today:
`InstantUpgradeCost() = int((ceil(sqrt((r1+r2+r3)/2) ^ 0.75) + GetTimeCost(time)) * 0.95)`
(`BFOUNDATION.as:2114-2128`), where `GetTimeCost(s)` is `0` at or under 300 seconds and otherwise
`min(ceil(s * 20 / 3600), floor(sqrt(s * 0.8)))` (`STORE.as:162-171`). Show the total next to the
time total, but do not ship a one-click "finish everything" in phase 1. That is a large real-money
action and needs its own confirmation design.

### F2. Batch upgrade — Should, M

**For the player.** "Upgrade all my walls to level 6." One action instead of forty.

**How it works.** With a multi-selection active (F6), the inspector switches to a batch panel
showing the type breakdown of the selection. The player picks a target level, and the planner sets
`plan.level` on every selected node that can reach it, skipping those already at or above it and
those blocked by prerequisites. A preview line reads, for example, "34 of 40 walls will go from
level 4 to level 6; 6 already at level 6 or higher."

Also offer "upgrade everything one level" and "bring selection to the cheapest common level".

**What changes.** Nothing beyond F1's data change. This is purely a bulk editor over `plan`.

### F3. Build cost and time summary panel — Must, M

**For the player.** A permanent bar showing what the current plan costs, so the player can trade a
tower upgrade against a wall ring without leaving the tool.

**How it works.** A bottom bar, always visible, recomputed on every edit. It shows:

| Field | Source |
|---|---|
| Twigs, pebbles, putty, goo required | Sum of `costs[level].r1..r4` across every level step in every node's `plan`, plus `fortify_costs` for fortification steps |
| Resources the player has | Live from the base state |
| Shortfall per resource, in red | Difference |
| Total worker time | Sum of `costs[level].time`, in seconds |
| Wall-clock time | Total worker time divided by free workers, as a lower bound, plus a note that jobs do not parallelise perfectly |
| Shiny to finish instantly | Sum of `InstantUpgradeCost()` per step (`BFOUNDATION.as:2114-2128`) |
| Buildings still in inventory | Count of unplaced non-decoration nodes |

Hovering any total expands a breakdown by building type. Clicking a resource shortfall highlights
the nodes responsible.

**What changes.** No rules change. This is arithmetic over data the client already loads. Note that
build time is scaled by `GLOBAL._buildTime` in the live path (`BFOUNDATION.as:2254`), so the summary
must apply the same multiplier or it will disagree with the yard.

### F4. Defence coverage view — Should, M

**Partly shipped 2026-09-26 (§8, Q15).** The range circles this section set out to replace are drawn
after all, because the owner asked for them by name: **View ▸ Tower ranges** (R) draws every placed
tower's reach, land and air on separate switches, and **View ▸ Centre of yard** marks yard (0, 0).
What is left of F4 — the per-cell heat sampling, the dead-zone hatching and the coverage percentage
— is issue #55 and the rest of this section still describes it.

**For the player.** A heat overlay answering "where is my base weak?" instead of a tangle of range
circles.

**How it works.** Sample the yard on the same 10-unit grid the pathing system uses, giving
178 x 142 cells at the largest expansion. For each cell, sum the damage per second of every tower
whose range circle covers it, keeping ground and air separate. Range and damage come from
`stats[level-1]`, the values `BTOWER.Props()` reads (`client/scripts/BTOWER.as:91-113`). Damage per
second is the game's own formula, `damage * (40 / rate)` (`BTOWER.as:144-148`). Range is squared
distance from the footprint centre, matching `targetInRange()` (`BTOWER.as:234-249`), so a plain
circle from the centre is exactly right. Ground versus air comes from the `_targetFlyerMode` map
(`BTOWER.as:25-35`) through `getOldStyleTargets()` (`Targeting.as:175-190`): type 115 is air only,
types 21, 25 and 132 hit both, the rest are ground only.

Reference numbers, from `client/scripts/YARD_PROPS.as`:

| Type | Tower | Levels | Range (L1 to max) | Damage (L1 to max) | Rate |
|---|---|---|---|---|---|
| 20 | Cannon | 10 | 160 to 250 | 20 to 200 | 40 |
| 21 | Sniper | 10 | 300 to 372 | 100 to 1100 | 80 |
| 23 | Laser | 8 | 160 to 180 | 120 to 280 | 80 |
| 25 | Tesla | 8 | 250 to 400 | 100 to 240 | 10 to 35 |
| 115 | Aerial | 8 | 300 to 440 | 200 to 400 | 60 |
| 118 | Railgun | 8 | 300 to 400 | 400 to 2500 | 160 |
| 138 | Stronghold | 3 | 360 to 400 | 900 to 1100 | 1 |

Three display modes. **Heat** shades cells by total damage per second, ground and air as separate
layers. **Dead zones** hatches in red every in-bounds cell with zero damage per second; this is the
mode most players will leave on. **Coverage percentage** is one headline number per layer, the
fraction of in-bounds unoccupied cells with non-zero damage per second, shown in the summary bar and
stored in the layout metadata so two layouts compare numerically.

Traps are drawn separately because they are one-shot with a 20-unit trigger radius
(`BTRAP.as:21-27`) and a blast radius of 50 for the Booby Trap, 90 for the Heavy Trap
(`YARD_PROPS.as:2689`, `:6289`). The Monster Bunker (type 22) is drawn as a deployment radius,
300 to 500 by level, not as damage.

**Approximations, stated in the UI.** The Stronghold's four emitters each cover a 180-degree arc and
shift when damaged (`GuardTower.as:27-28,105-114`); the overlay treats it as a full circle. Spurtz
cannons scale damage by health (`SpurtzCannon.as:179`); the overlay assumes full health. Towers
under construction or upgrade do not shoot (`BTOWER.as:159-161`); the overlay counts them at their
planned level and flags them.

**What changes.** No rules change. Pure read-side analysis.

### F5. Attack path preview — Could, L

**For the player.** Drop a marker where an attacker would fling monsters, pick a monster behaviour,
and see the route they would take. This is the feature that turns the planner from a layout editor
into a design tool, because walls and gaps are the whole game.

**What is feasible without a combat simulation.** The pathing system is a plain weighted grid and is
cheap to reimplement. It is a 260 x 260 grid at 10 world units per cell, base cost 10
(`client/scripts/com/monsters/pathing/PATHING.as:34-36,76-91`). Each building stamps its `_gridCost`
rectangles additively, scaled by 0.1, floored at 2 (`PATHING.Cost:93-119`); the Cannon Tower's table
is `[[Rect(0,0,70,70), 10], [Rect(10,10,50,50), 200]]` (`client/scripts/BUILDING20.as:19`). Walls,
type 17, stamp `100 + level * 25` on their inner rectangle (`BFOUNDATION.as:3151`, base table at
`client/scripts/BUILDING17.as:14`). Flood fill and path extraction are `PATHING.GetPathB:188` and
`PATHING.Path:412`. The drop zone is a circle the attacker places anywhere, with monsters scattered
uniformly inside radius `diameter / 2` (`client/scripts/ATTACK.as:438-443,510,543-549`). Target
selection is the `targetGroup` integer resolved in `MonsterBase.as:991-1090`: 1 nearest building,
2 walls, 3 lootables, 4 towers, 5 healer, 6 hunter.

So the preview shows, honestly labelled: **the route a single monster of a chosen target group would
take from a chosen drop point, against the base as planned and fully intact.**

**What is not feasible and must not be implied.** Monsters break walls as they go and the cost grid
changes under them; wall-targeting monsters do double damage to walls (`CreepBase.as:888-890`);
targets die and everything retargets; splash, healers, hunters and champions all change the picture.
Anything past the first destroyed building needs a real combat simulation. Do not build one here.

**In the UI.** A Paths overlay. The player places up to four drop markers, or uses "sample the
perimeter", which drops 36 markers every 10 degrees. For each marker the planner traces one path per
selected target group and draws it as a coloured polyline with an arrowhead. A funnel score reports
how many of the 36 sampled paths pass through each wall gap, which is the number base designers
actually want.

**What changes.** No rules change; this is a client-side estimate. It must carry a visible
"estimate, assumes nothing is destroyed" label.

### F6. Multi-select and box select — Must, M

**For the player.** Select a wall run and move it as one thing.

**How it works.** The selection becomes a set rather than the single `_selectMoveTarget` of today
(`PlannerDesignView.as:56`). Click selects one, shift-click adds or removes, dragging on empty canvas
with the Box tool or with Shift held draws a marquee that selects every intersecting footprint,
Ctrl-A selects all, Escape clears, and "select all of this type" sits on the context menu and the
inspector header. Dragging any member moves the whole set with relative offsets preserved.
Validation runs over the set: if any member lands out of bounds or overlapping, the whole move is
invalid and every offending member is tinted, reusing `BuildingItem.toggleInvalid:163-165`.

**What changes.** No rules change. The snap threshold stays at 5 units
(`MOUSE_POSITION_SNAP_THRESHHOLD`, `PlannerDesignView.as:52`) and applies to the group's anchor.

### F7. Move, mirror, align and distribute groups — Should, M

**For the player.** Build half a base, mirror it, and get a symmetric base in one action. Straighten
a ragged wall line without dragging each segment.

**Mirroring is possible.** Every building has a single scalar footprint, `size` (for example
`"size": 64` for the Cannon Tower, `YARD_PROPS.as:1972`), so footprints are square. A horizontal
mirror about a vertical axis at `cx` is the pure coordinate transform `x' = 2 * cx - x - size`, with
`y` unchanged. Nothing changes shape and nothing needs to rotate. Vertical mirror is the same in
`y`; diagonal is the composition of both. The sprite facing does not mirror, because sprites are
fixed facings and no rotation field exists anywhere in the data (`BaseTemplateNode.as:6-12`). Nothing
in the game reads a building's facing, so a mirrored layout is mechanically identical to its
original; say "mirrors positions, not artwork" the first time the tool is used.

**Align and distribute.** With two or more selected: align left, right, top, bottom, centre
horizontally, centre vertically; distribute evenly horizontally or vertically. These operate on
footprint edges, and every result is re-validated before commit.

**What changes.** No rules change; a mirrored layout was always reachable by dragging. One caveat for
the UI: pathing cost rectangles are not guaranteed symmetric, so a mirror can in principle path
slightly differently. In practice the tables are symmetric, including the Town Hall's five
rectangles (`client/scripts/BUILDING15.as:22`).

### F8. Undo and redo — Must, S

**For the player.** Ctrl-Z. That is the whole feature, and its absence is the single most frustrating
thing about the current tool.

**How it works.** A command stack over the layout model. Every mutation, from place and move and
store to clear, upgrade-plan change, mirror, align and load-slot, pushes an inverse command. Depth
200. The stack clears on Apply and on loading a different slot, with a confirmation before either.
Because the planner mutates only its own model until Apply (`BASE.applyTemplate` is the only writer,
`BASE.as:5025-5041`), undo is purely local and cheap.

**What changes.** Nothing in the rules, but the new planner must be built on an immutable layout
model with command-based mutation from day one, or undo becomes expensive to retrofit.

### F9. Copy a layout between main yard and outposts — Should, M

**For the player.** Design one good outpost layout and stamp it onto all of them.

**How it works.** The Load dialog gains a source picker: any of the player's yards, not just the
current one. On load into a different yard the planner runs a reconciliation pass and reports it
before anything is placed:

| Case | Behaviour |
|---|---|
| Building type exists in the target yard, same or higher count | Placed at the saved position |
| Target yard has fewer of that type | Place as many as exist, list the rest as missing |
| Target yard has more of that type | Place the saved ones, leave the surplus in inventory |
| Type does not exist in the target yard's building set | Skip, list under "not available here" |
| Node falls outside the target yard's expansion bounds | Place in inventory, list under "does not fit" |

Building sets genuinely differ. Inferno yards use `INFERNOYARDPROPS.as` and outposts use
`OUTPOST_YARD_PROPS.as`, with different level caps for the same type. The planner must resolve props
against the *target* yard's table, not the source's.

**What changes.** Outposts gain Save and Load: today `canSave = !BASE.isOutpost` disables both
(`BasePlanner.as:41`, `BasePlannerPopup.as:268-270,282-284`). Remove that restriction so layouts
become account-scoped rather than yard-scoped. A saved layout also records which yard kind it came
from, so the reconciliation pass knows what to expect.

### F10. Layout sharing by code or link — Could, M

**For the player.** Post a base design in Discord and have someone load it.

**How it works.** "Share" on a saved layout uploads it and returns a short code such as
`BYM-7K2M-QH4P`, plus a link. Loading a code fetches the layout read-only into a preview, and the
player chooses "load into slot" to keep it. Shared layouts are stripped of building ids and owner
identity; only `{x, y, type, level, fort}` per node survives, plus name, notes and tags.

**What changes.** New storage and two endpoints, see section 5. Shared layouts are immutable once
published; editing produces a new code.

### F11. Community template gallery with rating — Could, L

**For the player.** Browse layouts other players made, filtered to a Town Hall level and yard size,
sorted by rating.

**How it works.** A tab in the Load dialog. Each entry shows a thumbnail, author name, the Town Hall
level it was designed for, required expansion level, the coverage percentages from F4, an average
rating and a vote count. Filters for yard kind, expansion, Town Hall level and tag. One vote per
player per layout, 1 to 5.

**What changes.** User-generated content on a shared surface means moderation, reporting and a
profanity filter on names and notes. Do not ship it alongside F10. Ship share codes first, watch
what people share, then decide whether the gallery earns its moderation cost. See Q3.

### F12. Compare two layouts side by side — Could, M

**For the player.** "Is my new design actually better than the one I am running?"

**How it works.** Compare mode splits the canvas into two synchronised panes with linked pan and
zoom. Below each, the same statistics: ground and air coverage, dead-zone count, total building
levels, resources and time to realise, and inventory count. Differences are highlighted, better in
green. A diff overlay draws every building that moved, with a line to its other position. Compare is
read-only and changes no rules.

### F13. Keyboard shortcuts — Must, S

Proposed map. All are single keys with no modifier except where shown, so they work while the mouse
is on the canvas.

| Key | Action | Key | Action |
|---|---|---|---|
| `V` | Select tool | `Ctrl+Z` / `Ctrl+Shift+Z` | Undo / redo |
| `B` | Box select | `Ctrl+A` | Select all |
| `H` | Pan tool | `Ctrl+C` / `Ctrl+V` | Copy / paste selection |
| `S` | Store tool | `Ctrl+S` | Save to current slot |
| `U` | Upgrade tool | `Delete` | Store selection |
| `F` | Fortify tool | `Escape` | Clear selection or cancel drag |
| `1` `2` `3` | Ground, air, trap overlays | Arrow keys | Nudge selection by one grid unit |
| `4` | Coverage overlay | `Shift` + arrows | Nudge by ten units |
| `5` | Path overlay | `Ctrl` + arrows | Nudge by one footprint |
| `M` | Mirror horizontally | `+` / `-` | Zoom in / out |
| `Space` held | Temporary pan | `0` | Zoom to fit |

A shortcut reference opens with `?`.

### F14. Touch and mobile gestures — Should, M

| Gesture | Action |
|---|---|
| One finger drag on empty canvas | Pan |
| Pinch | Zoom |
| Tap building | Select and open inspector |
| Long press building | Enter drag mode, then drag |
| Long press empty canvas | Open the radial tool menu |
| Two-finger tap | Undo |
| Drag from inventory to canvas | Place |
| Drag building onto the inventory panel | Store |

Box select is the one feature that does not get a touch equivalent; on touch, "select all of type"
and tap-to-add-to-selection replace it. The inspector becomes a bottom sheet below 900 px, and the
inventory becomes a collapsible drawer. Hit targets are at least 44 px.

### F15. Working zoom slider and minimap — Must, S

**For the player.** Continuous zoom and a way to know where you are in a base bigger than the screen.

**How it works.** Replace the dead `onZoomScroll` stub (`BasePlannerPopup.as:537-538`) with a real
continuous slider from 0.25 to 2.0. Keep the 0.25 step buttons (`PlannerDesignView.as:76-80`) and
wheel zoom, but anchor wheel zoom on the cursor rather than the canvas centre. Add zoom-to-fit and
zoom-to-selection. A minimap sits in the canvas corner: the whole yard at fixed scale, buildings as
coloured dots by category, the viewport as a draggable rectangle, yard bounds drawn, click to jump.
Both are missing UI, not missing rules, so nothing changes.

### F16. Inventory search and filter — Must, S

**For the player.** Type "cannon" and see the cannons.

**How it works.** A search box above the inventory matching localised name and type id. Filter chips
for the six existing categories, which are already the accordion headers (`PlannerExplorer.as:41-46`):
defensive, building, resource, trap, wall, decoration. Sort by name, level, footprint or count, with
name-then-level kept as the default because that is today's behaviour
(`PlannerExplorer.plannerNodeSort:60-73`). Count badges on each header. Two additions worth the small
effort: a "needs placing" filter showing only the non-decoration buildings blocking Apply, and stack
badges so forty identical walls occupy one row instead of forty.

### F17. Pre-Apply checklist — Must, S

**For the player.** Know exactly what is wrong before pressing Apply, and be able to click straight
to it.

**How it works.** A panel that opens when Apply is clicked, or on demand from the summary bar. Each
row is a check with a status and, where relevant, a "show me" link that selects the offending nodes.

| Check | Severity | Source of the rule |
|---|---|---|
| Every non-decoration building is placed | Blocking | `BasePlannerPopup.checkIfApplicable:132-143` |
| No building overlaps another | Blocking | `PlannerDesignView.validateBuilding:558-582` |
| Every building is inside the yard bounds for the current expansion | Blocking | `YARD_EXPANSIONS` by `STORE._storeData.ENL.q`, `PlannerDesignView.as:106,571-577` |
| Decorations are inside the larger decoration bounds | Blocking | `MAX_YARD_DIMENSIONS` 3240 x 2600, `PlannerDesignView.as:104,578-580` |
| Enough resources for the queued upgrades | Warning | Summary totals, F3 |
| Enough free workers for the queued upgrades | Warning | `QUEUE.CanDo:76-113`, `WORKERS.Assign:65-102` |
| No queued upgrade is blocked by a prerequisite | Warning | `BASE.CanUpgrade:3828+`, `costs[level].re` |
| Ground coverage has no dead zone touching a resource building | Advisory | F4 |
| Layout has been saved since the last edit | Advisory | `hasBeenSaved`, `BasePlannerPopup.as:748-764` |

Blocking checks disable Apply. Warnings allow it with an explicit acknowledgement. The current
implementation collapses all of this into one untargeted message, `basePlanner_cantApply`
(`BasePlannerPopup.as:557-563`).

**What changes.** Recommend relaxing the first check from blocking to a warning, so a player can
apply a partial layout and leave the rest stored. See Q4.

### F18. Saved-layout metadata — Must, M

**For the player.** Tell two saved layouts apart at a glance.

**How it works.** Each slot gains a name of up to 40 characters (today 15,
`BasePlannerTransferRow.as:29`), a note of up to 500 characters, up to five tags, a generated
thumbnail, the yard kind and expansion level it was designed for, created, updated and last-applied
timestamps, and the cached statistics from F3 and F4. The Load dialog becomes a card grid rather
than a row list, showing thumbnail, name, tags, coverage percentages and "last applied 3 days ago".
Thumbnails are rendered client-side at save time at a fixed 320 x 256 PNG, capped at 40 KB; see Q6
on where they are stored.

**What changes.** Slot count should also rise, from today's client-enforced 2 and 10
(`BasePlanner.as:20-24`, `SubscriptionHandler.as:152`, `YardPlannerExtraSlotsReward.as:19`) to five
free and twenty-five for subscribers, enforced server-side. See Q2.

## 4. UI and UX design

Engine-neutral. Assume a 2D canvas for the yard and an HTML overlay for every panel, so panels get
real text input, scrolling and accessibility for free.

### 4.1 Screen layout

```
+==================================================================================================+
| YARD PLANNER    [ Turtle v3                v ]  * unsaved     Layout  Edit  View  Help   [ ] [X] |
+--------------------------------------------------------------------------------------------------+
| [Select] [Box] [Pan] | [Store] [Upgrade] [Fortify] | [Mirror] [Align v] [Distribute v] | [<] [>] |
| Overlays:  [x] Ground   [ ] Air   [ ] Trap   [ ] Coverage   [ ] Paths   [ ] Labels               |
+-------------------+--------------------------------------------------------+---------------------+
| INVENTORY     (12)|                                                        | INSPECTOR           |
| [ search...      ]|                                                        |---------------------|
| [All][Def][Wall]  |                    Y A R D   C A N V A S               | Cannon Tower        |
| [Res][Trap][Deco] |                                                        | Level 8             |
|-------------------|         (isometric yard, grid, range rings,            | Range 240  DPS 180  |
| v Defensive   (3) |          coverage heat, drag ghosts, bounds)           |                     |
|  [#] Cannon L8 x2 |                                                        | UPGRADE TO          |
|  [#] Sniper L6 x1 |                                                        | [ L9 ] [L10] [Max]  |
| v Walls      (40) |                                                        | 21.0M twigs         |
|  [#] Wall L4 x40  |                                                        | 15.8M pebbles       |
| v Decoration  (9) |                                                        |  1.5M putty         |
|  ...              |                                                        | 4d 0h   28 shiny    |
|                   |                                                        |                     |
|                   |                                                        | FORTIFY             |
|                   |                                                        | Tier 2 -> 3         |
|                   |                                            +---------+ | [ Queue ]           |
|                   |                                            | MINIMAP | |                     |
|                   |   [-]======O========[+]  100%   [fit]      |  . . .  | | [Store]  [Select    |
|                   |                                            |  [__]   | |          all Cannon]|
+-------------------+--------------------------------------------+---------+-+---------------------+
| PLAN  Twigs 21.0M / 34.2M   Pebbles 15.8M / 40.1M   Putty 1.5M / 8.0M   Goo 0 / 2.1M             |
|       Time 4d 0h  (2 free workers)   Shiny 28   Coverage G 87%  A 41%   Unplaced 3               |
|       [ Checklist: 1 blocking ]        [ Compare ]   [ Clear ]   [ Save ]   [ APPLY ]            |
+==================================================================================================+
```

Regions:

- **Top bar.** Layout name and slot picker, unsaved indicator, menus, fullscreen and close.
- **Toolbar.** Tools on the left, group operations in the middle, undo and redo on the right.
  Overlay toggles on a second row. Everything here has a keyboard shortcut in its tooltip.
- **Left panel, inventory.** Search, category chips, then stacked accordion groups with counts.
- **Canvas.** The yard. Zoom slider along the bottom edge, minimap in the bottom-right corner.
- **Right panel, inspector.** Context-sensitive: nothing selected shows layout statistics; one
  building shows its stats and its upgrade ladder; many buildings show the batch panel.
- **Bottom bar, plan summary.** Always visible. Resources needed against resources held, time,
  shiny, coverage, unplaced count, then the action buttons. Apply is the only filled button.

### 4.2 Interaction model

**Select.** Click a building to select it and fill the inspector; shift-click adds or removes; click
empty canvas to clear; double-click selects every building of the same type. Right-click opens a
context menu with store, upgrade, select-all-of-type and copy.

**Drag.** Press and drag a selected building to move the whole selection. A translucent ghost follows
the cursor at the snapped position while the original stays visible at reduced opacity, so the player
sees the delta. Release commits if valid and snaps back if not; Escape cancels, matching
`cancelDragBuilding:510-525`. A click with no travel picks the selection up instead: it follows the
pointer, the next click drops it, a refused drop keeps it in hand, and right-click or Escape returns
it to its original position.

**Place from inventory.** Click or drag an inventory row; the building attaches to the cursor and
places on click. With paint mode on, which the code already supports as `ADD_INVENTORY_PAINTMODE`
(`PlannerDesignView.as:46`), consecutive clicks keep placing from the same stack until it is empty or
Escape is pressed. This matters enormously for walls.

**Snap.** Positions snap with the existing 5-unit threshold (`MOUSE_POSITION_SNAP_THRESHHOLD`,
`PlannerDesignView.as:52`); Alt places unsnapped. Add edge snapping: within 4 units of alignment with
another building's edge, the drag snaps and a thin guide line appears. This alone removes most of the
tedium from wall building.

**View.** Tab or the toolbar's view buttons switch between the isometric canvas and a flat top-down
blueprint: grass rectangle, plot outline, next expansion dashed, and buildings as square tiles
coloured by category with name and level. Selection, drag, click-to-carry and snapping all work the
same way in either view.

**Hover.** A building shows a compact tooltip with name, level, and for towers range and damage per
second. Hovering an inventory row highlights every matching placed building on the canvas.

### 4.3 Visual feedback

| State | Treatment |
|---|---|
| Valid placement | Footprint outlined in white, drop shadow under the ghost |
| Invalid placement | Footprint filled 40 percent red, the colliding buildings outlined red, cursor shows a no-entry badge. Mirrors today's `toggleInvalid:163-165` but names the reason in a tooltip: "overlaps Sniper Tower" or "outside yard bounds" |
| Out of yard bounds | The bounds rectangle for the current expansion pulses; the next expansion's bounds are shown as a dashed line, which the current code already draws (`PlannerDesignView.as:186-189`) |
| Selected | 2 px accent outline plus corner handles |
| Multi-selected | Same outline plus a dashed bounding box around the whole set |
| Range rings | Per-tower circles, ground in blue, air in cyan, trap in orange, at 15 percent fill. Shown for the selection always, and for everything when the overlay is toggled on |
| Coverage heat | Low-saturation blue-to-red gradient under the buildings, never above them. Dead zones hatched |
| Queued upgrade | Small upward chevron badge on the building, tinted green, with the target level |
| Queued fortify | Shield badge |
| Cost delta | When an upgrade is queued or removed, the affected number in the bottom bar animates over 200 ms and flashes once. Nothing else in the bar moves |
| Unplaced building | Its inventory row carries an amber dot; the Apply button carries a badge with the count |

Colour is never the only channel. Invalid placement also gets the badge, queued upgrades also get
the chevron shape, dead zones also get hatching.

### 4.4 Empty states

| Situation | What the player sees |
|---|---|
| No saved layouts | The Load dialog shows an illustration and one line: "No saved layouts yet. Arrange your yard, then press Save." A "Save current yard as a layout" button. |
| Inventory empty | "Everything is placed." Not a blank panel. |
| Search matches nothing | "No buildings match 'xyz'." with a clear-search link. |
| Nothing selected | The inspector shows layout statistics: building count by category, total levels, coverage, and the three worst dead zones. Never blank. |
| Coverage overlay with no towers | "No towers placed, so there is nothing to cover." |
| Path overlay with no drop marker | A hint on the canvas: "Click anywhere outside the walls to place a drop point." |
| Gallery with no results for a filter | Filter chips shown with counts so the player can see which one is too narrow. |

### 4.5 Confirmation flows

**Apply.** Apply is the only irreversible action in the tool, so it gets a real dialog:

```
Apply this layout to your yard?

  42 buildings will move.
   3 stored buildings will be placed.
   6 upgrades will start now:
       Cannon Tower L8 to L9        21.0M twigs, 15.8M pebbles, 1.5M putty, 4d
       Wall L4 to L5  x5             2.5M twigs,  1.9M pebbles,          , 6h
   2 upgrades will wait for a free worker.

  Total deducted now:  23.5M twigs   17.7M pebbles   1.5M putty
  You will have left:  10.7M twigs   22.4M pebbles   6.5M putty

  [ ] Save to "Turtle v3" first

                                        [ Cancel ]   [ Apply ]
```

Moves alone need no dialog beyond a summary line, because moving is free and reversible by applying
the previous layout. Upgrades spend resources, so they are always itemised. The save checkbox
defaults to on when there are unsaved changes.

**Clear** keeps today's confirmation (`onClearClick:574-592`) and adds "this can be undone with
Ctrl-Z", which is true once F8 exists. **Close with unsaved changes** keeps today's guard
(`BasePlannerPopup.Hide:701-718`) and gains a third option, so the choices are keep editing, discard,
or save and close. **Load over unsaved changes** offers the same three; today the planner simply
swaps the active template (`setActiveTemplate:61-68`).

## 5. Data and server changes

### 5.1 The new layout format

Version 2. Field names from version 1 are kept where they exist, so migration is additive.

```json
{
  "version": 2,
  "slotid": 0,
  "name": "Turtle v3",
  "notes": "Funnels everything into the north gap. Weak to air.",
  "tags": ["defence", "th7", "anti-ground"],
  "yardKind": "main",
  "expansion": 4,
  "thumb": "data:image/png;base64,...",
  "createdAt": 1758585600,
  "updatedAt": 1758672000,
  "lastAppliedAt": 1758672400,
  "stats": {
    "buildings": 63,
    "coverageGround": 0.87,
    "coverageAir": 0.41,
    "plannedCost": { "r1": 21000000, "r2": 15800000, "r3": 1562500, "r4": 0 },
    "plannedTime": 345600
  },
  "nodes": [
    { "x": -320, "y": -160, "id": 1042, "type": 20, "level": 8,  "fort": 2,
      "plan": { "level": 10, "fort": 4 } },
    { "x": -280, "y": -160, "id": 1043, "type": 17, "level": 4,  "fort": 0 },
    { "x":  140, "y":   60, "id": 0,    "type": 31, "level": 1,  "fort": 0 }
  ]
}
```

| Field | Meaning |
|---|---|
| `version` | `1` for legacy rows, `2` for this format. Required on write. |
| `yardKind` | `"main"`, `"outpost"`, `"inferno-main"` or `"inferno-outpost"`. Selects the props table. New. |
| `expansion` | The `ENL.q` the layout was designed for, 0 to 6. Warns when loading into a smaller yard. New. |
| `nodes[].x`, `.y` | Grid coordinates, integers, origin at the yard centre, as today. `BASE.applyTemplate` converts with `GRID.ToISO` (`BASE.as:5033`). |
| `nodes[].id` | Live building id, or `0` for a stored building. Today stored items carry the sentinel `1000000` (`PlannerTemplate.as:7`); `0` is clearer. |
| `nodes[].level`, `.fort` | Level and fortification tier at save time. **New**; today a saved node has no level at all (`BaseTemplateNode.as:6-12`). |
| `nodes[].plan` | Optional target level and fortification tier. **New.** Absent means no change planned. |
| `stats` | Cached and advisory, recomputed on load, so the Load dialog and gallery can sort without parsing every node. |

Nodes stay a JSON array, not the index-keyed object the current client emits
(`BaseTemplate.exportData:27-35`).

### 5.2 Validation the server must enforce

The server currently validates nothing (`server/src/controllers/yardplanner/saveTemplate.ts:28-40`,
and `docs/server-api.md:383`). Every rule below is new.

| Rule | Detail | Failure |
|---|---|---|
| Slot bounds | `slotid` is an integer in `[0, maxSlots)` where `maxSlots` is the caller's entitlement | 400 |
| Slot entitlement | `maxSlots` is resolved from the caller's subscription server-side, never from the request | 403 |
| Version | `version` is 1 or 2; a v1 body is accepted only from the legacy endpoint | 400 |
| Name | 1 to 40 characters after trimming, no control characters | 400 |
| Notes | At most 500 characters | 400 |
| Tags | At most 5, each 1 to 24 characters, lowercase alphanumeric and hyphen | 400 |
| Node count | At most 600 nodes. `[PLACEHOLDER]` — derive the real ceiling from the per-type purchase limits in the props tables before launch | 400 |
| Payload size | At most 64 KB per slot after the thumbnail is excluded, and at most 512 KB for the whole column | 413 |
| Thumbnail | At most 40 KB, PNG only, decoded and re-encoded server-side rather than trusted | 400 |
| Node types | Every `type` exists in the props table for the layout's `yardKind` | 400 |
| Node levels | `1 <= level <= costs.length` for that type; `0 <= fort <= fortify_costs.length`, and `fort > 0` only when `can_fortify` | 400 |
| Plan levels | `plan.level >= level` and within the same cap; `plan.fort >= fort` | 400 |
| Ownership | Every node with `id != 0` names a building the caller's save actually owns, of that exact type. Every node with `id == 0` has a type present in the caller's stored-building counts, and the counts are not exceeded | 403 |
| Yard bounds | Non-decoration nodes satisfy `-W/2 <= x <= W/2 - size` and the same in `y`, with `W` and `H` from the expansion table for the caller's real `ENL.q`, not the layout's claimed `expansion`. Decorations use 3240 x 2600 | 400 |
| Footprint overlap | No two non-decoration nodes have overlapping square footprints of side `size` | 400 |
| Duplicate ids | No `id` appears twice | 400 |

Expansion bounds, from `PlannerDesignView.as:106`:

| `ENL.q` | Width x Height |
|---|---|
| 0 | 1000 x 800 |
| 1 | 1100 x 880 |
| 2 | 1220 x 980 |
| 3 | 1340 x 1080 |
| 4 | 1480 x 1180 |
| 5 | 1620 x 1300 |
| 6 | 1780 x 1420 |

Decorations are bounded by `MAX_YARD_DIMENSIONS`, 3240 x 2600 (`PlannerDesignView.as:104,578-580`).

Validation must live in one shared module so that save and apply enforce identical rules, and so the
client can import the same predicate for instant feedback.

### 5.3 Endpoints

Existing, kept as deprecated aliases for at least one release:

| Method | Path | Status |
|---|---|---|
| GET | `/api/:apiVersion/bm/yardplanner/gettemplates` | Deprecated. Keeps the index-key spread shape for old clients. |
| POST | `/api/:apiVersion/bm/yardplanner/savetemplate` | Deprecated. Gains the validation rules above but keeps the v1 body shape. |

New:

| Method | Path | Request | Response |
|---|---|---|---|
| GET | `/api/:apiVersion/bm/yardplanner/templates` | none | `{ error: 0, slots: number, maxSlots: number, templates: Layout[] }` — a real array under a named key, fixing the spread quirk in `getTemplates.ts:19-23` |
| GET | `/api/:apiVersion/bm/yardplanner/templates/:slotid` | none | `{ error: 0, template: Layout }` or 404 |
| PUT | `/api/:apiVersion/bm/yardplanner/templates/:slotid` | `Layout` (v2, without `slotid`) | `{ error: 0, template: Layout }` |
| DELETE | `/api/:apiVersion/bm/yardplanner/templates/:slotid` | none | `{ error: 0 }`. This is the endpoint `BasePlannerService.clearSlot:64-67` already calls and the server never implemented |
| POST | `/api/:apiVersion/bm/yardplanner/apply` | `{ baseid: number, layout: Layout, startUpgrades: boolean }` | `{ error: 0, moved, placed, upgradesStarted, upgradesSkipped, base }` |
| POST | `/api/:apiVersion/bm/yardplanner/share` | `{ slotid: number }` | `{ error: 0, code: string, url: string }` |
| GET | `/api/:apiVersion/bm/yardplanner/shared/:code` | none | `{ error: 0, template: SharedLayout }`, with ids and owner stripped |
| GET | `/api/:apiVersion/bm/yardplanner/gallery` | Query `yardKind`, `expansion`, `townhall`, `tag`, `sort`, `page` | `{ error: 0, entries: GalleryEntry[], total: number }` |
| POST | `/api/:apiVersion/bm/yardplanner/gallery/:code/rate` | `{ rating: 1..5 }` | `{ error: 0, average: number, votes: number }` |
| POST | `/api/:apiVersion/bm/yardplanner/gallery/:code/report` | `{ reason: string }` | `{ error: 0 }` |

All of these sit behind `apiVersion`, `verifyUserAuth` and `logRequest`, matching the existing
registrations at `server/src/app.routes.ts:169-170`. The gallery read endpoints should also carry
the public read rate limiter. Share and rate need their own limiter, since they are write paths open
to abuse.

### 5.4 How Apply is validated server-side

Today Apply is entirely client-side: `BASE.applyTemplate` moves each `BFOUNDATION` with `moveTo` and
calls `Save()`, and `moveTo` itself ends in `Save()`, so the base save fires twice
(`BASE.as:5025-5041`, `BFOUNDATION.as:3601-3613`, `BasePlanner.as:123-125`). The server sees only a
normal base save and has no idea a layout was applied.

Proposed, and this is a significant change: **Apply becomes a server-authoritative operation.**

1. The client posts the full layout to `POST /bm/yardplanner/apply` with the target base id.
2. The server runs the full validation set from 5.2 against the *live* save, not the client's
   claims: every `id` is owned, every stored type is in storage with sufficient count, bounds come
   from the real `ENL.q`. Any blocking failure rejects the whole request. Apply is atomic.
3. If `startUpgrades` is true, the server walks the `plan` entries in the given order, checking
   prerequisites (`costs[level].re`), resources and worker availability. It starts as many as it can
   afford, deducts exactly those resources, and returns which it skipped and why. Resources are
   never deducted for a job that did not start.
4. The server writes the new positions and returns the authoritative base state, which the client
   adopts wholesale. The double `Save()` disappears, because Apply is one request.

This closes the hole where a client can move buildings anywhere, and makes the resource deduction
for planner-started upgrades auditable.

### 5.5 Migration of existing `savetemplate` data

The column is `jsonb` typed `Opt<any[]>` on the save entity
(`server/src/database/models/save.model.ts:393-395`). Existing rows are entries of
`{ slotid, name, data }` where `data` is a JSON *string* containing an index-keyed object of
`{x, y, id, type}` nodes, because the client stringifies before posting
(`BasePlannerService.as:17`) and the server stores the spread body verbatim
(`saveTemplate.ts:32-38`).

Migration is lazy and read-through, not a batch job. On the first read of a row through the new
`GET /templates`, detect the missing `version`, parse `data` if it is a string, and convert the
index-keyed object to an array. Set `version: 1` and `yardKind: "main"`, because legacy layouts could
only be saved from the main yard (`canSave = !BASE.isOutpost`, `BasePlanner.as:41`), and leave
`expansion` null. Leave `level` and `fort` absent on every node; the client fills them from the live
building on load, exactly as today, and writes them back on the next save. Drop entries whose
`slotid` is not an integer in `[0, 10)`, since the old client already discarded out-of-range slots on
load (`BasePlannerService.as:40,48-50`). Write the upgraded row back on the next save, never on read,
so a read-only session does not mutate the save.

Rows that fail to parse are quarantined into a `savetemplate_legacy` column rather than deleted, so a
player can be helped manually if a layout they cared about was malformed.

## 6. Phased delivery plan

| Phase | Contents | Effort |
|---|---|---|
| **1. Parity plus must-haves** | Canvas, panels, pan, zoom, place, move, store, clear, save, load, apply (L). F8 undo and redo on a command-based model (S). F6 multi-select and box select (M). F13 shortcuts (S). F15 zoom slider and minimap (S). F16 inventory search and stack badges (S). F3 cost and time summary (M). F17 pre-Apply checklist (S). F18 layout metadata and higher slot count (M). v2 format, server validation, new endpoints, DELETE slot, lazy migration (L). | 7 to 9 engineer-weeks, about a third server-side |
| **2. Make it a design tool** | F1 upgrade and fortify with worker-aware Apply (L). F2 batch upgrade (M). F4 defence coverage (M). F7 mirror, align, distribute (M). F9 copy between yards, outposts gain save and load (M). F14 touch gestures (M). Server-authoritative Apply (M). | 6 to 8 engineer-weeks |
| **3. Make it social** | F5 attack path preview (L). F12 compare layouts (M). F10 share codes (M). F11 gallery with rating, moderation and reporting (L). | 7 to 9 engineer-weeks, plus ongoing moderation that is not an engineering cost |

Three architecture requirements must land in phase 1 or become expensive later: the immutable layout
model with command-based mutation, the shared validation module used by both client and server, and
the props resolution layer that works for all four yard kinds.

## 7. Open questions

**Q1. Do planner-queued upgrades need a real job queue?** Today there is none: `WORKERS.Assign`
returns null when everyone is busy (`WORKERS.as:65-102`) and `QUEUE.CanDo` just reports the failure
(`QUEUE.as:76-113`). *Recommended:* add a queue capped at 10 pending jobs that auto-starts the next
when a worker frees, deducting resources at start rather than at queue time. This changes the wider
game, not just the planner, so it needs your sign-off before phase 2.

**Q2. How many layout slots?** Today 2, and 10 for subscribers, client-side only
(`BasePlanner.as:20-24`, `SubscriptionHandler.as:152`). *Recommended:* 5 free, 25 for subscribers,
enforced server-side. Five covers a main, a farming, a war layout and two experiments, which keeps
the subscriber tier meaningful without crippling the free tier.

**Q3. Ship the community gallery, or only share codes?** *Recommended:* share codes in phase 3,
gallery deferred until you have seen the sharing volume. A gallery needs moderation, reporting and a
text filter from day one, and a gallery nobody submits to looks worse than no gallery.

**Q4. Should Apply still be blocked while a non-decoration building is in the inventory?** Today it
is hard-blocked (`BasePlannerPopup.checkIfApplicable:132-143`). *Recommended:* downgrade to a
warning, so the player can apply a partial layout with a "3 buildings will stay in storage" line in
the dialog. The current rule forces a player to finish a layout in one sitting.

**Q5. Should the planner open outside build mode?** Today the only entry is a button on the Yard
Planner building's info popup, pushed only in `BUILD` mode and removed when that building is damaged
or counting down (`BUILDINGINFO.as:97,143,167-169` and `:99,111,118,125`). *Recommended:* read-only
viewing from anywhere, editing only in build mode, and drop the damaged-building rule entirely. It
is a punishment the player cannot see the reason for.

**Q6. Where do thumbnails live?** *Recommended:* not in the `savetemplate` jsonb column. Twenty-five
slots at 40 KB each is a megabyte of base64 in a row loaded on every base load. Put them in object
storage keyed by `{userId}/{slotid}` and store only the URL. If object storage is not available yet,
ship phase 1 without thumbnails rather than inflating the save row.

**Q7. Is the attack path preview worth the risk of being wrong?** It shows the route against an
intact base only, and real attacks destroy walls as they go. *Recommended:* build it and label it as
an estimate that assumes nothing is destroyed. The funnel count across 36 sampled drop points is the
genuinely useful output and does not depend on simulating destruction.

**Q8. Should a layout refuse to load into a yard with a smaller expansion?** *Recommended:* no. Load
it, place every node that fits, inventory the rest, and show a banner: "designed for expansion level
4, you are at level 2, so 7 buildings did not fit." Refusing to load is a dead end; loading with a
clear report shows the player what they are working toward.

## 8. Decisions (2026-09-23)

The owner answered the eight questions above. These override the recommendations in section 7 and
any conflicting statement in sections 3 to 6.

| # | Decision |
|---|---|
| Q1 | **No job queue.** Walls and traps get batch actions that complete instantly under the existing rule that jobs of 300 seconds or less finish free (every wall build/upgrade and trap placement is 5 seconds). Batch wall upgrade: select any set of walls, see the total cost, confirm once, all upgrade immediately with no worker. Re-arm traps: one button re-places every fired trap at its last position. Towers and other buildings keep one job per worker with no queue; Apply starts as many planned upgrades as there are free workers and reports the rest. F1 stands with this change; F2 (batch upgrade) is scoped to walls and traps. |
| Q2 | **10 layout slots for everyone**, enforced server-side. No subscriber tier for slots. |
| Q3 | **Tabled.** F10 (sharing) and F11 (gallery) move to the backlog with no decisions taken. |
| Q4 | **Apply stays hard-blocked** while any non-decoration building is unplaced. F17's checklist names each unplaced building and selects it in the inventory on click. **No auto-place.** Reason: a building left in the yard can collide with a building the new layout puts on the same cells. |
| Q5 | Planner opens **read-only from anywhere** and is **editable in build mode**. Owning the Yard Planner building unlocks it; its damage, build, upgrade or fortify state never locks it. Entry is a toolbar button, not the building's popup. **Last sentence revised 2026-09-24 — see Q12: entry is the toolbar control *and* the building's popup.** |
| Q6 | **No thumbnails.** The load dialog shows name, building count, expansion level and last-saved date, plus a read-only preview that opens the layout in the planner. Thumbnails go to the backlog with sharing. |
| Q7 | **F5 (attack path preview) is discarded.** The Wild Monster Baiter (building 19) becomes the defence simulator as a separate feature: full roster and champions, any drop point, chosen monster levels, replay, a per-tower results report, no lasting damage. |
| Q8 | Loading a layout into a smaller yard **places what fits, inventories the rest, and shows a banner** naming the expansion level it was designed for and the count that did not fit. With Q4, Apply then stays blocked until those are placed or removed. |
| Q9 | **Blueprint view added (decided 2026-09-23).** The planner gets a flat top-down "blueprint" view, drawn like the original Flash planner's `PlannerDesignView`: grass rectangle, plot outline, next expansion shown dashed, buildings as square tiles coloured by category with name and level. It is switchable with Tab or toolbar buttons alongside the isometric view. Reason: the isometric art makes footprints hard to read while placing. **Click-to-carry added** as an alternative to press-and-drag: a click picks the selection up, it follows the pointer, the next click drops it, a refused drop keeps it in hand, and right-click or Escape puts it back, matching the original planner's `dragBuilding` behaviour. Paint mode for placing from inventory is deferred until inventory placement exists. |
| Q10 | **Phase 1 remainder shipped (2026-09-23).** Batch wall upgrade and trap re-arm (server routes walls/upgrade and traps/rearm, instant under the free-finish rule, charged and pointed server-side, new `save.firedtraps` records where a trap fired), the F3 cost panel as a selection-based next-level summary, and F16 as search over placed buildings. Defaults taken on every open question are recorded in docs/design/yard-planner-phase1-remainder.md §6, notably: empire points are awarded for batch steps as the Flash client did; the wall type's display name is "Block"; nothing is stored or painted yet. |
| Q11 | **Planned upgrades shipped (2026-09-24).** Layout nodes carry `plan: { level, order }`; the inspector plans a building's upgrade; the bottom bar sums planned upgrades against holdings and free workers; Apply with `startUpgrades=1` walks plans in player order: free-finish steps complete instantly, longer steps start one per free worker, the rest wait or are skipped with a reason (partial by design, Q1). Fortify deferred until a fortification ladder exists. Plan: docs/design/planner-upgrades.md. Also: mirror/align/distribute (F7), zoom slider and minimap (F15), planner access gate and read-only mode, and the smaller-yard load report (Q8) all landed 2026-09-23/24. |
| Q12 | **Planner entry made visible (2026-09-24), revising Q5.** Owner review, verbatim: "It's hard for a new user to know how to go into layout mode" and "I really don't see the Plan button." Two doors now, not one. The toolbar's ghost "Plan" button becomes a primary-filled **"Layout"** control with a floor-plan glyph and a 44 px target under a coarse pointer; it reads "View layout" when the session is read-only and "Close layout" while the planner is open. The **Yard Planner building's popup gains an "Open layout planner" button**, which reverses the last sentence of Q5: players click that building expecting it to do something, and an inert popup teaches them the planner is elsewhere without saying where. The P shortcut and the Q5 access rule (Yard Planner owned, editable only in build mode, damage never locks it) are unchanged. Also fixed in passing: the yard's status readout was a child of the toolbar and `.cell-readout` pins itself to its positioned ancestor, so it rendered as a 102 × 213 box sitting on top of the entry control. Issue #46. |
| Q13 | **The planner teaches itself (2026-09-24).** Owner review, verbatim: "For the tooltip, possible to do a gif/video? your words aren't exactly helpful." A `title` is exact and still tells a new player nothing, so the planner now **shows** the move. The first opening puts up a dismissible card of six moves — select, box select, drag, click-to-carry, the group tools and Find — each a looping inline-SVG demo beside one line of text. "Got it" or the cross sets one `localStorage` flag, read *and* written through try/catch: a blocked store means show the card, never an exception on the way in. The `?` button reopens the same card and the old shortcut sheet is its second tab, so neither door is lost. The same demos pop up on hover, keyboard focus or a long press over each group tool button and each Align/Distribute menu row, with **its own picture for every align and every distribute** — "top edges" illustrated by a left-align is worse than no picture. No GIFs, no video, no library: rectangles on a grid, coloured from the same tokens as the rest of the chrome, with the motion in CSS so `prefers-reduced-motion: reduce` has one place to stop the loop and pin every element at its **end** state. Issue #49. |
| Q14 | **Storing and clearing shipped (2026-09-24).** Owner review, verbatim: "If the user has an existing yard, it is quite hard to shift stuff around. Is there a clear button?" Every move has to land legally, so rearranging a full yard is a puzzle with no free squares. The planner now has a **drawer**: Store (the toolbar button, the chip beside the selection count, or Delete/Backspace) lifts the selection off the plot into it, **Yard ▸ Clear yard** stores everything not fixed after a confirmation, and the drawer lists what it holds as stacks — "Block L1 × 400" — of which a click carries one back out, dropped by the next click on the yard. Each is one undo entry however many buildings it moves. Mushrooms are never stored. Three decisions taken in passing: **(a) no server change.** Storing is a planner-local edit, not a save: the server has no notion of a stored building and needs none, because Apply is blocked while the drawer holds anything, so the drawer never reaches it. **(b) Apply blocks on a stored decoration too**, although `unplacedBuildings` exempts decorations server-side. Apply does not *remove* a building it is not sent, it leaves it standing — so a stored decoration would come back at its old position, under whatever the plan has since moved onto those cells. Blocking is the only reading the yard can keep its side of; Q4 is unchanged for everything else. **(c) Saving a layout with a full drawer is refused** rather than the format extended, with a message naming the count. A layout node has no field that could say "this one is in the drawer", and teaching the schema, the validator and Apply one would be a server change for a layout that Apply could never accept anyway. Issue #50. |
| Q15 | **Range discs and a centre mark shipped (2026-09-26), ahead of F4.** Owner review 2026-09-24, verbatim: "give the ability to see the land and aerial range of defence towers (visibility toggleable by user)" and "add an indication for the center of the yard." F4 was scoped as a heat map over the pathing grid, which answers *how strong* a spot is; the owner asked *how far* a tower reaches, which is the question you have with a tower in your hand, so the circles F4 meant to replace are drawn now and F4's sampling stays open as issue #55. A toolbar **View** menu holds four switches: **Tower ranges** (R) with **Land** and **Air** nested under it, and **Centre of yard**. Ranges start off, the centre mark on, and all four are remembered in `localStorage` through try/catch. Decisions taken in passing: **(a) the class decides, not the stats table.** A disc is drawn for a `tower` with a `range` — the Siege Works carries one and is not a defence, and the Monster Bunker carries one and is. Land versus air is `_targetFlyerMode` (`Targeting.as:175-190`): 115 is air only, 21, 25 and 132 are both, the other eight are ground only. The planned level is used where a plan exists, else the level the yard has. **(b) No minimum ranges, and the ring is written anyway.** No `stats` block in `YARD_PROPS.as` carries one and `targetInRange` tests a single bound, so `TOWER_MIN_RANGE` ships empty with a test holding it so; the annulus is drawn the moment a row appears, because a dead zone is the one part of a range a player cannot deduce. **(b2) Colours and cost.** Land is warm orange `0xff7a18`, air is sky blue `0x3fb9ff`: neither is the selection amber nor the fault red, so a disc never reads as a warning. Fills sit at 0.10 alpha so 23 overlapping discs still show the grass, and a selected tower's disc is brighter (0.24 fill, 0.95 edge against 0.55). One `Graphics` per family holds every disc, batched by selected and unselected, and it is rebuilt only on a plan edit, selection change, drag step, view switch or toggle, never per frame. In the 3D view a disc is the 2:1 isometric ellipse; in the blueprint it is a circle. Both views draw discs and the centre mark under the buildings: in the blueprint that means between its ground and its tiles, because discs laid over the tiles washed out the towers in a dense base. **(c) The centre is yard (0, 0),** which the plot's `[-w/2, w/2) x [-h/2, h/2)` span makes exact and cell-aligned at every expansion. The centre mark is on by default and drawn under the buildings. Its crosshair is counter-scaled by the zoom so it holds the same size on screen at every zoom; the dashed axes are in world units, because they measure the plot rather than mark a point. The status line reads "centre" while the pointer is on that cell. Issues #4 and #54. |
