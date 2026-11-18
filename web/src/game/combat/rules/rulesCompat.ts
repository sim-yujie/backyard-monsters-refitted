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
