import { ALTITUDE_FLOOR, AVERAGE_ALTITUDE } from "@/game/combat/rules";

/**
 * What a cell's height does to an outpost standing on it (Flash's
 * `PopupInfoEnemy` / `PopupInfoMine` "newmap_h1" and "newmap_h2" lines). Both
 * numbers are the live rules, not decoration:
 *
 * - Tower range is `height / 125` of its table range from height 100 up
 *   (`towerRange`), so a hill reaches farther.
 * - Income is `125 / height` of the table rate (`autobank.ts` `outpostRate`,
 *   a cell with no height reads as 100), so low ground pays more.
 */
export interface HeightBonus {
  /** Metres shown to the player: the height above the 100 base. */
  readonly metres: number;
  /** Tower range change, whole percent. */
  readonly towerPct: number;
  /** Resource income change, whole percent. */
  readonly incomePct: number;
}

export const heightBonus = (height: number): HeightBonus => {
  const cell = Math.trunc(height);
  const incomeCell = cell > 0 ? cell : ALTITUDE_FLOOR;
  return {
    metres: cell - ALTITUDE_FLOOR,
    towerPct: cell >= ALTITUDE_FLOOR ? Math.round((cell * 100) / AVERAGE_ALTITUDE - 100) : 0,
    incomePct: Math.round((AVERAGE_ALTITUDE * 100) / incomeCell - 100),
  };
};
