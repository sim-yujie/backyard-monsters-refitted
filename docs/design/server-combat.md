# Server-Authoritative Combat — Implementation Plan (issue #23)

Dated 2026-09-24. This is the implementation plan for GitHub issue #23, "Server: server-authoritative
combat simulation". Today the server never simulates a battle: `damage`, `destroyed`, the
defender's per-building health, the loot on both sides and even the defender's protection timer are
written from the attacking client's payload, and the anti-cheat hook that could refuse any of it is
a no-op (`docs/specs/combat.md:25-91`). The plan moves the rules of combat into one TypeScript
module that the web client's defence simulator (issue #22) and the server both run, puts a
server-side audit in front of every attack save in the same log-then-reject shape the economy audit
uses (`docs/design/economy-save-validation.md` §3.2), and lays out the replay path that makes the
server's result the only result once the web client's attack flow (issue #32) can feed it.

Every line number below cites the `revamp` branch as it stands today. Where the plan makes a choice
the owner has not ruled on, section 6 names the default taken and why. Owner saves are issue #24 and
out of scope; the attack-start checks are issues #25 and #26 and already landed.

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

**The whole battle runs in the browser and the server writes what it is told.** The four phases of
an attack and who is authoritative for each are tabled at `docs/specs/combat.md:27-34`: the gate and
the load are the server's, the battle and the save are the client's. On the save, the server's entire
defence is four narrow clamps — the trap-only building filter, the champion `hp` minimum, the
losses-only resource delta and the ownership check (`combat.md:56-63`) — and every other key on
`Save.attackSaveKeys` is `JSON.parse`'d straight onto the defender's row
(`server/src/database/models/save.model.ts:515-528`, applied at
`server/src/controllers/base/save/baseSave.ts:184-192`). The attacker's own `attackloot` is added to
their pool with no cap (`controllers/base/save/handlers/attackLootHandler.ts:14-21`).

**Who sends attack saves.** Only the archived Flash client. The web client calls `/base/load` and the
Yard Planner routes and never posts to `/base/save` (`web/src/api/base.ts:24-57`; a search of
`web/src` for `base/save` finds nothing). That stays true until issue #32 gives the web client an
attack flow. The Flash client cannot be patched, cannot show a structured error, and on a rejected
save keeps its local state and tries again (`client/scripts/BASE.as:3413-3416`, `:3420-3428`).

**When the Flash client saves during an attack.** Three triggers, all through `BASE.Save()`:

| Trigger | Source |
|---|---|
| Every fling: `ATTACK.Spawn` ends with `BASE.Save()` unless the attack is already over | `client/scripts/ATTACK.as:580-582` |
| The 1 Hz `BASE.Tick`: with a save pending, `SaveB()` fires once 6 s (`savedelay * 2`, `savedelay` is 3, `server/src/game-data/flags.ts:44`) have passed since the request, or 15 s since the last save | `BASE.as:2512-2517` |
| Auto-end or retreat: `BASE.Save(1, false, true)` with `over = 1`, flushed immediately | `ATTACK.as:283-291`, `:808-817`; `BASE.as:2601-2611` |

So an attack produces a sequence of saves roughly one per fling, at least 6 s apart, and a final one
carrying `over`. Each is a full snapshot, not a delta: `buildinghealthdata` and `damage` are the
yard's state at that moment (`BASE.as:3159-3169`, `:3312`).

**What one attack save carries**, from `BASE.SaveB()` (`BASE.as:3155-3312`), and what the server does
with each key today:

| Key | Built from | Server today |
|---|---|---|
| `buildingdata` | Every building, `BFOUNDATION.getBuildingSaveData()` (`BFOUNDATION.as:425-472`) | Trap-only filter, fired traps recorded (`handlers/buildingDataHandler.ts:37-66`) |
| `buildinghealthdata` | Every building below full health, `id -> int(health)`; fired traps as 0 (`:439-455`) | Written verbatim (default branch) |
| `damage` | `100 - 100 / totalMaxHP * totalHP`, walls excluded (`:444-451`, `:468`) | Written verbatim |
| `destroyed` | `damage >= 90 ? 1 : 0`, wild monster and outpost targets only (`BASE.as:3297-3308`) | Written verbatim; drives Map Room 3 takeover (`baseSave.ts:244-257`) |
| `resources` | The **defender's** delta plus `rNmax` (`BASE.as:2643-2654`) | Losses only, capped at 10,000,000 per resource, floored at 0 (`handlers/defenderLootHandler.ts:29-46`) |
| `attackloot` | The attacker's capped loot minus bomb spend (`BASE.as:2859-2866`) | Added to the attacker's pool, uncapped (`attackLootHandler.ts:14-21`) |
| `monsters` | The **defender's** housing after bunker use (`BASE.as:3173-3175`) | Written verbatim onto the defender's row |
| `monsterupdate` | Map Room 2: one `{ baseid, m }` per attacker cell in range, housing minus what was flung (`BASE.as:2968-3045`) | Attacker's own row and other bases, `protected` cleared on each (`handlers/monsterUpdateHandler.ts:35-54`, `services/base/updateMonsters.ts:25-34`) |
| `attackcreatures` | Not sent in Map Room 2 (`BASE.as:3266-3268`) | Overwrites `userSave.monsters` when present (`baseSave.ts:218-220`) |
| `champion` | The defender's champions | `hp` may only fall (`handlers/championHandler.ts:13-25`) |
| `attackerchampion` | The attacker's champions | Overwrites `userSave.champion` verbatim (`baseSave.ts:164-166`) |
| `attackersiege` | The attacker's siege inventory | Overwrites `userSave.siege` (`:178-182`) |
| `attackreport` | `ATTACK.LogRead()`: an HTML `<ul>` of timestamped events (`ATTACK.as:465-500`) | Written verbatim, unbounded |
| `buildingresources` | The **attacker's** Map Room 2 auto-bank update (`BASE.as:3232-3239`) | Written verbatim onto the **defender's** row (default branch, `attackSaveKeys` at `save.model.ts:525`) |
| `over` | 1 on the final save | Ends the session, clears `attackid`, grants protection (`baseSave.ts:258-271`) |
| `attackid`, `academy`, `lockerdata`, `points`, `basevalue`, `catapult`, `flinger`, ... | Sent on every save (`BASE.as:3179-3195`, `:3264`) | Not on `attackSaveKeys`; ignored on an attack save |

**Holes the audit closes that the issue text does not name.** Reading the table:

1. `attackerchampion` lets an attacker set their own champion's level, type and feed state
   (`baseSave.ts:164-166`).
2. `monsters` on an attack save is the *defender's* roster, written verbatim by the attacker.
3. `buildingresources` is the attacker's outpost income snapshot and lands on the defender's row.
4. `protected` and `locked` are on `attackSaveKeys` (`save.model.ts:518-519`). The Flash client never
   sends either — its whitelist carries `protect`, a different key (`BASE.as:3109-3110`) — so they
   exist only for a forged request.
5. `attackloot` has no cap and no relation to what the defender lost.
6. `attackreport` has no size limit and is served back to the defender as HTML.

**What the server already knows** at the moment an attack save arrives:

- The defender's row: `buildingdata` (type, level, position, harvester buffers `st`), the stored
  `buildinghealthdata`, `resources`, `champion`, `monsters` (housing and bunker contents), `type`.
- The attack session: attacker id, `attackid` and `startedat`
  (`services/base/attackSession.ts:43-50`), read before anything is applied (`baseSave.ts:86-91`).
- The attacker's own row: `academy` (monster levels 1..6,
  `docs/specs/monsters-and-hatchery.md:1263-1275`), `champion`, `catapult`, `siege`, and
  `monsters.housed` for the main yard and every outpost, which is what `monsterupdate` reports
  against (`services/monsters/transferRules.ts:171-185` reads it).
- The monster and champion stat tables, `server/src/game-data/stats/monsterStats.ts` and
  `championStats.ts`. These are already authoritative: `validateAttack` bans a client whose declared
  stats differ from them (`services/maproom/validateAttack.ts:25-91`).
