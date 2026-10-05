import type { RaidApi, RaidPreference, RaidResult } from "@/api/raid";

/**
 * After a raid has landed (issue #226 WP4, `docs/design/wild-raids.md` §4.3):
 * the result popup, "well defended" with its +10 Shiny or "poor defence"
 * with what was stolen and Repair now, then the frequency popup, as Flash's
 * `CleanUp` followed one with the other (`WMATTACK.as:867-871`).
 *
 * Closing the frequency popup without an answer keeps the last choice, as
 * Flash's close button did.
 */

export interface RaidAftermathView {
  /** Shows the result; resolves once the player has closed it. */
  result(result: RaidResult): Promise<void>;
  /** Asks more, same or less; resolves with the answer, or null when closed without one. */
  frequency(tribe: string, defended: boolean): Promise<RaidPreference | null>;
  /** A short line when the answer could not be saved. */
  notice(message: string): void;
}

export interface RaidAftermathOptions {
  readonly api: Pick<RaidApi, "frequency">;
  readonly view: RaidAftermathView;
}

/** Runs the two popups for one landed raid; resolves when both are done. */
export const runRaidAftermath = async (options: RaidAftermathOptions, result: RaidResult): Promise<void> => {
  const { api, view } = options;
  await view.result(result);
  const preference = await view.frequency(result.tribe, result.defended);
  if (preference === null) return;
  try {
    await api.frequency(preference);
  } catch {
    view.notice("Your choice could not be saved. The wild monsters will come as before.");
  }
};
