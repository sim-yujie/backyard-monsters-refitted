# Attack Flow — Redesign Proposal

A design document for the web client's attack screen (issue #32): choosing monsters, flinging them
at an enemy yard, watching the battle, and ending the attack. Today the web client has no attack
screen at all. This proposal is the redesign the rules spec asks for
(`docs/specs/combat.md` §10) built directly as the client's first implementation, so there is only
one fling flow to learn, not a Flash-shaped one migrated later.

All citations are `path:line` relative to the repository root. Current-behaviour claims cite the
Flash client or the server; claims about the shared combat engine cite its source under
`web/src/game/combat/rules/`, which this plan reads rather than reimplements. Where something new is
proposed, that is said explicitly.

This plan builds against the fling-log contract in `docs/design/server-combat.md` §3.10 — the
shape issue #23 fixed so #32 has one thing to build to, not two. It does not invent a second
contract, and it does not require any part of #23's server work to land first: phase 1 here is
client-authoritative, exactly as the Flash client is today.

Contents:

1. [Problem statement](#1-problem-statement)
2. [Design goals](#2-design-goals)
3. [Feature proposals](#3-feature-proposals)
4. [UI and UX design](#4-ui-and-ux-design)
5. [Data and server changes](#5-data-and-server-changes)
6. [Phased delivery plan](#6-phased-delivery-plan)
7. [Open questions](#7-open-questions)

## 1. Problem statement

### 1.1 What attacking is today (Flash)

An attack is entered with `POST /base/load` carrying `type=attack` or `type=wmattack` plus an
`attackData` payload the client builds from its own housed roster and stats
(`docs/specs/combat.md:133-163`, `client/scripts/ATTACK.as:199-222`). The monster panel is a
scrolling HUD list, one row per monster type, with a `+`/`-` button per row
(`combat.md:320-345`). Sending N monsters costs N clicks, one per monster, because `BucketAdd` is
called once per press (`combat.md:337-339`, `CREATUREBUTTON.as:106-125`); press-and-hold repeats at
roughly 20 adds a second after a ten-frame delay (`combat.md:332-334`). A champion is a second
button, a resource bomb is a three-click popup that **discards the entire monster bucket and
champion the moment it opens** (`combat.md:412-414`, `CATAPULTPOPUP.as:168-187`), and a siege weapon
is a two-click popup with its own clearing rule (`combat.md:477-488`). The spec's own §3 is explicit
that Map Room 2 has no wave system at all — its section is titled "Waves" precisely to say so
(`combat.md:466-475`: "There is no wave system in an attack."). What exists instead is a **drop**:
one fling of the current bucket. Drops are emergent — one, then another — and the flinger's payload
does not accumulate across drops in Map Room 2, so a 300-monster attack is several full reselections
from scratch (`combat.md:306-309`, `:474-475`, `:490-492`).

The representative mid-game attack the spec measures — four drops of about 25 monsters, one
champion, one bomb — costs **110 clicks** today (`combat.md:1511-1521`):

| Item | Count |
| --- | --- |
| `+` clicks | 100 |
| Champion `Send` | 1 |
| Drop clicks | 4 |
| Catapult sequence | 3 |
| End-of-attack popups | 2 |
| **Total** | **110** |

Ending an attack is two popups: the attack log, then `popup_attackend`
(`combat.md:1259-1268`). The five-minute timer (seven with the alliance power-up Declare War active
— `ap_declarewar` raises the attack countdown from 300 to 420 seconds in its `NORMAL` scope, adds
25% flinger capacity in its `OFFENSE` scope, and adds two cells of attack range either way,
`combat.md:1337-1339`) forces a retreat two minutes after it expires (`combat.md:1087-1101`, §10
rule 10). Section 10 of the spec names, click by click,
every one of the fifteen manual actions the redesign should remove or replace
(`combat.md:1467-1541`) and eleven rules that must survive the rewrite unchanged
(`combat.md:1410-1439`) — reproduced in full in §2 below, because they are this plan's constraints,
not its subject.

### 1.2 What exists in the web client today: nothing

- The Map Room 2 cell panel already has an Attack button. It is permanently disabled with the
  tooltip "Coming soon: attacking is a later task." (`web/src/ui/maproom/CellPanel.ts:26`, `:82`).
  This is the one piece of UI already reserved for this feature.
- `web/src/api/base.ts:9-57` has exactly two calls, `loadOwnYard` and `loadOwnBase`, both
  `type: BaseMode.BUILD` against the caller's own base. Neither `attackData` nor any attack mode is
  built anywhere in `web/src`. `web/src/api/types.ts:69-81` already declares
  `BaseMode.ATTACK` and `BaseMode.WORLD_MAP_ATTACK` as string constants, but nothing in the client
  ever sets `type` to either — they exist only because the enum is transcribed wholesale from
  `server/src/enums/Base.ts` (comment at `types.ts:68`).
  `BaseLoadRequest` (`types.ts:83-90`) has no `attackData` field and `BaseLoadResponse`
  (`types.ts:183-218`) has no `attackid`, `canattack` or `attpowerups` field.
- **The web client never calls `/base/save` at all**, in any mode
  (`docs/design/server-combat.md:43-44`, confirmed again while writing this plan: a search of
  `web/src` for the string finds nothing outside `docs/`). Building that call, for an attack save
  specifically, is new work this plan scopes.
- `SceneManager.goTo(name: string)` takes no second argument
  (`web/src/app/SceneManager.ts:70-75`); there is no way today to tell the next scene which base to
  open. Every existing scene loads a fixed target (`loadOwnYard()`), because none has needed anything
  else.

### 1.3 What the shared combat engine already provides

`web/src/game/combat/rules/` (issue #22/#23) is a deterministic battle simulator, already built and
tested, that this plan is the first client-side consumer of.

- **`createBattle(yard, options)`** (`web/src/game/combat/rules/engine.ts:320-1102`) returns a
  `Battle` with `apply(event)`, `step()`, `runTo(tick)`, `state()` and `checkpoint()`
  (`engine.ts:212-226`). This is exactly the incremental tick API a live renderer needs: advance by
  one tick, or run to an arbitrary tick, and read back health, loot, creep counts and per-tower
  reports at any point (`engine.ts:187-209`).
- **`AttackEvent`** is `types.ts`'s `FlingEvent` re-exported, so the engine consumes the same fling,
  bomb, siege and retreat events this plan's UI must produce, with no translation layer
  (`engine.ts:143-150`, `types.ts:440-468`).
- **`replayAttack(input)`** (`web/src/game/combat/rules/replay.ts:133-207`) runs a whole `FlingLog`
  over a yard and returns health, damage, loot, fired traps and a per-800-tick digest
  (`replay.ts:76-100`). It is what the server will call in Phase B (#23 §2.8) and what a Baiter-style
  self-test would call; this plan's live renderer calls the lower-level `createBattle` directly so it
  can draw between ticks, but both paths run the identical rule set.
- **Fidelity is documented, not assumed.** The engine's own top comment lists every place it departs
  from Flash, each numbered and cited (`engine.ts:81-138`). Three of those numbered notes matter
  directly to this plan and are called out again in §3.4 below: siege weapons are accepted as events
  and have **no effect** (`engine.ts:127-128`, note 8); putty bombs carry **no damage and no
  speed/damage buff** (`engine.ts:634-639`); and champion abilities beyond base damage and Krallen's
  looting are not modelled (`engine.ts:124-126`).
- The engine is deterministic by construction — no `window`, `Date.now` or `Math.random`, no
  trigonometry, everything driven by a seeded RNG (`web/src/game/combat/rules/index.ts:17-24`,
  `rng.ts`) — which is what makes "what the player watched is what the log can replay later" true
  from day one, per `docs/design/server-combat.md` §3.10's own framing.
- **Monster art is not a gap either.** No creep or champion in the Flash client was ever a vector
  MovieClip in the yard: every one is a pre-rendered PNG sprite sheet loaded by URL, and every sheet
  `SPRITES.as` references is already sitting in `server/public/assets/monsters/` — 61 of 61 checked,
  no SWF extraction needed (`docs/art/monster-sprites.md`, its own §1 "Bottom line"). What is missing
  is only the code that slices and animates those sheets in PixiJS, which is WP0/WP5 below (§F5).

Nothing in `web/src/game/yard/` draws a creep, a bomb or a drop ring **yet**, and the art that will
let it is not something this plan has to commission. `YardRenderer`
(`web/src/game/yard/YardRenderer.ts:39-370`) draws buildings, mushrooms and planner chrome only —
`show`, `draw`, `setHovered`, `setSelected`, `setView`, `pick`, `worldToYard`/`yardToWorld`, and
nothing about combat. That renderer is reused as-is to draw the enemy yard (§3.1); a new layer is
needed for everything that moves during a battle (§3.5, §5.4), built on the sprite sheets above.

## 2. Design goals

**Decided 2026-09-26: phase 1 stays client-authoritative.** The owner reviewed this premise directly
and accepted it — the client computes the battle's outcome and reports it on `/base/save`, exactly as
the Flash client does today, with no server-side verification or replay in this plan's scope. That
remains issue #23's Phase B, gated on this plan supplying the fling log (§5.3) and nothing more.

| # | Goal | Measure |
| --- | --- | --- |
| G1 | Every rule in spec §10 "Rules that must be preserved" holds exactly | The eleven rules below are unchanged; a reviewer checks each against the shipped code |
| G2 | Every Flash-era constraint spec §10 names as droppable is dropped | Hold-to-repeat frame counters, `SecNum`, the 80 Hz/1 Hz clock split, taunt/brag flows: none exist in the new client |
| G3 | The representative attack (four drops of ~25 monsters, a champion, a bomb) costs well under 20 clicks | §4.5's click table totals 14 |
| G4 | The client produces the exact fling log `docs/design/server-combat.md` §3.10 specifies | A fixture log built by the new client round-trips through `replayAttack()` with no shape changes |
| G5 | No server change ships in phase 1 beyond what already exists, and the client stays fully authoritative for the save (decided above) | §5.5; the one place this needed a decision is Open Question 2 |
| G6 | Every interaction has full touch parity | No control needs hover-only or drag-only input; §4.6 states this per interaction |
| G7 | The battle is watched, not resolved instantly | The engine's tick API drives a real-time (1x/2x) render; §F5 |

Rules that must be preserved (`docs/specs/combat.md:1410-1439`), verbatim in summary, unchanged by
this plan:

1. Loot is damage, one point of damage to a resource building is one unit of that resource.
2. Resource buildings stop being targets once emptied.
3. Walls do not count toward the damage percentage.
4. Specialists hit their class harder (×2 walls, ×2 towers, ×3 hunting creeps).
5. Preference falls back to "all buildings", and the fallback is sticky.
6. 90% is the victory and takeover threshold, and the two stay equal.
7. Damage protection tiers (4 attacks/hour → 1 hour; 50% damage → 36 hours; outposts 25% → 8 hours);
   attacking clears the attacker's own protection.
8. Traps only fire on ground units, heavy traps only on the five large monsters.
9. Flinger range is a function of level (4/6/8/10 main, 1/2/3/4 outpost).
10. The five-minute limit (seven with Declare War), hard retreat two minutes after expiry.
11. Wild monster camps regenerate after twelve hours and never get damage protection.

Flash-era constraints spec §10 names as droppable (`combat.md:1441-1465`) and this plan drops all of:
the 80 Hz accumulator and the two-clock split (the engine already runs one fixed-timestep clock,
`engine.ts:69-79`); the load-shedding hacks; `SecNum` obfuscation; the SWF integrity check;
building-type parallel-array indexing; isometric/cartesian conversions threaded through every system
(the engine keeps exactly two, `yard.ts:29-58`); the duplicated damage-percent calculation;
frame-counted press-and-hold; and Facebook taunt/brag flows.

## 3. Feature proposals

### 3.0 Overview

| # | Feature | Priority | Effort |
| --- | --- | --- | --- |
| F1 | Entering an attack from Map Room 2, from a bookmark, or from View yard | Must | M |
| F2 | Army composition panel | Must | L |
| F3 | Fling and deploy interaction | Must | M |
| F4 | Catapult and siege, coexisting with the monster bucket | Must | M |
| F5 | Watching the battle | Must | L |
| F6 | Ending the attack | Must | M |
| F7 | Timer, retreat and damage protection display | Must | S |
| F8 | Touch and phone parity | Must | woven into F2–F7 |

### F1. Entering an attack from Map Room 2, from a bookmark, or from View yard — Must, M

**For the player.** Three doors, one destination. Click Attack on any cell's panel in Map Room 2 —
a wild monster camp, an outpost, another player's main yard — and the enemy yard opens. Jump to a
saved bookmark first if that is how the cell was found; the same panel is there either way. Or open
View yard on any cell to look around read-only first, and if it turns out to be worth attacking,
click Attack from inside that look — which switches straight into the attack without returning to
the map.

**How it works, from the map.** `CellPanel`'s Attack button (`CellPanel.ts:82`) stops being
`disabledAction(...)` and becomes a real button that calls back to the scene with the cell's
`bid` (`CellPanel.ts:186`, `:238` — the field is already read and displayed, just not acted on). The
same preconditions the Flash client checks client-side before offering the button
(`docs/specs/maproom2.md:365-379`: attacking enabled, not protected, no truce, a flinger in range,
at least one monster or a healthy champion available) are re-derived from the cell payload and the
player's own roster already cached from the map load; every one of them is also enforced
server-side (`baseModeAttack.ts:71-104`, table at `docs/server-api.md:388-394`), so the client-side
check is UX only — a refusal the client missed still surfaces from the server's error, handled the
same way §4.7 describes.

A new API call, `loadAttack(baseid, attackData)`, is added to `web/src/api/base.ts` alongside
`loadOwnYard`/`loadOwnBase`, following their exact shape: `type: BaseMode.ATTACK` (main yards and
outposts) or `BaseMode.WORLD_MAP_ATTACK` (wild monster camps), `baseid`, and `attackData` built from
the roster the map already returned for cells in flinger range
(`docs/specs/combat.md:278-286`) — the same construction `ATTACK.AttackData()` does
(`combat.md:138-144`), reusing `monsterStats`/`championStats` already available client-side for the
stat block the server checks (`validateAttack.ts:25-91`, `combat.md:146-151`). A matching
`saveAttack(...)` is added for §3.6/§5.

**Entry from a bookmark needs no new work.** A bookmark only moves the camera to a saved cell
(`docs/specs/maproom2.md:590-605`; `web/src/game/maproom/Bookmarks.ts`, wired at
`web/src/app/scenes/MapRoom2Scene.ts:55-58`). Jumping to a bookmarked cell opens the same
`CellPanel` any other cell does, so Attack is reachable from it automatically once F1 ships — there
is no separate "attack from bookmark" flow in Flash either (`maproom2.md` has no such section).

**View yard: read-only, for any cell.** Today `CellPanel`'s View yard button is enabled only for
the caller's own cell — `setViewYardEnabled` is called with `payload.mine === 1`
(`CellPanel.ts:102`, `:110-124`), and every other cell shows the tooltip "Coming soon: only your own
yard opens in this build." (`OTHERS_YARD`, `CellPanel.ts:37`). This is decided now (Open Question 7):
that restriction is lifted. Flash's own `type=view`/`wmview` modes exist for exactly this — a
read-only look at any cell — and the server dispatches them to `baseModeView`, which does none of an
attack's work: no `attackData`, no range or protection check, no `attackid`, no session, no attack
log (`server/src/controllers/base/load/baseLoad.ts:71-74`, `:109-111`; `baseModeView.ts:19-37`).

Rather than a new scene, `web/src/app/scenes/YardScene.ts` is generalised to open a foreign, read-only
yard instead of always `loadOwnYard()` (`YardScene.ts:364`) — the access rule this needs was already
anticipated when the planner's read/write gate was written: `plannerAccess`'s own comment names "a
visit flow" as the reason `loadType` and `ownYard` are separate arguments, not one flag
(`web/src/game/yard/planner/access.ts:25-29`). A foreign view therefore composes for free with what
already exists: the Yard Planner opens read-only if the yard has one (`access.ts:74-76`'s existing
`READ_ONLY` branch), and the building panel already knows how to omit an action a session may not
take (`YardScene.ts:583-594`'s conditional `planner` option, the same pattern Open Question 10 points
at for the enemy building panel). The one addition is a toolbar **Attack** button, shown only when
the yard being viewed is not the player's own and the preconditions described above — protection,
truce, range, an available roster — currently pass.

**Decided 2026-09-26: no tower-range overlay, in View yard or in the attack itself.** The planner's
`RangeLayer` (`web/src/game/yard/planner/RangeLayer.ts`, shipped per Q15 of
`docs/design/yard-planner-redesign.md`) draws land and air range discs for the yard's *owner*, inside
the planner only. Neither the read-only View screen nor `AttackBattleLayer` (§F5) reuses it or draws
anything like it: handing an attacker a free read of the defender's tower coverage is a real
tactical advantage this plan chooses not to grant. If that is wanted later it is a new feature to
design and approve on its own, not a reuse of `RangeLayer` as it stands.

**Attacking from inside View yard needs a second load, and here is why.** `baseModeView` never runs
a range check, never mints an `attackid`, never starts the attack session that later authorises
`/base/save`, and never clears the attacker's own protection or writes an attack log — all of that is
`baseModeAttack`'s job alone, and it only runs on `type=attack`/`wmattack`
(`baseLoad.ts:76-81`, `:113-118`; `baseModeAttack.ts:57-207`). A View load's response cannot be
promoted into an attack after the fact — there is no such endpoint — so clicking Attack from inside
View yard issues the same `loadAttack(baseid, attackData)` call §"How it works, from the map"
describes, as a genuine second request. What makes this feel like one continuous motion rather than a
reload is that the View screen's already-rendered yard stays on screen while that second load
resolves in the background — usually well under a second, since it is the same `buildingdata`
fetched moments earlier, just with the attack's side effects now applied — and the scene then hands
off into the attack (§F5) with no intervening map screen.

**Where the target goes.** `SceneManager.goTo` takes no parameters (`SceneManager.ts:70-75`), and
extending it for one caller is more surface than a one-shot handoff needs. A small module,
`web/src/game/attack/attackTarget.ts`, holds the chosen `baseid` and cell kind between the click and
the new scene's `enter()`, the same shape `web/src/api/auth.ts:28`'s `getSession()` and
`web/src/api/http.ts:71-78`'s `authToken` already use for state that outlives one call:
`setAttackTarget(target)` from `MapRoom2Scene` or from `YardScene`'s new Attack button,
`consumeAttackTarget()` from the new scene, clearing it so a stale target cannot leak into an
unrelated visit. Its shape carries one optional field from the start — the already-resolved
`BaseLoadResponse`, when the caller (View yard) has just fetched one — so the attack scene can skip
re-fetching what it was just handed, without ever needing a second, incompatible shape later.

### F2. Army composition panel — Must, L

**For the player.** See every housed monster type and the champion in one list. Set how many of
each to send by typing a number directly, or with `+`/`-` buttons that auto-repeat and accelerate the
longer they are held, or by pressing Fill on that row; press Fill all to top up everything at once.
Watch the capacity bar update live. The selection survives opening the catapult or a siege weapon,
and survives a drop too — though what each row can still send may shrink, since a drop spends housed
monsters.

**How it works.** A new session object, `web/src/game/attack/AttackSession.ts`, holds the
composition as a plain `Roster` (`types.ts:210`) plus an optional champion choice, mirroring the
shape `web/src/game/yard/planner/PlannerSession.ts` already established for "one object holds the
state, the DOM panel reads `state()`" (`PlannerSession.ts:28-44`, `:304-327`). Unlike the planner,
this session needs no undo stack — a composition is cheap to reset and nothing here is destructive —
so it is considerably smaller.

Each row (one monster type, or the champion) is modelled on `InventoryPanel`'s stack rows — icon,
name, level, and a count (`web/src/ui/yard/InventoryPanel.ts:1-90`) — but where that panel's count
is a read-only tally reduced one at a time by a click, this row's count is a **quantity control**.
**Decided 2026-09-26, no slider:** a number box the player can tap and type an exact figure into
directly, flanked by minus and plus buttons that auto-repeat and accelerate while held — the
un-timed, accessible replacement for Flash's own frame-counted hold-to-repeat
(`CREATUREBUTTON.as:113-119`, dropped per G2), and a control that lets a player land on an exact
figure on a touchscreen, which a slider cannot do reliably. The row's maximum is
`min(housed count, remaining capacity / bucketCost(1))`, both numbers the engine already exposes —
`bucketCost(roster, levels)` and `flingerPayload()` (`engine.ts:295-306`) give the exact arithmetic
`BucketAdd`'s silent refusal used to enforce one click at a time (`combat.md:337-339`); the panel
computes it once per edit instead of asking the player to discover it by hitting a wall.

A capacity bar at the top of the panel shows total bucket cost against `flingerPayload()`
(`engine.ts:306` — capacity 2250 at the forced Map Room 2 flinger level 4,
`docs/specs/combat.md:301-304`), the same number `UI_TOP.as:252-257`'s bar already showed, just
computed from the shared stats module instead of client-held constants.

**Fill.** One Fill button per row and one Fill all action at the top. Filling walks rows in roster
order — the order the player's own housing already lists monsters, which is stable and repeatable —
adding each type up to its own maximum until the shared capacity is exhausted (Open Question 11 names
this the default because a random or best-damage fill order would make "fill" behave differently
each press).

**After a drop, nothing resets — but every row reflects what is actually left.** Decided 2026-09-26:
the composition on screen after a drop is the same numbers the player set, never auto-cleared and
never auto-refilled. What changes is each row's ceiling, reclamped the instant the drop lands to
`min(remaining housed count, remaining capacity / bucketCost(1))` — the same arithmetic §"How it
works" above already computes on every edit, just re-run once more after the fling. A row whose true
count fell below the number showing is greyed and carries a plain note naming what is actually left
— "20 left" — rather than silently rewriting the figure the player typed out from under them. A row
whose housed count reaches zero shows 0 and stays disabled until, if ever, more of that type comes
back into range. This is the direct opposite of `BucketAdd`'s silent refusal past a wall
(`combat.md:337-339`): the wall is explained, not just hit.

**Champion.** At most one may be chosen — the panel enforces this as a single-select control (a
radio group, not checkboxes), matching the rule that only one champion may ever be on the field
(`combat.md:341-348`, `types.ts:221-227`'s `ChampionOnField` comment: "at most one per attack"). No
`Send`/`Hold` toggle is needed; picking a different champion simply replaces the choice, and a
picked champion can be un-picked with the same control.

**Last army.** A "load last army" action recalls the most recent composition sent in a *previous*
attack, stored in `localStorage` under a per-player key, read and written through try/catch exactly
as the planner's own `localStorage` flags already are (`docs/design/yard-planner-redesign.md`, Q13's
dismissible-help-card flag and Q15's view-toggle memory). A blocked or cleared store degrades to an
empty composition, never an error.

### F3. Fling and deploy interaction — Must, M

**For the player.** Tap or click a spot on the enemy yard to send the current composition there.
The composition stays selected — sending another drop is "tap again", not "reselect from
scratch."

**How it works.** The one click in the old flow that carries real tactical meaning is the drop point
(`combat.md:1540-1541`), so this plan keeps exactly that click and removes every other one. Rather
than a ring that follows the mouse continuously (`DROPZONE.as:58-70`) — which has no equivalent
under a finger, since touch has no hover — placement is **tap-to-drop**: hovering (mouse) previews
the ring and whether it is legal, and a touch simply shows the same preview centred on the last
touch point before the release that commits it. This is the same touch/mouse duality
`web/src/game/yard/planner/PlannerInput.ts`'s carry-and-drop already solved for building placement
(`Grab`, referenced at `PlannerSession.ts:22`) and reused here rather than reinvented.

A new `web/src/game/attack/AttackInput.ts`, built on the same pointer-event pattern as
`web/src/game/yard/YardInput.ts:36-137` (one `pointerdown`/`pointerup`/`pointermove` set, a drag-slop
test to tell a tap from a pan), computes the drop radius from `dropRadius(bucketCost(...))`
(`engine.ts:290-303`) and rejects a centre that overlaps a building footprint, the same rule
`DROPZONE.as:64` enforces and `docs/design/server-combat.md` §3.10 writes into the fling-log contract
(`x`, `y` "a fling centre may not overlap a building footprint",
`server-combat.md:768`). On a valid drop, `AttackSession` appends a `fling` `FlingEvent`
(`types.ts:440-452`) to its `FlingLog`, hands it to the running `Battle.apply(event)` (§F5), and —
unlike Flash — **does not clear the composition**, only reclamps it to what is still available
(§F2's "after a drop" rule). The player sends the same numbers again with one more tap, or edits the
panel first.

**There is no wave to build.** As §1.1 already cites (`combat.md:466-475`, "There is no wave system
in an attack."), a drop is emergent by design: nothing here numbers a drop or shows a drop-count
bar. Each drop is simply another `fling` event, matching the spec's own account of an attack as one
fling then another, not a scripted sequence.

### F4. Catapult and siege, coexisting with the monster bucket — Must, M

**For the player.** Open the bomb picker or the siege weapon picker without losing the monster
composition, the champion choice, or the other tool's pending selection. All three are independent.

These are two different systems in the live game, not two names for one thing. The **Catapult** is
the resource-bomb popup — twig, pebble and putty tiers, bought from the attacker's own resource pool
(`combat.md:396-439`). **Siege weapons** — Decoy, Vacuum and Jars — are a separate, building-granted
arsenal with their own quantities and drop rules (`combat.md:440-464`). Flash gives each its own
popup and its own two- or three-click sequence for exactly this reason, and this plan keeps that
separation rather than merging them into one "special weapons" picker.

**How it works.** This is the direct fix for the flow's worst click loss: today, opening the
catapult grid silently empties the bucket and un-sends the champion
(`combat.md:412-414`, `CATAPULTPOPUP.as:168-187`), and every bucket edit cancels a pending bomb or
siege weapon in the other direction (`combat.md:477-488`'s mutual-exclusion table). Spec §10
recommends exactly this fix — "the three tools should coexist" (`combat.md:1537-1539`) — and this
plan takes it as the default with no alternative considered.

Two new panels, `web/src/ui/attack/CatapultPopover.ts` and `SiegePopover.ts`, are **not** built on
`web/src/ui/Popover.ts`'s hover/press bubble despite the name similarity — that component exists for
*hints* shown alongside a control a player is about to use for something else
(`Popover.ts:1-37`'s own framing: "a small bubble that opens under a control on hover"), and a bomb
or siege choice is the primary action, not a hint. They are docked panels in the same family as
`BuildingPanel`/`InventoryPanel` (`web/src/ui/Panel.ts`), opened by a direct tap, so touch parity
needs no special case: a tap that opens a hint bubble and a tap that opens a real panel are the same
gesture either way, but only the panel behaves correctly when a player has no hover at all.

Picking a bomb tile or a siege weapon raises its own drop ring exactly as F3 does — same
`AttackInput` drop-target logic, keyed to whichever tool is pending — and on drop appends a `bomb` or
`siege` `FlingEvent` (`types.ts:453-467`) without touching the monster bucket's state at all. The
three tools' pending state lives as three independent fields on `AttackSession`, not a shared one
that any edit clears.

**A gap in the engine, flagged rather than hidden.** The battle engine already accepts `bomb` events
and applies real damage for the twig and pebble tiers (`engine.ts:641-652`), but **putty bombs (the
speed/damage buff) apply no effect at all** — the engine's own comment says so plainly: "Putty bombs
carry no damage at all; their slow is not modelled" (`engine.ts:639`, fidelity note 8 at
`engine.ts:122-129`). **Siege events are accepted and ignored outright** — no Decoy, Vacuum or Jars
effect exists in the engine today (`engine.ts:147-148`: "A `siege` event is accepted and ignored").
This plan still ships the siege and putty-bomb pickers, and still logs their events into the
fling log — because the contract in `docs/design/server-combat.md` §3.10 is fixed either way, and a
future engine update should make old logs replay correctly without the client changing — but the UI
marks both as having no battle effect yet (§4.4), and a follow-up issue against the shared rules
module (not this plan, and not gating it) is the right place to implement them. Shipping the picker
with an honest "no effect yet" label is judged better than withholding it until the engine catches
up, because the fling-log contract and the UI shell are useful now and the effect is a pure addition
later.

### F5. Watching the battle — Must, L

**For the player.** After a drop, see the monsters walk across the enemy yard, attack, take
damage, and (for towers) fire back, at real speed or twice real speed — not an instant number, and
not a fast-forward past the content either. No range discs are drawn over the enemy yard (§F1's
decision); what is on screen is only what the battle itself is doing.

**How it works.** A new `web/src/game/attack/AttackBattleLayer.ts` sits on top of the existing
`YardRenderer` and owns exactly what the yard renderer does not: creep and champion sprites, a
resource-bomb flash, a siege-weapon marker, and the drop-ring preview from F3/F4. It never draws a
building — that stays `YardRenderer`'s job, called with the same enemy `Yard` model `readYard()`
already builds from a `BaseLoadResponse` (`web/src/game/yard/yardModel.ts:38-138`, `:210`),
unmodified. The two layers read the same `EngineYard`/`CombatYard` positions
(`web/src/game/combat/rules/yard.ts:243-269`'s `fromIso`/coordinate helpers) so a creep's isometric
position and a building's isometric position are computed the same way.

**The art is real, not placeholder.** §1.3 already establishes that the original per-monster PNG
sprite sheets exist untouched in `server/public/assets/monsters/`, loaded exactly as `SPRITES.as`
describes (`docs/art/monster-sprites.md`). `AttackBattleLayer` draws from WP0's generated sprite
table (below) through PixiJS texture grids: one column per facing direction (30, 32, or 16 depending
on the monster, `docs/art/monster-sprites.md` §1 "Frame selection"), one row per animation frame.
Classic creeps (C1-C12 and others with a single pose per direction) simply glide, unanimated, exactly
as Flash drew them; flying creeps additionally get the sine-wave hover bob Flash used to keep them
from looking rigid in the air (`CreepBase.as:262-264`, cited already in `docs/art/monster-sprites.md`
§1 "Flyers and shadows") plus their separate shadow sheet. Champions get their walk and attack rows
where the sheets provide them. There are no per-monster death frames in the source art — Flash played
a shared particle splat instead of a death animation (`EFFECTS.CreepSplat`, `EFFECTS.as:54-79`,
`MonsterBase.as:1234`) — so `AttackBattleLayer` does the same: one shared splat effect on every death,
not per-monster art that never existed.

`AttackSession` owns one `Battle` (`createBattle(engineYard, options)`, `engine.ts:320`), created the
moment the attack opens with `seed` from Open Question 1's answer. Each render frame, the scene calls
`battle.runTo(currentTick)` where `currentTick` advances by `deltaSeconds * TICKS_PER_SECOND *
speedMultiplier` (`stats.ts:60`: 80 ticks per second), then reads `battle.state()`
(`engine.ts:188-209`) for health, creep positions is not directly exposed by `state()` — creep
positions live inside the engine's closure — so `AttackBattleLayer` additionally needs a small,
new **read-only creep snapshot** the engine does not currently expose (a list of `{id, x, y, hp,
monsterId, flying}` per living creep). This is a small, additive change to `Battle.state()` or a
sibling accessor in `engine.ts`, scoped to WP5 below and owned by whoever lands it, not a rewrite of
the engine's internals.

**Speed controls. Decided 2026-09-26: two speeds, 1x and 2x, no pause, no skip-to-end.** The attack
clock keeps running in battle time either way — 2x means the real-world wait is half as long, not
that content is skipped — and there is no way to pause or jump straight to the result. Mechanically
this needed nothing new: the render loop is already "advance to a tick, then read state" rather than
a fixed real-time simulation, so the toggle is exactly "advance the target tick faster per frame";
`runTo` already loops `step()` until the target (`engine.ts:1095-1097`).

### F6. Ending the attack — Must, M

**For the player.** One screen at the end of the attack: what was destroyed, how much was looted,
how much damage was dealt, and one Return-to-map action. Not two popups — and the attack ends the
moment there is genuinely nothing left that could change, not only when the clock runs out.

**How it works. Decided 2026-09-26, the exact rule:** the attack ends automatically the instant any
of these is true — no creeps are alive on the field, the player has no housed monsters left within
flinger range to send, and no bomb or siege weapon remains unused; **or** damage reaches 100%; **or**
the timer expires. Only the third of the three is `battle.state().over` on its own
(`engine.ts:208`, `:978-1013`'s countdown-then-no-attacker-left logic, matching `ATTACK.Tick`'s rule,
`combat.md:1103-1120`) — the engine watches the battlefield, not the attacker's remaining housing or
bomb/siege inventory, so on its own it has no way to end the attack early just because the player is
provably out of everything to send. `AttackSession` therefore checks the first two conditions itself,
every tick: `battle.state().creepsAlive === 0` (`engine.ts:1049`, the field is empty) together with its
own bucket and tool-inventory state for the first, and `damagePercent()` over `battle.state().health`
(`damagePercent.ts`, the same function `replay.ts:188` already calls) against 100 for the second —
and ends the attack the moment either holds, which in the common case is well before the five-minute
clock would have. A new `web/src/ui/attack/EndAttackPanel.ts` replaces the Flash pair — the attack log
popup and `popup_attackend` (`combat.md:1259-1268`) — with one modal: damage percentage, resources
looted (from `battle.state().loot`), buildings destroyed, and one Return-to-map button. This is the
one click at the end of the click table in §4.5, against Flash's two.

### F7. Timer, retreat and damage protection display — Must, S

**For the player.** See the countdown, see it turn to a warning near the end, and have a Retreat
button that is always available — not only near the end, and not gated on anything — and works
immediately rather than waiting for the hard cutoff. Decided 2026-09-26: retreating asks for one
confirmation, since it ends the attack early and cannot be undone (Open Question 9).

**How it works.** The countdown shown is `ATTACK_COUNTDOWN_SECONDS` (300) or
`DECLARE_WAR_COUNTDOWN_SECONDS` (420) depending on whether the attacker's Declare War powerup is
active (`stats.ts:71-72`, `combat.md:1087-1101`), counting down to the hard retreat at
`RETREAT_GRACE_SECONDS` (120) past that (`stats.ts:81`, `combat.md:1099`). A Retreat button appends a
`retreat` `FlingEvent` (`types.ts:468`) immediately — `apply()`'s handling of it already marks every
attacking creep `gone` on the next tick (`engine.ts:1019-1024`) — rather than the old two-step
"`RetreatAll` then `End`" (`combat.md:1122-1133`). Damage protection is shown for what it is: a
display of the rule from `combat.md:1274-1299`, not a client-side timer the client enforces, since
protection is only ever granted server-side, on the final save (`baseSave.ts:261-263`).

**A risk worth naming plainly here rather than only in §7's table.** `ATTACK_MAX_SECONDS` (420 +
120 = 540 seconds, `stats.ts:84`) is the longest a Declare War attack's countdown-plus-retreat-grace
can legitimately run. The attack session that authorises the final `/base/save` is valid for exactly
420 seconds (`ATTACK_SESSION_WINDOW = ATTACK_TIMEOUT`, `docs/server-api.md:272-274`). A Declare War
attack that runs past 420 seconds before its final save is sent would have that save refused as
`expired` (`checkAttackBinding`, `docs/server-api.md:284-289`) even though the battle itself is still
a legitimate one under the game's own rules. This is a pre-existing property of the server, not
something this plan introduces, but it is this plan that first builds a client honest enough to run
right up against it. §7, Open Question 2 gives the default: a client-side safety margin, not a
server change.

## 4. UI and UX design

### 4.1 Screen layout — View yard (read-only), desktop and phone

The screen §F1 opens for a read-only look at any cell — `YardScene` generalised, not a new scene — has
no Army panel and no timer: nothing here is an attack yet, only a button that starts one.

```
Desktop:
┌──────────────────────────────────────────────────────────────────────┐
│  HUD   resources · scene nav                                          │
├──────────────────────────────────────────────────────────────────────┤
│                                                                        │
│                                                          ┌───────────┐│
│                    OTHER PLAYER'S YARD                   │ Building  ││
│                    (isometric, read-only)                 │ info      ││
│                                                          │ (tap a    ││
│                                                          │ building) ││
│                                                          └───────────┘│
│  [View layout]                                  [ Attack ]            │
│  status: 400 buildings · zoom · hint                    [zoom][mmap] │
└──────────────────────────────────────────────────────────────────────┘

Phone:
┌───────────────────┐
│  ⋯                 │
├───────────────────┤
│  OTHER PLAYER'S    │
│  YARD (read-only)  │
├───────────────────┤
│ [View layout] [Attack] │
└───────────────────┘
```

The toolbar keeps the existing "View layout" control (Q5 of `docs/design/yard-planner-redesign.md`,
unchanged) and gains one new button beside it. Attack is omitted entirely, not merely disabled, when
the client-side preconditions refuse it (protected, truced, out of range, nothing to send) — the same
choice `CellPanel` already makes for its own affordances rather than showing a permanently greyed-out
control with no reason attached.

### 4.2 Screen layout — desktop, the attack itself

```
┌────────────────────────────────────────────────────────────────────────────┐
│  HUD   resources · scene nav            ⏱ 04:32                [Retreat]   │
├────────────────────────────────────────────────────────────────────────────┤
│                                                          ┌─────────────────┐│
│                                                          │ Army            ││
│                    ENEMY YARD                            │ C1 [-][30][+]   ││
│                    (isometric, YardRenderer)              │        [Fill]  ││
│                                                          │ C4 [-][ 5][+]   ││
│                                                          │        [Fill]  ││
│                    (creep sprites, drop ring:             │ Champion    ▸  ││
│                     AttackBattleLayer)                    │ [  Fill all  ] ││
│                                                          ├─────────────────┤│
│                                                          │ [  Catapult  ]  ││
│                                                          │ [   Siege    ]  ││
│                                                          └─────────────────┘│
│  status: 400 buildings · zoom · hint                        [zoom][mmap]   │
└────────────────────────────────────────────────────────────────────────────┘
```

Each row is a number box flanked by `-`/`+` (auto-repeating, accelerating while held) and its own
Fill button — never a slider (Decided 2026-09-26, §F2).

The layout mirrors `YardScene`'s own furniture placement: HUD across the top
(`web/src/ui/Hud.ts`), a status readout bottom-left (`YardScene.ts:184-186`), zoom control and
minimap bottom-right (`YardScene.ts:452-478`), and a docked right-hand panel
(`YardScene.ts:571-596`'s `BuildingPanel` pattern, reused here for the Army panel). Nothing about the
chrome is novel; only the Army panel, the Catapult/Siege panels, and the battle layer are new.

### 4.3 Screen layout — phone, the attack itself (≈400 px wide)

```
┌───────────────────┐
│ ⏱ 4:32       [≡]  │   HUD collapses to the timer and an overflow menu
├───────────────────┤
│                    │
│    ENEMY YARD      │
│                    │
│                    │
├───────────────────┤
│ ▲  Army (30 C1)    │   collapsed bottom sheet, tap or drag up to open
└───────────────────┘

expanded:
┌─────────────────────┐
│  ▼  Army            │
│  C1 [-][ 30][+][Fill]│
│  C4 [-][  5][+][Fill]│
│  Champion: Krallen ▸│
│ [Fill all][Bomb][Siege]│
│  Tap the yard to drop│
└─────────────────────┘
```

Same control, no slider: a typeable number box, `-`/`+` either side, a Fill button per row.

The bottom-sheet pattern is new to this plan, but the underlying primitive — a docked panel that can
collapse to a small tab — already exists in spirit in the planner's inset-reporting bars
(`YardScene.ts:141-145`'s `inset` tracking, `PlannerBar` reporting its own height back to the scene
so the canvas fit recomputes around it). The Army panel reports its own height the same way so the
enemy yard's fit-to-screen zoom (`applyZoomLimits`, `YardScene.ts:499-518`) leaves room for whichever
state — collapsed or expanded — the sheet is in.

### 4.4 Panel inventory

| Panel | Desktop position | Phone position | Notes |
| --- | --- | --- | --- |
| View yard toolbar | Toolbar, beside "View layout" | Toolbar row | F1; read-only, one Attack button, shown only when attackable |
| Army composition | Docked right | Bottom sheet | F2; number box + `-`/`+` per row, per-row Fill, Fill all, champion, last-army — no slider |
| Catapult picker | Docked right, replaces Army temporarily | Bottom sheet | F4; bomb tiles, "no effect yet" badge on putty tiers |
| Siege picker | Docked right | Bottom sheet | F4; "no effect yet" badge on all three weapons until the engine implements them |
| Enemy building info | Docked right | Bottom sheet | Read-only `BuildingPanel` reuse, no upgrade actions offered |
| Battle speed toggle | HUD strip | HUD strip | F5; 1x/2x only, no pause, no skip-to-end |
| End-of-attack | Centred modal | Full-screen modal | F6; damage %, loot, buildings destroyed, one Return-to-map action |
| Timer / retreat | HUD strip | HUD strip, overflow for Retreat on very small widths | F7; Retreat always available, one confirmation |

### 4.5 Click count for the representative attack (after this redesign)

Same scenario spec §10 measured — four drops of about 25 monsters, one champion, one bomb — counted
the same way (from the moment the attack screen is open):

| Item | Count |
| --- | --- |
| Composition gestures, drop 1 (2 monster-type quantities + 1 champion pick) | 3 |
| Drop 1 | 1 |
| Repeat last + drop, drops 2–4 (×3) | 6 |
| Catapult sequence (open, pick tile, drop) | 3 |
| End-of-attack screen | 1 |
| **Total** | **14** |

Fourteen, against Flash's 110, or its own hold-to-repeat floor of roughly 11 (8 long presses plus the
champion, drop and catapult clicks, `combat.md:1523-1524`). The gain over hold-to-repeat is not from
typing versus holding a key — it is from never re-entering the composition for drops 2 through 4, and
never losing it to the catapult.

### 4.6 Touch and phone parity, stated per interaction

| Interaction | Mouse | Touch |
| --- | --- | --- |
| Set a monster's quantity | Click `-`/`+` (hold to auto-repeat), or type in the number box | Tap `-`/`+` (hold to auto-repeat, same element, pointer events), or tap the number box for the on-screen keyboard |
| Fill a row / Fill all | Click | Tap, ≥44 px target |
| Choose a champion | Click a radio row | Tap the same row |
| Preview the drop ring | Hover shows the ring following the cursor | The last touch point shows the same ring before release |
| Commit a drop | Click inside the ring | Lift the finger inside the ring |
| Open Catapult / Siege | Click | Tap — a real panel opens, not a hover bubble (§F4) |
| Switch 1x / 2x speed | Click the speed toggle | Tap the same toggle |
| Retreat | Click | Tap, confirmed once (destructive, ends the attack early) |

Nothing in this plan depends on hover as the *only* way to reach something, and nothing depends on a
continuous drag with no release event, which is the one interaction (Flash's cursor-following ring)
that has no touch equivalent at all and is why F3 redesigns it as tap-to-drop rather than porting it.

### 4.7 Errors on the attack path

The same errors the Flash client already gets are shown, translated into the client's existing
notice pattern (`web/src/ui/maproom/Notices.ts`, already used by both `MapRoom2Scene` and
`YardScene` for load failures): `baseProtectedErr`, `baseUnderAttackErr`, `userOnlineErr`,
`truceActiveErr` on entry (`docs/server-api.md:388-394`), and `attackNotBoundErr` on a save that
missed its session window (`docs/server-api.md:296-311`) — this last one is exactly what Open
Question 2 is about avoiding in the common case, but the client must still handle it gracefully when
it happens (a clear "this attack expired before it could be saved" notice, not a silent retry, since
retrying blind is what the Flash client already does badly, `docs/server-api.md`'s `ApiError`
comment at `web/src/api/http.ts:7-16`).

## 5. Data and server changes

### 5.1 View mode versus attack mode on `/base/load`

Both are existing, unchanged endpoints — `type` is the only thing that varies — but they run
different code with different guarantees, which is why §F1 treats moving from one to the other as a
second request rather than a mode flag on one load. `baseLoad`'s dispatch:

| `type` | Handler | What it does |
| --- | --- | --- |
| `view`, `wmview` | `baseModeView` (`server/src/controllers/base/load/baseLoad.ts:71-74`, `:109-111`; `baseModeView.ts:19-37`) | Finds or regenerates the save row. No `attackData`, no range/protection/truce check, no `attackid`, no session, no attack log, no protection cleared. |
| `attack`, `wmattack` | `baseModeAttack` (`baseLoad.ts:76-81`, `:113-118`; `baseModeAttack.ts:57-207`) | Requires and validates `attackData` (`validateAttack`, `baseLoad.ts:79`, `:116`); refuses on protection, an active attack, the defender being online, a truce, or range, all before any write (`baseModeAttack.ts:71-104`); on success mints `attackid`, starts the attack session that later authorises `/base/save` (`services/base/attackSessionStore.ts`, `docs/server-api.md:267-277`), appends to `save.attacks`, clears the attacker's own protection, and writes an attack log. |

Both responses spread the same `@FrontendKey` save fields through `mapSaveData`
(`docs/server-api.md:198-212`), so the *shape* the client reads — `buildingdata`,
`buildinghealthdata`, `resources`, `champion`, and so on — is identical either way. What View's
response lacks is `attackid` and everything downstream of it: without a session, a `/base/save`
against this row would be refused outright (`checkAttackBinding`'s `no-session` case,
`docs/server-api.md:284-289`). That is the one fact that decides §F1's design: a foreign yard can be
*drawn* from a View load, but it can only be *attacked* by a fresh Attack load.

### 5.2 What the Flash client sends today, which this plan matches

**Decided 2026-09-26: phase 1 stays client-authoritative**, as §2 already states — the client
computes the outcome and reports it, exactly as Flash does — so the new `/base/save` call must build
the same fields the server's attack-save
path already understands (`Save.attackSaveKeys`, `docs/server-api.md:241-243`; the per-key handler
table at `docs/server-api.md:231-239`; the controller at `server/src/controllers/base/save/baseSave.ts:124-264`):

| Key | What the client computes it from | Server behaviour today |
| --- | --- | --- |
| `attackid` | Echoed from the load response | Consistency check only (`docs/server-api.md:291-294`) |
| `over` | `AttackSession`'s combined end condition (F6: nothing left to send, or 100% damage, or `battle.state().over`), or a manual Retreat | Clears `attackid`, ends the session, grants defender protection (`baseSave.ts:261-271`) |
| `buildingdata` | The enemy yard's post-battle state | Non-trap changes ignored; only a fired trap's removal is honoured (`buildingDataHandler.ts`, `docs/server-api.md:236`) |
| `buildinghealthdata` | `battle.state().health` | Written verbatim (`docs/server-api.md` default branch) |
| `damage` | `damagePercent()` over the same yard (`damagePercent.ts`) | Written verbatim |
| `destroyed` | `derivedDestroyed(damage, kind)` (`replay.ts:194`, wild/outpost only) | Written verbatim, drives Map Room 3 takeover |
| `monsters` | Defender's housing/bunker after consumption | Written verbatim onto the defender |
| `champion` | Defender's champion hp | Only a **lower** hp is honoured (`championHandler.ts`, `docs/server-api.md:237`) |
| `attackerchampion` | Attacker's own champion hp after the battle | Overwrites `userSave.champion` verbatim (`baseSave.ts:162-166`) |
| `attackcreatures` | **Not sent in Map Room 2** (`combat.md`'s own note, `server-combat.md:73` row) | — |
| `monsterupdate` | `[{baseid, m}]` per attacker cell in range, housing minus what was flung | Written to attacker's own row and other bases, clears their `protected` (`baseSave.ts:214-215`, `updateMonsters.ts`) |
| `attackloot` | `battle.state().loot` | Added to the attacker's pool, uncapped (`attackLootHandler.ts`, `baseSave.ts:222-224`) |
| `resources` | Defender's loss (negative of `battle.state().defenderLoss`) | Losses only, capped, floored at 0 (`defenderLootHandler.ts`, `baseSave.ts:226-235`) |
| `attackreport` | A plain-text summary built from the fling log's own events | Written verbatim onto the defender (`docs/server-api.md`'s "Save write keys", default branch) |
| `attackersiege` | Attacker's siege inventory after use | Overwrites `userSave.siege` (`baseSave.ts:178-182`) |

### 5.3 The one new field: `flinglog`

`docs/design/server-combat.md` §3.10 fixes the shape:

```json
{
  "v": 1,
  "seed": 1834027731,
  "events": [
    { "t": 480,  "kind": "fling",  "x": -615, "y": 115, "r": 100,
      "monsters": { "C1": 30, "C4": 5 }, "champion": { "t": 5, "l": 5 } },
    { "t": 2400, "kind": "bomb",   "id": "pb1", "x": 180, "y": -480 },
    { "t": 3100, "kind": "siege",  "weapon": "jars", "x": 180, "y": -480 },
    { "t": 9000, "kind": "retreat" }
  ]
}
```

`AttackSession` accumulates this from the exact events `AttackInput` produces (§F3/§F4) — no
translation, because `AttackEvent` in `engine.ts:150` is `FlingEvent` — and resends it in full on
every save, per the contract's own rule ("resent in full on every save",
`server-combat.md:747-748`). `flinglog` is **not** on `Save.attackSaveKeys` today, so a phase-1
server that has not landed #23's WP5 simply never reads it — sending it now is inert extra data, not
a compatibility risk, and it is what lets #23's Phase B replay be "a wiring job" once it lands
(`server-combat.md:148-149`) rather than a client rewrite. Open Question 3 covers verifying the
current schema does not reject the extra field.

### 5.4 New client-side state

None of this touches the server; all of it is new files under `web/src/game/attack/` and
`web/src/ui/attack/`:

- `AttackSession` — composition (`Roster` + optional champion), the three tools' independent pending
  state, the running `Battle`, the accumulating `FlingLog`, the countdown.
- `attackTarget` — the one-shot scene handoff singleton (§F1).
- A small addition to `Battle`'s public surface (or a sibling read function) exposing live creep
  positions for the renderer (§F5) — the only change to `web/src/game/combat/rules/` this plan asks
  for, and it is additive: existing callers (`replayAttack`, any future Baiter) are unaffected.
- `localStorage` key for "last army" (§F2), namespaced per player id the same way other client-only
  preferences already are.

### 5.5 No server change is required to ship phase 1

`/base/load` with `type=attack`/`wmattack` and `/base/save` on an attack row are both live, unchanged
endpoints (`docs/server-api.md:193-194`, `:241-324`). `BaseMode.ATTACK` and `WORLD_MAP_ATTACK` already
exist server-side (they are transcribed from there, `web/src/api/types.ts:68`). The one place a
server change was considered and rejected for phase 1 — extending the 420-second attack session
window to cover Declare War's full 540-second worst case — is Open Question 2; the default there is a
client-side margin instead, specifically so this plan needs no companion server PR to ship.

## 6. Phased delivery plan

Phase 1 is a complete, playable attack against an enemy yard, client-authoritative exactly as Flash
is today, with the redesigned low-click flow throughout. Phase 2 is anything that depends on issue
#23's server-side work landing, or is polish that does not block a first playable attack.

| # | Package | Contents | Depends on | Size |
| --- | --- | --- | --- | --- |
| WP0 | Monster sprite table | `web/tools/gen-monster-sprites.mjs` (parses `client/scripts/SPRITES.as`'s `_sprites.X = new SpriteData(...)` lines, resolves `FUBAR_X/Y`, reads each PNG's own size, modelled on `web/tools/gen-building-art.mjs`), `web/src/game/attack/monsterSpriteData.ts` (generated, like `buildingArtData.ts`), `web/src/game/attack/monsterSprites.ts` (the hand-written animation table — direction count per monster, 30/32/16; column from facing angle; row from state and tick; champion walk/attack rows — plus its tests), following the route `docs/art/monster-sprites.md` §3 already lays out | Nothing | S/M |
| WP1 | Entry and API plumbing | `web/src/api/types.ts` (attack fields on request/response), `web/src/api/base.ts` (`loadAttack`, `saveAttack`), `web/src/game/attack/attackTarget.ts` (its shape includes an optional pre-fetched `BaseLoadResponse` from day one, for WP1b's use), `web/src/app/App.ts` (register the new scene), `web/src/ui/maproom/CellPanel.ts` (wire the Attack button), `web/src/app/scenes/MapRoom2Scene.ts` (call `setAttackTarget` then `goTo`) | Nothing | S/M |
| WP1b | View yard entry, and Attack from inside View | `web/src/ui/maproom/CellPanel.ts` (enable View yard for any cell, drop the `OTHERS_YARD` restriction — **shares this file with WP1**), `web/src/api/base.ts` (`viewBase(baseid, kind)` — **shares this file with WP1**), `web/src/app/scenes/YardScene.ts` (accept an optional foreign, read-only target instead of always `loadOwnYard()`; add the toolbar Attack button; on click, call `loadAttack` and populate `attackTarget`'s pre-fetched field) | WP1 (shares its files — must land after WP1 merges, not just after its interfaces are frozen) | M |
| WP2 | Attack scene shell and enemy-yard rendering | `web/src/app/scenes/AttackScene.ts`, `web/src/game/attack/AttackSession.ts` (new files) | WP1's shapes (can be coded against a frozen interface before WP1 lands, the way `server-combat.md`'s WP1/WP4 code against `stats.ts`'s signatures before WP0 lands) | L |
| WP3 | Army composition panel and fling-log builder | `web/src/ui/attack/ArmyPanel.ts`, `web/src/game/attack/bucket.ts`, `web/src/game/attack/flingLog.ts` (new files) | WP2's `AttackSession` shape | M/L |
| WP4 | Fling/deploy input, catapult and siege pickers | `web/src/game/attack/AttackInput.ts`, `web/src/ui/attack/CatapultPopover.ts`, `web/src/ui/attack/SiegePopover.ts` (new files) | WP3's bucket/fling-log shape | M |
| WP5 | Live battle rendering | `web/src/game/attack/AttackBattleLayer.ts` (draws creeps and champions from WP0's sprite table through PixiJS texture grids, the flyer hover bob and shadow, the shared death splat, no per-monster death art), `web/src/ui/attack/BattleControls.ts` (the 1x/2x toggle, new files); the small creep-snapshot addition to `web/src/game/combat/rules/engine.ts` | WP2's `AttackSession`/`Battle` host, and WP0's sprite table | L |
| WP6 | End-of-attack, timer/retreat, and the save | `web/src/ui/attack/EndAttackPanel.ts` (new file); edits to `web/src/game/attack/AttackSession.ts` and `web/src/app/scenes/AttackScene.ts` (**shared with WP2**) | WP2 (shared files, so **sequential**, not parallel), WP3 (fling log), WP5 (battle outcome) | M |

**Parallelism.** WP0 has no dependencies at all and should start immediately, in parallel with
everything else — it touches only new files under `web/src/game/attack/` and `web/tools/`, and
nothing downstream needs more than its exported table's shape, which `docs/art/monster-sprites.md`
§3 already fixes. WP1 is small and should also land first, or at least have its API shapes frozen
first, since every other package reads them. **WP1b must land after WP1 actually merges** — it edits the
same `CellPanel.ts` and `base.ts` WP1 does, so this pair is a true row-level conflict, not just a
shared interface; it is not a candidate for the "code against a frozen shape" treatment the rest of
this list gets, and is best done by the same agent as WP1 or picked up immediately after. WP1b's own
new file, `YardScene.ts`'s generalisation, touches nothing any other package touches, so once merged
it does not block WP2 onward. Once WP2's `AttackSession`/`AttackScene` interfaces are frozen (not
necessarily merged — a stub is enough, the way `server-combat.md` §5 has WP1 and WP4 start against
`stats.ts`'s exported signatures before WP0 lands), **WP3, WP4 and WP5 can run as three parallel
agents**: WP3 and WP4 touch no file WP5 touches, and WP5 touches no file WP3 or WP4 touch. WP4
depends on WP3's bucket shape at the interface level only, so it too can start once that shape is
named, not once WP3 is merged.

**Which packages must be sequential.** WP1b after WP1 (shared files, above). WP6 edits
`AttackSession.ts` and `AttackScene.ts`, the same two files WP2 creates — so WP6 must land after WP2,
not alongside it, and is best done by whoever finishes WP2 or picked up immediately after, once WP3's
fling log and WP5's battle outcome shapes are also available to build the save payload from. No other
pair of packages in this table touches the same file.

**Acceptance checks**, one unit-test focus and one browser check per package, the browser checks run
against the local dev stack (server on `http://localhost:3001`, client on `http://localhost:5173`)
with the sandbox account `yardtester@test.com` / `Dev12345!`:

| # | Unit tests | Browser check |
| --- | --- | --- |
| WP0 | The generated table has one entry per `SPRITES.as` sprite key with the right `cellW`/`cellH`/anchor/`cols`/`rows`; the animation table's direction count (30/32/16) and row ranges match `docs/art/monster-sprites.md` §1's table, cited entry by entry; the generator fails loudly on a missing PNG | Run the generator against the checked-in assets; it completes with no missing-file errors and the emitted table's row count matches the sheet count `docs/art/monster-sprites.md` §1 states (61) |
| WP1 | `loadAttack` builds the same `attackData` shape `ATTACK.AttackData()` does, from a fixture roster | Click Attack on a wild monster camp in Map Room 2 as `yardtester`; confirm the request fires with `type=wmattack` and a plausible `attackData` |
| WP1b | `viewBase` sends `type=view`/`wmview` with no `attackData`; `YardScene`'s foreign-target path never calls `loadOwnYard` | Open View yard on another player's cell as `yardtester`; the yard renders read-only, with an Attack button that, when clicked, issues a fresh `loadAttack` and lands in the running attack with no map screen in between |
| WP2 | `AttackSession` state transitions (idle → loaded → battle running) | Open an attack on a camp in flinger range; the enemy yard renders isometric, centred, with the HUD countdown running |
| WP3 | `bucketCost`/`flingerPayload` clamp a row's maximum correctly; a built `FlingLog` fling event matches the §3.10 shape field for field | Tap `+` and hold it on a monster row; the count climbs, accelerating, and the capacity bar updates live and stops accepting more once the flinger payload is spent |
| WP4 | A drop centre overlapping a building footprint is rejected, matching the server-combat contract's rule | Drop a mixed composition on open ground; creeps spawn inside the ring. Open Catapult, confirm the monster panel's numbers are unchanged |
| WP5 | A scripted fling against a tiny fixture yard reaches the same digest a `replay.test.ts`-style fixture would | Watch a real battle at 1x, then switch to 2x mid-battle; creeps and champions animate from the real sprite sheets (a flyer bobs, a death shows the shared splat), and towers visibly fire in step with the engine tick |
| WP6 | A built save payload contains every key in §5.2's table, correctly shaped, from a fixture `BattleState` | Run a full attack on a wild monster camp to completion — sending everything housed and letting the field clear should end it before the timer does — then reload the same camp and confirm its building health and resources reflect the battle just watched |

## 7. Open questions

| # | Question | Default and reason |
| --- | --- | --- |
| 1 | Where does the client get a combat seed, since #23's server-side `combatseed` has not landed (`server/src/services/base/attackSession.ts` has no `seed` field yet, confirmed while writing this plan)? | **The client mints its own** at attack start (a plain random 32-bit integer) and puts it in `flinglog.seed`. No shape change is needed later: once #23 lands `combatseed` on the load response, the client reads that instead of generating one, and the field it writes is the same field. |
| 2 | Declare War's worst-case battle length (540 s, `stats.ts:84`) exceeds the 420-second window that authorises the final save (`docs/server-api.md:272-274`) — extend the server window, or cap the client? | **Cap the client.** Show the true countdown, but raise a distinct warning a short margin before 420 seconds so a Declare War attacker wraps up in time, and treat a save refused as `expired` past that point as a rare, already-handled error path (§4.7) rather than shipping a server change phase 1 does not otherwise need. Extending `ATTACK_SESSION_WINDOW` is a reasonable one-line follow-up for whoever owns issue #25, not a #32 dependency. |
| 3 | Does sending an unrecognised `flinglog` form field on `/base/save` risk the request being rejected by `BaseSaveSchema`? | **Verify, don't guess — treat as an acceptance check in WP6.** `flinglog` is not on `Save.attackSaveKeys` today, so the save loop never reads it (`baseSave.ts:124`), and it is send-and-ignore unless the schema is `.strict()`. WP6's browser check confirms a real save with the field attached still succeeds before this is relied on. |
| 4 | Should putty bombs and siege weapons be hidden from the UI entirely until the engine implements their effect (§F4), or shipped now with a "no effect yet" label? | **Shipped now, labelled.** The fling-log contract is fixed either way, and withholding the picker delays a UI surface that is otherwise finished for no benefit to the contract; the label is one line of copy. |
| 5 | Who builds `attackreport` — the client, matching the old HTML `<ul>` log (`ATTACK.LogRead()`, `combat.md:1205-1211`), or something simpler? | **A plain-text summary**, one line per fling/bomb/siege/retreat event, built straight from the fling log the client already has. The server writes it verbatim either way (`docs/server-api.md`'s default branch) and the web client will render it as text, not `htmlText`, so there is no reason to reproduce Flash's HTML. |
| 6 | Does the Army panel's "fill" respect a player-chosen priority (favourite monster first), or always roster order? | **Roster order**, so "fill" is deterministic and repeatable across presses; a priority order is a plausible phase-2 refinement once there is a UI for expressing one, not a phase-1 requirement. |
| 7 | Should `View yard` (Flash's read-only `type=view`/`wmview`) open for any cell, with an Attack button inside it that switches straight into the attack? | **Decided 2026-09-26: yes, both.** View yard now opens read-only for any cell, not only the caller's own (§F1), and its Attack button issues a second `/base/load` (`type=attack`/`wmattack`) and hands off into the attack without returning to the map. A second load is required rather than reused: `baseModeView` never checks range, never mints the attack session `baseModeAttack` does, and never runs any of an attack's side effects (§5.1's table), so a View load cannot be promoted into an attack after the fact. This is folded into WP1b, sequenced after WP1 because it shares files with it (§6). |
| 8 | Should the creep-position accessor added to `engine.ts` for WP5 be a change to `Battle.state()`'s existing shape, or a new sibling method? | **A new sibling method** (for example `battle.creeps()`), so `BattleState`'s existing shape — and everything that already reads it, including `replay.ts` — is untouched, and the addition is visibly scoped to what the renderer needs. |
| 9 | Does the Retreat button need a confirmation dialog? | **Decided 2026-09-26: yes, one click of confirmation.** Retreat is always available (§F7) and ends the attack early with no undo; the existing pattern for a destructive, irreversible action elsewhere in the client (the planner's clear-yard confirmation, `docs/design/yard-planner-redesign.md` Q14) is one dialog, not a double-click or a hold. |
| 10 | Does the enemy `BuildingPanel` (read-only info on a clicked enemy building, §4.4) need any new fields beyond what the existing panel shows for the player's own yard? | **No.** The same panel, same fields, with the upgrade/fortify affordances simply omitted for a yard that is not the player's own — which the panel's `access`-gated construction already supports (`YardScene.ts:583-594`'s conditional `planner` option is the existing pattern for "omit an action this session may not take"). |
| 11 | Should phase 1 include battle sound effects? | **Decided by default: no.** Phase 1 ships silent. Flash's own monster and battle sounds are a separate asset/behaviour question this plan does not scope, and a silent battle is a complete, playable feature on its own; sound is a phase 2 polish item if the owner wants it. |

**Gaps in the engine this plan found and does not fix.** Recorded here rather than in a work package,
since they belong to the shared rules module (#22/#23), not to #32: siege weapons have no battle
effect (`engine.ts:127-128`); putty bombs have no damage and no buff effect (`engine.ts:639`);
champion abilities beyond base damage and Krallen's looting are not modelled (`engine.ts:124-126`).
None of the three block a playable attack — this plan ships the UI for all three and logs their
events correctly — but the owner should decide whether to file them as follow-up issues against the
combat rules module now or defer until a player actually needs the effect.
