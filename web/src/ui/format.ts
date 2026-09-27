/**
 * The number spellings every panel shares.
 *
 * Both used to live in whichever file first needed them — the amount in
 * `Hud.ts`, the countdown in `BuildingPanel.ts` — which was fine while one
 * surface showed each. The planner's bottom bar now shows a cost beside the
 * HUD's holdings and a build time beside a building's countdown, and two
 * spellings of the same number on one screen read as two different numbers.
 *
 * None touches the DOM: they take a number and return a string, so they are
 * as testable as the rest of the yard's arithmetic.
 */

/**
 * A resource amount in full: "15,000,000".
 *
 * The default wherever a number of a resource is shown (issue #134): players
 * should see what they actually hold and pay, and "15.0M" hides the last few
 * hundred thousand. A fraction is dropped rather than rounded — a harvester's
 * 999.6 twigs are 999 that can be spent — and the separator is the same in
 * every locale. `undefined` is a value the save did not send, and it shows as
 * an em dash rather than as a zero the player does not have.
 */
export const formatAmount = (value: number | undefined): string => {
  if (value === undefined) return "—";
  return Math.floor(value).toLocaleString("en-US");
};

/**
 * A resource amount short enough for a control that cannot grow: "15.0M".
 *
 * The explicit opt-in to leave {@link formatAmount}'s full figure, for the few
 * places with no room for it: the HUD's change float, the HUD on a phone, a
 * size button. Under a thousand is exact; past that it is one decimal of K or
 * M and two of B, which is what the original's HUD does.
 */
export const formatCompact = (value: number | undefined): string => {
  if (value === undefined) return "—";
  if (value < 1_000) return String(Math.floor(value));
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
