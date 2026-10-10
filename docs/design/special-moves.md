# Monster special moves (Monster Lab ranks) — Design

Issue #352. Owner decisions confirmed 2026-10-10 (`agent-handoffs/special-moves-decisions.md`);
Flash facts in `agent-handoffs/reports/facts-special-moves.md`. Numbers follow the Lab screen's
own text where Flash code and screen disagree. Rank 0 is always the plain monster.

## 1. Where a rank enters a battle

| Fighter | Rank comes from |
|---|---|
| Attacker's monsters (players, bots, outposts; MR1 and MR2) | The attacker's Lab (`academy[id].powerup`), frozen into the attack session with the academy levels |
| Bunker / yard defender monsters | The defender's Lab (`defenderRanks`, next to `defenderLevels`) |
| Wild-monster raids and Trojan raiders | None (rank 0) |
| Baiter (practice simulator) | The player's own Lab ranks, whatever level a row is set to |

Plumbing: `BattleOptions.ranks` / `defenderRanks` (shared rules) -> `ReplayInput.ranks` /
`defenderRanks`. The server freezes `attackerRanks` in the attack session (and its checkpoint copy),
serves it as `attackerranks` on the attack load, and every replay (attack save, abandoned attack,
auto-attack landing, finaliser) reads the ranks from the same academy, so web and server fight the
same battle. A load that froze the academy but sent no ranks means "none researched". A defence
only carries `defenderRanks` when it has researched something, so rank-0 digests are unchanged.

## 2. WP1: the moves in the engine

| Monster | Move | Numbers (rank 1 / 2 / 3) |
|---|---|---|
| C4 Fink | Each hit also splashes other targets (buildings and ground enemy creeps) within 60 px; initial target excluded | extra targets 1 / 2 / 3, full damage |
| C13 Wormzer | Each swing splashes buildings and ground enemies within 100 px, linear falloff, target included; skipped if the same target as the last splash | damage x1 / x2 / x3 |
| C11 Project X | On death a blast of 60 px (buildings and ground enemies), linear falloff | damage x1 / x2 / x3 |
| C5 Eye-ra | Airburst damage bonus; blast radii stretched by the same percentage | 120 / 130 / 140 % of the swing; building radius 72 / 78 / 84, creep radius 108 / 117 / 126 |
| C12 D.A.V.E. | Rocket range (may target flyers) | 140 / 180 / 220 px; no range at rank 0 |

The numbers live in one file, `specialMoves.ts` (shared rules, synced to the server). The engine
hooks are `onAttack` (Fink, Wormzer; after a building swing, a creep swing and `fight()`),
`projectXBlast` (in `onDeath`) and the airburst in `explodeCreep`. A defender's monsters never
splash buildings (Flash `AOEDamage`). D.A.V.E.'s two half-damage rockets are visual only (WP3);
the total damage is already counted that way.

`CreepSnapshot.rank` (only when above 0) is there for the visuals.

## 2b. WP2: five more moves

| Monster | Move | Numbers (rank 1 / 2 / 3) |
|---|---|---|
| C3 Bolt | Blink: with fewer than rank*5 waypoints of route left and the route's end within rank*150 screen px, it goes untargetable and hops a tenth of the way ten times, then counts as arrived | range 150 / 300 / 450 px; route test 5 / 10 / 15 waypoints |
| C9 Brain | Cloak: from the moment it has a target and is walking, it carries `TARGETS_INVISIBLE`; after arriving it stays cloaked for the delay, then shows until it walks again | 0 / 4 / 8 s after arriving |
| C7 Bandito | Whirlwind: each swing splashes everything within 60 (target left out, no cap, full damage); the swing comes faster | attack speed 1x / 1.5x / 2x |
| C8 Fang | Venom: a bite on a creep leaves ONE venom on it and each bite adds a stack; every half second (40 loops) it hurts for stacks x Fang damage x share; never wears off, ends with the creep's death; buildings take none | share 0.1 / 0.2 / 0.3 |
| C14 Teratorn | Fireball bounce: after it lands on a building it jumps to the nearest other building within 100 screen px, `rank` times, half the last damage each time | 1 / 2 / 3 jumps |

How it is wired:
- Brain: the creep's `flags` gain `TARGETS_INVISIBLE` while cloaked. Towers, the Spurtz Cannon and
  every splash ask for the flags they can reach, so a cloaked Brain is skipped by all of them; the
  trap, Fomor's aura and Korath's quake already ask for the invisible and still see it. Bunker
  monsters and the caged champion also drop a foe that has gone unseen.
- Bolt: `targetable` is false for the ten hops, which the creep index already honours.
- Fang: `venomStacks`, `venomDps`, `venomTick` and `venomBy` on the poisoned creep. The bite runs
  at the start of the creep's tick, beside Korath's flame, through the creep's armour.
