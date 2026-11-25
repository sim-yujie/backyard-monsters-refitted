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
 *
 * Patch 8.3 (23 Nov 2026) empties it again: every building, not only a wall,
 * now sits on the grid at its stored X/Y (bug #61), which moves a building
 * off Flash's 10-unit lattice by a cell, and with it its routes, tower range
 * and traps. No replay stamped with 3cb9cc66416d5eda or 8.1/8.2's
 * 0ba3fde8701104af plays the same any more.
 *
 * Patch 8.5 keeps it empty with two changes that move battles (owner,
 * 24 Nov 2026). Krallen now hits a harvester she has drained until it
 * falls, as Flash's `setWaypoints` kept her on it (`engine.ts`, `swing`).
 * And the ranged reach of the owner's pick C: a ranged monster or Fomor
 * now reaches a building from its range times 1/√2
 * (`RANGED_BUILDING_REACH_SCALE`). No replay stamped with 8.3/8.4's
 * c8cfcc231fcacd03 plays the same any more.
 *
 * Patch 8.7 keeps it empty, though it moves no stored battle: Krallen has
 * no Mode (owner, 25 Nov 2026, `hasMode`), so a new attack's log flings her
 * in none and with no learned brain, while the engine still fights a log that
 * has them as before. A replay stamped with 8.5's 2b60802884bcf7e6 would
 * still play the same, but this list also lets a page on those rules start an
 * attack (`rulesStamp.ts`), and such a page still flings Krallen in the Mode
 * its picker offers: it must reload instead.
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
