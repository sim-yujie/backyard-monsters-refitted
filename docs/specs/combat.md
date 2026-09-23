# Combat — Rules and Data Specification

Reverse-engineered from the Refitted client (ActionScript 3) and server (TypeScript). This document
describes the **rules and data** of attacking a yard, not the Flash rendering of it. It is written
for a rebuild of combat as a web client.

All citations are `path:line` relative to the repository root. Endpoint shapes are not re-derived
here; see `docs/server-api.md`.

Contents:

1. [Overview and authority](#1-overview-and-authority)
2. [Entering an attack](#2-entering-an-attack)
3. [Monster selection and deployment](#3-monster-selection-and-deployment)
4. [Monster behaviour](#4-monster-behaviour)
5. [Defences](#5-defences)
6. [Damage and loot](#6-damage-and-loot)
7. [Ending an attack](#7-ending-an-attack)
8. [Timers](#8-timers)
9. [UNVERIFIED](#9-unverified)
10. [Redesign notes](#10-redesign-notes)

---

## 1. Overview and authority

An attack has four phases.

| Phase | What happens | Authoritative side |
| --- | --- | --- |
| 1. Gate | The client checks range, protection and truce, then posts `/base/load` with `type=attack` or `type=wmattack`. The server re-checks protection, active attack, defender presence, truce and range — all of them before it writes anything — and only then mints an `attackid`. | **Server** |
| 2. Load | The server returns the defender's whole yard: buildings, per-building health, traps, housed monsters, champion, resources, powerups. | **Server** |
| 3. Battle | The entire fight — flinging, pathfinding, targeting, damage, tower fire, traps, loot pickup, death, the damage percentage and the loot totals — runs in the browser. Not one byte of it is recomputed anywhere else. | **Client** |
| 4. Save | The client posts `/base/save` with `damage`, `destroyed`, `attackloot`, the defender's negative resource delta, the surviving trap set, champion hp, and the attack report. The server applies almost all of it as given. | **Client, with narrow server clamps** |

**Combat is client-authoritative.** The server never simulates a battle, never recomputes damage,
and never checks that the reported loot could have come from the buildings that were destroyed. The
only hook that could reject a fabricated result is `validateSave`
(`server/src/controllers/base/save/baseSave.ts:69`), and in the open-source build it resolves to a
documented no-op:

```ts
export const validateSave = async (_user: User, _save: Save, _rawBody: unknown): Promise<void> => {
  // No-op stub - no validation performed
  return;
};
```

(`server/src/scripts/anticheat/anticheat.stub.ts:31-34`.) The loader only reaches for a private
implementation when `process.env.ENV === Env.PROD`, and falls back to the stub if that module is
absent (`server/src/scripts/anticheat/anticheat.ts:15-25`).

One real check does exist, but it runs at the *start* of an attack, not on the result:
`validateAttack` compares the stat block the client declares for each monster and champion against
the server's own tables and bans on mismatch (§2). It never sees the battle.

On the result itself, four narrow clamps are the whole of the server's defence, and each is
deliberate:

| Clamp | Rule | Source |
| --- | --- | --- |
| Building layout | On an attack save, only traps may be removed. Every non-trap building's type, level and position is re-read from the database and the client's copy discarded. | `server/src/controllers/base/save/handlers/buildingDataHandler.ts:31-42` |
| Defender champion | Only `hp` is taken from the client, and only if lower than stored (`Math.min`). | `server/src/controllers/base/save/handlers/championHandler.ts:16-22` |
| Defender resources | The reported delta is applied only where it is negative, capped at 10,000,000 per resource per save, and floored at 0. | `server/src/controllers/base/save/handlers/defenderLootHandler.ts:29-45` |
| Permission | The caller must own the base, or be the attacker the server recorded for the attack the base is currently under. | `baseSave.ts`, `services/base/attackSession.ts` |

The permission clamp used to be weaker than it looks, and issue #25 closed the gap. It once
required only that the target row carry a non-zero `attackid`; the random `attackid` minted at
attack start was never stored against the attacker and never compared, so any authenticated user
could post an attack save against any base that was under attack by anyone, and bank the
`attackloot` into their own pool. Attack start now also writes a session —
`attackerid:attackid:startedat` under `attack-session:<basesaveid>` in Redis — and an attack save
is refused unless the authenticated caller is that attacker and the attack is inside the same
420-second window `isAttackActive` uses. The check runs before `validateSave` and before the
economy audit, so a refusal changes nothing on the row. The full contract, including the four
refusal reasons and the HTTP-200-with-`error` shape the Flash client needs, is in
`docs/server-api.md` under "Attack session binding".

The Inferno save endpoint (`controllers/inferno/infernoSave.ts`) still carries the original
`attackid`-only gate; binding it needs the matching session to be minted in `infernoModeAttack`,
and the two have to land together.

Everything else on `Save.attackSaveKeys` — `destroyed`, `damage`, `locked`, `protected`,
`monsters`, `over`, `buildinghealthdata`, `buildingresources`, `attackreport`, `attackersiege` —
falls through the default branch and is `JSON.parse`'d straight onto the defender's row
(`server/src/database/models/save.model.ts:501-513`, applied at `baseSave.ts:134-142`). The
attacker's own loot (`attackloot`) is added to their pool with no cap at all
(`server/src/controllers/base/save/handlers/attackLootHandler.ts:14-21`).

Note in particular that `protected` is on the attack key list. An attacking client can write the
defender's damage-protection timestamp directly.

### Simulation clock

Two clocks run during a battle.

| Clock | Rate | Drives |
| --- | --- | --- |
| Slow tick | 1 Hz, from a 50 ms regulator accumulating to 1000 ms (`client/scripts/com/computus/model/Timekeeper.as:14`, `:86`, `:91-102`) | `ATTACK.Tick` — the countdown, the flinger cooldown, the end-of-attack check (`client/scripts/GLOBAL.as:1128-1130`) |
| Fast tick | Nominally 80 Hz. Each frame banks `2/25` loops per elapsed millisecond, capped at `_maxLoops = 800` (`client/scripts/GLOBAL.as:1234-1238`, `:362`) | Creep movement and attacks, tower fire, traps, bunkers, projectiles (`GLOBAL.as:1246-1291`) |

Every duration below given "in ticks" is fast ticks unless stated otherwise.

### What `WMATTACK.as` is not

`client/scripts/WMATTACK.as` is the **incoming** AI attack system — wild monsters raiding the
player's own yard, driven by the monster baiter and the invasion event. It exports to the
`aiattacks` save key (`client/scripts/BASE.as:3203`) and is ticked outside attack mode
(`GLOBAL.as:1303`). Attacking a wild monster camp uses `GLOBAL.e_BASE_MODE.WMATTACK` and runs
through the same `ATTACK.as` as a player attack. The two are unrelated despite the name.

---

## 2. Entering an attack

### Client preconditions

These are enforced in the Map Room 2 popups and are documented in full in
`docs/specs/maproom2.md` under "Attack". In summary, all of the following must hold before the
button is live: attacking is enabled by feature flag, the target is not damage-protected, no truce
is active, at least one owned cell within flinger range covers the target, and the player has at
least one monster or a healthy champion.

Two further client gates sit in `BASE.LoadBase`:

| Check | Effect | Source |
| --- | --- | --- |
| Outside Map Room 2/3, an attack may only be launched from build mode | Request refused | `client/scripts/BASE.as:503-506` |
| Outside Map Room 2/3, the attacker must own a functioning Flinger | `"Impossible fling"` logged, request refused | `client/scripts/BASE.as:513-518` |

Neither applies in Map Room 2, where flinger ownership is decided by the map cell instead.

### The request

`POST /base/load` with `type`, `baseid`, `mapversion`, and — for the four attack modes only — an
`attackData` JSON string (`client/scripts/BASE.as:624-626`).

`attackData` is built by `ATTACK.AttackData()` (`client/scripts/ATTACK.as:199-222`):

| Field | Contents |
| --- | --- |
| `champions[]` | `{ type: "G<n>", stats: <full champion prop block> }` for every champion the player owns |
| `monsters[]` | `{ id: "<creatureID>", count: <available>, stats: <full creature prop block> }` per monster type |

The client is therefore telling the server its own monster stats, and the server checks them.
`validateAttack` (`server/src/services/maproom/validateAttack.ts:25-91`, called at
`server/src/controllers/base/load/baseLoad.ts:79`, `:117`) compares every property of every
declared monster and champion against `monsterStats` / `mr3MonsterStats` / `championStats`, to two
decimal places (`:102-109`, `:119-135`). Any mismatch, unknown creature id, missing payload or
altered structure calls `logAttackViolation`, which increments `attackViolations`, writes a report
row and **sets `user.banned = true`** (`server/src/services/base/reportManager.ts:39-53`).

Two limits on that check. It is skipped entirely when `process.env.ENV === Env.LOCAL`
(`validateAttack.ts:25`). And it validates stat *values*, never *counts* — the file's own TODO says
so: `// Validate monster count from flinger` (`validateAttack.ts:10-11`). Nothing stops a client
declaring more monsters than it owns.

There is **no resource or energy cost to attacking in Map Room 2.** The `attackcost` field on
`/base/load` is read only when `mapversion === MapRoomVersion.V3`
(`server/src/controllers/base/load/modes/baseModeAttack.ts:165-177`). Where it is read, the client
sets the price: there is no server-side cost table, no affordability check, `r4` is ignored, and the
subtraction can drive the pool negative (`:167-169`). The shiny branch is clamped at zero and
refuses shiny-locked accounts (`:170-176`).

### Server validation

`server/src/controllers/base/load/modes/baseModeAttack.ts`. Every check in the first block is
skipped when the target is a wild monster camp (`save.type === BaseType.TRIBE`, `:63`).

| Check | Error | Line |
| --- | --- | --- |
| `save.protected > now` | `baseProtectedErr()` | `:71` |
| `isAttackActive(save)` | `baseUnderAttackErr()` | `:73` |
| Main yards only: defender's `last-seen:main:<uid>` within 60 s | `userOnlineErr()` | `:75-78` |
| Active truce between the two users | `truceActiveErr()` | `:80-82` |
| Range | throws, and writes a report | `:104` |

Every one of them runs before the first write. The `attackid`, the appended `AttackDetails`, the
map cell, the attack log, the Map Room 3 attack cost and the attack session are all produced after
`validateRange` returns (`baseModeAttack.ts:107-206`), so an attack the server refuses leaves the
defender exactly as it found them.

This is the fix for issue #26. Range used to be the *last* statement of the function, after the
flush, so a refusal left the defender flagged as under attack for the full 7-minute
`isAttackActive` window with no attacker present, no session to authorise a save and nothing to
clear it early. Moving the check needed one other change: a wild monster camp attacked for the
first time has no `world_map_cell` row, and the old order was what created one in time for the
check to find it. The cell's coordinates now come from the last six digits of the base id instead
(`rangeCheck.ts:165`), which is the same derivation the row-creation block uses, so the check sees
the same cell it always did without anything being written to reach it.
| Attack modes require `ctx.meetsDiscordAgeCheck` unless the target is a scripted Map Room 1 tribe | `discordAgeErr()` 401 | see `docs/server-api.md` §Base / Yard |

Level restrictions exist but are disabled. `canAttack` only blocks level-32+ players from Map Room
3 resource outposts at level ≤ 20; the player-versus-player "no more than 12 levels down" rule is
commented out pending vengeance mode
(`server/src/services/base/canAttack.ts:23-41`).

Side effects of a successful entry:

- `save.attacks` is trimmed to the last two entries when longer than three, then an `AttackDetails`
  record `{ fbid, name, pic_square, friend, count: 1, starttime, seen: false }` is appended — for
  non-tribe targets only (`baseModeAttack.ts:107-120`).
- The **attacker's** own damage protection is cleared (`damageProtection(userSave, BaseMode.ATTACK)`
  → `protection = 0`, `baseModeAttack.ts:122-124`, `server/src/services/maproom/v2/damageProtection.ts:34-36`).
- `save.attackid = floor(random() * 99999) + 1` (`baseModeAttack.ts:126`). It marks the row as under
  attack and is echoed to the client, which sends it back on every save.
- An attack session is written to Redis under `attack-session:<basesaveid>`, naming the attacker,
  that `attackid` and the start time (`services/base/attackSessionStore.ts`). This, not the
  `attackid`, is what authorises the attacker's `/base/save` against someone else's row. It is
  written after the flush, so a wild monster camp created by this very request already has its
  `basesaveid`.
- A `world_map_cell` row is created for a wild monster camp being attacked for the first time, with
  `base_type = WM` and terrain height recomputed from noise (`baseModeAttack.ts:128-163`). The row
  it would have found is looked up earlier, at `:97`, so the range check can use its coordinates.
- An `AttackLogs` row is written and `save.lastattackername` set, for non-tribe targets
  (`baseModeAttack.ts:194-204`, `server/src/services/base/createAttackLog.ts:17-39`).

### Range

The rule itself is pure and lives in `server/src/services/maproom/v2/rangeCheck.ts`: coordinates
and flinger levels in, a verdict out, no database. `validateRange.ts` is the half that loads what
the rule needs and turns a refusal into the error the client gets. That split is what let the check
move ahead of the writes (issue #26); the rule's arithmetic is unchanged.

Map Room 2 range is a **square** (Chebyshev) distance on the toroidal grid, not a hex distance —
the code says so (`rangeCheck.ts:136-158`).

| Flinger level | Main-yard range | Outpost range |
| --- | --- | --- |
| 0 | 0 | 0 |
| 1 | 4 | 1 |
| 2 | 6 | 2 |
| 3 | 8 | 3 |
| 4+ | 10 | 4 |

(`rangeCheck.ts:87-128`.) `DECLARE_WAR_RANGE = 2` is added to any non-zero range
unconditionally on the server, whether or not the powerup is active
(`rangeCheck.ts:23`, `:79`). The client only adds it when `ALLIANCE_DECLAREWAR` is really
running (`PowDeclareWar` returns `range + 2`, `client/scripts/POWERUPS.as:341-344`).

The main yard is checked first; if it is out of range the server sweeps a
`MAX_OUTPOST_RANGE + DECLARE_WAR_RANGE = 6` cell box around the target for owned outposts
(`rangeCheck.ts:192`), looks up just those outposts' flinger levels, and tests them
(`rangeCheck.ts:271`). One quirk survives the move, deliberately: the flinger level of one nearby
outpost is tested against the *offsets of every other*, so in practice the strongest flinger inside
the box decides for all of them. Issue #26 was about when the check runs, not what it decides, so
it was preserved exactly rather than quietly tightened.

A refusal is one of five reasons, each keeping the wording it threw before
(`validateRange.ts:171-190`): no homebase, no attack cell, no outposts owned, no outposts near the
cell, and nothing in range. Only the last writes a report row.

### What the client loads about the target

The attack-mode `/base/load` response is the standard save envelope described in
`docs/server-api.md` §Base / Yard. The combat-relevant fields:

| Field | Used for |
| --- | --- |
| `buildingdata` | Every building: type, level, grid position, build/upgrade countdowns |
| `buildinghealthdata` | Per-building current health, only for buildings below full |
| `monsters` | The defender's housing and bunker contents, read by `HOUSING` / `MONSTERBUNKER` |
| `champion` | The defending champion's type, level and hp |
| `resources` + `rNmax` | The pool `BSTORAGE` loots from, and storage caps |
| `powerups` | The defender's alliance buffs |
| `attpowerups` | The attacker's alliance buffs; attack modes only |
| `attackid` | Read into `BASE._attackID` (`client/scripts/BASE.as:832`) and echoed back on every save |
| `protected` | Read into `BASE._isProtected`, used to decide whether to offer the taunt button |

Traps arrive inside `buildingdata` as ordinary buildings of type 24 or 117. They are placed like
any other building and then hidden from view outside build mode
(`client/scripts/BTRAP.as:33-36`).

---

## 3. Monster selection and deployment

### Where the attacker's monsters come from

`ATTACK._curCreaturesAvailable` is a map of creature id to count.

- Outside Map Room 2, it is filled from the player's own housing:
  `numHealthyHousedCreeps` per monster type (`client/scripts/ATTACK.as:181-190`).
- In Map Room 2, it is filled **before** the yard loads, from the map cells in flinger range, and
  `ATTACK.Setup` only snapshots it into `GLOBAL._attackerMapCreaturesStart`
  (`ATTACK.as:191-196`). See `docs/specs/maproom2.md` §Attack.

### Flinger capacity

Capacity per fling is `GLOBAL._buildingProps[4].capacity[_attackersFlinger - 1]`, index 4 being
building type 5, the Monster Flinger (`client/scripts/ATTACK.as:589`).

| Yard props set | Capacity by flinger level 1..6 | Source |
| --- | --- | --- |
| Map Room 3 / base table | 250, 850, 1500, 2500, 3500, 3500, 3500 | `client/scripts/YARD_PROPS.as:598` block |
| **Map Room 2 (overridden)** | **500, 1000, 1750, 2250, 3000, 4000** | `client/scripts/GLOBAL.as:713` |

`ALLIANCE_DECLAREWAR` with scope `OFFENSE` adds `floor(capacity * 0.25)`
(`ATTACK.as:593-595`).

**In Map Room 2 the attacker's flinger level is forced to 4** whenever the current mode equals the
load mode (`GLOBAL.as:856-864`), giving a fixed capacity of 2250 before the alliance bonus. The
flinger level read from the loaded yard at `GLOBAL.as:830-832` belongs to the defender and is
overwritten by that branch.

Capacity is **per fling, not per attack**, in Map Room 2. The cumulative counter `_flungSpace` is
subtracted from capacity only when `USE_CUMULATIVE_FLINGER_CAPACITY` is true **and** the session is
in Map Room 3 (`ATTACK.as:30`, `:596-598`). The real limit on total monsters flung in Map Room 2 is
the number of monsters housed in range and the countdown.

Each monster type costs `bucket` space; see the table in §4.

### Housing capacity (the pool being drawn from)

| Building | Map Room 2 capacity by level | Source |
| --- | --- | --- |
| Housing (type 15) | 200, 260, 320, 380, 450, 540 | `client/scripts/GLOBAL.as:682` |
| Monster Bunker (type 22) | 380, 450, 540, 660, 800 | `client/scripts/GLOBAL.as:683` |

### The fling flow, click by click

The monster panel is not a popup. `setupAttackMode` builds it into the HUD as soon as the attack
screen opens (`client/scripts/UI_TOP.as:251-302`). It is a vertically scrolling list, one 53 px row
per champion then one per monster type that has a non-zero count
(`UI_TOP.as:328-391`), masked to `screenHeight - 476` pixels with a `ScrollSetV` scrollbar
(`UI_TOP.as:276-287`).

**Monster row.** Two buttons, `+` and `-` (`client/scripts/CREATUREBUTTON.as:50-60`).

- `+` mouse-down → `UI2._top.BombDeselect()`, then one `ATTACK.BucketAdd`, then
  `ATTACK.BucketUpdate` (`CREATUREBUTTON.as:106-125`).
- Holding `+` auto-repeats: after 10 `ENTER_FRAME`s, one further add every 2 frames
  (`CREATUREBUTTON.as:113-119`). The repeat stops as soon as the cursor leaves the button's
  rectangle (`CREATUREBUTTON.as:148-152`).
- `-` is the mirror image (`CREATUREBUTTON.as:127-146`).

`BucketAdd` (`ATTACK.as:586-623`) refuses silently when the type's available count is 0 or when the
remaining capacity is less than that monster's `bucket` cost. It decrements
`_curCreaturesAvailable` and increments `_flingerBucket[id]`.

**Champion row.** A single `Send` button that toggles to `Hold`
(`client/scripts/CHAMPIONBUTTON.as:43-92`). One click adds the champion to the bucket, a second
click removes it. A separate `Retreat` button pulls an already-flung champion back
(`CHAMPIONBUTTON.as:94-99`). Once flung, `Send` is permanently disabled for that champion
(`CHAMPIONBUTTON.as:65-70`, `CREEPS._flungGuardian`).

Only one champion may be selected: the panel logs an error and skips any second champion whose
type is not 5 (`UI_TOP.as:340-347`).

**Drop zone.** Any change to the bucket calls `ATTACK.BucketUpdate`
(`ATTACK.as:641-675`), which sums the bucket's space cost and then:

- if the total is 0, removes the drop zone;
- otherwise sizes the zone at `total / 4`, floored at 200, and shows it as a `DROPZONE.GROUND` ring
  that follows the cursor (`ATTACK.as:664-673`, `client/scripts/DROPZONE.as:58-70`).

The ring turns invalid over any building footprint (`DROPZONE.as:64-69`, `Drop` at `:158-162`).

**The drop.** Mouse-up on the ring, provided the map was not being dragged and
`ATTACK._countdown >= 0` (`DROPZONE.as:52-56`), calls `ATTACK.Spawn(point, size / 2)`
(`DROPZONE.as:160`).

`ATTACK.Spawn` (`ATTACK.as:510-584`) then, for every entry in the bucket:

- picks a uniformly random angle and a radius in `[0, size/2)` and spawns the creep there in
  `"bounce"` behaviour (`ATTACK.as:529-531`, `:546-549`);
- sets `_hitLimit = int.MAX_VALUE` on the creep (`ATTACK.as:549`);
- outside Map Room 2/3, decrements the player's stored monster count by one per creep
  (`ATTACK.as:550-552`);
- accumulates `_flungSpace` and `_flingValue` (the sum of `cResource`);
- writes a log line, empties the bucket, sets `_flingerCooling = _flingerCooldown`, calls
  `BASE.Save()` and removes the drop zone (`ATTACK.as:576-583`).

`_flingerCooldown` is 5 (`ATTACK.as:143`) and `_flingerCooling` counts down once per **slow** tick
(`ATTACK.as:234-236`), so the intended gap is five seconds. **`_flingerCooling` is never read
anywhere** — there is no code that blocks a second fling while it is non-zero
(the only references are the declaration, the reset, the decrement and the assignment). The
cooldown does not currently exist as a rule.

**Click count for one fling.** To send `N` monsters (any mix of types) plus a champion:

| Step | Clicks |
| --- | --- |
| `+` on a monster row, once per individual monster | N |
| `Send` on the champion row | 1 |
| Mouse-up on the drop zone | 1 |
| **Total** | **N + 2** |

Press-and-hold collapses the N into one long press per type, at roughly 20 adds per second after a
10-frame delay. Scrolling the list is an extra drag whenever the player owns more monster types
than fit in `screenHeight - 476` pixels at 53 px per row.

A realistic wave of 30 Pokeys, 5 Finks and a champion is therefore **37 clicks**, or 3 presses and
1 click if the player uses hold-to-repeat. A full attack is several such waves.

### Catapult (resource bombs)

`CATAPULTPOPUP` is the resource-bomb UI, not the monster flinger. It only appears when
`GLOBAL._attackersCatapult > 0` and the yard is not Inferno (`UI_TOP.as:296-302`).

Three clicks per bomb:

1. Click the catapult image → `CATAPULTPOPUP.Show` opens the bomb grid
   (`client/scripts/CATAPULTPOPUP.as:60`, `:165-198`).
2. Click a bomb tile → `downBomb` hides the grid, sets `ResourceBombs._bombid`, and immediately
   calls `Fire` → `ResourceBombs.BombAdd`, which raises a drop zone of the bomb's radius
   (`CATAPULTPOPUP.as:83-94`, `:200-213`,
   `client/scripts/com/monsters/effects/ResourceBombs.as:274-280`).
3. Click a valid target → `DROPZONE.Drop` → `ResourceBombs.BombDrop`
   (`DROPZONE.as:163-172`, `ResourceBombs.as:292-329`).

Opening the catapult grid is destructive. `Show` returns every non-champion monster in the bucket
to the available pool, deselects a sent champion, removes the drop zone and cancels a pending siege
weapon before it opens (`CATAPULTPOPUP.as:168-187`).

A bomb costs its `cost` in the matching resource, taken from the attacker's pool, and **marks every
bomb of that resource type as used for the rest of the attack**
(`ResourceBombs.as:301-315`). So at most one twig bomb, one pebble bomb and one putty bomb per
attack.

| Bomb | Catapult lvl | Resource | Cost | Radius | Damage | Drop target | Other |
| --- | --- | --- | --- | --- | --- | --- | --- |
| tw0 | 1 | r1 | 10,000 | 200 | 2,200 | buildings | |
| tw1 | 1 | r1 | 100,000 | 200 | 7,000 | buildings | |
| tw2 | 1 | r1 | 5,000,000 | 200 | 50,000 | buildings | |
| pb0 | 2 | r2 | 10,000 | 200 | 2,400 | buildings | |
| pb1 | 2 | r2 | 100,000 | 300 | 9,000 | buildings | |
| pb2 | 2 | r2 | 2,000,000 | 350 | 30,000 | buildings | |
| pb3 | 2 | r2 | 10,000,000 | 400 | 75,000 | buildings | |
| pu0 | 3 | r3 | 10,000 | 150 | 0 | monsters | speed ×1.2 for 10 s, damage ×0.2 |
| pu1 | 3 | r3 | 100,000 | 150 | 0 | monsters | speed ×1.4 for 15 s, damage ×0.4 |
| pu2 | 3 | r3 | 5,000,000 | 300 | 0 | monsters | speed ×1.8 for 30 s, damage ×0.7 |
| pu3 | 3 | r3 | 10,000,000 | 500 | 0 | monsters | speed ×2.0 for 40 s, damage ×0.9 |

(`ResourceBombs.as:48-178`. `damageMult` is the multiplier the buffed monsters' damage is scaled
*by*; the tooltip shows `1 - damageMult` as a penalty, `client/scripts/CATAPULTITEM.as:88`.)
Putty bombs target your own monsters, so they are only offered while at least one monster or
champion is still available (`ATTACK.as:254-265`).

### Siege weapons

`SIEGEWEAPONPOPUP` appears when `SiegeWeapons.availableWeapon != null` and the yard is not Inferno
(`UI_TOP.as:289-295`). Three weapons exist: Decoy, Vacuum and Jars
(`client/scripts/com/monsters/siege/SiegeWeapons.as:22-24`).

Two clicks per use:

1. Click the weapon image → `Target()`. If the weapon has a range it raises a drop zone of that
   range and the weapon's `dropTarget`; if not it fires immediately
   (`client/scripts/SIEGEWEAPONPOPUP.as:341-362`).
2. Click a valid target → `DROPZONE.Drop` → `SIEGEWEAPONPOPUP.Fire`
   (`DROPZONE.as:173-199`, `SIEGEWEAPONPOPUP.as:395-405`).

| Weapon | Drop target | Notes |
| --- | --- | --- |
| Decoy | `SIEGEWEAPON_GROUND_SPECIAL` — must land clear of buildings within a 30 px radius, and highlights nearby `BUILDING22` bunkers | `client/scripts/com/monsters/siege/weapons/Decoy.as:52`, `DROPZONE.as:20`, `:139-146` |
| Vacuum | `SIEGEWEAPON_GROUND` — must land clear of buildings; `canFire` also requires a valid target | `weapons/Vacuum.as:21`, `:168-169` |
| Jars | `SIEGEWEAPON_BUILDINGS` — must land on a building, and only `BTOWER` instances are highlighted | `weapons/Jars.as:34`, `DROPZONE.as:130-137` |

Activating a weapon decrements its `quantity`, writes an attack-log line and, if it has a
duration, starts a one-second-interval timer for that many seconds
(`SiegeWeapons.as:52-68`). A jarred tower is skipped by every monster targeting branch
(`client/scripts/com/monsters/monsters/MonsterBase.as:1035`, `:1078-1082`) and its jar has its own
health pool (`BTOWER.as:251-281`).

### Waves

**There is no wave system in an attack.** `client/scripts/UI_NEXTWAVE.as` is the special-event
wave bar for the player's *own* yard: `ShouldDisplay()` requires `GLOBAL.mode` to be `BUILD`, the
yard to be the main yard, the tutorial finished and a special event to be running and not yet
active (`UI_NEXTWAVE.as:14-34`). Clicking it calls `SPECIALEVENT.StartRound()`
(`UI_NEXTWAVE.as:36-38`).

Waves in an attack are emergent: the player flings a group, waits, and flings another. Nothing
numbers them except `ATTACK._flingCount`, used as a log key (`ATTACK.as:571-576`).

### Mutual exclusion between the three deployment tools

The three tools cancel each other, which is the main source of lost input:

| Action | Cancels |
| --- | --- |
| `+`/`-` on a monster row | The selected bomb (`CREATUREBUTTON.as:107`, `:128`) |
| Any bucket change | The pending bomb and the pending siege weapon (`ATTACK.BucketUpdate`, `ATTACK.as:660-663`) |
| Opening the catapult grid | The whole monster bucket, the champion selection, the drop zone and the siege weapon (`CATAPULTPOPUP.as:168-187`) |
| Selecting a bomb | The siege weapon (`CATAPULTPOPUP.as:202-204`) |
| Selecting a siege weapon | Whatever `ZeroOutAttacks()` clears (`SIEGEWEAPONPOPUP.as:346`) |

---

## 4. Monster behaviour

### Stats

From `server/src/game-data/stats/monsterStats.ts`. Arrays are indexed by academy level (1..6); a
one-element array means the value does not scale. `bucket` is flinger space, `cStorage` is housing
space. `targetGroup` is explained below.

| ID | Name | Speed | Health | Damage | Range | Attack delay | Target group | Bucket | Line |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| C1 | Pokey | 1.2 | 200→300 | 60→85 | melee | 60 | 1 all | 7 | `:41` |
| C2 | Octo-ooze | 1.4 | 1000→1800 | 15→35 | melee | 60 | 4 towers | 10 | `:66` |
| C3 | Bolt | 2.5→3.2 | 150 | 15→55 | melee | 60 | 3 resources | 15 | `:91` |
| C4 | Fink | 1.3 | 200→240 | 300→520 | melee | 60 | 1 all | 20 | `:116` |
| C5 | Eye-ra | 2→3 | 600→2400 | 4000→24000 | suicide | 60 | 2 walls | 60 | `:141` |
| C6 | Ichi | 1.2 | 2000→2800 | 50→110 | melee | 60 | 4 towers | 20 | `:167` |
| C7 | Bandito | 1.0 | 500→900 | 200→450 | melee | 60 | 1 all | 20 | `:192` |
| C8 | Fang | 1.1→1.6 | 400 | 600→800 | melee | 60 | 1 all | 30 | `:217` |
| C9 | Brain | 2→2.2 | 600→1400 | 100→350 | melee | 60 | 3 resources | 30 | `:242` |
| C10 | Crabatron | 1→1.5 | 4000→4800 | 100→170 | melee | 60 | 4 towers | 40 | `:267` |
| C11 | Project X | 0.9→1.3 | 800→1200 | 1200→2200 | melee | 60 | 4 towers | 70 | `:292` |
| C12 | D.A.V.E. | 0.8→1.2 | 8000→21000 | 1500→1900 | melee | 60 | 1 all | 160 | `:317` |
| C13 | Wormzer | 3→4 | 600→1700 | 300→700 | melee | 60 | 1 all | 70 | `:342` |
| C14 | Teratorn | 2.5→3.5 | 1600→4200 | 300→700 | 150 | 90 | 1 all | 70 | `:369` |
| C15 | Zafreeti | 0.75→0.95 | 8000 | −400→−1000 | 150 | 20 | 5 heal | 200 | `:396` |
| C16 | Vorg | 1.5→2.5 | 750 | −60→−110 | 150 | 10 | 5 heal | 60 | `:422` |
| C17 | Slimeattikus | 1→1.5 | 700→1000 | 850→1400 | melee | 60 | 1 all | 40 | `:449` |
| C18 | (Slime spawn) | 1.5→2 | 250 | 310→350 | melee | 60 | 1 all | 40 | `:475` |
| C19 | Rezghul | 0.8→1.3 | 7000→10000 | 700→1200 | 200 | 60 | 4 towers | 250 | `:498` |

Inferno monsters, same file:

| ID | Name | Speed | Health | Damage | Range | Target group | Bucket | Line |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| IC1 | Spurtz | 1.2 | 400→550 | 160→350 | melee | 1 all | 15 | `:526` |
| IC2 | Zagnoid | 1.8 | 1500→3600 | 80→110 | melee | 4 towers | 15 | `:551` |
| IC3 | Malphus | 3.2 | 450→620 | 100→140 | melee | 3 resources | 15 | `:576` |
| IC4 | Valgos | 2.0 | 2000→4000 | 490→775 | melee | 2 walls | 30 | `:601` |
| IC5 | Balthazar | 4.5 | 3200→5600 | 600→930 | melee | 6 hunt | 40 | `:626` |
| IC6 | Grokus | 1.3→1.6 | 7600→12500 | 400→550 | melee | 3 resources | 50 | `:651` |
| IC7 | Sabnox | 1.7→2.2 | 1120→2200 | 700→1350 | 240 | 4 towers | 80 | `:676` |
| IC8 | King Wormzer | 2.5→3.0 | 6200→16000 | 1200→2500 | melee | 1 all | 100 | `:702` |

Notes on the fields:

- **Speed in the table is the raw data value, which is not the movement rate.** It is halved on
  construction (`CreepBase.as:84`) and halved again every step
  (`_speed = moveSpeed * 0.5`, `CreepBase.as:1456`), so the effective per-tick step is a quarter of
  the number shown. Behaviour then scales it: pen ×0.5, juice/housing/bunker ×1.5, defend ×1.5,
  attacking ×0 (`CreepBase.as:1457-1471`). During the tutorial (`TUTORIAL._stage < 200`) the base
  value is doubled back (`CreepBase.as:85-87`).
- **Attack delay** is in fast ticks between attacks. The default when `attackDelay` is absent is 60
  (`client/scripts/com/monsters/monsters/creeps/CreepBase.as:108-111`), so roughly 0.75 s at 80 Hz.
- **Negative damage heals.** Zafreeti and Vorg use `targetGroup 5` and negative `damage`; they
  switch to `changeModeHeal()` on spawn (`CreepBase.as:195-197`). Zafreeti has five levels, not six.
- **`explode: [1]`** replaces the normal attack with a suicide blast (`CreepBase.as:75`, `:896-898`,
  `:762-835`). Eye-ra is the only user. Buildings within 60 px take
  `damage * (3600 - d²) / 3600`; the creep it is touching takes full damage inside 30 px; defending
  non-flying creeps within 90 px take falloff damage; then the attacker sets its own health to 0.
- **Movement** is `"ground"` unless the stat block overrides it. Only Wormzer declares
  `movement: "burrow"` with `pathing: "direct"` in the overworld set
  (`server/src/game-data/stats/monsterStats.ts:342` block), and only in `monsterStats` — the
  `mr3MonsterStats` copy at `:922` omits it.
- `mr3MonsterStats` (same file, from `:729`) repeats the same `props` blocks for Map Room 3, with
  Pokey's `bucket` and `cStorage` differing and Wormzer's movement fields absent.
- `cTime`, `cResource`, `cStorage`, `hTime`, `hResource` and `trainingCosts` are production and
  housing economy, not combat.

### Target groups and the targeting algorithm

`targetGroup` is read on construction (`CreepBase.as:74`) and drives
`MonsterBase.findTarget(targetGroup)` (`client/scripts/com/monsters/monsters/MonsterBase.as:991-1171`).

| Value | Preference | Candidate set | Line |
| --- | --- | --- | --- |
| 1 | No preference | Every building in `BASE._buildingsMain` that is alive and not `decoration`, `immovable` or `enemy` | `:1072-1086` |
| 2 | Walls | `BASE._buildingsWalls`, not destroyed, health > 0 | `:1011-1017` |
| 3 | Resource buildings | `BASE._buildingsMain` where the building is `ILootable`, alive and `!_looted` | `:1019-1025` |
| 4 | Defence towers | `BASE._buildingsTowers`; bunkers only count while they still hold or have dispatched monsters; jarred towers and traps are skipped | `:1027-1039` |
| 5 | Heal | Handled before `findTarget` — the creep enters `changeModeHeal()` | `CreepBase.as:195-197`, `:384-389` |
| 6 | Hunt monsters and bunkers | Living defending creeps via `findHuntingTargets()`, plus any bunker in `BASE._buildingsBunkers` that is in use | `:1041-1069` |

The algorithm is:

1. Collect the candidate set for the preference. For each candidate, distance is
   `QuickDistance(creepGridPos, buildingGridPos) - building._middle` — centre to centre, minus half
   the building's footprint (`:997-1008`).
2. Keep the closest and the second-closest.
3. **If the preferred set is empty, fall through to the "all buildings" set** and, unless the
   creep's group is 4, permanently rewrite its own `_targetGroup` to 1 (`:1072-1077`). A tower
   specialist keeps hunting towers forever; every other specialist degrades to a generalist the
   first time its preference runs dry.
4. If nothing at all is left, retreat (`:1087-1090`).
5. Otherwise, move:
   - **Burrowing** monsters teleport their waypoint to a random one of the four sides of the target
     and ignore the path entirely (`:1092-1118`).
   - **Flying** monsters orbit. If already within 170 px of the target centre they are "at target";
     otherwise they pick a waypoint on a ring of radius `120 + random(10)`, stretched 1.7× on x, at
     the current bearing ± 20° (`:1147-1158`). Balthazar (`IC5`) uses a 50 px threshold and a
     `30 + random(10)` ring (`:1125-1146`).
   - **Everything else** requests a path to the closest building, and a second path to the
     second-closest (`:1160-1169`).

Retargeting cadence: a creep that is neither looking nor attacking re-runs `findTarget` every 150
fast ticks, or every 300 in catch-up mode (`CreepBase.as:874-876`). It also retargets immediately
when its target dies, when a `targetGroup 3` creep's target becomes `_looted`, or when its target
tower gets jarred (`CreepBase.as:854-857`). A hunting creep re-runs it every 150 ticks regardless
(`CreepBase.as:851-853`).

`targetGroup 3` creeps carry a permanent loot bonus: an `AdditionPropertyModifier(1.5)` is added to
their loot property at construction (`CreepBase.as:224-226`).

**Specialists also hit their preferred class harder.** The multiplier is applied per swing in
`tickBAttack` (`CreepBase.as:884-894`):

| Condition | Damage multiplier |
| --- | --- |
| Behaviour is hunt and the target is a creep | × 3 |
| `targetGroup 2` and the target's `_class` is `wall` | × 2 |
| `targetGroup 4` and the target's `_class` is `tower` | × 2 |

Eye-ra's listed 4000–24000 damage is therefore 8000–48000 against a wall, and a tower specialist
does double against towers. The two building multipliers are independent `if`s rather than an
else-chain, but no monster has both groups, so they never stack.

Two further melee rules. Hitting a creep in melee drags it into defend mode against the attacker if
it was not already engaged (`CreepBase.as:906-915`), which is how a bunker dispatch turns into a
brawl. And a ranged attack needs line of sight, not just range: `canShootCreep` and
`canShootBuilding` test squared distance **and** `PATHING.LineOfSight`
(`CreepBase.as:720-748`).

Attacking creeps also ignore the hit counter. `_hitLimit` defaults to 50 and a creep despawns once
`_hits` exceeds it (`MonsterBase.as:168`, `CreepBase.as:928-943`), but `ATTACK.Spawn` sets
`_hitLimit = int.MAX_VALUE` on every flung creep (`ATTACK.as:549`), so the limit only bites
defenders.

### Pathfinding

`client/scripts/com/monsters/pathing/PATHING.as` is a flood-fill over a 10 px grid.

| Rule | Value | Source |
| --- | --- | --- |
| Base cell cost | 10 | `:83`, reset to 10 at `:152` |
| Minimum cell cost | 2 | `:104-105` |
| Diagonal movement | cost × 1.5 | `:359-362` |
| Building cost | Added per building from its `_gridCost` rectangles, re-applied every reset for buildings with `health > 0` | `:154-165` |
| Wall registration | Only `BWALL` registers a `building` on its cells, a 20 × 20 rectangle | `client/scripts/BWALL.as:11-14` |
| Wall handling, normal | If the chosen path crosses a cell holding a living wall, the path is truncated there and the wall is handed back as the thing to attack | `:445-452` |
| Wall handling, ignore | With `ignoreWalls`, a wall cell costs a flat 20 instead of its real cost | `:355-357` |
| Scatter | Within depth 20 of the start, a path has a 60% chance per step of jumping to a random diagonal cell within ±3 that is also shallow — monsters spread out near the drop point | `:453-470` |

`ignoreWalls` is set for the juice, housing, pen, defend, feed and decoy behaviours and for the
jump movement type (`MonsterBase.as:1173-1177`). Attacking creeps never ignore walls: that is what
makes a maze work.

Typical building costs, as `[rectangle, cost]` pairs: a resource building is 10 on its outer
footprint and 200 on the inner (`client/scripts/BUILDING1.as:22`); the Town Hall is 10/200 over
130 px (`client/scripts/BUILDING14.as:19`); Housing is 400 on five separate strips
(`client/scripts/BUILDING15.as:22`); a wooden block is 20 outer and `100 + level * 25` inner
(`client/scripts/BUILDING17.as:14`, raised at `client/scripts/BFOUNDATION.as:3151`).

### Abilities

Abilities are components attached at spawn, almost all gated behind `poweredUp()` — the academy
upgrade.

| Monster | Component | Effect |
| --- | --- | --- |
| Bandito (C7) | `BanditoAOEDamageSpin(60, flags, 60, false)` | Periodic 60 px area damage spin against ground units (`creeps/Bandito.as:11-16`) |
| Bolt (C3) | `Blink()` | Short-range teleport (`creeps/Bolt.as:11-13`, `abilities/Blink.as`) |
| Brain (C9) | `Invisibility(powerUpLevel())` | Untargetable while invisible; sets `aggroRange = 1` (`creeps/Brain.as:11-13`, `abilities/Invisibility.as:44`) |
| D.A.V.E. (C12) | `DAVERockets()` | Sets `targetMode = 1` and fires two half-damage missiles per attack instead of one (`creeps/DAVE.as:11-13`, `:16-23`) |
| Eye-ra (C5) | `targetMode = 1` | No component; changes what it may shoot (`creeps/Eyera.as:11-13`) |
| Fang (C8) | `PoisonOnAttack()` | Damage over time on hit (`creeps/Fang.as:11-13`) |
| Fink (C4) | `AOEDamageOnAttack(60, flags, powerUpLevel(), 60, false)` | 60 px splash on each hit, against buildings and ground units (`creeps/Fink.as:12-17`) |
| Project X (C11) | `AOEDamageOnDeath(60, flags)` | 60 px blast on death (`creeps/ProjectX.as:11-20`) |
| Rezghul (C19) | `RezghulResurrectAttack(300, cooldown, flags, 50, proj, Zombiefy)` — **always on** | Fires a 300 px projectile at a dead friendly creep and revives it as a zombie with the stat multipliers from `zombieSpeedMultiplier` / `zombieHealthMultiplier` / `zombieDamageMultiplier`; `resurrectCooldown` gates it (`creeps/Rezghul.as:48-53`) |
| Slimeattikus (C17) | `DeathSplit(this, "C18")` — **always on** | Splits into `splits[level]` = 2,2,3,3,4,5 C18 spawns on death (`creeps/Slimeattikus.as:11-13`, stats `:449`) |
| Teratorn (C14) | `GlavesOnAttack(powerUpLevel())` | Extra projectiles on attack; ranged attack spawns a `TYPE_MAGMA` fireball (`creeps/Teratorn.as:12-15`, `:18-23`) |
| Vorg (C16) | none | Ranged healer; `attackFlags = getOldStyleTargets(1)` so it can reach both ground and flying friendlies (`creeps/Vorg.as:12`) |
| Wormzer (C13) | `AOEDamageOnAttackOncePerTarget(100, flags, powerUpLevel())` | 100 px splash, each target hit at most once per swing (`creeps/Wormzer.as:11-21`) |
| Zafreeti (C15) | none | Ranged healer, same target flags as Vorg (`creeps/Zafreeti.as:12`) |

Other components in `com/monsters/monsters/components/abilities/` that exist but are attached
elsewhere: `AbsorbProjectiles`, `AcidOnDeath`, `AOEEnrage` (re-checks range every 30 ticks,
`AOEEnrage.as:22`), `AOEHealOnDeath` (defaults 200 px radius), `AOEZergBonus`, `BlinkOnAttack`,
`Enrage`, `LootingMultiplier`, `ProximityLootBuff`, `RangedAttack`, `TemporaryComponent`,
`TowerTaunt` (500 px default).

### Targeting flags

`Targeting` uses a bitmask, not a type enum (`client/scripts/Targeting.as:11-23`):

| Flag | Bit |
| --- | --- |
| `k_TARGETS_DEFENDERS` | 1 |
| `k_TARGETS_ATTACKERS` | 2 |
| `k_TARGETS_GROUND` | 4 |
| `k_TARGETS_FLYING` | 8 |
| `k_TARGETS_INVISIBLE` | 16 |
| `k_TARGETS_BUILDINGS` | 32 |

`getOldStyleTargets(n)` converts the legacy "flyer mode" integer (`Targeting.as:175-190`):

| n | Expands to |
| --- | --- |
| −1 | ground + invisible + attackers |
| 0 | ground + attackers |
| 1 | ground + flying + attackers |
| 2 | flying + attackers |

A hit is legal when `canHitCreep(attackerFlags, defenceFlags)` — `!(~attackerFlags & defenceFlags)`,
that is, the attacker must cover every flag the defender declares (`Targeting.as:322-325`).

Creep lookup is bucketed into 100 px cells keyed `"node<x>|<y>"`, with live and dead creeps in
separate maps (`Targeting.as:25-29`, `:41-52`). A radius query scans
`floor(radius / 100) + 1` cells in each direction (`Targeting.as:213-221`).

### Champions

From `server/src/game-data/stats/championStats.ts`, arrays indexed by level 1..6 (Krallen 1..5).

| ID | Name | Speed | Health | Damage | Range | Attack | Bucket | Heal time (s) | Line |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| G1 | Gorgo | 1→2 | 40k→200k | 1000→3000 | 35→70 | melee | 240 | 3600→115200 | `:40` |
| G2 | Drull | 2→3.6 | 12k→60k | 3000→8000 | 35→90 | melee | 180 | 3600→115200 | `:69` |
| G3 | Fomor | 1.2→2.3 | 15k→40k | 70→120 | 140→210 | ranged | 200 | 3600→115200 | `:98` |
| G4 | Korath | 1.4→2.5 | 28k→175k | 2000→6500 | 35→65 | melee | 200 | 3600→115200 | `:127` |
| G5 | Krallen | 2.2→2.6 | 50k→62k | 800→1200 | 35→65 | melee | 200 | 7200→115200 | `:156` |

All five declare `targetGroup: [0]`, which matches none of the preference branches, so
`findTarget` falls straight through to the "all buildings" set. `ChampionBase` overrides
`findTarget` and sets `_targetGroup = 3` in its constructor
(`client/scripts/com/monsters/monsters/champions/ChampionBase.as:116`, `:547`); it refuses to treat
a wall as a target unless `_targetGroup == 2` (`ChampionBase.as:708`).

**Every champion attacks on a fixed 56-tick delay**, not a per-champion value
(`ChampionBase.as:164`). Fomor overrides it to 8 (`champions/Fomor.as:12`); Korath sets
72/72/80/80/80/80 by level (`champions/Korath.as:25-46`).

Champions also carry the same permanent +1.5 loot modifier as `targetGroup 3` creeps
(`ChampionBase.as:221`).

Two champions carry aura values. Fomor's `buffs` runs 0.1→0.6 and Krallen's 0.2→0.3 with a
`buffRadius` of 250→350. Krallen's buff raises the attacker's resource **cap** during looting
(`client/scripts/ATTACK.as:698-702`), and she additionally carries hard-coded per-building loot
multipliers: **×2 against `BRESOURCE` and ×3 against `BSTORAGE`**
(`champions/Krallen.as:31-32`). She overrides `findTarget` to sweep un-looted lootables first, then
non-jarred towers, then bunkers (`champions/Krallen.as:60-110`).

Korath and Fomor have combat behaviour beyond their stat lines. Korath applies a burning damage-over-time
of `damage * 0.1` on every hit (`champions/Korath.as:162-165`) and unlocks an anti-air fireball at
power level 2 and a ground stomp over `range * 2.5` at power level 3
(`Korath.as:110-134`, `:167-200`). Fomor attaches `AOEEnrage(250, 1 + buff*2, buff)`, buffing nearby
allies rather than only shooting (`champions/Fomor.as:18-19`).

`bonusSpeed`, `bonusHealth`, `bonusRange`, `bonusDamage` and `bonusBuffs` are the three
post-maximum feeding tiers.

A champion may be flung only if `hp > 0` and `status == k_CHAMPION_STATUS_NORMAL`
(`ATTACK.as:122-126`, `UI_TOP.as:336-339`).

---

## 5. Defences

### Towers

Stats live in the client's yard-props table, indexed `GLOBAL._buildingProps[type - 1].stats[level - 1]`
(`client/scripts/BTOWER.as:91-113`). `rate` is in fast ticks; the tower re-arms with
`_fireTick += _rate * 2` (`BTOWER.as:180`), so a `rate` of 40 is roughly one shot per second at
80 Hz. `speed` is projectile speed. Range is in pixels.

| Type | Name | Levels | Range | Damage | Rate | Splash | Health | Line |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 20 | Cannon Tower | 10 | 160→250 | 20→200 | 40 | 30→75 | 6k→98.2k | `YARD_PROPS.as:1966` |
| 21 | Sniper Tower | 10 | 300→372 | 100→1100 | 80 | 0 | 6k→98.2k | `:2187` |
| 23 | Laser Tower | 8 | 160→180 | 120→280 | 80 | 40 | 9k→58k | `:2487` |
| 25 | Tesla Tower | 8 | 250→400 | 100→240 | 10→35 | 0 | 15k→90k | `:2728` |
| 115 | Flak Tower | 8 | 300→440 | 200→400 | 60 | 180→225 | 15k→90k | `:6033` |
| 118 | Railgun Tower | 8 | 300→400 | 400→2500 | 160 | 0 | 17.6k→110k | `:6324` |
| 129 | Quake Tower (Inferno) | 6 | 160→210 | 1100→4400 | 15 | — | 10k→34k | `:6872` |
| 132 | Magma Tower (Inferno) | 6 | 180→230 | 180→480 | 20 | 0 | 15k→70k | `:7142` |
| 136 | Spurtz Cannon (Inferno) | 5 | 300→500 | 280→360 | 72→170 | 35→75 | 15k→60k | `:7551` |
| 137 | Black Spurtz Cannon | 5 | 300→500 | 330→410 | 72→170 | 35→75 | 16.5k→66k | `:7663` |
| 22 | Monster Bunker | 5 | 300→500 | dispatches monsters | — | — | 10k→105k | `:2410` |
| 128 | Housing Bunker | — | — | — | — | — | — | `:6857` |
| 138 | Stronghold | 3 | — | — | — | — | 400k→600k | `:7775` |

Type 130 (Inferno Cannon Tower) has no `stats` block in `YARD_PROPS.as`.

**What each tower may shoot.** A per-type "flyer mode" table feeds `getOldStyleTargets`
(`BTOWER.as:25-35`, used at `:390-393`):

| Type | Mode | Meaning |
| --- | --- | --- |
| 20 Cannon, 23 Laser, 118 Railgun, 129 Quake, 130 Inferno Cannon | 0 | Ground only |
| 21 Sniper, 25 Tesla, 132 Magma | 1 | Ground and flying |
| 115 Flak | 2 | **Flying only** |

Types absent from the table fall through to mode 0 as well (`_loc9_` stays 0).

**Target selection.** `FindTargets(maxTargets, priority)` (`BTOWER.as:382-427`):

1. `Targeting.getCreepsInRange(range, position + (0, footprintHeight/2), flags)`.
2. Sort by `priority`: 1 = nearest first, 2 = farthest first, 3 = highest health first, 4 = lowest
   health first (`:398-409`).
3. Keep the first `maxTargets` entries.

Every `BTOWER` constructs with `_maxTargets = 1` and `_priority = 1`
(`BTOWER.as:71`, `:75`), so the default behaviour is **one target, the nearest**. Subclasses
override: `SpurtzCannon` sets `_maxTargets = 10` (`client/scripts/SpurtzCannon.as:53`) and
`HOUSINGBUNKER` calls `FindTargets(3)` (`client/scripts/HOUSINGBUNKER.as:270`).

Note that `rate` is used inconsistently. The fire loop re-arms with `_rate * 2`
(`BTOWER.as:179`) while the upgrade tooltip prints damage per second as `damage * 40 / rate`
(`BTOWER.as:144-148`). The two disagree by a factor of two; the fire loop is what actually runs.

**Fire loop.** `TickAttack` (`BTOWER.as:171-229`):

- Only fires when `canAttack` — health above zero and no build, upgrade or fortify countdown
  running (`:159-161`).
- Re-arms `_fireTick += _rate * 2`, then either acquires (`_fireTick = 30`) or fires.
- A vacuum hose in range preempts everything for towers whose flyer mode is truthy, with
  `_fireTick = 30` (`:189-194`, `:163-169`).
- Acquisition throttles under load: when `CREEPS._creepCount > 150`, `_fireTick` is padded by
  `creepCount / 15` (`:200-202`, `:220-222`).
- A dead, untargetable or invisible target forces an immediate re-acquire (`:207-218`).

**Range and terrain.** In Map Room 2, an outpost's or wild monster camp's tower range is scaled by
cell altitude: `cellHeight * range / GLOBAL._averageAltitude` (125), applied only when
`cellHeight >= 100` (`BTOWER.as:80-85`, `:94-99`). Main yards keep the flat value.

**Jars.** A jarred tower has `targetableStatus` raised so monsters skip it, and its jar has its own
health pool `Jars.durability` (`BTOWER.as:255-256`, `:280-281`).

**Two towers do not use the shared engine.**

The Stronghold (type 138, `client/scripts/GuardTower.as`) runs four independent Tesla emitters, each
covering its own arc: `(-180, 0)`, `(-90, 90)`, `(0, 180)` and a special `(90, 180)` compared on
absolute angle (`GuardTower.as:27-28`, `:206-208`). All four share the tower's level stats, so a
level-3 Stronghold is four emitters of 1100 damage at range 400. Each fires **hitscan** — a direct
`modifyHealth` with a lightning effect, no projectile (`:182-187`) — at the nearest
ground-or-flying attacker inside its arc (`:194-215`). Emitter positions shift as the tower takes
damage (`:105-114`). `ApplyJar` is overridden to a no-op, so **the Stronghold cannot be jarred**
(`:38-39`).

The Spurtz Cannons (types 136 and 137, `client/scripts/SpurtzCannon.as`) burst-fire. They hold up to
10 targets, rotate the barrel 1° per tick, and begin firing once within 20° of the current target;
at 2° they advance to the next one, so a burst sweeps across the group
(`:35-41`, `:121-165`). Shots per burst come from the `shots` stat. Damage scales with the cannon's
own condition: `damage * (0.5 + 0.5 * health / maxHealth)`, so a wrecked cannon still does half
(`:179`, `:187`), times 1.25 under tower overdrive (`:184-186`). Every impact has a **50% chance to
spawn a live defending Spurtz (IC1)**, culled after 100 frames on a 10%-per-tick roll
(`:35`, `:94-107`, `:229-250`).

### Traps

`BTRAP` (`client/scripts/BTRAP.as`) and its subclass `BHEAVYTRAP`.

| Property | Value | Source |
| --- | --- | --- |
| Trigger radius | 20 px, fixed for every trap | `BTRAP.as:25` |
| Blast radius | The building's `size`: 50 for type 24, 90 for type 117 | `YARD_PROPS.as:2682`, `:6283` |
| Damage | `damage[0]`: 1000 for type 24, 10000 for type 117 | same |
| Health | 10 | same |
| Targets | `getOldStyleTargets(-1)` — ground, invisible, attackers. Flying units never trigger a trap. | `BTRAP.as:26` |
| Retarget interval | 20 fast ticks while unfired | `BTRAP.as:50-54` |
| Single use | Yes: `_fired = true` and `setHealth(0)` | `BTRAP.as:114`, `:146` |
| Quantity allowed, by yard level | Type 24: 0,0,8,15,20,28,35,42,50,60,75. Type 117: 0,0,0,0,4,6,8,10,12,15,18 | `YARD_PROPS.as:2682` / `:6283` blocks |

Damage falls off linearly with distance:
`damage / size * (size - distance * 0.5)` (`BTRAP.as:106`). At distance 0 the target takes full
damage; the multiplier only reaches zero at `distance = 2 * size`, which is outside the query
radius, so every creep inside the blast takes at least half damage.

`BHEAVYTRAP` differs in three ways (`client/scripts/BHEAVYTRAP.as`):

- It only triggers on **large** monsters: creature ids `C10`–`C12` and `IC7`–`IC8`. Everything
  else walks over it (`:28-31`). It stops at the first qualifying target (`:38`).
- It damages ground units at full falloff damage, then runs a second pass on flying units at half
  (`:51-82`).
- A trap only counts as fired if it actually caught something: `_fired` is set inside
  `if (_loc8_ > 0)` (`BTRAP.as:113-114`, `BHEAVYTRAP.as:83-84`). A trap that explodes on nothing
  stays armed.

### Bunker monsters

`HOUSINGBUNKER.TickAttack` (`client/scripts/HOUSINGBUNKER.as:237-300`):

1. Capacity is refreshed from `_buildingProps.capacity[level - 1]` while the bunker lives (`:245-247`).
2. `FindTargets(3)` runs when there are no targets, or a target died, every 10 frames — and
   unconditionally every 60 frames (`:269-271`).
3. Every 30 ticks, with targets present, flyers and ground targets are each sorted by distance
   (`:273-276`).
4. Flying attackers are matched one-to-one with an interceptor from the unused pool (`:277-288`).
5. Ground attackers get the **whole remaining pool** dispatched at the single nearest target
   (`:289-298`).

`Bunker` itself only tracks `_used`, `_monstersDispatched` and `_monstersDispatchedTotal`
(`client/scripts/Bunker.as`). A bunker stops being a valid `targetGroup 4` or `6` target once it is
empty and has dispatched nothing (`MonsterBase.as:1029-1033`, `:1052-1068`).

### Defending champion

The defender's champion arrives in the load payload's `champion` field and fights as an ordinary
`ChampionBase` with `_friendly` inverted. Only its `hp` can be reduced by the attacker, and only
downward (`server/src/controllers/base/save/handlers/championHandler.ts:16-22`).

### What "destroyed" means for a building

Health is a `CModifiableProperty` on `BFOUNDATION`. `modifyHealth`
(`client/scripts/BFOUNDATION.as:499-542`) applies, in order:

1. Refuse if `!isTargetable` (`:501-505`).
2. Take the absolute value of the incoming amount (`:507`).
3. Fortification: `damage *= (100 - (fortLevel * 10 + 10)) / 100` (`:508-511`). Level 1 is −20%,
   level 2 −30%, and so on.
4. Armour: `damage *= (1 - armor)` (`:512`).
5. `setHealth(health - damage)`.
6. If health reached 0: clear `_repairing`, clamp to 0, and call `Destroyed()` once (`:513-520`).
7. Otherwise, if the building is not a wall, write a "damaged to N%" log line (`:521-527`).
8. If an attacker was named and the building is not destroyed, loot it for
   `damage * attacker.lootingMultiplier` (`:528-535`).

`Destroyed()` (`BFOUNDATION.as:1964-2015`) sets `_destroyed = true`, cancels any repair, and for a
building that was mid-build or mid-upgrade cancels that too. An upgrade being cancelled refunds
half the elapsed time, capped at 8 hours:
`refund = min((totalTime - remaining) * 0.5, 28800)`, and the countdown becomes
`remaining + refund` (`:1986-1994`). The building's grid cost is removed and pathing reset
(`:2010-2011`).

A destroyed building is not deleted. It keeps its row in `buildingdata` with health 0, and the
server re-sends the layout from the database on the next load.

---

## 6. Damage and loot

### Damage percentage

Computed inside `BFOUNDATION.getBuildingSaveData()`, which runs on every save
(`client/scripts/BFOUNDATION.as:425-472`):

```
_percentDamaged = 100 - 100 / s_totalBuildingMaxHP * s_totalBuildingHP
```

(`:468`.) The two sums are built at `:433-452` with these exclusions:

- Mushrooms and the building currently being placed are skipped entirely (`:435`).
- A fired trap, or a type-53 building past `_expireTime`, records health 0 and contributes to
  **neither** sum (`:439-442`).
- **Walls contribute to neither sum** (`:444`). Destroying a maze does not raise the damage
  percentage.
- When the yard is the player's own main yard **and** the mode is build, `s_totalBuildingHP` uses
  `maxHealth` rather than `health` (`:445-446`), so your own yard always reports 0% while you are
  building in it.

`ATTACK.EndB` computes its own percentage for the victory popup with a different filter
(`client/scripts/ATTACK.as:931-938`, duplicated in `CalculateBaseDamagePercent`, `:1098-1109`):

```as3
if (_loc7_._class != "wall"
    && (_loc7_._class == "trap" && _loc7_._class == "enemy" && _loc7_._fired) === false
    && (_loc7_._type == 53 && _loc7_._expireTime < GLOBAL.Timestamp()) === false)
```

`_class == "trap" && _class == "enemy"` can never both be true, so the middle clause is always
`false === false`, always true. **The end-of-attack popup therefore counts fired traps as
surviving buildings, while the value actually saved does not.** The two numbers disagree whenever a
trap went off. Treat the `getBuildingSaveData` figure as the real one.

### Victory

`BYMConfig.k_sVICTORY_THRESHOLD = 90` (`client/scripts/com/monsters/configs/BYMConfig.as:30`).

| Target | Win condition | Source |
| --- | --- | --- |
| Outpost (Map Room 2) | damage ≥ 90 | `ATTACK.as:944-949` |
| Wild monster camp (Map Room 2) | damage ≥ 90, and sets `WMBASE._destroyed = true` | `ATTACK.as:944-948` |
| Wild monster camp (Map Room 1) | The Town Hall (`BUILDING14`) at health 0 and not repairing | `ATTACK.as:957-969` |
| Player main yard | **No win state.** Map Room 2 simply reopens the map. | `ATTACK.as:992-994` |

`destroyed` is only sent for wild monster attacks and outposts:
`saveData.destroyed = _percentDamaged >= 90 ? 1 : 0`
(`client/scripts/BASE.as:3300`, `:3303`, `:3307`). Attacking a player main yard sends `damage` and
no `destroyed` key at all.

### Loot: damage becomes resources, one for one

The rule is simple and deliberate: **every point of damage dealt to a resource building takes one
unit of that resource out of it**, up to what the building is holding.

`BRESOURCE.Loot(amount)` (`client/scripts/BRESOURCE.as:93-127`):

1. `taken = min(_stored, amount)`.
2. Subtract it from `_stored` and call `ATTACK.Loot(type, taken, x, y, 0, this)`.
3. On an outpost, also subtract it from `BASE._resources` and the negative delta
   `BASE._deltaResources` (`:104-119`).
4. When `_stored` hits 0, set `_looted = true`, `_canFunction = false`, `_producing = 0`
   (`:121-125`) — which is exactly what makes `targetGroup 3` creeps move on.

Destroying a resource building loots its whole remaining store first
(`BRESOURCE.as:129-134`).

`BSTORAGE.Loot(amount)` (`client/scripts/BSTORAGE.as:30-90`) draws from the **yard's pooled
resources** instead:

1. Build the list of resource types with a positive pool balance.
2. Pick one uniformly at random.
3. `taken = min(ceil(amount), thatPool)`.
4. Subtract from `BASE._resources` and record the negative delta.
5. Scale what the attacker actually receives:
   - × 0.5 when the target is a Map Room 2 outpost (`:77-79`);
   - × 0.9 otherwise (`:80-82`);
   - then ÷ 5 on top of that for a wild monster camp (`:83-85`).
6. `ATTACK.Loot(type, scaledAmount, x, y, 9, this)`.

The random-type pick means storage loot is noisy per hit, not proportional to what the defender
holds.

The `amount` passed in is `damage * attacker.lootingMultiplier`
(`BFOUNDATION.as:528-534`). `lootingMultiplier` starts at 1, is raised 1.5 for `targetGroup 3`
creeps and for every champion (`CreepBase.as:224-226`, `ChampionBase.as:221`), and is further
modified by the `LootingMultiplier`, `ProximityLootBuff` and Vacuum `lootBonus` components. Krallen
bypasses the property entirely for her own hits, applying ×2 against resource buildings and ×3
against storage (`champions/Krallen.as:31-32`).

### Loot caps

`ATTACK.Loot(resource, amount, x, y, particles, building, vacuum)`
(`client/scripts/ATTACK.as:677-735`):

1. **Low-level bonus.** If `LOGIN._playerLevel < 20`:
   `amount += amount * max(0, (20 - level) * 0.03)`. A level-1 player gets +57%.
   (`:678-680`.)
2. The **full** amount is added to `ATTACK._loot` and `_hpLootN`, which is what the attack log and
   `lootreport` show (`:681-694`).
3. The **capped** amount is added to the attacker's pool. The cap is `rNmax`, raised by Krallen's
   buff if she is on the field: `cap += cap * krallen._buff` (`:696-702`). When
   `current + amount > cap`, the credited amount becomes `cap - current`, floored at 0 — but
   **only** if the session is an Inferno main yard or outpost with the descent passed, or
   `GLOBAL.mode == GLOBAL._loadmode` (`:703-709`). Outside those cases the overflow is credited in
   full.
4. The capped amount goes into `GLOBAL._resources`, `GLOBAL._hpResources` and `_deltaLoot`
   (`:710-721`).

So the log can legitimately show more loot than the player received.

### What reaches the server

| Payload key | Built from | Meaning |
| --- | --- | --- |
| `attackloot` | `ATTACK._savedDeltaLoot` + `GLOBAL._savedAttackersDeltaResources` per resource (`client/scripts/BASE.as:2859-2866`) | Capped loot gained, minus bomb costs spent. Added to the attacker's pool uncapped (`attackLootHandler.ts:14-21`) |
| `resources` | `BASE._savedDeltaResources` plus the four `rNmax` (`BASE.as:2643-2654`) | The defender's delta. Only negative entries are applied, capped at 10,000,000 each, floored at 0. `rNmax` ignored. (`defenderLootHandler.ts:29-45`) |
| `lootreport` | `{r1..r4: ATTACK._loot.*, isInferno, name}` (`BASE.as:2761-2770`) | **Uncapped** loot. On an attack save this key is ignored: `lootreport` is on `Save.saveKeys` but not `Save.attackSaveKeys` (`save.model.ts:471`, `:501-513`) |
| `damage` | `BASE._percentDamaged` (`BASE.as:3312`) | Written straight onto the defender's row |
| `destroyed` | `_percentDamaged >= 90 ? 1 : 0`, wild monster and outpost only (`BASE.as:3300-3307`) | Written straight onto the defender's row |

Note a second asymmetry in the storage path: `BSTORAGE` subtracts the **unscaled** amount from the
defender's pool and credits the attacker the scaled one (`BSTORAGE.as:65-86`). An outpost loses
twice what the raider gains; a wild monster camp loses five times.

### Damage persistence

The defender's `buildinghealthdata` is on `Save.attackSaveKeys` (`save.model.ts:509`) and is
written verbatim through the default branch. `buildingdata` goes through the trap-only filter. So
after an attack the defender's yard reloads with the exact per-building health the attacker's
browser reported.

Countdowns are then advanced: on an attack save, `advanceBuildingTimers` rolls the owner's build
and upgrade timers forward by `now - baseSave.savetime` using the pre-save health snapshot, before
`savetime` moves (`baseSave.ts:211-218`).

### Wild monster regeneration

A wild monster save older than `WILD_MONSTER_EXPIRATION = 43200` seconds (12 hours) is deleted and
regenerated — but only inside `baseModeView`, that is, only when someone opens the camp
(`server/src/controllers/base/load/modes/baseModeView.ts:13`, `:32-40`). There is no scheduled job
and no check on the map read path, so the map keeps showing a camp as destroyed indefinitely. This
is analysed in full in `docs/specs/maproom2.md` §5, "Root cause of the stale NPC yard bug".

Two other regeneration clocks exist for the other map rooms: Map Room 1 per-user tribes respawn
after **10 minutes** (`server/src/services/maproom/v1/createMR1Tribes.ts:46`, `:86-96`), and
Inferno tribes after **1 hour**
(`server/src/services/maproom/inferno/createInfernoTribes.ts:43`, `:78-91`). Only Map Room 2's
12-hour rule is gated behind a manual yard view.

Wild monster camps never receive damage protection: `damageProtection` is only called for
`MAIN` and `OUTPOST` types (`baseSave.ts:200-204`).

---

## 7. Ending an attack

### Time limit

`ATTACK._countdown` is set when the yard loads (`client/scripts/GLOBAL.as:839-842`):

| Condition | Countdown |
| --- | --- |
| Default | 300 s (5 minutes) |
| Map Room 2 or 3 with `ALLIANCE_DECLAREWAR` active in `NORMAL` scope | 420 s (7 minutes) |

It decrements once per slow tick (`ATTACK.as:237`). Two thresholds:

- At `_countdown < 0`, the auto-end check in `ATTACK.Tick` can fire (`:284`).
- At exactly `_countdown == -120`, `RetreatAll()` runs unconditionally (`:238-240`).

Dropping monsters is blocked once `_countdown < 0` (`DROPZONE.as:53`).

### Auto-end

`ATTACK.Tick` (`client/scripts/ATTACK.as:224-292`) ends the attack when `!_sentOver` **and** either
no targetable building remains **or** `CREEPS._creepCount` is zero, **and** one of:

- the countdown has expired,
- no targetable building remains, or
- neither a monster nor a usable bomb is left.

"Targetable building" means any `BFOUNDATION` with health above zero that is not a `BMUSHROOM` and
whose `_class` is not `wall`, `trap`, `enemy`, `decoration` or `cage`
(`:276-282`). "Resources left" counts available creatures, champions with hp and normal status, and
everything still in the flinger bucket (`:241-274`). Bombs count as a resource if any unused bomb is
within the catapult level, with putty bombs additionally requiring at least one monster to buff, or
if any bomb is currently in flight (`:253-270`).

When the condition trips, `_sentOver = true` and `BASE.Save(1, false, true)` fires
(`:283-291`).

### Retreat

- `RetreatAll()` puts every creep into retreat mode, saves with `over = 1`, and shows the
  "attack over" message (`ATTACK.as:808-817`).
- `ATTACK.End()` clears the bucket, saves if not already sent, retreats every creep, deactivates the
  siege weapon, and then either shows the attack log (Map Room 2/3 main yard) or goes straight to
  `EndB()` (`ATTACK.as:861-896`).
- A retreating creep sets `_behaviour = k_sBHVR_RETREAT`, stops attacking and paths back to its
  spawn point. Retreat is **not** on the `ignoreWalls` list, so a retreating monster still has to
  path around or through the maze (`MonsterBase.as:759-768`, `:1173-1177`).
- A champion can be retreated individually from its panel row
  (`client/scripts/CHAMPIONBUTTON.as:94-99`).

### The result payload

`BASE.SaveB()` (`client/scripts/BASE.as:3129-3339`) posts to `<baseURL>/save`. Fields are ordered
by a fixed whitelist (`BASE.as:3109-3110`). Attack-specific content, added when the mode is not
build (`:3250-3291`):

| Key | Value |
| --- | --- |
| `attackid` | `BASE._attackID`, from the load response |
| `over` | `1` when this is the final save (`:3241-3243`) |
| `damage` | `BASE._percentDamaged` |
| `destroyed` | 0/1, wild monster and outpost targets only |
| `buildingdata` | Full building map, filtered server-side to traps only |
| `buildinghealthdata` | Per-building health, applied verbatim |
| `monsters` | The defender's housing state after bunker monsters were consumed |
| `champion` | The defender's champions; only `hp` is honoured |
| `attackerchampion` | The attacker's champions, written to `userSave.champion` |
| `attackcreatures` | The attacker's monster roster; overwrites `userSave.monsters` |
| `monsterupdate` | Per-cell housing updates, which may target other base ids |
| `attackloot` | Attacker's resource gain |
| `resources` | Defender's resource delta plus caps |
| `attackreport` | `ATTACK.LogRead()` — the HTML battle log |
| `lootreport` | Uncapped loot totals; ignored on attack saves |
| `attackersiege` | The attacker's siege weapon inventory |
| `protect` | 0/1/2 by remaining building HP (`:3251-3258`). **Not on either save-key list, so the server ignores it.** |

`BASE._saveProtect` is 1 below 65% total building HP and 2 below 45%, main yards only
(`:3252-3257`).

### What the server does with it

`server/src/controllers/base/save/baseSave.ts`, on the `isAttack` branch:

| Step | Line |
| --- | --- |
| Permission: owner, or the row carries a non-zero `attackid` | `:62-67` |
| Attack binding: the caller must be the attacker recorded for this attack, inside the 420-second window (`checkAttackBinding`, issue #25). Refused before anything is applied, so the row is untouched | `services/base/attackSession.ts` |
| `validateSave` — the anticheat hook, a no-op in open-source builds. The Inferno counterpart `server/src/controllers/inferno/infernoSave.ts` never calls it at all | `:69` |
| Iterate `Save.attackSaveKeys`, with the trap filter, champion clamp and resource handler | `:74-146` |
| `monsterupdate` → attacker's save, and possibly other bases | `:155-157` |
| `attackcreatures` → `userSave.monsters` | `:159-161` |
| `attackloot` → attacker's pool, uncapped | `:163-165` |
| `resources` → defender's pool, losses only | `:167-176` |
| Map Room 3 only: `over && damage >= 90` triggers a structure takeover or marks a tribe cell destroyed | `:185-198` |
| `over` on a `MAIN` or `OUTPOST` target → `damageProtection(baseSave)` | `:200-204` |
| `baseSave.attackid = over ? 0 : attackid` | `:207` |
| `advanceBuildingTimers` | `:213-215` |
| `savetime = now` | `:218` |
| `last-seen` heartbeat is **not** written on an attack save | `:220-222` |

The response is the standard save envelope plus `takeover` when a Map Room 3 capture occurred
(`:230-235`).

### Attack logs and reports

Three separate things carry the word "report".

**1. The `AttackLogs` table.** One row per attack, written once, at the moment the attack
*starts* (`server/src/services/base/createAttackLog.ts:17-39`, called from
`baseModeAttack.ts:203`). Columns: attacker id/name/avatar, defender id/name/avatar, `type`, `x`,
`y`, `loot`, `attackreport`, `attacktime`
(`server/src/database/models/attacklogs.model.ts`).

**`loot` and `attackreport` are hardcoded `{}` at creation and never updated by any other code
path.** They are dead columns. Read back via `GET /api/:v/attacklogs` with a `filter` of
`myattacks`, `peopleattackingme` or both, 50 most recent, cached 30 minutes
(`server/src/controllers/attacklogs/getAttackLogs.ts`; see `docs/server-api.md` §Attack Logs).

**2. `save.attackreport`.** The attacker's HTML battle log, written straight onto the defender's
row through the default save branch (`save.model.ts:512`). It is a `@FrontendKey` field, so the
defender sees it on their next `/base/load`. `ATTACK.LogRead()` builds it
(`client/scripts/ATTACK.as:465-500`): a `<ul>` of timestamped events, then a resources-looted
summary drawn from `ATTACK._loot` (the uncapped figure).

Log entries are keyed so repeats overwrite (`ATTACK.Log`, `:447-463`). Keys used:
`fling<n>`, `b<buildingId>`, `trap<id>`, `htrap<id>`, `bomb<bombid>`, `siegeWeaponActivation`.

**3. `save.lastattackername`.** Set at attack start (`createAttackLog.ts:36`) and surfaced in the
alliance members list as `last_attacker`
(`server/src/services/alliance/allianceMember.ts:44`, `:86`).

### What the defender sees

**No attack mail is ever generated.** Nothing under `server/src/controllers/mail/` writes a
`Message` row on an attack or a save.

On their next `/base/load`, the defender's save carries: `damage`, `destroyed`, the reduced
`buildinghealthdata`, the reduced `resources`, the new `protected` timestamp, `attacks` with the
appended `AttackDetails`, and `attackreport`. The client shows `ATTACK.PoorDefense()` or
`ATTACK.WellDefended()` accordingly (`client/scripts/ATTACK.as:1006-1096`).

`lastattackername` does **not** reach the defender: it has no `@FrontendKey` decorator
(`save.model.ts:244-245`), so `mapSaveData` filters it out. Its only reader is the alliance members
list (`server/src/services/alliance/allianceMember.ts:44`, `:86`).

The `seen` flag on each `AttackDetails` is written `false` at attack start
(`baseModeAttack.ts:117`) and **is never set to `true` anywhere in the codebase**. There is no
read-receipt.

The attack-logs endpoint caches per user and filter for 30 minutes
(`server/src/controllers/attacklogs/getAttackLogs.ts:15`, `:66`), so a fresh attack can be invisible
to the defender's log for up to half an hour.

### Errors on the combat path

| Error | Status | Thrown at |
| --- | --- | --- |
| `discordAgeErr` | 401 | `baseLoad.ts:77`, `:96`, `:103`, `:114` |
| `loadFailureErr` | 404 | `validateAttack.ts:30`, `:36`, `:48`, `:61`, `:74`, `:87`; `getAttackLogs.ts:71` |
| `baseProtectedErr` | 403 | `baseModeAttack.ts:71`; `infernoModeAttack.ts:44` |
| `baseUnderAttackErr` | 409 | `baseModeAttack.ts:73`; `infernoModeAttack.ts:50` |
| `userOnlineErr` | 409 | `baseModeAttack.ts:77`; `infernoModeAttack.ts:48` |
| `truceActiveErr` | 403 | `baseModeAttack.ts:82` |
| `shinyLockedErr` | 403 | `baseModeAttack.ts:173` |
| `permissionErr` | 403 | `baseSave.ts:67`; `infernoSave.ts:57` |
| `saveFailureErr` | 500 | `baseSave.ts:60` |
| `antiCheatBanErr` | 403 | Defined in `server/src/errors/errors.ts:91-98`; **no call site in this tree** |
| Raw `Error` → 500 | — | `baseModeAttack.ts:68`, `:139`, `:200`; `validateRange.ts:49`, `:62`, `:171-190` |

Out-of-range attacks surface as a raw 500, not a typed error — the body is the interceptor's
generic `{ error: "Something went wrong, please contact support.", errorDetails: { status: 500, … } }`.
Moving the check ahead of the writes (issue #26) did not change that shape, so the Flash client sees
exactly what it saw before; the only difference is that the defender is no longer left locked.

### The attacker's end-of-attack UI

`ATTACK.EndB()` (`:920-1004`):

- Map Room 2 outposts and wild monster camps get a `popup_attackend(win)` (`:985-991`).
- Map Room 2 main yards go straight back to the map (`:992-994`).
- Otherwise the attacker's own base is reloaded in build mode (`:995-1003`).

Before that, the attack log popup is shown for Map Room 2/3 main yards, with a "talk trash" button
when the defender ended up protected or lost their Town Hall (`ATTACK.ShowLog`, `:294-377`).

---

## 8. Timers

### Damage protection

`server/src/services/maproom/v2/damageProtection.ts`, called from `baseSave.ts:200-204` on `over`
for `MAIN` and `OUTPOST` types only.

| Base type | Condition | Duration | Line |
| --- | --- | --- | --- |
| Main yard | ≥ 4 attacks in the last hour | 1 hour | `:60` |
| Main yard | `damage >= 50` and ≥ 1 attack in the last 36 hours | 36 hours | `:63-65` |
| Outpost | `damage >= 25` and ≥ 1 attack in the last 8 hours | 8 hours | `:86-88` |
| Inferno yard | Same as main yard | 1 h / 36 h | `:92-120` |

Protection is never extended while already active (`:50-52`, `:76-78`, `:103-105`); an expired
timestamp is cleared to 0 on the next evaluation. **Launching any attack clears the attacker's own
protection** (`:34-36`). Wild monster camps and Map Room 3 structures are excluded
(`baseSave.ts:200-202`).

A cell taken over receives a flat 12 hours
(`server/src/controllers/maproom/v2/takeoverCell.ts:89`, `:99`). A Map Room 3 capture grants none
(`server/src/services/maproom/v3/takeoverCellMR3.ts:73-85`).

**Protection is also silently cleared by the monster-update path.** Any base named in a
`monsterupdate` entry has `save.protected = 0` written alongside its new roster
(`server/src/services/base/updateMonsters.ts:29-33`). Since flinging from an outpost reports that
outpost's housing, launching an attack drops protection on every source yard, not just the main
one.

### Attack lock

An attack is active while `attackid != 0` **and** the last entry in `save.attacks` started less
than `ATTACK_TIMEOUT = 7 * 60` seconds ago
(`server/src/services/base/isAttackActive.ts:12`, `:25-33`). Past that the `attackid` is treated as
stale — the usual cause is an attacker who disconnected mid-battle. The lock also feeds the map's
`lo` field (see `docs/specs/maproom2.md` §7).

`attackid` is cleared on the final save (`baseSave.ts:207`), which also deletes the attack session
that authorised it.

The attack session shares the same 7 minutes by construction: `ATTACK_SESSION_WINDOW` is
`ATTACK_TIMEOUT`, so the moment the lock goes stale and the defender may be attacked by somebody
else, the previous attacker can no longer save against the row.

### Online guard

A main yard whose owner was seen within 60 seconds cannot be attacked
(`baseModeAttack.ts:75-78`), reading the Redis key `last-seen:main:<uid>`. That key is refreshed
with a 120-second TTL on every **non-attack** save (`baseSave.ts:220-222`), so a player who closes
the game stays unattackable for up to a minute after their last save.

### Truce

Truces are per-pair rows with an expiry. `TRUCE_DURATION = 14 * 24 * 60 * 60`
(`server/src/controllers/mail/requestTruce.ts:21`), stamped on accept
(`server/src/services/mail/handleTruceResponse.ts:36-38`). The server rejects an attack while one is
active (`baseModeAttack.ts:80-82`, `server/src/services/mail/isTruceActive.ts:12-29`), and the
client blocks the button. **Inferno attacks skip the truce check and the range check entirely**
(`server/src/controllers/base/load/modes/infernoModeAttack.ts:36-79`). Full rules are in
`docs/specs/maproom2.md` §7.

### Alliance powerups affecting combat

| Powerup | Effect | Source |
| --- | --- | --- |
| `ap_declarewar`, `NORMAL` scope | Attack countdown 300 s → 420 s | `client/scripts/GLOBAL.as:840-842` |
| `ap_declarewar`, `OFFENSE` scope | Flinger capacity +25% | `client/scripts/ATTACK.as:593-595` |
| `ap_declarewar` | +2 cells of attack range; the client adds it conditionally, the server unconditionally | `POWERUPS.as:341-344`, `rangeCheck.ts:23`, `:79` |
| `ap_armament`, `DEFENSE` scope | Applied as a base buff, not a numeric modifier here | `POWERUPS.as:129-131`, `:332-335` |
| `ap_conquest` | Takeover cost × 0.75, rounded up | `POWERUPS.as:337-339` |

The active set depends on which side the player is on. `_powerups` is the defender's,
`_attpowerups` the attacker's, `_mypowerups` the player's own
(`POWERUPS.as:189-212`).

### Other cadences

| Timer | Value | Source |
| --- | --- | --- |
| Flinger cooldown | 5 slow ticks, **set but never enforced** | `ATTACK.as:143`, `:578` |
| Bomb double-drop guard | `waitTime = now + 1` second after selecting a bomb | `CATAPULTPOPUP.as:201`, `ResourceBombs.as:297-299` |
| Creep retarget | every 150 fast ticks, 300 in catch-up | `CreepBase.as:874-876` |
| Hunting creep retarget | every 150 fast ticks | `CreepBase.as:851-853` |
| Tower reacquire | `_fireTick = 30`, plus `creepCount / 15` above 150 creeps | `BTOWER.as:199-202` |
| Trap retarget | every 20 fast ticks | `BTRAP.as:50-54` |
| Bunker retarget | every 10 frames when idle, forced every 60 | `HOUSINGBUNKER.as:269-271` |
| Bunker dispatch | every 30 ticks | `HOUSINGBUNKER.as:273` |

---

## 9. UNVERIFIED

- **Flinger cooldown.** `ATTACK._flingerCooling` is initialised, reset to 5 after every fling and
  decremented each slow tick, but no code reads it. Either the enforcement was lost in
  decompilation or the cooldown never existed. Treat "5 seconds between flings" as intent, not as
  an observed rule.
- **`ATTACK.Damage`, `ATTACK.ProcessDamageGrid`, `ATTACK.Miss` and `ATTACK._damageGrid`** are empty
  stubs (`ATTACK.as:32`, `:770-806`). `BFOUNDATION.Destroyed` and `Targeting.DealLinearAEDamage`
  still call `ATTACK.Damage`. Whatever aggregate damage display they once drove is gone.
- **`targetGroup 3` loot bonus.** `AdditionPropertyModifier(1.5)` is applied to the loot property
  (`CreepBase.as:224-226`). Whether the resulting multiplier is 1.5 or 2.5 depends on
  `CModifiableProperty`'s composition order, which was not traced.
- **`targetMode`.** Eye-ra and D.A.V.E. set `targetMode = 1` when powered up
  (`creeps/Eyera.as:12`, `abilities/DAVERockets.as:14`). The semantics of `targetMode` were not
  traced. `DAVERockets.onRemoved` also sets `owner.range = 1`
  (`DAVERockets.as:20-21`), which looks wrong but may be intentional.
- **Ability numeric parameters.** Radii and counts are cited above, but the per-level damage of
  `AOEDamageOnAttack`, `Blink`, `PoisonOnAttack`, `GlavesOnAttack` and `Invisibility` comes from
  `powerUpLevel()` through `CModifiableProperty` chains that were not followed to their values.
- **Tower `speed` field.** Present in every tower stat block and assigned to `super._speed`
  (`BTOWER.as:107`). It is projectile travel speed rather than fire rate, but the unit was not
  confirmed against `PROJECTILE`/`FIREBALL`.
- **Inferno Cannon Tower (type 130)** has no `stats` block in `YARD_PROPS.as`, yet it appears in the
  flyer-mode table (`BTOWER.as:31`). Its behaviour when placed is unknown.
- **Wall health.** `YARD_PROPS.as` gives type 17 five levels (1000→27000) and type 18 a single
  value of 3600. Whether stone blocks really have one level was not confirmed against the store.
- **`ATTACK._flingValue`** accumulates `cResource` per monster flung and is never read.
- **Champion `buffs` and `buffRadius`** are in the stats table, but only Krallen's `_buff` was
  traced to a use (the loot cap at `ATTACK.as:700-702`). Fomor's 0.1→0.6 aura was not traced.
- **Map Room 1 and Inferno** paths are cited where they intersect Map Room 2 but were not specified.
  `IATTACK`, `IWMATTACK` and descent modes differ in several branches of `ATTACK.EndB`.
- **`creeps/rebalance/`** holds twelve `*v2.as` variants plus `RebalancedCreatures.as`, and
  `creeps/inferno/` holds four more subclasses. Neither set was read; whether they are live or dead
  code was not determined.
- **Three parallel tower tables** exist: `YARD_PROPS.as` (main yard), `INFERNOYARDPROPS.as` and
  `OUTPOST_YARD_PROPS.as`, selected at `GLOBAL.as:719-746`. Per-level values match where they
  overlap, but maximum levels differ (main yard 10 for cannon and sniper, Inferno 7). Section 5's
  table is the main-yard set only.
- **`speed` on a tower** versus the twice-halved `speed` on a monster are different quantities with
  the same field name; only the monster halving was traced to source.
- **`targetMode`** on `BTOWER` versus the `_targetFlyerMode` lookup: `BUILDING118.as:44` and
  `INFERNOQUAKETOWER.as:29` set `attackFlags = getOldStyleTargets(-1)`, but `FindTargets` reads the
  static map instead, so those assignments appear to have no effect. Not confirmed.

---

## 10. Redesign notes

### Rules that must be preserved

These are load-bearing. Change any of them and the economy or the meta breaks.

1. **Loot is damage.** One point of damage to a resource building removes one unit of that resource
   from it, capped at what it holds. This is the single relationship that makes monster damage and
   yard economy commensurable. Everything else — the low-level bonus, the looting multiplier, the
   storage scalars — is a modifier on top.
2. **Resource buildings stop being targets once emptied.** `_looted` is what makes resource-seeking
   monsters sweep a yard instead of grinding one silo. Without it, `targetGroup 3` is useless.
3. **Walls do not count toward the damage percentage.** A maze must cost the attacker time without
   giving them progress. If walls counted, mazing would be self-defeating.
4. **Specialists hit their class harder**: ×2 against walls for wall-breakers, ×2 against towers
   for tower-killers, ×3 against creeps when hunting. Together with the preference system this is
   what makes a mixed composition beat a mono-composition. Remove it and monster choice collapses to
   damage-per-housing-space.
5. **Preference falls back to "all buildings", and the fallback is sticky.** A monster whose
   preferred class is exhausted becomes a generalist permanently, except tower specialists. This is
   what stops a yard from stalling a wave forever by simply not having the preferred building type.
6. **90% is the victory threshold** for outposts and wild monster camps, and it is also the takeover
   threshold. The two must stay equal.
7. **Damage protection tiers**: 4 attacks in an hour → 1 hour; 50% damage → 36 hours; outposts 25%
   → 8 hours. Attacking clears your own protection. This is the whole anti-farming system.
8. **Traps only fire on ground units, and heavy traps only on the five large monsters.** That is
   the counter-play that makes flying and small units worth bringing.
9. **A flinger's range is a function of its level**, 4/6/8/10 for main yards and 1/2/3/4 for
   outposts, and outposts are how a player projects reach. This is the entire spatial layer of
   Map Room 2.
10. **The 5-minute limit** (7 with Declare War) with a hard retreat 2 minutes after expiry.
11. **Wild monster camps regenerate after 12 hours** and never get damage protection.

### Flash-era constraints that can be dropped

- **The 80 Hz `_loops` accumulator** with its 800-loop cap and catch-up mode
  (`GLOBAL.as:1229-1291`). This exists because Flash's `ENTER_FRAME` rate was unreliable. A fixed
  timestep loop with interpolation replaces it cleanly.
- **The two-clock split.** `ATTACK.Tick` at 1 Hz and combat at 80 Hz exist because the 1 Hz clock
  was the economy clock. One authoritative simulation clock is enough.
- **The load-shedding hacks.** Tower reacquisition padding above 150 creeps
  (`BTOWER.as:200-202`), `CREEPS.processOverlapBatch`, the `_render` flag that draws only the last
  loop of a frame. Modern hardware does not need them, and they make tower behaviour depend on
  creep count, which is not a designed rule.
- **`SecNum` everywhere.** Every combat number is wrapped in an obfuscated integer with a paired
  plain "hp" shadow copy and mismatch logging (`ATTACK.as:737-759`). This was client-side
  anti-tamper for a plugin that could be memory-edited. In a server-authoritative rebuild it is
  dead weight; in a client-authoritative one it never worked anyway.
- **The `md5(loaderInfo.bytes)` `lootbonus` field** (`BASE.as:3200`) — a SWF integrity check that
  has no meaning outside Flash.
- **Building-type integers** with parallel arrays indexed `type - 1`. `GLOBAL._buildingProps[4]`
  meaning the Flinger is a bug waiting to happen.
- **Isometric grid conversions** (`GRID.ToISO` / `FromISO`) threaded through targeting, pathing and
  spawning. Pick one coordinate space.
- **The duplicated damage-percent calculation** with the always-true trap clause
  (`ATTACK.as:933`, `:1104`). Compute it once.
- **Hold-to-repeat with frame counters** (`CREATUREBUTTON.as:113-119`). See below.
- **Facebook taunt and brag flows** (`ATTACK.ShowTaunt`, `:379-436`; `WellDefended`'s `sendFeed`).

### Every manual click in the current fling flow

Listed so the redesign can remove them. "One click" means one discrete mouse action.

**Selecting monsters**

1. Scroll the monster list — a drag on `ScrollSetV`, needed whenever the player owns more monster
   types than fit in `screenHeight - 476` pixels at 53 px per row (`UI_TOP.as:276-287`).
2. Click `+` on a monster row. **One click per individual monster.** Sending 40 Pokeys is 40
   clicks (`CREATUREBUTTON.as:52`, `:106-125`).
3. Or press and hold `+`: a 10-frame dead time, then roughly 20 adds per second, aborting the
   instant the cursor drifts outside the button rectangle (`CREATUREBUTTON.as:113-119`, `:148-152`).
4. Click `-` to correct an overshoot. One click per monster removed
   (`CREATUREBUTTON.as:127-146`).
5. Click `Send` on the champion row (`CHAMPIONBUTTON.as:72-83`).
6. Click `Hold` to undo that (`CHAMPIONBUTTON.as:85-92`).

**Placing them**

7. Move the cursor to aim the drop ring — it follows the mouse every frame and must be clear of
   every building footprint (`DROPZONE.as:58-70`).
8. Click inside the ring to drop (`DROPZONE.as:52-56`).

**Then repeat.** The bucket empties on every drop (`ATTACK.as:577`), and capacity does not
accumulate in Map Room 2, so a 300-monster attack is roughly `300 / (2250 / bucketCost)` full
selections from scratch.

**Catapult**

9. Click the catapult image. This **silently discards the entire current monster selection and
   champion** (`CATAPULTPOPUP.as:168-187`).
10. Click a bomb tile (`CATAPULTPOPUP.as:83-94`).
11. Click a target to drop it (`DROPZONE.as:163-172`).

**Siege weapon**

12. Click the weapon image (`SIEGEWEAPONPOPUP.as:341-362`).
13. Click a target (`DROPZONE.as:173-199`).

**Ending**

14. Click `Next` or `Return Home` on the attack log popup (`ATTACK.as:318-327`).
15. Click through `popup_attackend` (`ATTACK.as:985-991`).

**The arithmetic.** A representative mid-game attack — four waves of about 25 monsters, one
champion, one bomb — is:

| Item | Count |
| --- | --- |
| `+` clicks | 100 |
| Champion `Send` | 1 |
| Drop clicks | 4 |
| Catapult sequence | 3 |
| End-of-attack popups | 2 |
| **Total** | **110** |

Hold-to-repeat reduces the 100 to about 8 long presses if the player never overshoots and never
lets the cursor slip.

**What the redesign should replace them with.** The information the player is actually expressing
is a *composition* — "30 Pokey, 5 Fink, the champion" — and a *location*. Everything between those
two facts is Flash-era plumbing:

- Let the player type or drag a quantity instead of incrementing it. A slider or a number field
  replaces N clicks with one gesture.
- Offer a saved loadout. The same composition is flung repeatedly within one attack and across
  attacks; there is nothing to recompute.
- Offer "fill to capacity", which is what the `+`-mashing approximates. The capacity number is
  already computed and already displayed as a percentage bar
  (`UI_TOP.as:252-257`).
- Stop discarding selections. The catapult clearing the bucket, and `BucketUpdate` cancelling the
  pending bomb and siege weapon, are implementation coupling, not game rules. The three tools should
  coexist.
- Keep the drop-point choice. Where a wave lands is a real tactical decision and the one click in
  this list that carries meaning.
