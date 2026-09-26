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
is a two-click popup with its own clearing rule (`combat.md:477-488`). There is no wave system —
waves are emergent, one fling then another — and the flinger's payload does not accumulate across
flings in Map Room 2, so a 300-monster attack is several full reselections from scratch
(`combat.md:306-309`, `:474-475`, `:490-492`).

The representative mid-game attack the spec measures — four waves of about 25 monsters, one
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
(`combat.md:1259-1268`). The five-minute timer (seven with Declare War) forces a retreat two minutes
after it expires (`combat.md:1087-1101`, §10 rule 10). Section 10 of the spec names, click by click,
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

Nothing in `web/src/game/yard/` draws a creep, a bomb or a drop ring. `YardRenderer`
(`web/src/game/yard/YardRenderer.ts:39-370`) draws buildings, mushrooms and planner chrome only —
`show`, `draw`, `setHovered`, `setSelected`, `setView`, `pick`, `worldToYard`/`yardToWorld`, and
nothing about combat. That renderer is reused as-is to draw the enemy yard (§3.1); a new layer is
needed for everything that moves during a battle (§3.5, §5.3).

## 2. Design goals

| # | Goal | Measure |
| --- | --- | --- |
| G1 | Every rule in spec §10 "Rules that must be preserved" holds exactly | The eleven rules below are unchanged; a reviewer checks each against the shipped code |
| G2 | Every Flash-era constraint spec §10 names as droppable is dropped | Hold-to-repeat frame counters, `SecNum`, the 80 Hz/1 Hz clock split, taunt/brag flows: none exist in the new client |
| G3 | The representative attack (four waves of ~25 monsters, a champion, a bomb) costs well under 20 clicks | §4.4's click table totals 15 |
| G4 | The client produces the exact fling log `docs/design/server-combat.md` §3.10 specifies | A fixture log built by the new client round-trips through `replayAttack()` with no shape changes |
| G5 | No server change ships in phase 1 beyond what already exists | §5.4; the one place this needed a decision is Open Question 2 |
| G6 | Every interaction has full touch parity | No control needs hover-only or drag-only input; §4.5 states this per interaction |
| G7 | The battle is watched, not resolved instantly | The engine's tick API drives a real-time (or sped-up) render; §3.5 |

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
| F1 | Entering an attack from Map Room 2 | Must | S |
| F2 | Army composition panel | Must | L |
| F3 | Fling and deploy interaction | Must | M |
| F4 | Catapult and siege, coexisting with the monster bucket | Must | M |
| F5 | Watching the battle | Must | L |
| F6 | Ending the attack | Must | M |
| F7 | Timer, retreat and damage protection display | Must | S |
| F8 | Touch and phone parity | Must | woven into F2–F7 |

### F1. Entering an attack from Map Room 2 — Must, S

**For the player.** Click Attack on any cell the player can reach — a wild monster camp, an
outpost, another player's main yard — and the enemy yard opens, drawn the same way the player's own
yard is.

**How it works.** `CellPanel`'s Attack button (`CellPanel.ts:82`) stops being
`disabledAction(...)` and becomes a real button that calls back to the scene with the cell's
`bid` (`CellPanel.ts:186`, `:238` — the field is already read and displayed, just not acted on). The
same preconditions the Flash client checks client-side before offering the button
(`docs/specs/maproom2.md:365-379`: attacking enabled, not protected, no truce, a flinger in range,
at least one monster or a healthy champion available) are re-derived from the cell payload and the
player's own roster already cached from the map load; every one of them is also enforced
server-side (`baseModeAttack.ts:71-104`, table at `docs/server-api.md:388-394`), so the client-side
check is UX only — a refusal the client missed still surfaces from the server's error, handled the
same way §4.6 describes.

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

**Where the target goes.** `SceneManager.goTo` takes no parameters (`SceneManager.ts:70-75`), and
extending it for one caller is more surface than a one-shot handoff needs. A small module,
`web/src/game/attack/attackTarget.ts`, holds the chosen `baseid` and cell kind between the click and
the new scene's `enter()`, the same shape `web/src/api/auth.ts:28`'s `getSession()` and
`web/src/api/http.ts:71-78`'s `authToken` already use for state that outlives one call:
`setAttackTarget(target)` from `MapRoom2Scene`, `consumeAttackTarget()` from the new scene, clearing
it so a stale target cannot leak into an unrelated visit.

