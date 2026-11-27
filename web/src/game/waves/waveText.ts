import { waveName } from "@/api/waves";

/**
 * The wave events' words (beta 10, Wild Monster Invasion). Short, as the
 * owner asks of in-game text: the pictures and numbers carry the rest.
 */

/** The raid strip's line for the whole fight, short enough for a phone's one row: "Wave 7/30", "Bonus wave 1". */
export const waveStripLine = (wave: number, firstBonusWave: number): string =>
  wave >= firstBonusWave ? waveName(wave, firstBonusWave) : `Wave ${wave}/${firstBonusWave - 1}`;

/** The HUD's counter: "7/30", or "Bonus 1" on the bonus waves. */
export const waveCounter = (wave: number, firstBonusWave: number): string =>
  wave >= firstBonusWave ? `Bonus ${wave - firstBonusWave + 1}` : `${wave}/${firstBonusWave - 1}`;

/** The totem's names by level (Flash's `BTOTEM`: gold at bonus 1, Black Diamond at bonus 2). */
export const totemName = (level: number): string =>
  level >= 6 ? "Black Diamond Totem" : level === 5 ? "Gold Totem" : `Victory Totem level ${Math.max(1, level)}`;

export const WAVE_LOST_LINE = "Your yard fell. It is repairing; try the wave again when ready.";
export const WAVE_SURRENDERED_LINE = "You surrendered. Your yard is repairing; try again when ready.";
export const WAVE_ALL_BEATEN = "Every wave beaten!";
