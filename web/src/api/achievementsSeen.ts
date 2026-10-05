import { actionKey, type YardActionResult, type YardStore } from "@/game/yard/YardStore";
import { post } from "./http";
import type { YardResponse } from "./types";
import { yardBody } from "./yard";

/**
 * The unlock pop-up's one route (`docs/design/achievements.md` §9.1, issue
 * #204, WP6), a yard action that works on an outpost too:
 *
 *   POST /api/:apiVersion/bm/yard/achievements/seen   ids (JSON array)
 *
 * The client showed these unlocks, so no later answer carries them. An id not
 * earned, already seen or still owed is ignored; `400` only for a malformed
 * list. The answer carries the yard state, so it runs through the store's
 * queue like any other yard action.
 */

const SEEN_PATH = "/api/:apiVersion/bm/yard/achievements/seen";

/** `report` of `achievements/seen`: the ids it marked. */
export interface AchievementsSeenReport {
  seen: number[];
}

/** Marks `ids` seen, on the outpost `baseid` when given. */
export const markAchievementsSeen = (
  ids: readonly number[],
  baseid?: string,
): Promise<YardResponse<AchievementsSeenReport>> =>
  post<YardResponse<AchievementsSeenReport>>(SEEN_PATH, yardBody({ ids: JSON.stringify(ids) }, baseid));

export const AchievementsSeenKey = actionKey("achievements", "seen");

/** `seen` through the store's one-at-a-time queue, which merges the answer. */
export const markSeenAction = (
  store: Pick<YardStore, "run">,
  ids: readonly number[],
  send: typeof markAchievementsSeen = markAchievementsSeen,
): Promise<YardActionResult<AchievementsSeenReport>> =>
  store.run({ key: AchievementsSeenKey, send: (_api, ...yard) => send(ids, ...yard) });