### F2. Army composition panel — Must, L

**For the player.** See every housed monster type and the champion in one list, set how many of
each to send with one gesture per type — drag, type a number, or press "fill" — and watch the
capacity bar update live. The selection survives opening the catapult or a siege weapon. It survives
a drop, too: after flinging, the same numbers are still there to send again.

**How it works.** A new session object, `web/src/game/attack/AttackSession.ts`, holds the
composition as a plain `Roster` (`types.ts:210`) plus an optional champion choice, mirroring the
shape `web/src/game/yard/planner/PlannerSession.ts` already established for "one object holds the
state, the DOM panel reads `state()`" (`PlannerSession.ts:28-44`, `:304-327`). Unlike the planner,
this session needs no undo stack — a composition is cheap to reset and nothing here is destructive —
so it is considerably smaller.

Each row (one monster type, or the champion) is modelled on `InventoryPanel`'s stack rows — icon,
name, level, and a count (`web/src/ui/yard/InventoryPanel.ts:1-90`) — but where that panel's count
is a read-only tally reduced one at a time by a click, this row's count is a **quantity control**:
a slider from 0 to the row's own maximum, a number input beside it for typing an exact figure, and a
long-press/press-and-hold-free "fill to remaining" button per row. The row's maximum is
`min(housed count, remaining capacity / bucketCost(1))`, both numbers the engine already exposes —
`bucketCost(roster, levels)` and `flingerPayload()` (`engine.ts:295-306`) give the exact arithmetic
`BucketAdd`'s silent refusal used to enforce one click at a time (`combat.md:337-339`); the panel
computes it once per edit instead of asking the player to discover it by hitting a wall.

A capacity bar at the top of the panel shows total bucket cost against `flingerPayload()`
(`engine.ts:306` — capacity 2250 at the forced Map Room 2 flinger level 4,
`docs/specs/combat.md:301-304`), the same number `UI_TOP.as:252-257`'s bar already showed, just
computed from the shared stats module instead of client-held constants.

**Fill.** One button per row and one "fill everything" action at the top. Filling walks rows in
roster order — the order the player's own housing already lists monsters, which is stable and
repeatable — adding each type up to its own maximum until the shared capacity is exhausted (Open
Question 11 names this the default because a random or best-damage fill order would make "fill"
behave differently each press).

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
The composition stays selected — sending another wave is "tap again", not "reselect from
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
(`types.ts:440-452`) to its `FlingLog`, hands it to the running `Battle.apply(event)` (§3.5), and —
unlike Flash — **does not clear the composition**. The player sends the same numbers again with one
more tap, or edits the panel first.

