/**
 * Older combat rules versions (`MANIFEST.json` `version`) whose battles these
 * rules still play to the same result, so a defence replay stamped with one
 * stays watchable after an update (patch 7.8, 17 Nov 2026). The web viewer
 * (`defenceWatch.ts`) and the server's Defences list (`defences.ts`) both
 * read it.
 *
 * Empty since patch 7.9 (18 Nov 2026): a wall now blocks the pathing grid on
 * its stored X/Y rather than up to a cell off it (`yard.ts`, `buildEngineYard`),
 * which moves battles against walls off Flash's 10-unit lattice (many player
 * yards and most tribe yards have some), and a champion or ranged creep now
 * reaches a building `range` yard units from its nearest tile instead of
 * screen pixels from its top corner (`reachSquared`), which moves nearly every
 * battle with one. No replay stamped with an older version (7.7.2's
 * b4f0c156a8d2afee, 7.8's b03bd4b8bac1386d) plays the same any more.
 * Patch 7.10 (19 Nov 2026) keeps it empty: Gorgo, melee, now hits a building
 * only from one cell off its nearest tile (`MELEE_REACH_CHAMPIONS`), which
 * moves every battle he attacks in, so 7.9's fa6de785db1c4615 replays with
 * Gorgo no longer play the same.
 * Habits learned by the owner's pick B (19 Nov 2026, `habits.ts`) change only
 * how the server learns between attacks; the engine reads a log's `h` as
 * before, so 7.10/7.11's 3cb9cc66416d5eda still plays the same.
 * Beta 9's drop-zone test (`dropZone.ts`, the overlap rule moved out of the
 * web's tap-to-drop so the server can check a Repeat attack's plan) is read
 * by no battle, so 8.x's 0ba3fde8701104af still plays the same.
 *
 * Emptied again in beta 9 (Infernal Monster Lab, owner 21 Nov 2026): without
 * a Lab rank Balthazar strikes monsters 1x (an attacking one hunted at 3x) and
 * King Wormzer splashes nothing (x4 within 100 before), which moves every
 * battle either fights in; 8.x's 0ba3fde8701104af, 7.10/7.11's
 * 3cb9cc66416d5eda and the drop-zone version b1991244e863f4d8 replays with
 * them no longer play the same. The owner (desk, 23 Nov 2026) chose to drop
 * them: replays from before beta 9 stop playing.
 *
 * Patch 8.3 (23 Nov 2026) keeps it empty: every building, not only a wall,
 * now sits on the grid at its stored X/Y (bug #61), which moves a building
 * off Flash's 10-unit lattice by a cell, and with it its routes, tower range
 * and traps. No replay stamped with an earlier version plays the same.
 *
 * Patch 8.3 (23 Nov 2026) empties it again: every building, not only a wall,
 * now sits on the grid at its stored X/Y (bug #61), which moves a building
 * off Flash's 10-unit lattice by a cell, and with it its routes, tower range
 * and traps. No replay stamped with 3cb9cc66416d5eda or 8.1/8.2's
 * 0ba3fde8701104af plays the same any more.
 *
 * The ranged reach of the owner's pick C (24 Nov 2026) keeps it empty: a
 * ranged monster or Fomor now reaches a building from its range times 1/√2
 * (`RANGED_BUILDING_REACH_SCALE`), which moves every battle with one, so no
 * replay stamped with beta 9's 0f7f60198e612d6b plays the same any more.
 *
 * Beta 9's reach audit (owner's pick A, Desk 8, 25 Nov 2026; towers left
 * as they are, pick B, 25 Nov) keeps it empty: a splash measures buildings in
 * screen pixels to their drawn top corner, and an Eye-ra's blast hits the
 * defender it fights within 30 px, not 50 (`reach.ts`). That moves every
 * battle with a splash on buildings or an Eye-ra fighting, so no replay
 * stamped with fed8c884206301e4 plays the same any more.
 *
 * The Krallen fix (owner, 24 Nov 2026) keeps it empty: she now hits a
 * harvester she has drained until it falls, as Flash's `setWaypoints` kept
 * her on it (`engine.ts`, `swing`), so every battle in which she drains a
 * harvester before it falls plays differently, and 8.3/8.4's
 * c8cfcc231fcacd03 (on beta 9, 286adaed33a75b03) replays with a Krallen no
 * longer play the same.
 *
 * Patch 8.5 (main, merged back 25 Nov 2026) brings only the Krallen fix and
 * the ranged reach above, but beta 9's other changes move its battles, so
 * 8.5's 2b60802884bcf7e6 is not listed.
 *
 * Patch 8.7 keeps it empty, though it moves no stored battle: Krallen has
 * no Mode (owner, 25 Nov 2026, `hasMode`), so a new attack's log flings her
 * in none and with no learned brain, while the engine still fights a log that
 * has them as before. A replay stamped with beta 9's 54111bf01375377f would
 * still play the same, but this list also lets a page on those rules start an
 * attack (`rulesStamp.ts`), and such a page still flings Krallen in the Mode
 * its picker offers: it must reload instead.
 *
 * Patch 8.6 keeps it empty and moves battles with an attacking Krallen
 * (owner, 25 Nov 2026, `BattleOptions.flashKrallen`): she keeps her route
 * on her walking look unless the new one is shorter, as Flash's
 * `setWaypoints`, and turns only on a defender that reaches or hits her or
 * hits beside her, not on one that is merely in her reach. Every other
 * champion fights as before. The server replays an attack whose session was
 * minted under older rules with both off, so it lands as it was fought.
 * Under the same gate she also goes for a harvester that was empty when the
 * yard loaded until a hit finds it empty (`EngineBuilding.emptyUnhit`), as
 * Flash's `_looted` does; every other creep still reads it as looted.
 *
 * Patch 8.6 (main, merged back 25 Nov 2026) brings only the two Krallen
 * changes above, but beta 9's other changes move its battles, so 8.6's
 * cf287596a22ae2e0 is not listed.
 *
 * Patch 8.7's whole-health fix keeps it empty and moves battles (player
 * report, Reii, 25 Nov 2026; owner's pick A+, `BattleOptions.wholeHealth`):
 * the health of a monster, a champion (in its cage too) and a building stays
 * whole, as Flash's `SecNum` keeps it, so a Quake Tower's quake bigger than a
 * monster's health kills it instead of leaving it under 1, and a building
 * left on 0.4 falls while one on 0.5 stands on 1. No replay stamped with
 * beta 9's 22d6196bc811ac42 plays the same any more. The server replays an
 * attack whose session was minted under older rules with it off.
 *
 * Patch 8.7 (main, merged back 26 Nov 2026) brings only whole health, the
 * HCC's upgrading-hatchery fix and ranged shots drawn to a building's middle,
 * but beta 9's other changes move its battles, so 8.7's 92ea2dbbfe06531c is
 * not listed.
 *
 * Beta 10's monster rebalance keeps it empty (owner, desk b10-numbers,
 * 27 Nov 2026): Crabatron, Wormzer, Project X and Fang health, Wormzer's
 * housing, Zafreeti's speed, Ichi's Thorns (7/10/13%) and the main yard's
 * slower Spurtz Cannon reload (2x between bursts, desk spurtz6 pick B, 28 Nov
 * 2026, which replaced beta 10's first pick, at most 2 hatched Spurtz a
 * cannon, before it went live) move battles, so no replay stamped with
 * beta 9's 15bf255b01aafabc plays the same any more; the Defences list says
 * "Recorded before beta 10" instead (`defenceWatch.ts`). Beta 10's wave
 * events (Wild Monster Invasion) add `level`, `rank` and `rage` to a raid
 * wave (`RaidEvent`); a wave without them spawns as before.
 *
 * Add the version a change replaces only when that change moves no battle.
 * A change that moves any battle result must empty this list.
 */
export const COMPATIBLE_RULES_VERSIONS: readonly string[] = [];

/**
 * Whether a battle stamped with the rules version `stamp` plays to its stored
 * result on the rules version `ours`: the same version, or one listed in
 * {@link COMPATIBLE_RULES_VERSIONS}.
 */
export const rulesPlay = (stamp: string, ours: string): boolean =>
  stamp === ours || COMPATIBLE_RULES_VERSIONS.includes(stamp);
