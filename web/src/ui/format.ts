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
 * A resource amount at its shortest: "100K", "12.5M", "1.2B".
 *
 * The Yard Planner's bottom bar (owner, 2026-11-04: one row, numbers over
 * words). Like {@link formatCompact} but without a trailing ".0", and rounded
 * down at every unit, as {@link formatAmount} is: a held 99,960 never reads as
 * the 100K a wall needs. It also never reads "1000K"; that is "1M". The cell's
 * tooltip keeps the exact figure.
 */
export const formatShort = (value: number | undefined): string => {
  if (value === undefined) return "—";
  const whole = Math.floor(value);
  if (whole < 1_000) return String(whole);
  // Tenths of the unit, in whole numbers, so the rounding is exact.
  const tenths = (unit: number): number => Math.floor(whole / (unit / 10)) / 10;
  if (whole < 1_000_000) return `${tenths(1_000)}K`;
  if (whole < 1_000_000_000) return `${tenths(1_000_000)}M`;
  return `${tenths(1_000_000_000)}B`;
};

/**
 * A price at its shortest, rounded UP: "1.3K" for 1,250, "14.5K" for 14,450.
 *
 * {@link formatShort} rounds down so a held amount is never overstated; a
 * price must never be understated instead, or a tile looks cheaper than it
 * is (tester, 9 Nov: Pokey's 1,250 read "1.2K"). Hatchery tiles use it; the
 * full figure stays in their tooltip. A price that rounds up to 1000K is "1M".
 */
export const formatShortPrice = (value: number | undefined): string => {
  if (value === undefined) return "—";
  const whole = Math.ceil(value);
  if (whole < 1_000) return String(whole);
  const units = [
    [1_000, "K"],
    [1_000_000, "M"],
    [1_000_000_000, "B"],
  ] as const;
  for (const [unit, mark] of units) {
    const tenths = Math.ceil(whole / (unit / 10)) / 10;
    if (tenths < 1_000 || mark === "B") return `${tenths}${mark}`;
  }
  return String(whole);
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
