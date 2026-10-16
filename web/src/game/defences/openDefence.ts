import { defencesApi, type DefencesApi } from "@/api/defences";
import { ApiError } from "@/api/http";
import { DEFENCE_REFUSAL_TEXT, defenceWatchOf, type DefenceWatch } from "./defenceWatch";

/**
 * Watch, from the Defences screen or an attack notice in the mailbox (issue
 * #363, `docs/design/defence-replays.md` §8): fetch the defence's battle and
 * check it can be played here, as `defenceWatchOf` does for any answer.
 *
 * The answer is the run to hand the watch scene, or the words the player is
 * shown instead of Watch. The server's refusals read as the list's own:
 * `410` is a defence kept without its battle ("Replay not available"); `404`
 * one that is not kept any more (only the newest 20 are) or was never the
 * player's.
 */

/** A defence that is no longer kept: pushed out of the newest 20 since the list or notice was shown. */
export const DEFENCE_GONE_TEXT = "This attack is no longer kept";

/** The fetch failed for some other reason: the network, the server. */
export const DEFENCE_LOAD_FAILED_TEXT = "The replay could not load. Try again";

export type DefenceOpening = { readonly run: DefenceWatch } | { readonly refusal: string };

export const openDefence = async (id: number, api: DefencesApi = defencesApi): Promise<DefenceOpening> => {
  let answer;
  try {
    answer = await api.replay(id);
  } catch (error) {
    if (error instanceof ApiError && error.serverStatus === 410) return { refusal: DEFENCE_REFUSAL_TEXT.missing };
    if (error instanceof ApiError && error.serverStatus === 404) return { refusal: DEFENCE_GONE_TEXT };
    return { refusal: DEFENCE_LOAD_FAILED_TEXT };
  }
  const checked = defenceWatchOf(answer);
  return "refusal" in checked ? { refusal: DEFENCE_REFUSAL_TEXT[checked.refusal] } : checked;
};
