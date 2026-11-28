import type { WavePrize } from "./waveTypes.js";

/**
 * ═══════════════════════════════════════════════════════════════════════
 * WAVE EVENT PRIZES: the one place to change them.
 *
 * Owner, 27 Nov 2026: every wave beaten pays Glimmers (event coins, the
 * Decorations tab's currency), more at the totem waves; the totem itself
 * comes at wave 1 and goes up at waves 10, 20 and 30, gold at bonus wave 1
 * and Black Diamond at bonus wave 2 (Flash's `isMajorWave`,
 * `BTOTEM.EarnedTotemLevel`).
 *
 * PLACEHOLDER Glimmer numbers, waiting for the owner's approval:
 *   ordinary wave 5, totem wave (1, 10, 20, 30) 20, bonus wave 1 40, bonus
 *   wave 2 60: 26 x 5 + 4 x 20 + 40 + 60 = 310 for all 32 waves of one
 *   event (a 14-day big event pays 400, `eventRewards.ts`).
 * ═══════════════════════════════════════════════════════════════════════
 */
export const WAVE_GLIMMERS = {
  ordinary: 5,
  totemWave: 20,
  bonus1: 40,
  bonus2: 60,
} as const;

/** The totem's level after each totem wave (1-based wave number), Flash's `EarnedTotemLevel`. */
export const TOTEM_LEVEL_AFTER_WAVE: Readonly<Record<number, number>> = { 1: 1, 10: 2, 20: 3, 30: 4, 31: 5, 32: 6 };

/** The totem's level for a player who has beaten `beaten` waves (0: none yet). */
export const totemLevelFor = (beaten: number): number => {
  let level = 0;
  for (const [wave, at] of Object.entries(TOTEM_LEVEL_AFTER_WAVE)) if (beaten >= Number(wave)) level = Math.max(level, at);
  return level;
};

/** Flash's 32-wave prize list: Glimmers on every wave, the totem on the totem waves. */
export const flashWavePrizes = (): WavePrize[] =>
  Array.from({ length: 32 }, (_, index) => {
    const wave = index + 1;
    const totemLevel = TOTEM_LEVEL_AFTER_WAVE[wave];
    const glimmers =
      wave === 31 ? WAVE_GLIMMERS.bonus1 : wave === 32 ? WAVE_GLIMMERS.bonus2 : totemLevel ? WAVE_GLIMMERS.totemWave : WAVE_GLIMMERS.ordinary;
    return totemLevel ? { glimmers, totemLevel } : { glimmers };
  });
