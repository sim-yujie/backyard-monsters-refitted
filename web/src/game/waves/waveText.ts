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

export const WAVE_LOST_LINE = "Your yard fell this time.";
export const WAVE_SURRENDERED_LINE = "You surrendered this wave.";
export const WAVE_ALL_BEATEN = "Every wave beaten!";

/** The lost pop-up's chip: true, as repairs start on their own and nothing is taken. */
export const WAVE_LOST_CHIP = "Repairs started · No loot lost";

/** A wave's army, as `WaveStatus.preview` lists it. */
export interface WaveArmyGroup {
  readonly monster: string;
  readonly count: number;
}

const CHAMPION_IDS = new Set(["G1", "G2", "G3"]);

/**
 * The lost pop-up's one-line counter tip, from the wave's own army (neon's
 * direction A): flyers first, then a champion, then a big swarm.
 */
export const waveTip = (army: readonly WaveArmyGroup[], flies: (monster: string) => boolean): string | null => {
  if (army.length === 0) return null;
  if (army.some((group) => flies(group.monster))) return "Flyers in this wave: add towers that hit the air.";
  if (army.some((group) => CHAMPION_IDS.has(group.monster))) return "A champion leads it: upgrade your strongest towers.";
  if (army.reduce((sum, group) => sum + group.count, 0) >= 40) return "A big swarm: splash towers and traps thin it out.";
  return "Tough monsters: upgrade towers or add walls.";
};

/** The army of the wave this device called last, for its lost pop-up's tip. */
let lastArmy: { run: string; wave: number; army: readonly WaveArmyGroup[] } | null = null;

export const rememberWaveArmy = (run: string, wave: number, army: readonly WaveArmyGroup[]): void => {
  lastArmy = { run, wave, army };
};

/** The remembered army of wave `wave` in run `run`, if this device called it. */
export const waveArmy = (run: string, wave: number): readonly WaveArmyGroup[] =>
  lastArmy && lastArmy.run === run && lastArmy.wave === wave ? lastArmy.army : [];