- The cost table, footprints and the storage-cap formula from the economy work
  (`game-data/buildingCosts.ts`, `game-data/buildingFootprints.ts`,
  `services/base/economy/resourceBudget.ts`'s `storageCap`).

**What the server does not know, and cannot learn from the Flash client.**

- **There is no fling log.** The client sends no drop positions, no drop times and no per-fling
  composition as data. What it does send is (a) the roster left in each attacker cell after each
  fling, from which the count flung so far per monster type is the difference against the stored
  roster (`BASE.as:2993-3017`: `amtUsed = amtAllCells - amtAvailable`, and flung monsters are
  consumed whether or not they survive), and (b) the attack log HTML, whose `fling<n>` entries carry
  a second-granularity offset and the composition as localised text (`ATTACK.as:571-576`,
  `:447-463`). Neither carries a position.
- **Tower stats are not on the server.** `gen-building-costs.mjs` deliberately leaves every
  non-economy `capacity` and `produce` out of the cost table
  (`web/tools/gen-building-costs.mjs:158-167`), and the per-level `range`, `damage`, `rate`,
  `speed` and `splash` blocks live only in
  `client/scripts/YARD_PROPS.as` (type 20 at `:1979-2183`, the other twelve `stats` blocks at
  `:2200`, `:2423`, `:2498`, `:2739`, `:6045`, `:6337`, `:6886`, `:7157`, `:7457`, `:7566`, `:7678`,
  `:7791`). Building `hp` ladders are extracted only into the web art table
  (`web/tools/gen-building-art.mjs:85-102`, `web/src/game/yard/buildingArtData.ts:75-76`), not the
  server.
- **Pathing costs live in code, not tables.** Each building class declares `_gridCost` rectangles
  (`client/scripts/BUILDING17.as:14`, `BUILDING20.as:19`) and only walls register on the grid
  (`client/scripts/BWALL.as:11-13`).

### 1.2 The decision: a bounded audit now, a full replay when the client can feed it

Two designs were on the table.

**Phase A — bound and clamp.** The server derives, from what it holds and what the save reports,
the *most* a battle could have done in the time since the last save, refuses anything past it, and
derives the fields it can derive outright (`damage`, `destroyed`, the loot cap, the health floor).
It never needs a position. It is exact where the client's figure is a pure function of other data
(`damage` from health, `destroyed` from `damage`, loot capped by storage) and an envelope where the
figure depends on the battle (how much health fell, how much loot came out).

**Phase B — replay.** The client sends every fling, bomb and siege activation with a tick and a
position, plus the seed; the server runs the same deterministic engine over the same defender yard
and writes *its* outcome. The client only renders. Nothing reported by the client is trusted.

**This plan commits #23 to Phase A, and builds the engine for Phase B under issue #22 so that Phase B
is a wiring job once issue #32 lands.** The reasons:

1. Phase B has no input today. The Flash client cannot send a fling log (section 1.1), and a replay
   without positions is a guess that would refuse honest play. Issue #32 is where the web client's
   attack flow is designed; section 3.10 fixes what it must send so #32 can build to it.
2. Phase A closes every hole in section 1.1 that is a free write — the protection timer, the
   defender's roster, the attacker's champion, `buildingresources`, uncapped loot, health that rises,
   `damage` that disagrees with the health it summarises — and bounds the rest. That is the whole of
   what a server can do for a Flash attacker without a fling log, and it is worth having on its own.
3. The engine is needed anyway. Q7 of the planner redesign made the Wild Monster Baiter the defence
   simulator (`docs/design/yard-planner-redesign.md:873`; issue #22: full roster and champions, any
   drop point, chosen levels, replay, a per-tower report). A simulator that disagrees with the server
   would be worse than none, so the engine is written once, in the shared module of section 3.2, and
   the Baiter is its first consumer. Phase A's bound model lives in the same module and is the second.
4. The economy audit (#24) proved the shape: pure services, a log-only week, then reject. Phase A fits
   that shape exactly; Phase B needs a worker and a new request contract and is better landed on its
   own after the client exists.

Phase B's rules and contract are written down here (sections 2.8, 3.5, 3.10) so the engine is built
to them, but its server wiring is the last work package and is gated on #32.

### 1.3 In scope

| Item | Summary |
|---|---|
| Combat stats table | A generated table of tower stats per level, building `hp` ladders, trap and bunker numbers, the flyer-mode table, grid costs, and the monster and champion props, in one file both trees load (section 3.3). |
| Shared rules module | `web/src/game/combat/rules/`, copied to `server/src/game-rules/combat/` by a sync script with a hash manifest and a drift test on both sides (section 3.2). Holds the stat readers, the bound model, the damage-percent and loot rules, the seeded RNG, the grid, targeting and the tick engine. |
| Attack audit | Pure `auditAttackSave(input)` returning a verdict: derived fields plus violations. Runs before any key is applied. |
| Key trims | `protected`, `locked` and `buildingresources` leave `attackSaveKeys`; `monsters`, `attackerchampion` and `attackcreatures` become clamps rather than overwrites. |
| Rollout | `COMBAT_SAVE_VALIDATION=off\|log\|reject`, default `log`, mirroring `ECONOMY_SAVE_VALIDATION`. |
| Engine and golden replays | The deterministic simulation (creeps, towers, traps, bunkers, champions, bombs) with fixture replays whose digests must match under Bun and under Vitest. |
| Fling log contract | The keys the web client must add to an attack save for Phase B, fixed now for #32. |
| Tests and a curl script | `bun:test` over the sandbox fixture for the server, Vitest for the shared module, and a shell script that drives a real attack through accept and reject. |

### 1.4 Out of scope and deferred

- **Inferno** (`controllers/inferno/infernoSave.ts`, `infernoModeAttack`), which still carries the
  pre-#25 gate and mints no session; the audit is written against the Map Room 2 save path and the
  Inferno twin follows when the binding does.
- **Map Room 1 tribes** (`baseSave.ts:66-73`) and **Map Room 3** structures beyond what falls out of
  `damage` being derived (`baseSave.ts:244-257` keeps reading `baseSave.damage`).
- **Attack start.** `validateAttack`'s missing count check (`validateAttack.ts:10-11`) is a different
  hole: the count it would check is the roster the audit already derives, so section 6 lists it as a
  one-line follow-up rather than a package here.
- **Abilities with untraced numbers.** `Blink`, `PoisonOnAttack`, `GlavesOnAttack`, `Invisibility`
  and the per-level `AOEDamageOnAttack` values come from `CModifiableProperty` chains the spec did
  not follow (`combat.md:1362-1375`). The bound model gives them slack (section 2.3); the engine
  implements them in WP4 as the values are read, each with a citation.
- **The Baiter UI** itself (issue #22) and the fling UI (issue #32). This plan delivers the engine
  and the contract they consume.
- **Siege weapon effects** beyond what the bound needs: Jars and Decoy only make a battle easier for
  the attacker within the envelope the bound already allows; the Vacuum's `lootBonus` is an open
  question (section 6).

---

## 2. Rules: what the server derives and what it checks

Notation: **S** is the defender's stored row, **T** the submitted save, **A** the attacker's stored
row, `now` the server clock in unix seconds (`utils/getCurrentDateTime.ts`), `session` the attack
session read at `baseSave.ts:91`. Ticks are fast ticks at 80 per second, the rate every combat
constant in the client is written in (`combat.md:93-102`; `client/scripts/GLOBAL.as:1234`).

A rule either **derives** a field (the server writes its own value and, in `log` mode, records a
mismatch) or **checks** one (a violation). Each violation is `{ rule, ids?, detail, enforced }`, the
same shape as the economy audit's (`services/base/economy/auditEconomySave.ts`, "The verdict"). Rule
names are the wire names of section 3.9.

### 2.1 Which saves are audited, and the attack context

Every save on the `isAttack` branch (`baseSave.ts:79`) that passed the binding check. The audit runs
after `requireAttackBinding` and before the key loop, so a refusal leaves the row untouched
(`baseSave.ts:86-93`, `:124`).

The **attack context** is derived first and every rule reads it:

| Field | Derivation | Source |
|---|---|---|
| `startedAt` | `session.startedat` | `attackSession.ts:48-49` |
| `elapsedAttack` | `clamp(now - startedAt, 0, 540)`: the 420 s Declare-War maximum plus the 120 s grace before `RetreatAll` | `GLOBAL.as:839-842`, `ATTACK.as:237-240` |
| `elapsedSave` | `clamp(now - max(S.savetime, startedAt), 0, elapsedAttack)`: the interval this save covers. `savetime` moves to `now` on every attack save (`baseSave.ts:280`), so successive saves partition the attack | — |
| `levels` | `A.academy[id].level` per monster id, clamped to the stat array's length exactly as the client clamps (`client/scripts/CREATURES.as:75-77`, `:81`); absent means 1 (`:45-47`) | `academyHandler.ts:24-26` for the stored clamp to 6 |
| `flung` | Per monster id, `max(0, storedHoused - reportedHoused)` summed over the attacker cells named in `T.monsterupdate`, where `storedHoused` is `housedCounts(A_cell.monsters)` for each of the attacker's own rows and `reportedHoused` is `housedCounts(update.m)` (`transferRules.ts:171-185`). Cumulative for the attack, because a cell's stored count only falls as saves land | `BASE.as:2993-3017` |
| `flungChampion` | `T.attackerchampion` reports a champion whose `hp` is below `A.champion`'s, or the attack report names one; either marks the champion as on the field | `ATTACK.as:526-539` |
| `bombs` | `A.catapult` decides which bomb tiers exist (`combat.md:415-427`); at most one bomb per resource per attack (`ResourceBombs.as:301-315`) | — |
| `reference` | `S.buildingdata` with countdowns advanced to `now` by `referenceYard(S, now)` (`services/base/economy/referenceYard.ts:62-70`), so a tower whose upgrade finished mid-attack is read at its new level as the client reads it | — |

A save whose `monsterupdate` names a base the attacker does not own, or whose `housed` values are not
non-negative integers, is `malformed` (400) — the same refusal `transferRules.ts` makes for a
transfer (`:187-190`).

### 2.2 Health: only downwards, and `damage` is a sum

For every id in `T.buildinghealthdata`:

**The id exists** in `reference`, else `unknownBuilding`. **The value is an integer in
`[0, maxHp(type, level)]`**, else `malformed`. `maxHp` is `hp[l - 1]` from the combat stats table
(section 3.3; the client's `_buildingProps.hp`, `client/scripts/BWALL.as:20`).

**Health only falls.** `T.hp[id] <= S.hp[id]` where an absent stored entry means `maxHp`
(`BFOUNDATION.as:453-455` writes only buildings below full). Rule `healthRose`, enforced, and
**derived**: in `reject` mode the server writes `min(S, T)`; a building missing from `T` that S holds
below full keeps S's value rather than healing to full. Repairs cannot happen during an attack
(`Destroyed()` cancels them, `BFOUNDATION.as:1964-2015`), so there is no honest way for a value to
rise.

**Traps.** A trap dropped from `T.buildingdata` (the existing fired-trap rule,
`buildingDataHandler.ts:46-58`) must carry `0` in `T.buildinghealthdata` or be absent; a trap present
in both with health 0 is treated as fired. Rule `trapState`, recorded only.

**`damage` is derived.** From the clamped health map, exactly as `getBuildingSaveData` computes it
(`BFOUNDATION.as:433-468`): over every building in `reference` that is not a mushroom (type 7) or a
wall (types 17, 18), `totalMax += maxHp`, `total += health`, with a fired trap and an expired type 53
contributing to neither sum; `damage = 100 - 100 / totalMax * total`. In `reject` mode the server
writes this and ignores `T.damage`; in `log` mode a `T.damage` more than 1 point away is
`damageMismatch` with `{ sent, derived }`. The 1-point tolerance is the client's `int()` in the log
line versus the float it saves (`BFOUNDATION.as:525`, `:468`).

**`destroyed` is derived**: `derivedDamage >= 90 ? 1 : 0` for a `TRIBE` or `OUTPOST` target and
absent otherwise (`BASE.as:3297-3308`; `BYMConfig.k_sVICTORY_THRESHOLD = 90`,
`client/scripts/com/monsters/configs/BYMConfig.as:30`). Rule `destroyedMismatch`, recorded in `log`.

### 2.3 The damage budget

The one rule that needs the roster. Let `drop` be the sum over every building in `reference` of
`S.hp - clampedT.hp`, walls included this time (walls absorb damage even though they are not in the
percentage). Then `drop <= potential(elapsedSave) + slack`, else `damageBudget` with
`{ drop, potential }`, enforced.

`potential` is the most damage the monsters on the field could deal in the interval if every swing
landed on its preferred class from the first tick:

```
swings(delay)     = floor(elapsedSave * 80 / delay) + 1
potential         = sum over flung monsters m at level L of
                      damage_m[L] * mult_m * swings(delay_m) * aoe_m
                  + champion:  damage_c[L] * swings(delay_c) * aoe_c
                  + bombs:     sum of the largest unused building-bomb damage per resource tier
                  + zombies:   potential of every flung monster once more, if a Rezghul was flung
slack             = 1% of potential, at least 1000
```

| Term | Value | Source |
|---|---|---|
| `damage_m[L]` | `props.damage[L - 1]`, clamped to the array | `monsterStats.ts`; `CREATURES.as:75-81` |
| `delay_m` | `props.attackDelay[0]` or 60 when absent | `CreepBase.as:108-111` |
| `mult_m` | 2 for `targetGroup` 2 and 4 (walls and towers take double from their specialists), 1 otherwise | `CreepBase.as:884-894` |
| `aoe_m` | 6 for Fink (60 px splash on hit), Wormzer (100 px, once per target per swing), D.A.V.E. (two half-damage rockets, so 1), Bandito's spin (60 px); 1 otherwise. The radius covers at most six 50-px footprints | `combat.md:652-678` |
| Eye-ra (`explode: [1]`) | Its damage counts once, times 2 (walls), not per swing: the creep dies on its blast | `CreepBase.as:896-898`, `:762-835` |
| Slimeattikus | Its own swings plus `splits[L]` C18 spawns at their swings | `creeps/Slimeattikus.as:11-13`; `monsterStats.ts` C17 `splits` |
| Healers (C15, C16) | Negative damage; contribute 0 | `combat.md:508-510` |
| `damage_c`, `delay_c` | Champion damage at level from `championStats.ts`; delay 56, Fomor 8, Korath 72/72/80/80/80/80 | `ChampionBase.as:164`, `champions/Fomor.as:12`, `champions/Korath.as:25-46` |
| `aoe_c` | 6 for Korath (stomp over `range * 2.5` at power 3), 1 otherwise | `Korath.as:167-200` |
| bombs | The building bombs the attacker's catapult level unlocks, one per resource tier, taken at their maximum tier: 50,000 (twig), 75,000 (pebble); putty bombs deal 0 | `ResourceBombs.as:48-178`; `combat.md:415-427` |

Fortification and armour only lower real damage (`BFOUNDATION.as:508-512`), so they do not appear.
Travel time, tower fire, walls in the way and monster deaths are all ignored: the bound is an
envelope, deliberately loose, and section 6 item 1 says why that is the right first bound.

**Damage with nothing on the field.** If `flung` is empty, no champion is on the field and the
attacker owns no catapult, `drop` must be 0. Rule `damageWithoutMonsters`, enforced. Bomb-only
damage is bounded by the bomb term above.

### 2.4 Loot

Loot is damage (`combat.md:1410-1416`, rule 1): a point of damage to a resource building removes one
unit of that resource from its buffer, and a point to a storage building draws from the pool
(`BRESOURCE.as:93-134`, `BSTORAGE.as:30-90`), scaled by the attacker's `lootingMultiplier` and the
low-level bonus (`ATTACK.as:678-680`). The lootable classes are `BRESOURCE` (types 1 to 4) and
`BSTORAGE` (types 6, 14 and 112, `client/scripts/BUILDING6.as`, `BUILDING14.as`, `BUILDING112.as`
each `extends BSTORAGE`).

Let `gain_r = max(0, T.attackloot[r])`, `spend_r = max(0, -T.attackloot[r])`,
`loss_r = max(0, -T.resources[r])`, and `lootableDrop` the part of section 2.3's `drop` that fell on
lootable buildings.

| Rule | Check | Enforced |
|---|---|---|
| `lootExceedsLoss` | `gain_r <= loss_r * LOOT_GAIN_RATIO` with `LOOT_GAIN_RATIO = 1.6`: the attacker receives at most the low-level bonus (`+57%` at level 1, `ATTACK.as:678-680`) over what the defender lost; storage scalars (`x0.5` outpost, `x0.9` main, `/5` wild monster, `BSTORAGE.as:77-85`) and the cap only make the gain smaller | Yes |
| `lootExceedsDamage` | `sum_r gain_r <= lootableDrop * LOOT_MULT_MAX`, `LOOT_MULT_MAX = 5`: the largest looting multiplier in the client is Krallen's `x3` against storage (`champions/Krallen.as:31-32`) times the `+57%` bonus; `targetGroup 3` creeps and champions carry `1.5` added to a base of 1 (`CreepBase.as:224-226`, `ChampionBase.as:221`), which is at most 2.5 whichever way `CModifiableProperty` composes it (`combat.md:1370-1372`). A Vacuum in `A.siege` doubles the allowance (section 6, item 4) | Yes |
| `lossExceedsPool` | `loss_r <= S.resources[r] + sum of st over harvesters of type r`: a yard cannot lose what it does not hold. `defenderLootHandler` already floors the pool; this makes the excess visible | Yes |
| `lootOverCap` | **Derived.** The credited gain is `min(gain_r, cap_r - A.resources[r])`, floored at 0, with `cap_r` from `storageCap(A)` (`services/base/economy/resourceBudget.ts`) raised by Krallen's `buff` when she is on the field (`ATTACK.as:696-702`). In `reject` mode `attackLootHandler` receives the credited figure; in `log` mode the difference is recorded | Derived |
| `bombSpend` | `spend_r <= 10,000,000` for `r1..r3` and 0 for `r4`, and only when `A.catapult` unlocks that resource's bombs; the largest bomb costs 10,000,000 and one per resource may be used | Yes |

### 2.5 The attacker's own row

| Key | Rule | Enforced |
|---|---|---|
| `attackerchampion` | For each entry matched by `t` to `A.champion`: only `hp` may change, and only downwards; `l`, `pl`, `fb`, `fd`, `ft`, `status` are taken from A. An entry with no match in A, or a missing entry, is `attackerChampionMutated`. **Derived**: the server writes A's entries with `hp = min(A.hp, T.hp)` | Yes |
| `attackcreatures` | Ignored on a Map Room 2 attack save (the client does not send it, `BASE.as:3266-3268`). Outside Map Room 2 the per-type counts may only fall against `A.monsters`: `rosterGrew` | Yes |
| `monsterupdate` | For every attacker cell, every `housed` count `<=` the stored count (`housedCounts`, `transferRules.ts:171`), else `rosterGrew` with `{ baseid, id, stored, sent }`. Other fields of `m` (`space`, `h`, `hid`, `hstage`, `hcc`) are copied as today | Yes |
| `attackersiege` | Every weapon's `quantity` `<=` the stored quantity, else `siegeGrew` | Yes |

### 2.6 The defender's roster and champion

| Key | Rule | Enforced |
|---|---|---|
| `monsters` (the defender's) | **Derived.** The server keeps S's blob and takes, per monster id, `min(S.housed[id], T.housed[id])`, and the same for the bunker contents once their shape is confirmed (section 6, item 5). A save that raises any count is `defenderRosterGrew` | Yes |
| `champion` (the defender's) | Unchanged: `championHandler` already takes `min(hp)`. The audit adds `championMutated` when `T` names a champion S does not hold, recorded only | No |

### 2.7 Keys that leave the attack write path

| Key | Why | Change |
|---|---|---|
| `protected`, `locked` | Damage protection is the server's to compute (`baseSave.ts:258-263`, `services/maproom/v2/damageProtection.ts`); the Flash client never sends either key | Removed from `Save.attackSaveKeys` in every mode (section 6, item 2) |
| `buildingresources` | The attacker's own auto-bank snapshot; it belongs to the attacker's main row and only ever reaches it through an owner save (`baseSave.ts:195`, `:379-387`) | Removed from `attackSaveKeys` in every mode; the audit records `foreignKey` when it is present |
| `attackreport` | Served back to the defender as HTML (`combat.md:1204-1212`) | Kept, but a body over 64 KB is `malformed`; not sanitised here (section 6, item 7) |

### 2.8 Phase B: what the replay derives

With a fling log (section 3.10) the server runs `replayAttack(yard, roster, log, seed)` from the
shared module and **derives** everything section 2.2 to 2.6 checks: the health map, `damage`,
`destroyed`, both resource deltas, the trap set, the champion `hp` on both sides, the bunker
contents. The client's copies are compared in `log` mode (`replayMismatch` with the field and both
values) and ignored in `authoritative` mode. The rules the engine must reproduce are the eleven at
`combat.md:1410-1439`, and the engine drops the Flash-era constraints at `:1441-1465`: one clock,
fixed timestep, no load shedding, no `SecNum`, one coordinate space.

The audit of section 2.3 stays on in Phase B as a sanity envelope around the replay itself.

---

## 3. Server design

### 3.1 Files

New, shared (source of truth in the web tree, copied to the server by section 3.2's script):

| File | Contents |
|---|---|
| `web/src/game/combat/rules/combatStatsData.ts` | GENERATED by section 3.3's generator. Tower stats per level, `hp` ladders, trap and bunker numbers, the flyer-mode table, grid costs, monster and champion props. |
| `web/src/game/combat/rules/stats.ts` | Readers: `monsterStat(id, key, level)` with the client's clamp (`CREATURES.as:75-81`), `championStat`, `towerStats(type, level)`, `maxHp(type, level)`, `flyerMode(type)`, `gridCost(type)`, and the code-side constants transcribed with citations: attack delay default 60, speed halving, behaviour speed factors, specialist multipliers, tower re-arm `rate * 2` and acquire 30, trap radius 20 and falloff, fortification formula, champion delays, victory threshold, countdowns, storage scalars, bomb table. |
| `web/src/game/combat/rules/damagePercent.ts` | `damagePercent(yard, health)`: section 2.2's sum, one implementation for the client's victory popup, the Baiter report and the server. |
| `web/src/game/combat/rules/potential.ts` | `damagePotential(context)` and the loot bounds of sections 2.3 and 2.4. Pure over the context. |
| `web/src/game/combat/rules/rng.ts` | `mulberry32(seed)`: 32-bit integer PRNG, `next()`, `int(n)`, `float()`. No dependency. |
| `web/src/game/combat/rules/grid.ts` | The 260 x 260 cost grid at 10 yard units per cell, base 10, minimum 2, diagonal `x1.5`, wall registration, the flood field and path extraction (`PATHING.as:34-36`, `:84`, `:104-105`, `:355-362`, `:412-475`), with the scatter step driven by the seeded RNG. Flood fields cached per `(target id, grid version)`. |
| `web/src/game/combat/rules/targeting.ts` | Target groups 1 to 6, the two-closest rule, the sticky fallback, the flag bitmask and `canHit` (`MonsterBase.as:991-1171`, `Targeting.as:11-23`, `:322-325`); creep buckets of 100 units. |
| `web/src/game/combat/rules/engine.ts` | `createBattle(yard, options)`, `battle.fling(event)`, `battle.tick()`, `battle.state()`: creeps, towers (including the Stronghold's four emitters and the Spurtz burst), traps, bunkers, champions, projectiles, bombs, siege effects. |
| `web/src/game/combat/rules/replay.ts` | `replayAttack(yard, roster, log, seed): Outcome` and `digest(state)`: runs the engine over a fling log and returns the health map, both deltas, the trap set and a checkpoint digest every 800 ticks. |
| `web/src/game/combat/rules/types.ts` | `CombatYard` (built from `buildingdata` and `buildinghealthdata`, the same fields `yardModel.ts` reads), `Roster`, `FlingLog`, `Outcome`, `AttackContext`, `CombatVerdict`. |
| `web/src/game/combat/rules/MANIFEST.json` | File name to SHA-256 of every file in the directory, written by the sync script. |
| `web/src/game/combat/rules/*.test.ts` | Section 4.1. |
| `web/tools/gen-combat-stats.mjs` | Section 3.3. |
| `web/tools/sync-combat-rules.mjs` | Section 3.2. |
| `web/test/fixtures/combat/*.json` | Golden replays: a yard, a roster, a fling log, a seed, the expected outcome and digests. |

New, server only:

| File | Contents |
|---|---|
| `server/src/game-rules/combat/` | The copied module, byte-identical, plus `sync.test.ts` (section 3.2). |
| `server/src/services/base/combat/attackContext.ts` | `attackContext(input): AttackContext`: section 2.1. Reads the session, the attacker's rows, the academy, `housedCounts`; the only file that knows the save shapes. |
| `server/src/services/base/combat/auditAttackSave.ts` | `auditAttackSave(input): CombatVerdict`. Pure. Sections 2.2 to 2.7 in order, never stopping at the first violation. Throws `layoutInvalidErr`-style 400 only for `malformed`. |
| `server/src/services/base/combat/recordVerdict.ts` | `recordCombatVerdict(ctx, user, save, verdict, mode)` and `applyCombatDerived(save, userSave, derived)`: the one file that touches the logger, `logReport` and the request; the same split `economy/recordVerdict.ts` makes. |
| `server/src/services/base/combat/replayRunner.ts` | Phase B (WP5): runs `replayAttack` in a Bun `Worker` with a deadline; returns the outcome or `timeout`. |
| `server/src/config/CombatConfig.ts` | `combatConfig: { mode, replay, tolerance constants }` (section 3.6). |
| `server/src/errors/errors.ts` addition | `combatSaveRejectedErr(violations, elapsed)` (section 3.9). |
| `server/src/services/base/combat/*.test.ts` | Section 4.2. |
| `server/scripts/verify-combat-save.sh` | Section 4.3. |

Modified:

| File | Change |
|---|---|
| `server/src/controllers/base/save/baseSave.ts` | Section 3.7: the context and audit calls before the key loop; `attackerchampion`, `attackcreatures`, `monsters` and `attackloot` take the derived values in `reject` mode; `protected`, `locked`, `buildingresources` no longer reach the default branch. |
| `server/src/database/models/save.model.ts` | `attackSaveKeys` loses `locked`, `protected`, `buildingresources` (`:518-519`, `:525`). |
| `server/src/services/base/attackSession.ts`, `attackSessionStore.ts` | A fourth field, `seed`, on the session string; `parseAttackSession` accepts three or four fields. Phase B reads it; Phase A mints it so the value exists from day one. |
| `server/src/controllers/base/load/modes/baseModeAttack.ts` | Returns `combatseed` in the attack-mode load response beside `attackid` (`:126`, `:191-192`). The Flash client ignores unknown fields. |
| `server/src/schemas/BaseSaveSchema.ts` | `flinglog` (JSON string, optional) for Phase B. |
| `server/example.env` | `COMBAT_SAVE_VALIDATION=log`, `COMBAT_REPLAY=off`, each with a comment. |
| `web/package.json` | `"gen:combat"` and `"sync:combat"` scripts; `"test"` unchanged (Vitest picks the new tests up under `src/**/*.test.ts`, `web/vite.config.ts:62`). |
| `docs/server-api.md`, `docs/specs/combat.md`, `docs/specs/monsters-and-hatchery.md` | Section 3.11. |

### 3.2 The shared rules module

**The problem.** `web/` and `server/` are separate packages with different compilers: the server is
`NodeNext` with `rootDir: "src"` and `.js` import suffixes, no `strict` (`server/tsconfig.json`), and
runs TypeScript directly under Bun; the web is `bundler` resolution, `strict`, `exactOptionalPropertyTypes`,
`noUncheckedIndexedAccess`, and builds with Vite (`web/tsconfig.json`). There is no root package,
no workspace and no `file:` dependency anywhere (`server/package.json`, `web/package.json`). A
third package would need either a build step or a change to `rootDir`, and today's repo has neither.

**The mechanism: one source, one copy, a manifest, a drift test on each side.** This is the pattern
the repo already trusts for the cost table, where two generated files "hold identical rows on
purpose" and each tree's integrity test guards its copy (`buildingCosts.ts:29-34`,
`web/src/game/yard/buildingCosts.test.ts:27-30`). The difference is that these files are hand-written,
so the check is a hash rather than a re-parse.

- **Source of truth** is `web/src/game/combat/rules/`. The web tree is where issue #22 works, where
  Vitest runs the module's tests, and where the stricter compiler is; code that passes there passes
  the server's looser one.
- **`web/tools/sync-combat-rules.mjs`** copies every `*.ts` file except tests into
  `server/src/game-rules/combat/` byte for byte, deletes copies whose source is gone, and writes
  `MANIFEST.json` (name to SHA-256) into both directories. It runs in the same breath as the
  generators: `node tools/sync-combat-rules.mjs` from `web/`, and `--check` exits non-zero on drift.
- **`server/src/game-rules/combat/sync.test.ts`** re-hashes the server copy and the web source (read
  through `../../../../web/src/game/combat/rules`, the same relative reach
  `server/src/game-data/buildingCosts.test.ts:28` uses for the fixture) and fails if either differs
  from the manifest. `web/src/game/combat/rules/sync.test.ts` does the same from the other side. A
  forgotten sync fails both test suites and CI.
- **Module rules**, enforced by `boundary.test.ts` in the source directory, which reads every file
  and rejects: an import that is not relative and inside the directory (no `@/`, no `pixi.js`, no
  `node:`), a reference to `window`, `document`, `Date.now`, `Math.random` or `performance`, and any
  file over 100 columns. Relative imports carry the `.js` suffix, which `NodeNext` requires and
  `bundler` resolution accepts for a `.ts` file, so the copy needs no rewriting.
- Both tsconfigs already include the directories: `server/tsconfig.json` includes `src/**/*`; the
  web includes `src`. Nothing else changes.

The server's consumers import from `../../../game-rules/combat/index.js`; the web's from
`@/game/combat/rules`. The Baiter and the server therefore execute the same bytes, and the golden
replay fixtures (section 4.1) prove that the same bytes give the same answer under Bun and Node.

### 3.3 The combat stats generator

`web/tools/gen-combat-stats.mjs`, run with `bun tools/gen-combat-stats.mjs` from `web/` (Bun rather
than Node, so it can import the server's TypeScript stat tables directly; the other two generators
stay on Node). It reuses `matchBrace`, `readIntArray` and the comment-stripping read from
`gen-building-costs.mjs:58-59`, `:69-85`, `:139-146`, lifted into `web/tools/lib/props.mjs` so the
three generators share one parser. Output is `web/src/game/combat/rules/combatStatsData.ts`, which
the sync script then copies.

What it reads, and from where:

| Table | Fields | Source |
|---|---|---|
| `TOWERS[type]` | `stats[]` per level: `range`, `damage`, `rate`, `speed`, `splash`, and `shots` where present | `client/scripts/YARD_PROPS.as`, the `"stats": [` block of each entry: type 20 `:1979`, 21 `:2200`, 22 `:2423` (range only), 23 `:2498`, 25 `:2739`, 115 `:6045`, 118 `:6337`, 129 `:6886`, 132 `:7157`, 136 `:7566`, 137 `:7678`, 138 `:7791`, and `:7457` (identified at generation time and named in the row comment) |
| `HP[type]` | `hp[]` per level for every entry that has one (137 of 140) | `YARD_PROPS.as` `"hp"` arrays, e.g. `:154` (harvesters), `:1828` (Wooden Block 1000..27000), `:1872` (Stone Block 3600), `:2184` (Cannon Tower), `:2725` (Booby Trap 10) |
| `TRAPS[type]` | `damage[0]`, `size` (the blast radius), `hp` | `:2689`, `:2724-2725` (type 24); the type 117 entry at `:6283` |
| `BUNKERS` | Monster Bunker `range[]` and the Map Room 2 `capacity` override `[380, 450, 540, 660, 800]`; Housing `[200, 260, 320, 380, 450, 540]`; Flinger `[500, 1000, 1750, 2250, 3000, 4000]` | `YARD_PROPS.as:2423`; `GLOBAL.as:682-683`, `:713`, transcribed with the same line tripwire `MR2_OVERRIDES` uses (`gen-building-costs.mjs:341-368`) |
| `FLYER_MODE[type]` | 0, 1 or 2 per tower type | `client/scripts/BTOWER.as:25-35`, transcribed with a tripwire on the object literal |
| `GRID_COST[type]` | `[[x, y, w, h, cost], ...]` | The `_gridCost = [...]` line of each `client/scripts/BUILDING<t>.as`, parsed as `new Rectangle(a, b, w, h), cost` pairs (`BUILDING17.as:14`, `BUILDING20.as:19`); walls' inner cost is the level-dependent `100 + level * 25` (`BFOUNDATION.as:3151`) and is emitted as a formula flag |
| `MONSTERS[id]` | `speed`, `health`, `damage`, `range`, `attackDelay`, `targetGroup`, `bucket`, `cStorage`, `explode`, `splits`, `zombieHealthMultiplier`, `zombieSpeedMultiplier`, `zombieDamageMultiplier`, `resurrectCooldown`, and the root `movement`, `pathing` | `server/src/game-data/stats/monsterStats.ts` (`MonsterProps` at `:3-21`, `MonsterStat.movement`/`pathing` at `:23-30`), imported and re-emitted so the shared module has one file and the server has no second copy to drift; `mr3MonsterStats` is not emitted (Map Room 3 is out of scope) |
| `CHAMPIONS[id]` | `speed`, `health`, `damage`, `range`, `attack`, `movement`, `buffs`, `buffRadius`, `bucket`, `targetGroup`, the three `bonus*` tiers | `server/src/game-data/stats/championStats.ts` (`ChampionProps` at `:1-26`) |

Integrity tests in both trees (section 4) assert: the Cannon Tower row is `range 160..250`,
`damage 20..200`, `rate 40`, `splash 30..75` over ten levels and `hp` ends at 98,200
(`combat.md:766`; `YARD_PROPS.as:1979-2184`); the Wooden Block `hp` is `[1000, 2300, 5750, 18000, 27000]`;
the Booby Trap deals 1000 over a 50-unit blast with 10 hp; every tower in `FLYER_MODE` has a `TOWERS`
row except 130, which has no stats block (`combat.md:780`); `MONSTERS.C1.damage` equals
`monsterStats.C1.props.damage` for every id and every key (the drift tripwire against the server's
own file); and every type in the sandbox fixture has an `HP` row.

### 3.4 Determinism

The engine must give the same answer on the server, in the Baiter, and in the web client's attack
renderer, from the same inputs. Five rules, each checked by a test:

1. **Fixed timestep, 80 ticks per second.** Every constant in the client is already in fast ticks
   (`rate * 2` re-arm, `attackDelay`, the 150-tick retarget, the 30-tick bunker cadence), so the
   engine keeps the unit rather than converting each one. A 300 s attack is 24,000 ticks; the
   `RetreatAll` at `_countdown == -120` is tick 33,600 on a Declare-War attack. The Flash
   accumulator, its 800-loop cap and catch-up mode are dropped (`combat.md:1443-1447`).
2. **One seeded RNG**, `mulberry32`, seeded from the session's `seed`. Every `Math.random()` in the
   combat path is replaced by a call on the battle's RNG in a fixed order: spawn angle and radius
   (`ATTACK.as:529-530`, `:546-547`), the pathing scatter (`PATHING.as:454`, `:469`), the storage loot
   pick (`BSTORAGE.as:59`), the burrow side (`MonsterBase.as:1097-1114`), the flyer ring
   (`:1139-1154`), the bunker interceptor pick (`HOUSINGBUNKER.as:444-451`), the Spurtz spawn roll
   (`SpurtzCannon.as:229`). Sound, particle and frame-offset randomness (`CreepBase.as:125`, `:945-955`)
   is not simulated.
3. **No transcendental functions.** Spawn positions are drawn by rejection sampling inside the drop
   circle with `sqrt` only; bearings are compared by cross products; distances use `sqrt`, which
   IEEE 754 rounds identically everywhere, unlike `sin`, `cos` and `atan2`, which engines may
   implement differently. `Math.floor` and integer ticks everywhere a value is stored.
4. **Fixed iteration order.** Creeps, buildings and towers live in arrays sorted by id; targets with
   equal distance are broken by id; no `for...in` over objects, no `Map` iteration where insertion
   order could differ between the server's and the client's construction.
5. **A digest.** `digest(state)` hashes every creep's position and health and every building's health
   at 800-tick checkpoints. Golden fixtures carry the digests; the same fixture runs under Bun
   (`server/src/game-rules/combat/replay.test.ts`) and under Vitest on Node, and both must match the
   file. That is the cross-runtime proof.

### 3.5 Performance and where the simulation runs

**Phase A** is arithmetic over the roster and the building map: a few hundred multiplications and one
pass over `buildingdata` (575 entries on the sandbox yard). It runs inline in the save request, like
the economy audit, and is not worth measuring beyond a test that the sandbox audit completes in under
5 ms.

**Phase B** is the expensive path. Sizing it from the client: a Map Room 2 fling is capped at 2,250
bucket units (`GLOBAL.as:863`, `:713`), which is 321 Pokeys, and an attack is several flings, so
the live creep count can pass 400 with a thousand over the attack; a yard holds up to 400 walls, a
few dozen towers and 75 traps (fixture counts); the grid is 67,600 cells. Per tick the engine moves
every creep and fires every tower, which is cheap. The cost is pathing: the Flash client floods the
whole grid per request (`PATHING.as:188-200`), and a creep re-requests every 150 ticks
(`CreepBase.as:874-876`), so a naive port would run tens of thousands of floods. The engine instead
caches one flood field per `(target building, grid version)`, invalidating on every building death
(`BFOUNDATION.as:2010-2011` is when the client resets costs), so floods are bounded by targets times
grid changes, a few hundred per attack.

Budget, to be measured by `bench.test.ts` in WP4 on the sandbox yard with a 300-Pokey, 4-fling,
5-minute log: **under 500 ms median and under 2 s worst on Bun 1.4**; the test fails above 5 s.

Where it runs: **in a Bun `Worker` started by the save request, awaited with a deadline of 5 s**,
single-flight per `basesaveid` (a Redis `SET NX` on `attack-replay:<basesaveid>`, released on
completion). A Koa request that blocked the event loop for seconds would stall every other player,
and a worker keeps the request path async without a queue, a job table or a second process. On
timeout the save falls back to Phase A's verdict and logs `replayTimeout`; in `authoritative` mode
that fallback is the only case where the client's clamped figures are written. A queue (Redis-backed,
a separate consumer) is deferred until a measured need exists (section 6, item 8).

### 3.6 Configuration and rollout

```ts
// server/src/config/CombatConfig.ts
export type CombatValidationMode = "off" | "log" | "reject";
export type CombatReplayMode = "off" | "log" | "authoritative";

export const combatConfig = {
  /** off: today's behaviour. log: audit, record, never refuse. reject: refuse and derive. */
  mode: parse(process.env.COMBAT_SAVE_VALIDATION, "log"),
  /** Phase B. off: never replay. log: replay and compare. authoritative: replay and write. */
  replay: parseReplay(process.env.COMBAT_REPLAY, "off"),
  /** Section 2.3 slack: 1% of potential, at least this many hit points. */
  damageSlackMin: 1000,
  /** Section 2.4. */
  lootGainRatio: 1.6,
  lootMultMax: 5,
  vacuumLootSlack: 2,
  /** Section 3.5. */
  replayDeadlineMs: 5000,
};
```

Both variables follow `ECONOMY_SAVE_VALIDATION` (`config/EconomyConfig.ts:18-73`): read once, an
unknown value falls back to the default and is named in the startup banner.

**Rollout, mirroring the economy audit (`economy-save-validation.md` §3.2):**

1. **Land in `log`.** The key trims of section 2.7 land at the same time in every mode, because no
   honest client sends those keys. Everything else is as today: the key loop runs, the client's
   `damage`, health map, loot and rosters are stored as sent. Every verdict with violations is one
   structured `logger.warn` (`event: "combat-save-audit"`) with the rule list and the context, and one
   `Report` row through `logReport` (`services/base/reportManager.ts:18-29`), so a repeat offender is
   visible by count.
2. **Read a week of Flash play.** Any rule that fires on honest attacks is a bug in the bound, not the
   player; section 4.3's script gives the expected positives. The two bounds most likely to need a
   constant nudged are `lootExceedsDamage` (the untraced looting multipliers) and `damageBudget`
   (ability damage), which is why both carry named constants in the config.
3. **Switch to `reject`.** Refusals come back in section 3.9's shape. A refused Flash save shows the
   message once and keeps retrying the same snapshot until the player reloads, which is the intended
   outcome for a tampered client. Derived fields are written from then on.
4. **`COMBAT_REPLAY=log`** once WP5 lands and the web client sends fling logs: replays run and are
   compared to the client's outcome; **`authoritative`** after the comparison is clean.
5. **`off`** on both variables is the emergency switch and never the default.

`DEV_SANDBOX` exempts nothing.

### 3.7 Where the checks go in `baseSave.ts`

Two insertions and four handler changes. The controller stays a sequence of calls; every rule lives
in the services.

After the binding check and the anti-cheat hook (`baseSave.ts:91-93`), before the economy audit's
`auditKind` line (`:99`):

```ts
// Attack saves are audited before anything is written (docs/design/server-combat.md §3.7),
// so a refusal in `reject` mode leaves both rows untouched. Owner saves go through the
// economy audit below instead.
const combatVerdict =
  isAttack && combatConfig.mode !== "off"
    ? auditAttackSave({
        context: await attackContext({ user, userSave, baseSave, session, submitted: saveData, now }),
        stored: baseSave,
        attacker: userSave,
        submitted: { ...saveData, damage: body.damage, buildinghealthdata: saveData.buildinghealthdata },
        config: combatConfig,
      })
    : null;

if (combatVerdict) await recordCombatVerdict(ctx, user, baseSave, combatVerdict, combatConfig.mode);
```

`attackContext` is the one async call: it loads the attacker's other rows named in `monsterupdate`
(the same `find` `updateMonsters.ts:18-22` makes) so the audit itself stays pure. `session` is the
value `requireAttackBinding` already read; it is returned rather than re-read.

In the key loop and the attack block, `reject` mode substitutes derived values:

| Site | Today | With a verdict in `reject` mode |
|---|---|---|
| `case SaveKeys.CHAMPION` (`:162-176`) | `userSave.champion = saveData.attackerchampion` | `userSave.champion = verdict.derived.attackerChampion` |
| `case SaveKeys.MONSTERS` (default branch) | verbatim | `baseSave.monsters = verdict.derived.defenderMonsters` |
| `buildinghealthdata` (default branch) | verbatim | `baseSave.buildinghealthdata = verdict.derived.health` |
| `damage`, `destroyed` (default branch) | verbatim | `verdict.derived.damage`, `verdict.derived.destroyed` (the latter only when defined) |
| `attackLootHandler` (`:222-224`) | `saveData.attackloot` | `verdict.derived.attackloot` (capped, spend preserved) |
| `attackcreatures` (`:218-220`) | overwrite | skipped on a Map Room 2 save; `verdict.derived.attackCreatures` otherwise |

In `log` mode none of these change, which is the promise log mode makes. The `over` handling,
`damageProtection`, the session end and `advanceBuildingTimers` (`:258-277`) are untouched: they
read `baseSave.damage`, which in `reject` mode is now the derived figure.

Phase B (WP5) adds one more call before the audit: if `saveData.flinglog` is present and
`combatConfig.replay !== "off"`, `replayRunner` produces an `Outcome` that the audit receives as
`submitted` in `authoritative` mode, or compares against in `log` mode.

### 3.8 The verdict

```ts
export interface CombatViolation {
  rule: CombatRule;                 // section 3.9's names
  ids?: number[];                   // building ids, first MAX_LISTED
  detail?: Record<string, unknown>;
  enforced: boolean;
}

export interface CombatDerived {
  health: BuildingHealthData;       // min(stored, submitted), per section 2.2
  damage: number;                   // section 2.2's sum over the derived health
  destroyed: 0 | 1 | undefined;     // outposts and wild monster camps only
  attackloot: Resources;            // gains capped at storage, spend preserved
  attackerChampion: ChampionData[]; // stored entries with hp = min
  defenderMonsters: JsonObject;     // stored blob with counts = min
  attackCreatures?: JsonObject;     // outside Map Room 2 only
}

export interface CombatVerdict {
  violations: CombatViolation[];
  derived: CombatDerived;
  context: { elapsedAttack: number; elapsedSave: number; flung: Counts; potential: number; drop: number };
}
```

`enforced` is decided by the rule, not the mode, so one verdict serves both modes and the log line
says which violations would have refused. The audit does not stop at the first violation.

### 3.9 Error contract

Written in the style of `docs/server-api.md` §1 "Errors" (`:110-146`) and identical in shape to the
economy rejection (`:349-384`), so a client that handles one handles both.

A rejected attack save is a `ClientSafeError` with `status: 409`, `data: { violations, elapsed }`
and **`isClientFriendly: false`**, beside `economySaveRejectedErr` (`errors/errors.ts:523-531`):

```ts
export const combatSaveRejectedErr = (violations: CombatViolation[], elapsed: number) =>
  new ClientSafeError({
    message:
      `This attack result does not add up (${violations.map((v) => v.rule).join(", ")}). ` +
      "Reload your yard.",
    status: Status.CONFLICT,
    data: { violations, elapsed },
    isClientFriendly: false,
  });
```

`isClientFriendly: false` for the reason the other eight cases use it: the interceptor answers HTTP
200 with `error` set (`middleware/clientSafeError.ts:90-93`), which is the one shape the Flash client
turns into a readable message (`BASE.as:3413-3416`); a real 409 would reach `handleLoadError` and
its five silent retries (`:3420-3428`). The web client reads `errorDetails.status`
(`web/src/api/http.ts:19-22`).

Body:

```json
{
  "error": "This attack result does not add up (healthRose, lootExceedsLoss). Reload your yard.",
  "errorDetails": {
    "status": 409,
    "message": "This attack result does not add up (healthRose, lootExceedsLoss). Reload your yard.",
    "data": {
      "violations": [
        { "rule": "healthRose", "ids": [32], "detail": { "stored": 4000, "sent": 6000 }, "enforced": true },
        { "rule": "lootExceedsLoss", "detail": { "resource": "r1", "gain": 1000000, "loss": 0 }, "enforced": true }
      ],
      "elapsed": 61
    }
  }
}
```

| Status | Rule | Detail keys | Meaning | Enforced |
|---|---|---|---|---|
| 400 | `malformed` | `issues` | A health value that is not an integer in range, a `housed` count that is not a non-negative integer, a `monsterupdate` naming a base the attacker does not own, an `attackreport` over 64 KB. `layoutInvalidErr` with `isClientFriendly` true, since only a broken client sends it | — |
| 409 | `unknownBuilding` | `ids` | Health reported for an id the defender's yard does not hold | Yes |
| 409 | `healthRose` | `ids`, `stored`, `sent` | A building's health above its stored value. Derived in `reject` | Yes |
| log | `trapState` | `ids` | A trap dropped from `buildingdata` without a 0 in the health map, or the reverse | No |
| log | `damageMismatch` | `sent`, `derived` | The client's `damage` differs from the health sum by more than 1 point. Derived in `reject`, so never a rejection | No |
| log | `destroyedMismatch` | `sent`, `derived` | `destroyed` disagrees with `derived >= 90`. Derived | No |
| 409 | `damageBudget` | `drop`, `potential`, `elapsed` | More health fell than the roster on the field could deal in the interval | Yes |
| 409 | `damageWithoutMonsters` | `drop` | Health fell with nothing flung and no catapult | Yes |
| 409 | `lootExceedsLoss` | `resource`, `gain`, `loss` | The attacker gained more than 1.6 times what the defender lost | Yes |
| 409 | `lootExceedsDamage` | `gain`, `lootableDrop`, `mult` | Total gain above the lootable damage times the largest looting multiplier | Yes |
| 409 | `lossExceedsPool` | `resource`, `loss`, `pool` | The defender lost more than it held | Yes |
| log | `lootOverCap` | `resource`, `gain`, `credited` | Gain above the attacker's storage cap. Derived in `reject` | No |
| 409 | `bombSpend` | `resource`, `spend`, `max` | A negative `attackloot` larger than one bomb, or on a resource the catapult cannot fire | Yes |
| 409 | `attackerChampionMutated` | `t`, `field` | The attacker's own champion changed anything but `hp`, or `hp` rose. Derived | Yes |
| 409 | `rosterGrew` | `baseid`, `id`, `stored`, `sent` | A housed count in `monsterupdate` or `attackcreatures` above the stored one | Yes |
| 409 | `siegeGrew` | `weapon`, `stored`, `sent` | A siege quantity above the stored one | Yes |
| 409 | `defenderRosterGrew` | `id`, `stored`, `sent` | The defender's housed or bunkered count rose. Derived | Yes |
| log | `championMutated` | `t` | The defender's `champion` names a champion the row does not hold | No |
| log | `foreignKey` | `key` | `protected`, `locked` or `buildingresources` present on an attack save | No |
| log | `replayMismatch` | `field`, `sent`, `replayed` | Phase B: the client's figure differs from the replay | No |
| log | `replayTimeout` | `ms` | Phase B: the worker missed its deadline; Phase A's verdict was used | No |

### 3.10 The fling log: what the web client must send (for issue #32)

The Flash client cannot send this. The web client's attack flow, when #32 builds it, adds one key to
every attack save, `flinglog`, a JSON string. It is the complete record from attack start, resent in
full on every save (a save is a snapshot, and the server keeps no partial state between saves):

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

| Field | Meaning | Rule |
|---|---|---|
| `seed` | The `combatseed` the attack-mode `/base/load` returned (section 3.1, `baseModeAttack.ts`) | Must equal the session's; else `malformed` |
| `t` | Fast ticks since attack start | Non-decreasing; `<= 33,600`; a fling with `t` past the countdown (`24,000`, or `33,600` under Declare War) is refused as the client refuses it (`DROPZONE.as:53`) |
| `x`, `y` | Yard units, the same space as `buildingdata.X/Y` | Inside the map; a fling centre may not overlap a building footprint (`DROPZONE.as:64`) |
| `r` | Drop radius: `max(200, bucketTotal / 4) / 2` | Recomputed by the server from `monsters`; a mismatch is `malformed` |
| `monsters` | Counts per id | Sum of `bucket[L] * count` at most the flinger capacity plus the Declare-War bonus (`ATTACK.as:589-598`); cumulative counts at most the roster in range |
| `champion` | At most one per attack, `hp > 0` and normal status at attack start | — |
| `bomb` | One per resource per attack, tier within `A.catapult`, cost within the attacker's pool at that tick | `ResourceBombs.as:301-315` |
| `siege` | Quantity within `A.siege` | — |

The server runs `replayAttack` over the log and derives the outcome. The web client runs the same
engine with the same seed to render, so what the player watched is what the server wrote. This
contract is the deliverable #32 builds against; it is fixed here so the engine (WP4) and the flow
are written to one shape.

### 3.11 Documentation

`docs/server-api.md`: a subsection **Combat save validation** after "Economy save validation"
(`:325-400`), stating both variables, that the audit precedes every attack write, the derived fields
in `reject` mode, the three keys removed from `attackSaveKeys`, the rule table of section 3.9, the
`flinglog` key and `combatseed` for a new client, and a pointer to this plan; `combatSaveRejectedErr`
added to the `isClientFriendly: false` list under §1 "Errors" (`:131-136`); the `/base/save` row
(`:194`) gains one sentence; the `Save` model's `protected` row notes it is server-written only.

`docs/specs/combat.md`: dated notes under §1 (after `:91`) and §7 "What the server does with it"
(`:1164-1183`) naming which mode is live and pointing here; §9's untraced multipliers gain a pointer
to the constants in `CombatConfig.ts`.

`docs/specs/monsters-and-hatchery.md` §8: one line that the Baiter simulator (#22) runs
`web/src/game/combat/rules/engine.ts`, the same engine the server uses.

---

## 4. Tests and verification

### 4.1 The shared module (`web/`, Vitest; mirrored under Bun)

Tests stay in the source tree; the sync script copies only the module. The server's one test of the
module is `server/src/game-rules/combat/replay.test.ts`, which runs the golden fixtures under Bun.
That is enough: the golden replays exercise every rule in the engine, and matching digests under
two runtimes is the property that matters.

| File | Cases |
|---|---|
| `combatStatsData.test.ts` | Section 3.3's integrity assertions; `MONSTERS` equals `monsterStats[id].props` key for key (imported through a relative path from the test only, so the module itself stays dependency-free). |
| `stats.test.ts` | `monsterStat("C1", "damage", 6)` is 85 and level 9 clamps to 85 (`CREATURES.as:75-77`); `attackDelay` defaults to 60; `maxHp(17, 5)` is 27,000; `flyerMode(115)` is 2 and `flyerMode(130)` is 0; wall grid cost at level 3 is 175. |
| `damagePercent.test.ts` | Over the fixture yard with empty health: 0. With every wall at 0: still 0. One Cannon Tower at half: the hand-computed figure. A fired trap contributes to neither sum. |
| `potential.test.ts` | One level-1 Pokey over 10 s: `60 * (floor(800 / 60) + 1) = 840`. One Eye-ra: its damage times 2, once. A Rezghul on the field doubles the roster term. Bombs at catapult 2 add 125,000; at 0 add nothing. Loot: `lootExceedsLoss` at gain 1601 against loss 1000; not at 1600. |
| `rng.test.ts` | Known sequence for seed 1; `int(6)` over 60,000 draws is uniform within 2%. |
| `grid.test.ts` | Base cost 10, minimum 2, diagonal 15; a wall at level 1 stamps 20 outer and 125 inner; a path across a wall line is truncated at the wall and returns it (`PATHING.as:445-452`); the scatter step is seeded and reproducible. |
| `targeting.test.ts` | Each target group over a hand-built yard: group 3 skips a looted harvester, group 4 skips a jarred tower and an empty bunker, group 2 falls through to "all" and rewrites itself to 1, group 4 does not (`MonsterBase.as:1072-1077`); `canHit` over the flag table (`Targeting.as:175-190`, `:322-325`). |
| `engine.test.ts` | A single Pokey against a lone level-1 Cannon Tower: the tower fires every 80 ticks (`rate * 2`) at 20 damage and the Pokey dies at tick 800 ± acquire; a Fink against three adjacent walls damages all three per swing; a Booby Trap fires once on a ground creep and never on a Teratorn; a bunker dispatches its whole pool at the nearest ground attacker every 30 ticks; a Stronghold's four emitters hit four separate creeps; Krallen loots `x3` from a silo; the countdown ends the battle at 24,000 and retreat at 33,600. |
| `replay.test.ts` | Every fixture under `web/test/fixtures/combat/`: outcome and digests equal the file. Fixtures: `pokey-rush` (300 Pokeys, one fling, sandbox yard), `mixed-waves` (four flings, a champion, one bomb), `maze` (a 400-wall yard, Eye-ras and Finks), `air` (Teratorns against Flak Towers), `empty-yard`. |
| `bench.test.ts` | `mixed-waves` completes under the section 3.5 budget; reported, and failed above 5 s. |
| `sync.test.ts`, `boundary.test.ts` | Section 3.2. |

Generating a fixture is a script, `web/tools/gen-combat-fixture.mjs <name>`, that runs the engine
and writes the outcome; a reviewer regenerates and diffs when a rule changes on purpose.

### 4.2 Server (`bun test` from `server/`)

The pattern is `services/base/economy/auditEconomySave.test.ts`: read the sandbox fixture
(`web/test/fixtures/baseload-sandbox-yard.json`: 575 buildings, 6 Cannon Towers at level 1, 400
Wooden Blocks, 75 Booby Traps, 18 Heavy Traps, `buildinghealthdata: {}`, resources of
11,163,050,000, two champions, housing of 25 Teratorns and 2 Zafreetis), `structuredClone` it as the
defender **S**, build an attacker **A** from `baseload-seed-user1.json` with a chosen `academy` and a
cell roster, and a session started at a chosen time.

| File | Cases |
|---|---|
| `combat/attackContext.test.ts` | `elapsedSave` from `savetime` and `startedAt`, clamped at 540; `flung` from stored versus reported `housed` across two cells, negatives clamped; levels clamp at the array length; a cell the attacker does not own is `malformed`. |
| `combat/auditAttackSave.test.ts` | Identity save (health map empty, zero deltas, zero loot): no violations, `damage` derived 0. Then one case per enforced rule in section 3.9, each asserting rule, detail and `enforced`; `healthRose` with a tower at 6000 against 4000 stored; `damageBudget` with 10 Pokeys and 3,000,000 of drop in 10 s; the same drop with 300 Pokeys passing; `lootExceedsLoss` and `lootOverCap` over a pool at the cap; `attackerChampionMutated` for a level change; `rosterGrew`; `defenderRosterGrew`; `foreignKey` for `protected`; `malformed` for a health value of 1.5 and for a 65 KB report. Derived: `damage` after a 50% Cannon Tower matches the hand sum, `destroyed` undefined for a `main` target and 1 for an outpost at 90. |
| `combat/recordVerdict.test.ts` | Mode `log` returns; `reject` throws `ClientSafeError` 409, `isClientFriendly` false, violations in `data`; unenforced-only verdicts do not throw; `logReport` and `logger` stubbed with `mock.module`. |
| `game-rules/combat/sync.test.ts`, `replay.test.ts` | Section 3.2, section 4.1's fixtures under Bun. |
| `attackSession.test.ts` (extended) | A three-field and a four-field session both parse; `seed` is a safe integer. |

`baseSave` itself needs a database and stays uncovered by unit tests; the controller change is two
calls and six substitutions, and section 4.3 exercises it end to end.

### 4.3 curl verification script

`server/scripts/verify-combat-save.sh <off|log|reject>`, in the shape of
`server/scripts/verify-economy-save.sh` (curl and `jq` only, database steps through
`docker exec ... psql`, a step-0 snapshot restored by an `EXIT` trap, `:151-195`). It needs two
accounts: the attacker `yardtester@test.com` / `Dev12345!` and a defender within flinger range on the
seeded Map Room 2 world, chosen at run time from `/api/v1/bm/worldmapv2/getarea` around the
attacker's home cell and overridable with `DEFENDER_BASEID`. Steps, each printing PASS or FAIL:

0. Snapshot `bym.save` for both accounts and arm the restore.
1. Log in as the attacker (`POST /api/v1/player/getinfo`); keep `token`, `userid`, home cell.
2. `POST /base/load` with `type=attack`, `baseid=<defender>`, `mapversion=2` and an `attackData`
   built from the attacker's housed roster with stats copied from `monsterStats.ts`; keep `attackid`,
   `basesaveid`, `buildingdata`, `buildinghealthdata`, `resources`, `combatseed`.
3. **Fling save**: `monsterupdate` moving 10 Pokeys out of the home cell, health map empty, zero
   deltas. Expect `error: 0`.
4. **Honest damage**: 6 s later, the first Cannon Tower at `hp - 500`, `damage` set to the hand
   sum. Expect `error: 0`; in `reject` mode expect the response's `damage` equal to the server's sum.
5. **Health rose**: the same tower at `maxHp + 1000`. Expect `healthRose` (`log`: warning line and
   `error: 0`; `reject`: `error` set, `errorDetails.status == 409`, then `/base/load` as the defender
   shows the tower at the step-4 value).
6. **Loot from nothing**: `attackloot.r1 = 1000000` with `resources.r1 = 0`. Expect `lootExceedsLoss`.
7. **Protection forge**: `protected = <now + 10 days>`. Expect `error: 0` in every mode and, on the
   defender's next load, `protected` unchanged from step 2.
8. **Champion forge**: `attackerchampion` with `l: 6` on a level-5 champion. Expect
   `attackerChampionMutated`; in `reject` mode the attacker's next `/base/load` shows level 5.
9. **Budget**: 3,000,000 of health removed across the towers with 10 Pokeys flung. Expect
   `damageBudget`.
10. **Final save**: `over = 1` with an honest snapshot. Expect `error: 0`, `attackid` cleared on the
    defender, protection granted or not per `damageProtection`.
11. Restore both rows.

The script takes the mode as its argument and asserts the matching expectation, so it runs once per
mode in a session.

---

## 5. Work packages

| # | Package | Contents | Depends on |
|---|---|---|---|
| WP0 | Combat stats table | `web/tools/lib/props.mjs` (the parser shared with `gen-building-costs.mjs`), `gen-combat-stats.mjs`, `combatStatsData.ts`, `stats.ts` with the transcribed constants, both integrity tests, `sync-combat-rules.mjs` and the two `sync.test.ts` files, `boundary.test.ts`, the `package.json` scripts. Small and mechanical; land first. | Nothing |
| WP1 | Bound model | `types.ts`, `damagePercent.ts`, `potential.ts`, `rng.ts` and their tests in the web tree; the server copy via sync. The Phase A rules of sections 2.2 to 2.4 as pure functions over `AttackContext`. | WP0 for `stats.ts`; can start against its signatures |
| WP2 | Server audit and rollout | `attackContext.ts`, `auditAttackSave.ts`, `recordVerdict.ts`, `CombatConfig.ts`, `combatSaveRejectedErr`, the `attackSaveKeys` trims, the `baseSave.ts` insertion and substitutions, the session `seed` field and `combatseed` in the load response, `example.env`, the startup banner, section 4.2's tests. | WP1 |
| WP3 | Docs and verification | Section 3.11's three documents, `verify-combat-save.sh`, a run in `log` and `reject` against the sandbox world with the output pasted into the PR. | WP2 |
| WP4 | Deterministic engine | `grid.ts`, `targeting.ts`, `engine.ts`, `replay.ts`, `digest`, the golden fixtures and `gen-combat-fixture.mjs`, `bench.test.ts`, the server-side `replay.test.ts`. This is the engine issue #22 consumes; it can be reviewed and merged on its own with no server behaviour change. | WP0; runs in parallel with WP1 to WP3 |
| WP5 | Phase B replay | `flinglog` on `BaseSaveSchema`, `replayRunner.ts` with the Worker and deadline, `COMBAT_REPLAY`, `replayMismatch` and `replayTimeout` in the verdict, the audit reading the replayed outcome in `authoritative` mode, a curl case with a hand-written fling log. **Gated on issue #32** sending the log; land with `replay=off` and flip to `log` when the client does. | WP2, WP4 |

WP0, WP1 and WP4 can run as three parallel subagents from the start: WP1 and WP4 code against
`stats.ts`'s exported signatures (`monsterStat`, `championStat`, `towerStats`, `maxHp`, `flyerMode`,
`gridCost`) before WP0 lands, and WP0 is a day's work. WP2 follows WP1; WP3 drafts the documents
alongside WP2 and runs the script once it lands. WP5 is written after WP4 and merged behind its flag.
A log review after a week in production, in the shape of the economy plan's WP4
(`economy-save-validation.md` §5), is a follow-up note under section 6 rather than a package.

---

## 6. Open questions and defaults

Each item states the default this plan takes; the owner can overturn any of them.

| # | Question | Default and reason |
|---|---|---|
| 1 | Is a bound that ignores towers, walls and travel time worth enforcing? | **Yes.** It is loose by construction — a full 300-Pokey fling can deal more than most yards hold in five minutes — but it is exact where it matters: health never rises, `damage` is a sum the server computes, loot cannot exceed loss or storage, nothing changes with nothing flung, and no roster or champion grows. Those are the writes a forged request makes today. A tighter bound needs positions, and positions need #32; a bound that guessed positions would refuse honest play, which is worse than a loose one. |
| 2 | Remove `protected`, `locked` and `buildingresources` from `attackSaveKeys` in every mode, or only in `reject`? | **Every mode, immediately.** The Flash client's whitelist does not contain `protected` or `locked` (`BASE.as:3109-3110`), so no honest save carries them and log mode's promise is kept; `buildingresources` on an attack save is the attacker's data on the defender's row, which is a bug rather than a rule. |
| 3 | `LOOT_GAIN_RATIO = 1.6`? | **Yes.** The attacker's gain over the defender's loss is the low-level bonus at most, `+57%` at level 1 (`ATTACK.as:678-680`); every other scalar shrinks the gain. WP3's log review revisits it. |
| 4 | The Vacuum's `lootBonus`? | **Double the `lootExceedsDamage` allowance when `A.siege` holds a Vacuum.** The value is a per-level property the spec did not trace (`weapons/Vacuum.as:172-174`); reading it is a WP4 task, after which the slack becomes the real multiplier. |
| 5 | The defender's bunker contents in `monsters`: which sub-field? | **Housing first (`housed`), bunkers when WP2 reads the shape.** `housedCounts` covers housing today (`transferRules.ts:171-185`); the bunker blob is opaque to the server (`docs/server-api.md:783`) and the Flash loader reads it through `MONSTERBUNKER`. Until then bunker counts are copied as sent and `defenderRosterGrew` covers housing only. |
| 6 | Reject with a real 409 or the Flash-friendly 200? | **200 with `error` set (`isClientFriendly: false`)**, for the reason the economy audit and the attack binding chose it (`economy-save-validation.md` §6, item 3). |
| 7 | Sanitise `attackreport` HTML? | **Not here; cap it at 64 KB.** The defender's Flash client renders it as `htmlText`, so sanitising changes what honest players see; the web client will render it as text. A separate issue. |
| 8 | A queue for Phase B replays? | **No, a Worker with a deadline and a single-flight lock.** One attack save every 6 s per attacker, a replay of under a second, and a 5 s deadline do not need a job table. Measure first; a Redis-backed queue is a bounded change to `replayRunner.ts` if the numbers say so. |
| 9 | Tick rate: keep 80 Hz or move to 60? | **80.** Every combat constant is written in 80 Hz ticks; converting them is a chance to be wrong in 40 places for nothing. A renderer interpolates. |
| 10 | Where the shared module's source lives: web or server? | **Web.** The stricter compiler, the Vitest suite, and the consumer that iterates on it first (#22) are all there. The server's copy is checked, never edited. |
| 11 | Mint `combatseed` now, before any client uses it? | **Yes.** It costs one field on the session string; it means the seed exists for every attack from the day WP2 lands, so WP5 needs no migration and a replay of a logged attack is possible retroactively. |
| 12 | The `validateAttack` count TODO (`validateAttack.ts:10-11`)? | **A one-line follow-up in WP2's PR, not a package.** The roster in range is what `attackContext` derives; checking the declared `count` against it at attack start is the same function called earlier. |
| 13 | `monsterupdate` clearing `protected` on the attacker's own cells (`updateMonsters.ts:31`)? | **Leave it.** Launching an attack already clears the attacker's protection by design (`combat.md:1281-1286`); the clear on source cells is the same rule applied to the yards the monsters came from. Recorded in the spec, not changed here. |
| 14 | Should the Baiter's report use the engine's per-tower damage counters? | **Yes, and the engine exposes them.** `battle.state()` carries per-tower damage dealt, shots fired and kills, because issue #22 asks for a per-tower report and the server's Phase B log line wants the same summary. |
