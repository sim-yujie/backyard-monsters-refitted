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
 * The tiers of the repainted defensive towers (`web/src/game/yard/buildingArtTiers.ts`):
 * tiers 2 and 3 from levels 4 and 7, the five-level Monster Bunker's from 3
 * and 5. The Flash towers have one picture for every level.
 *
 * Sent only while `TOWER_TIER_ART=on`. The new tower art is off in the live
 * game until the owner decides, so by default every tower still reads 1, as
 * before, and gives nothing more away; a browser with the new art on then
 * shows someone else's towers as tier 1.
 */
export const TOWER_TIER_ART_LEVELS: Readonly<Record<number, readonly number[]>> = {
  20: [1, 4, 7],
  21: [1, 4, 7],
  22: [1, 3, 5],
  23: [1, 4, 7],
  25: [1, 4, 7],
  115: [1, 4, 7],
  118: [1, 4, 7],
};

/** Whether viewers are sent the tier of someone else's towers: `TOWER_TIER_ART=on`. Read on each call, for tests. */
export const towerTierArtOn = (env: Record<string, string | undefined> = process.env): boolean =>
  env.TOWER_TIER_ART === "on";

/**
 * The level whose picture a building at `level` shows: the highest art level
 * at or below it, and 1 for a type with one picture. A level of 0 or less (a
 * foundation still being built) is kept as it is; it says nothing.
 * `towerTiers` adds the tower tiers (`TOWER_TIER_ART_LEVELS`).
 */
export const artLevelOf = (type: number, level: number, towerTiers: boolean = towerTierArtOn()): number => {
  if (!(level > 0)) return level;
  let chosen = 1;
  const steps = (towerTiers ? TOWER_TIER_ART_LEVELS[type] : undefined) ?? BUILDING_ART_LEVELS[type] ?? [];
  for (const step of steps) {
    if (step > level) break;
    chosen = step;
  }
  return chosen;
};
