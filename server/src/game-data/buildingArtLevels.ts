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
 * The level whose picture a building at `level` shows: the highest art level
 * at or below it, and 1 for a type with one picture. A level of 0 or less (a
 * foundation still being built) is kept as it is; it says nothing.
 */
export const artLevelOf = (type: number, level: number): number => {
  if (!(level > 0)) return level;
  let chosen = 1;
  for (const step of BUILDING_ART_LEVELS[type] ?? []) {
    if (step > level) break;
    chosen = step;
  }
  return chosen;
};
