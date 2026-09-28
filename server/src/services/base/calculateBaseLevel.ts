import { experiencePoints } from "../../game-data/stats/experiencePoints.js";
import { calculateEmpirePoints } from "./calculateEmpirePoints.js";

/**
 * Calculates the base level based on the given base points and base value.
 *
 * @param {string} basePoints - The base points.
 * @param {string} baseValue - The base value.
 * @returns {number} The calculated base level.
 */
export const calculateBaseLevel = (basePoints: string, baseValue: string) => {
  const points = calculateEmpirePoints(basePoints, baseValue);
  let baseLevel = 1;

  for (let i = 0; i < experiencePoints.length; i++) {
    if (points >= experiencePoints[i]) baseLevel = i + 1;
    else break;
  }
  return baseLevel;
};

/**
 * A player's level from their main save, which is the level `ATTACK.Loot`'s
 * low-level bonus reads (`LOGIN._playerLevel`, set from `BASE.BaseLevel()` in
 * build mode, `client/scripts/BASE.as:4867-4931`).
 *
 * @param save - The player's main save.
 * @returns The player's level, 1 or more.
 */
export const playerLevelOf = (save: { points?: string | null; basevalue?: string | null }): number =>
  calculateBaseLevel(save.points ?? "0", save.basevalue ?? "0");
