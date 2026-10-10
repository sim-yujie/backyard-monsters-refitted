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

The rest of the list (Bolt blink, Bandito whirlwind, Fang venom, Brain invisibility, Teratorn
bounce) is later work packages. `CreepSnapshot.rank` (only when above 0) is already there for
their visuals.

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

## 5. Tests

- `web/src/game/combat/rules/specialMoves.test.ts`: the numbers per rank, rank reading, damage per
  move against the Flash formula, once-per-target Wormzer, bunker defenders at the defender's rank
  (and not the attacker's), web/server replay equality, rank 0 equals no ranks.
- Server: session roundtrip and sanitising of `attackerRanks`, checkpoint copy, `foughtAcademy`
  merging `powerup`, abandoned-attack replay at the attacker's ranks.
- Web: `servedRanks`, the session's ranks (served, none served, roster fallback), roster ranks from
  the own-yard load, Baiter at the player's ranks.
