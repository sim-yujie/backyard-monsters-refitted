import type { GuideScreen } from "@/game/guide/guideBus";
import { post } from "./http";
import type { YardResponse } from "./types";

/**
 * The screen tips' one route (issue #227, `docs/design/tutorial.md` §7.1, §8.3):
 *
 *   POST /api/:apiVersion/bm/yard/tips/seen   screen
 *
 * Remembers on the server, per account, that a screen's tips were seen or
 * skipped, so they do not come back on another device. It is a yard action
 * on the main yard (the record lives there only), so it never sends a
 * `baseid`: from an outpost, a map or an attack it still lands on the main
 * yard. The answer is the main yard's state; the tip runner reads nothing
 * from it but `onboarding`, and it is never merged into an outpost's store.
 * Refusals: 400 `badRequest` for an unknown screen.
 */

const TIPS_SEEN_PATH = "/api/:apiVersion/bm/yard/tips/seen";

/** `report` of `tips/seen`: whether this request was the first to mark the screen. */
export interface TipsSeenReport {
  screen: GuideScreen;
  changed: boolean;
}

/** Marks a screen's tips seen. */
export const markTipsSeen = (screen: GuideScreen): Promise<YardResponse<TipsSeenReport>> =>
  post<YardResponse<TipsSeenReport>>(TIPS_SEEN_PATH, { screen });
