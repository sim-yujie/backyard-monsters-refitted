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

const signed = (percent: number): string =>
  percent === 0 ? "0%" : `${percent < 0 ? "−" : "+"}${Math.abs(percent)}%`;

/** "Tower range +20%" */
export const towerBonusText = (bonus: HeightBonus): string => `Tower range ${signed(bonus.towerPct)}`;

/** "Income −17%" */
export const incomeBonusText = (bonus: HeightBonus): string => `Income ${signed(bonus.incomePct)}`;

/** One line for a chip or a dialog: "Hill: tower range +20%, income −17%". */
export const heightBonusLine = (height: number): string => {
  const bonus = heightBonus(height);
  const place = bonus.towerPct > 0 ? "High ground" : bonus.incomePct > 0 ? "Low ground" : "Level ground";
  return `${place}: ${towerBonusText(bonus).toLowerCase()}, ${incomeBonusText(bonus).toLowerCase()}`;
};
