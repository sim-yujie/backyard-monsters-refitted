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