**Waves stay emergent**, exactly as spec §10 accepts (`combat.md:474-475`, "there is no wave system
in an attack"): nothing here numbers a wave or shows a wave bar; it is simply another fling event.

### F4. Catapult and siege, coexisting with the monster bucket — Must, M

**For the player.** Open the bomb picker or the siege weapon picker without losing the monster
composition, the champion choice, or the other tool's pending selection. All three are independent.

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
marks both as having no battle effect yet (§4.3), and a follow-up issue against the shared rules
module (not this plan, and not gating it) is the right place to implement them. Shipping the picker
with an honest "no effect yet" label is judged better than withholding it until the engine catches
up, because the fling-log contract and the UI shell are useful now and the effect is a pure addition
later.

### F5. Watching the battle — Must, L

**For the player.** After a drop, see the monsters walk across the enemy yard, attack, take
damage, and (for towers) fire back, at a pace that can be watched, sped up, or skipped past — not an
instant number.

**How it works.** A new `web/src/game/attack/AttackBattleLayer.ts` sits on top of the existing
`YardRenderer` and owns exactly what the yard renderer does not: creep sprites, a resource-bomb
flash, a siege-weapon marker, and the drop-ring preview from F3/F4. It never draws a building — that
stays `YardRenderer`'s job, called with the same enemy `Yard` model `readYard()` already builds from
a `BaseLoadResponse` (`web/src/game/yard/yardModel.ts:38-138`, `:210`), unmodified. The two layers
read the same `EngineYard`/`CombatYard` positions (`web/src/game/combat/rules/yard.ts:243-269`'s
`fromIso`/coordinate helpers) so a creep's isometric position and a building's isometric position are
computed the same way.

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

**Speed controls.** Because the render loop is "advance to a tick, then read state" rather than a
fixed real-time simulation, a ×2 or ×4 speed toggle is exactly "advance the target tick faster";
`runTo` already loops `step()` until the target (`engine.ts:1095-1097`), so no new engine capability
is needed for this. A "skip to end" action calls `runTo` with the countdown's final tick
(`ATTACK_MAX_SECONDS = 540`, `stats.ts:84`) in one jump, which is exactly what `replayAttack` already
does for its tail (`replay.ts:173-177`).

### F6. Ending the attack — Must, M

**For the player.** One screen at the end of the attack: what was destroyed, how much was looted,
how much damage was dealt, and a single Return action. Not two popups.

**How it works.** The auto-end condition is read straight off `battle.state().over`
(`engine.ts:208`, `:981-1013`'s countdown/no-targets logic) rather than reimplemented — the engine
already decides when nothing is left to attack or the countdown has expired, matching
`ATTACK.Tick`'s rule (`combat.md:1103-1120`) exactly because it is the same rule, ported once. A new
`web/src/ui/attack/EndAttackPanel.ts` replaces the Flash pair — the attack log popup and
`popup_attackend` (`combat.md:1259-1268`) — with one modal: damage percentage, resources looted (from
`battle.state().loot`), buildings destroyed, and one Return button. This is the one click at the end
of the click table in §4.4, against Flash's two.

### F7. Timer, retreat and damage protection display — Must, S

**For the player.** See the countdown, see it turn to a warning near the end, and have a Retreat
button that works immediately rather than waiting for the hard cutoff.

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

### 4.1 Screen layout — desktop

```
┌──────────────────────────────────────────────────────────────────────┐
│  HUD   resources · scene nav          ⏱ 04:32            [Retreat]   │
├──────────────────────────────────────────────────────────────────────┤
│                                                                        │
│                                                          ┌───────────┐│
│                                                          │ Army      ││
│                    ENEMY YARD                            │ ▸ C1  30  ││
│                    (isometric, YardRenderer)              │ ▸ C4   5  ││
│                                                          │ Champion ▸││
│                                                          │[ Fill all]││
│                    (creep sprites, drop ring:            ├───────────┤│
│                     AttackBattleLayer)                   │[Catapult] ││
│                                                          │[ Siege  ] ││
│                                                          └───────────┘│
│  status: 400 buildings · zoom · hint                    [zoom][mmap] │
└──────────────────────────────────────────────────────────────────────┘
```

The layout mirrors `YardScene`'s own furniture placement: HUD across the top
(`web/src/ui/Hud.ts`), a status readout bottom-left (`YardScene.ts:184-186`), zoom control and
minimap bottom-right (`YardScene.ts:452-478`), and a docked right-hand panel
(`YardScene.ts:571-596`'s `BuildingPanel` pattern, reused here for the Army panel). Nothing about the
chrome is novel; only the Army panel, the Catapult/Siege panels, and the battle layer are new.

### 4.2 Screen layout — phone (≈400 px wide)

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
┌───────────────────┐
│  ▼  Army           │
│  C1  ──●───────  30│
│  C4  ──────●───   5│
│  Champion: Krallen  │
│ [ Fill ] [Bomb][Siege]│
│  Tap the yard to drop│
└───────────────────┘
```

The bottom-sheet pattern is new to this plan, but the underlying primitive — a docked panel that can
collapse to a small tab — already exists in spirit in the planner's inset-reporting bars
(`YardScene.ts:141-145`'s `inset` tracking, `PlannerBar` reporting its own height back to the scene
so the canvas fit recomputes around it). The Army panel reports its own height the same way so the
enemy yard's fit-to-screen zoom (`applyZoomLimits`, `YardScene.ts:499-518`) leaves room for whichever
state — collapsed or expanded — the sheet is in.

### 4.3 Panel inventory

| Panel | Desktop position | Phone position | Notes |
| --- | --- | --- | --- |
| Army composition | Docked right | Bottom sheet | F2; quantity controls, fill, champion, last-army |
| Catapult picker | Docked right, replaces Army temporarily | Bottom sheet | F4; bomb tiles, "no effect yet" badge on putty tiers |
| Siege picker | Docked right | Bottom sheet | F4; "no effect yet" badge on all three weapons until the engine implements them |
| Enemy building info | Docked right | Bottom sheet | Read-only `BuildingPanel` reuse, no upgrade actions offered |
| End-of-attack | Centred modal | Full-screen modal | F6; one Return action |
| Timer / retreat | HUD strip | HUD strip, overflow for Retreat on very small widths | F7 |

### 4.4 Click count for the representative attack (after this redesign)

Same scenario spec §10 measured — four waves of about 25 monsters, one champion, one bomb — counted
the same way (from the moment the attack screen is open):

| Item | Count |
| --- | --- |
| Composition gestures, wave 1 (2 monster-type quantities + 1 champion pick) | 3 |
| Drop, wave 1 | 1 |
| "Repeat last" + drop, waves 2–4 (×3) | 6 |
| Catapult sequence (open, pick tile, drop) | 3 |
| End-of-attack screen | 1 |
| **Total** | **14** |

Fourteen, against Flash's 110, or its own hold-to-repeat floor of roughly 11 (8 long presses plus the
champion, drop and catapult clicks, `combat.md:1523-1524`). The gain over hold-to-repeat is not from
typing versus holding a key — it is from never re-entering the composition for waves 2 through 4, and
never losing it to the catapult.

### 4.5 Touch and phone parity, stated per interaction

| Interaction | Mouse | Touch |
| --- | --- | --- |
| Set a monster's quantity | Drag the slider, or type in the number field | Drag the slider (same element, pointer events) or tap the number field for the on-screen keyboard |
| Fill a row / fill all | Click | Tap, ≥44 px target |
| Choose a champion | Click a radio row | Tap the same row |
| Preview the drop ring | Hover shows the ring following the cursor | The last touch point shows the same ring before release |
| Commit a drop | Click inside the ring | Lift the finger inside the ring |
| Open Catapult / Siege | Click | Tap — a real panel opens, not a hover bubble (§F4) |
| Speed up / skip the battle | Click a speed button | Tap the same button |
| Retreat | Click | Tap, confirmed once (destructive, ends the attack early) |

Nothing in this plan depends on hover as the *only* way to reach something, and nothing depends on a
continuous drag with no release event, which is the one interaction (Flash's cursor-following ring)
that has no touch equivalent at all and is why F3 redesigns it as tap-to-drop rather than porting it.

### 4.6 Errors on the attack path

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

### 5.1 What the Flash client sends today, which this plan matches

Phase 1 is explicitly client-authoritative — the client computes the outcome and reports it, exactly
as Flash does — so the new `/base/save` call must build the same fields the server's attack-save
path already understands (`Save.attackSaveKeys`, `docs/server-api.md:241-243`; the per-key handler
table at `docs/server-api.md:231-239`; the controller at `server/src/controllers/base/save/baseSave.ts:124-264`):

| Key | What the client computes it from | Server behaviour today |
| --- | --- | --- |
| `attackid` | Echoed from the load response | Consistency check only (`docs/server-api.md:291-294`) |
| `over` | `battle.state().over` (F6) | Clears `attackid`, ends the session, grants defender protection (`baseSave.ts:261-271`) |
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

### 5.2 The one new field: `flinglog`

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

### 5.3 New client-side state

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

### 5.4 No server change is required to ship phase 1

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
| WP1 | Entry and API plumbing | `web/src/api/types.ts` (attack fields on request/response), `web/src/api/base.ts` (`loadAttack`, `saveAttack`), `web/src/game/attack/attackTarget.ts`, `web/src/app/App.ts` (register the new scene), `web/src/ui/maproom/CellPanel.ts` (wire the Attack button), `web/src/app/scenes/MapRoom2Scene.ts` (call `setAttackTarget` then `goTo`) | Nothing | S/M |
| WP2 | Attack scene shell and enemy-yard rendering | `web/src/app/scenes/AttackScene.ts`, `web/src/game/attack/AttackSession.ts` (new files) | WP1's shapes (can be coded against a frozen interface before WP1 lands, the way `server-combat.md`'s WP1/WP4 code against `stats.ts`'s signatures before WP0 lands) | L |
| WP3 | Army composition panel and fling-log builder | `web/src/ui/attack/ArmyPanel.ts`, `web/src/game/attack/bucket.ts`, `web/src/game/attack/flingLog.ts` (new files) | WP2's `AttackSession` shape | M/L |
| WP4 | Fling/deploy input, catapult and siege pickers | `web/src/game/attack/AttackInput.ts`, `web/src/ui/attack/CatapultPopover.ts`, `web/src/ui/attack/SiegePopover.ts` (new files) | WP3's bucket/fling-log shape | M |
| WP5 | Live battle rendering | `web/src/game/attack/AttackBattleLayer.ts`, `web/src/ui/attack/BattleControls.ts` (new files); the small creep-snapshot addition to `web/src/game/combat/rules/engine.ts` | WP2's `AttackSession`/`Battle` host | L |
| WP6 | End-of-attack, timer/retreat, and the save | `web/src/ui/attack/EndAttackPanel.ts` (new file); edits to `web/src/game/attack/AttackSession.ts` and `web/src/app/scenes/AttackScene.ts` (**shared with WP2**) | WP2 (shared files, so **sequential**, not parallel), WP3 (fling log), WP5 (battle outcome) | M |

**Parallelism.** WP1 is small and should land first, or at least have its API shapes frozen first,
since every other package reads them. Once WP2's `AttackSession`/`AttackScene` interfaces are frozen
(not necessarily merged — a stub is enough, the way `server-combat.md` §5 has WP1 and WP4 start
against `stats.ts`'s exported signatures before WP0 lands), **WP3, WP4 and WP5 can run as three
parallel agents**: WP3 and WP4 touch no file WP5 touches, and WP5 touches no file WP3 or WP4 touch.
WP4 depends on WP3's bucket shape at the interface level only, so it too can start once that shape is
named, not once WP3 is merged.

**Which packages must be sequential.** WP6 edits `AttackSession.ts` and `AttackScene.ts`, the same
two files WP2 creates — so WP6 must land after WP2, not alongside it, and is best done by whoever
finishes WP2 or picked up immediately after, once WP3's fling log and WP5's battle outcome shapes are
also available to build the save payload from. No other pair of packages in this table touches the
same file.

**Acceptance checks**, one unit-test focus and one browser check per package, the browser checks run
against the local dev stack (server on `http://localhost:3001`, client on `http://localhost:5173`)
with the sandbox account `yardtester@test.com` / `Dev12345!`:

| # | Unit tests | Browser check |
| --- | --- | --- |
| WP1 | `loadAttack` builds the same `attackData` shape `ATTACK.AttackData()` does, from a fixture roster | Click Attack on a wild monster camp in Map Room 2 as `yardtester`; confirm the request fires with `type=wmattack` and a plausible `attackData` |
| WP2 | `AttackSession` state transitions (idle → loaded → battle running) | Open an attack on a camp in flinger range; the enemy yard renders isometric, centred, with the HUD countdown running |
| WP3 | `bucketCost`/`flingerPayload` clamp a row's maximum correctly; a built `FlingLog` fling event matches the §3.10 shape field for field | Drag a monster's quantity slider; the capacity bar updates live and stops accepting more once the flinger payload is spent |
| WP4 | A drop centre overlapping a building footprint is rejected, matching the server-combat contract's rule | Drop a mixed composition on open ground; creeps spawn inside the ring. Open Catapult, confirm the monster panel's numbers are unchanged |
| WP5 | A scripted fling against a tiny fixture yard reaches the same digest a `replay.test.ts`-style fixture would | Watch a real battle; speed it to ×4; towers visibly fire and creeps visibly die in step with the engine tick |
| WP6 | A built save payload contains every key in §5.1's table, correctly shaped, from a fixture `BattleState` | Run a full attack on a wild monster camp to completion; reload the same camp afterward and confirm its building health and resources reflect the battle just watched |

## 7. Open questions

| # | Question | Default and reason |
| --- | --- | --- |
| 1 | Where does the client get a combat seed, since #23's server-side `combatseed` has not landed (`server/src/services/base/attackSession.ts` has no `seed` field yet, confirmed while writing this plan)? | **The client mints its own** at attack start (a plain random 32-bit integer) and puts it in `flinglog.seed`. No shape change is needed later: once #23 lands `combatseed` on the load response, the client reads that instead of generating one, and the field it writes is the same field. |
| 2 | Declare War's worst-case battle length (540 s, `stats.ts:84`) exceeds the 420-second window that authorises the final save (`docs/server-api.md:272-274`) — extend the server window, or cap the client? | **Cap the client.** Show the true countdown, but raise a distinct warning a short margin before 420 seconds so a Declare War attacker wraps up in time, and treat a save refused as `expired` past that point as a rare, already-handled error path (§4.6) rather than shipping a server change phase 1 does not otherwise need. Extending `ATTACK_SESSION_WINDOW` is a reasonable one-line follow-up for whoever owns issue #25, not a #32 dependency. |
| 3 | Does sending an unrecognised `flinglog` form field on `/base/save` risk the request being rejected by `BaseSaveSchema`? | **Verify, don't guess — treat as an acceptance check in WP6.** `flinglog` is not on `Save.attackSaveKeys` today, so the save loop never reads it (`baseSave.ts:124`), and it is send-and-ignore unless the schema is `.strict()`. WP6's browser check confirms a real save with the field attached still succeeds before this is relied on. |
| 4 | Should putty bombs and siege weapons be hidden from the UI entirely until the engine implements their effect (§F4), or shipped now with a "no effect yet" label? | **Shipped now, labelled.** The fling-log contract is fixed either way, and withholding the picker delays a UI surface that is otherwise finished for no benefit to the contract; the label is one line of copy. |
| 5 | Who builds `attackreport` — the client, matching the old HTML `<ul>` log (`ATTACK.LogRead()`, `combat.md:1205-1211`), or something simpler? | **A plain-text summary**, one line per fling/bomb/siege/retreat event, built straight from the fling log the client already has. The server writes it verbatim either way (`docs/server-api.md`'s default branch) and the web client will render it as text, not `htmlText`, so there is no reason to reproduce Flash's HTML. |
| 6 | Does the Army panel's "fill" respect a player-chosen priority (favourite monster first), or always roster order? | **Roster order**, so "fill" is deterministic and repeatable across presses; a priority order is a plausible phase-2 refinement once there is a UI for expressing one, not a phase-1 requirement. |
| 7 | Should `View yard` (Flash's read-only `type=view`/`wmview`) be built as a prerequisite for this plan, since `CellPanel.ts:37`'s "OTHERS_YARD" message suggests it is coming? | **No.** Attack mode's own load response already carries everything this plan draws (`docs/specs/combat.md:253-272`); a separate read-only scouting view is independently useful but not on this plan's critical path, and building it here would widen scope past what issue #32 asks for. |
| 8 | Should the creep-position accessor added to `engine.ts` for WP5 be a change to `Battle.state()`'s existing shape, or a new sibling method? | **A new sibling method** (for example `battle.creeps()`), so `BattleState`'s existing shape — and everything that already reads it, including `replay.ts` — is untouched, and the addition is visibly scoped to what the renderer needs. |
| 9 | Does the Retreat button need a confirmation dialog? | **Yes, one click of confirmation.** Retreat ends the attack early and cannot be undone; the existing pattern for a destructive, irreversible action elsewhere in the client (the planner's clear-yard confirmation, `docs/design/yard-planner-redesign.md` Q14) is one dialog, not a double-click or a hold. |
| 10 | Does the enemy `BuildingPanel` (read-only info on a clicked enemy building, §4.3) need any new fields beyond what the existing panel shows for the player's own yard? | **No.** The same panel, same fields, with the upgrade/fortify affordances simply omitted for a yard that is not the player's own — which the panel's `access`-gated construction already supports (`YardScene.ts:583-594`'s conditional `planner` option is the existing pattern for "omit an action this session may not take"). |

**Gaps in the engine this plan found and does not fix.** Recorded here rather than in a work package,
since they belong to the shared rules module (#22/#23), not to #32: siege weapons have no battle
effect (`engine.ts:127-128`); putty bombs have no damage and no buff effect (`engine.ts:639`);
champion abilities beyond base damage and Krallen's looting are not modelled (`engine.ts:124-126`).
None of the three block a playable attack — this plan ships the UI for all three and logs their
events correctly — but the owner should decide whether to file them as follow-up issues against the
combat rules module now or defer until a player actually needs the effect.
