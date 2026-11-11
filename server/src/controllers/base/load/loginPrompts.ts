/** What {@link loginPromptFields} reads off the load. */
export interface LoginPromptFacts {
  /** The player's own main yard, in build mode. */
  readonly ownMainYard: boolean;
  /** The new-player tutorial's stage: the country question waits for its end (205). */
  readonly tutorialStage: number;
  /** The player's country, when picked. */
  readonly country: string | null | undefined;
  /** The country question was answered or put off. */
  readonly countryAsked: boolean | null | undefined;
  /** The test server's `QUIET_LOGIN` is on for this load (`config/QuietLoginConfig.ts`). */
  readonly quiet: boolean;
}

/**
 * The owner's load's login prompt fields:
 *
 * - `countryask: 1`, the one-time "Where are you playing from?" (owner 3 Nov
 *   2026): on the own main yard, once the new-player tutorial is over, until
 *   answered or put off; never with `QUIET_LOGIN` on;
 * - `quietlogin: 1` with `QUIET_LOGIN` on: the web client then leaves the
 *   pop-ups that open by themselves on login shut.
 */
export const loginPromptFields = (facts: LoginPromptFacts): { countryask?: 1; quietlogin?: 1 } => ({
  ...(facts.ownMainYard &&
    !facts.quiet &&
    facts.tutorialStage >= 205 &&
    !facts.country &&
    !facts.countryAsked && { countryask: 1 as const }),
  ...(facts.quiet && { quietlogin: 1 as const }),
});
