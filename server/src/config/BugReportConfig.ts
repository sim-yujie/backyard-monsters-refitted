/**
 * In-game bug reports (`services/bugReports/bugReports.ts`): where they are
 * emailed and how many a player may send.
 *
 * - `BUG_REPORT_EMAIL` — who receives each report. Unset or blank falls back to
 *   the default below.
 *
 * Read on each call rather than once at import, so tests can change it.
 */

export const DEFAULT_BUG_REPORT_EMAIL = "simyujie@gmail.com";

/** Reports one player (or, signed out, one IP address) may send in 24 hours. */
export const BUG_REPORTS_PER_DAY = 5;

/** The address each report is emailed to. */
export const bugReportEmail = (env: Record<string, string | undefined> = process.env): string =>
  env.BUG_REPORT_EMAIL?.trim() || DEFAULT_BUG_REPORT_EMAIL;

/** Size and length caps on what a report carries. The web client keeps to them too. */
export const BUG_REPORT_LIMITS = {
  /** The player's own words, after trimming. */
  messageMin: 3,
  messageMax: 2000,
  /** The client's list of recent game errors: how many, and how long each. */
  errorsMax: 20,
  errorLengthMax: 1000,
  /** The automatic screenshot, decoded. */
  screenshotBytesMax: 1_500_000,
  /** The picture the player adds, decoded. */
  pictureBytesMax: 3_000_000,
} as const;
