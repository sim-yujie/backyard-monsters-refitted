/**
 * Repeat attack's putty fee (owner, 20 Nov 2026): "quite heavy penalty for
 * putty (not loot based). Players should not be able to profit on putty for
 * repeat attacks and should suffer a loss as it is automated. Take it as a
 * convenience fee."
 *
 * - Charged by the camp's level, in the bands below (the owner's table, r3).
 * - Burned before the attack starts, in the same write that starts it
 *   (`baseModeAttack`'s commit), so the player needs it in advance. A refused
 *   Repeat attack spends nothing; once it has started the fee is gone, won or
 *   lost.
 * - The pool has to cover the fee and the Catapult's putty shots together.
 * - Hand-played attacks stay free. Twigs, pebbles and goo still come in as loot.
 *
 * Not a promise that a Repeat attack always loses putty (owner, 20 Nov 2026):
 * a full destroy of a fresh camp can bank more putty than its fee (the
 * per-camp numbers are in `docs/design/auto-attack.md` §5.2). It is a
 * convenience fee that weighs most on the easy low-level camps, and players
 * still need their putty for outpost kits.
 */

/** One band of camp levels and its fee in putty. */
export interface RepeatFeeBand {
  readonly from: number;
  readonly to: number;
  readonly putty: number;
}

/** The owner's table (20 Nov 2026, second version), lowest band first. */
export const REPEAT_FEE_BANDS: readonly RepeatFeeBand[] = [
  { from: 25, to: 29, putty: 2_000_000 },
  { from: 30, to: 34, putty: 2_500_000 },
  { from: 35, to: 39, putty: 3_000_000 },
  { from: 40, to: 44, putty: 3_500_000 },
];

/**
 * The putty a Repeat attack on a camp of `level` costs, or null for a level
 * no band covers (never a real Map Room 2 camp's): such a camp is refused,
 * never repeated for free.
 */
export const repeatFeeFor = (level: number): number | null =>
  REPEAT_FEE_BANDS.find((band) => level >= band.from && level <= band.to)?.putty ?? null;