- Bandito: `onAttack` (the same hook as Fink and Wormzer); the speed is in `swingDelay`.
- Teratorn: `onAttack` on a building hit; the jumps follow Flash's `FindGlaiveTarget`.

For the visuals (WP3), `CreepSnapshot` gains `invisible`, `blinking` and `poisonStacks` (each
present only when set), and `recentEvents` gains `splash` (Fink, Wormzer, Bandito swings and
Project X's death blast: striker point, radius, how many it reached), `blink` (each hop) and
`bounce` (building ids and yard points, damage taken off). None of these enters the checkpoint.

## 3. Determinism

Shared rules, so the same code runs on web and server. Only seeded RNG, `+ - * /` and `Math.sqrt`.
Splash targets are sorted by distance, then creeps before buildings, then by id, so the order never
depends on iteration order. Rank-0 golden digests and replay fixtures are unchanged.

## 4. Choices made by builder

Choice made by builder:
- The splash origin is the striker's own point; buildings are measured by `cx`/`cy`.
- A splash skips decoration, immovable, enemy, trap and untargetable building types.
- Fink's splash damage is the hit's damage (the swing times the specialist multiplier on buildings).
- Eye-ra's airburst lands on the swing tick (no 0.4 s jump) and hits every defender creep within the
  stretched creep radius, flyers included, plus buildings (not decoration, enemy, trap). Flash's
  broken creep loop in the airburst was replaced by a real distance test.
- Eye-ra at rank 0 keeps the old engine blast exactly (it still does not hit creeps).
- Bunker defenders with no `defenderRanks` are rank 0; there is no fallback to the attacker's ranks.
- Zombies keep the rank of the side that raised them; raiders, minis and Spurtz are rank 0.
- Bots have no ranks, so revenge replays of bot attacks stay rank 0.
- Housing, transfer and revenge-planning code reads levels only, so it carries no ranks.

WP2:
- The Fang's venom bites every 80 ticks, which is the owner's "1 s". Flash's own interval is 40
  loops (`CStatusEffect._MAX_TICKS`), which at the 80 loops a second the game really runs is half a
  second, the same 40 Korath's flame uses here. The owner's figure was followed; it is one constant,
  `VENOM_INTERVAL_SECONDS`.
- Venom strength is the first Fang's damage times its rank's share and later bites only add stacks
  (Flash's `DOTEffect` keeps `_initialDPS`). Damage comes off the creep as from no one, but kills are
  credited to the Fang for the report.
- Bandito's whirlwind also reaches enemy buildings when it is an attacker, as Flash's
  `AOEDamageOnAttack` base does (the decisions file says "ground enemies"). It is the attacker's
  swing, not a Fink's: no cap.
- Bandito's speed is `attackDelay / (rank-based multiplier)`, truncated, combined with enrage and putty.
- Brain's cloak delay counts real seconds (80 ticks each). With a delay of 0 it shows itself the tick
  after it arrives, as Flash does. Flash's aggro range of 1 while cloaked is not modelled.
- Brain and Bolt only matter between an attacker and the defence. A defending (bunker) Brain also
  cloaks, which keeps attackers from engaging it; a defending Bolt never blinks (no route to blink on).
- Bolt does not walk during its blink (Flash also lets `move()` run); it hops from the tick after it
  starts. Its blink also needs the creep not to be at its target. If the target is lost mid-blink the
  blink ends without counting as arrived. Distances are screen px, as the route's waypoints are.
- Teratorn's bounce reads building points as the screen anchor plus half the footprint height, and
  keeps Flash's rule of skipping the building before only when another stands. Flash falls back to
  walls when nothing else is near; the owner's decision (no walls) is followed. Jumps loot as a
  `DummyTarget` (1). Only fireballs at buildings bounce, not those at creeps.

## 5. Tests

- `web/src/game/combat/rules/specialMoves.test.ts`: the numbers per rank, rank reading, damage per
  move against the Flash formula, once-per-target Wormzer, bunker defenders at the defender's rank
  (and not the attacker's), web/server replay equality, rank 0 equals no ranks.
- Server: session roundtrip and sanitising of `attackerRanks`, checkpoint copy, `foughtAcademy`
  merging `powerup`, abandoned-attack replay at the attacker's ranks.
- `web/src/game/combat/rules/specialMovesLab.test.ts` (WP2): the numbers per rank; Bandito's
  splash at every rank, no cap, and its swing gaps; Fang's stacks, bite size and one-second spacing,
  never wearing off, ending with the creep's death, no venom on buildings; Brain's cloak timeline per
  rank, towers, a trap and a bunker monster (with a rank-0 baseline); Bolt's ten hops, untargetable,
  arriving sooner; Teratorn's jumps, halving, no walls, nothing in reach; web/server replay equality.
- Web: `servedRanks`, the session's ranks (served, none served, roster fallback), roster ranks from
  the own-yard load, Baiter at the player's ranks.
