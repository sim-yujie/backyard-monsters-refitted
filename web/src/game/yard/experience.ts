/**
 * The empire points a player needs for each level, from level 1 up: the
 * original's table (`BASE.as`), as the server holds it in
 * `server/src/game-data/stats/experiencePoints.ts`. The yard HUD's XP bar
 * reads the points to the next level from it.
 */
export const EXPERIENCE_POINTS: readonly number[] = [
  0,
  900,
  3500,
  5000,
  7500,
  10500,
  14700,
  20580,
  28812,
  40337,
  56472,
  79060,
  110684,
  154958,
  216941,
  303717,
  425204,
  595286,
  833401,
  1166761,
  1633465,
  2286851,
  3201591,
  4482228,
  6275119,
  8785167,
  12299234,
  17218927,
  24106498,
  33749097,
  47248736,
  66148230,
  92607522,
  129650530,
  181510743,
  254115040,
  355761056,
  498065478,
  697291669,
  976208337,
  1366691671,
  1913368339,
  2678715675,
  3750201945,
  5250282723,
  7350395812,
  10290554137,
  14406775792,
  20169486109,
  28237280553,
  39532192774,
  55345069884,
  77483097838,
  108476336973,
  151866871762,
  212613620467
];

/** Where a player stands inside their level. */
export interface LevelProgress {
  readonly level: number;
  /** Points held, and the points the level started at and the next one needs. */
  readonly points: number;
  readonly floor: number;
  /** Null at the top level. */
  readonly next: number | null;
  /** 0 to 1 across the level; 1 at the top. */
  readonly fraction: number;
}

/** The progress inside `level` for `points` empire points. */
export const levelProgress = (level: number, points: number): LevelProgress => {
  const index = Math.min(Math.max(level, 1), EXPERIENCE_POINTS.length) - 1;
  const floor = EXPERIENCE_POINTS[index]!;
  const next = EXPERIENCE_POINTS[index + 1] ?? null;
  const fraction = next === null ? 1 : Math.min(1, Math.max(0, (points - floor) / (next - floor)));
  return { level, points, floor, next, fraction };
};
