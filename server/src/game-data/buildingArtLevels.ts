/**
 * The levels at which a building's yard art changes, for the types whose art
 * changes at all. Every other type has one picture for every level.
 *
 * A copy of the first number of each `levels` entry in the web client's
 * `BUILDING_ART_ROWS` (`web/src/game/yard/buildingArtData.ts`, generated from
 * `client/scripts/YARD_PROPS.as`); `buildingArtLevels.sync.test.ts` on the web
 * side fails when the two drift.
 *
 * Used to send someone else's yard with only the level its art needs, never
 * the building's real level (`services/base/viewMask.ts`).
 */
export const BUILDING_ART_LEVELS: Readonly<Record<number, readonly number[]>> = {
  1: [1, 3, 6, 10],
  2: [1, 3, 6, 10],
  3: [1, 3, 6, 10],
  4: [1, 3, 6, 10],
  5: [1, 2, 3, 4, 5],
  8: [1, 2, 3, 4],
  13: [1, 2, 3],
  14: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  17: [1, 2, 3, 4, 5],
  26: [1, 2, 3, 4],
  51: [1, 2, 3],
  121: [1, 2, 3, 4, 5, 6],
  127: [1, 2, 3, 4, 5],
  131: [1, 2, 3, 4, 5, 6],
};

/**
   * The tiers of the towers players see with the Modern look
   * (`MODERN_TOWERS` in `web/src/game/yard/buildingArtTiers.ts`): tiers 2 and 3
   * from levels 4 and 7, the Monster Bunker's and the six-level Magma Tower's
   * from 3 and 5, and one picture for every level of the Spurtz Cannons and the
   * Quake Tower (129, in the main yard and the Inferno alike). The
   * Inferno's Blast Tower and Sharpshooter (20 and 21 there, and 130) split as
   * the Cannon and Sniper do. The Flash towers, and the Classic look, have one
   * picture for every level. A viewer is sent only the tier's first level,
   * never the exact level. Always on: the old `TOWER_TIER_ART` env switch is
   * removed.
 */
export const TOWER_TIER_ART_LEVELS: Readonly<Record<number, readonly number[]>> = {
  20: [1, 4, 7],
  21: [1, 4, 7],
  22: [1, 3, 5],
  23: [1, 4, 7],
  25: [1, 4, 7],
  115: [1, 4, 7],
  118: [1, 4, 7],
  129: [1],
  130: [1, 4, 7],
  132: [1, 3, 5],
  136: [1],
  137: [1],
};

/**
 * The Inferno's own 3D buildings whose tiers split where the main yard's art
 * does not (`INFERNO_BUILDING_3D_ART` in `web/src/game/yard/buildingArtTiers.ts`):
 * the Bone Cruncher's tiers from levels 3 and 7, where the main yard's Twig
 * Snapper (the same type) changes at 3, 6 and 10. They take in the Inferno's
 * Flash steps (1 and 3), so the Classic look draws right from them too.
 */
export const INFERNO_ART_LEVELS: Readonly<Record<number, readonly number[]>> = {
  1: [1, 3, 7],
};

/**
 * The level whose picture a building at `level` shows: the highest art level
 * at or below it, and 1 for a type with one picture. A level of 0 or less (a
 * foundation still being built) is kept as it is; it says nothing.
 * `towerTiers` adds the tower tiers (`TOWER_TIER_ART_LEVELS`) and, in an
 * Inferno yard (`kind`), the Inferno's own 3D tiers (`INFERNO_ART_LEVELS`), on
 * unless a caller asks for the Flash steps alone.
 */
export const artLevelOf = (
  type: number,
  level: number,
  towerTiers: boolean = true,
  kind: string = "main"
): number => {
  if (!(level > 0)) return level;
  let chosen = 1;
  const inferno = towerTiers && kind === "inferno" ? INFERNO_ART_LEVELS[type] : undefined;
  const steps = inferno ?? (towerTiers ? TOWER_TIER_ART_LEVELS[type] : undefined) ?? BUILDING_ART_LEVELS[type] ?? [];
  for (const step of steps) {
    if (step > level) break;
    chosen = step;
  }
  return chosen;
};
