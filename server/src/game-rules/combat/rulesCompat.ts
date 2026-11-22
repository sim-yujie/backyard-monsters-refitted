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
 * Add the version a change replaces only when that change moves no battle.
 * A change that moves any battle result must empty this list.
 */
export const COMPATIBLE_RULES_VERSIONS: readonly string[] = [
  "3cb9cc66416d5eda",
  "0ba3fde8701104af",
];

/**
 * Whether a battle stamped with the rules version `stamp` plays to its stored
 * result on the rules version `ours`: the same version, or one listed in
 * {@link COMPATIBLE_RULES_VERSIONS}.
 */
export const rulesPlay = (stamp: string, ours: string): boolean =>
  stamp === ours || COMPATIBLE_RULES_VERSIONS.includes(stamp);
