/**
 * The two number spellings every panel shares.
 *
 * Both used to live in whichever file first needed them — the amount in
 * `Hud.ts`, the countdown in `BuildingPanel.ts` — which was fine while one
 * surface showed each. The planner's bottom bar now shows a cost beside the
 * HUD's holdings and a build time beside a building's countdown, and two
 * spellings of the same number on one screen read as two different numbers.
 *
 * Neither touches the DOM: they take a number and return a string, so they are
 * as testable as the rest of the yard's arithmetic.
 */

/**
 * A resource amount, short enough for a readout that never wraps.
 *
 * Under a thousand is exact; past that it is one decimal of K or M and two of
 * B, which is what the original's HUD does and what keeps 280,000,000 twigs
 * readable as "280.0M". `undefined` is a value the save did not send, and it
 * shows as an em dash rather than as a zero the player does not have.
 */
export const formatAmount = (value: number | undefined): string => {
  if (value === undefined) return "—";
  if (value < 1_000) return String(Math.round(value));
  if (value < 1_000_000) return `${(value / 1_000).toFixed(1)}K`;
  if (value < 1_000_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  return `${(value / 1_000_000_000).toFixed(2)}B`;
};

/**
 * Seconds remaining as a compact duration, or "Done".
 *
 * Two units at a time, largest first: a three-day job does not need its
 * seconds and a five-second one does not need its days.
 */
export const formatCountdown = (seconds: number): string => {
  if (seconds <= 0) return "Done";
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const rest = Math.floor(seconds % 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${rest}s`;
  return `${rest}s`;
};
