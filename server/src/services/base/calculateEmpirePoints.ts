/**
 * Empire points are the sum of a base's accumulated points and its base value.
 *
 * @param {string} basePoints - The base points.
 * @param {string} baseValue - The base value.
 * @returns {number} The combined empire points.
 */
export const calculateEmpirePoints = (basePoints: string, baseValue: string): number => {
  return Number(basePoints) + Number(baseValue);
};

/**
 * Empire points as `save.empirepoints` stores them: whole, and 0 for a part
 * that is missing or not a number, so one unreadable string never puts a
 * yard at the top or bottom of the leaderboard by itself.
 *
 * @param basePoints - The save's `points`.
 * @param baseValue - The save's `basevalue`.
 * @returns The whole, non-negative sum.
 */
export const empirePointsColumnValue = (basePoints: unknown, baseValue: unknown): number => {
  const part = (raw: unknown): number => {
    const value = Number(raw ?? 0);
    return Number.isFinite(value) && value > 0 ? value : 0;
  };
  return Math.floor(part(basePoints) + part(baseValue));
};
