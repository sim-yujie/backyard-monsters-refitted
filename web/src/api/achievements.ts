import { actionKey, type YardActionResult, type YardStore } from "@/game/yard/YardStore";
import { post } from "./http";
import type { YardResponse } from "./types";
import { yardBody } from "./yard";

/**
 * The achievements routes (`docs/design/achievements.md` §9, issue #204):
 *
 *   POST /api/:apiVersion/bm/yard/achievements/state         the player's own list
 *   POST /api/:apiVersion/bm/yard/achievements/seen  ids     pop-ups shown
 *
 * The two yard routes are yard actions on the account's record, and both work
 * on an outpost. `state` never sends a `baseid`: from an outpost, a map or an
 * attack it lands on the main yard, as `tips/seen` does, and the screen reads
 * only its report. `seen` belongs to the unlock pop-up (WP6), an own-yard
 * plugin: it sends the open yard's `baseid` and runs through that yard
 * store's queue, which merges the answer like any other yard action's.
 *
 * While the server's `ACHIEVEMENT_REWARDS` is off, an unlock it owes reads
 * `locked` in both lists and is never in `fresh`.
 */

const STATE_PATH = "/api/:apiVersion/bm/yard/achievements/state";
const SEEN_PATH = "/api/:apiVersion/bm/yard/achievements/seen";

export type AchievementStatus = "locked" | "earned";

/** One part of an entry with several rules: a champion of entries 4 and 5. */
export interface AchievementProgressPart {
  label: string;
  value: number;
  target: number;
}

/**
 * How far along an entry is: `value` of `target`, `value` capped at `target`
 * and full once earned. Entries 4 and 5 count the champions met and list
 * each in `parts`.
 */
export interface AchievementProgress {
  value: number;
  target: number;
  parts?: AchievementProgressPart[];
}

/** One entry of the player's own list. */
export interface AchievementView {
  id: number;
  name: string;
  description: string;
  shiny: number;
  status: AchievementStatus;
  /** Unix seconds it was earned; earned only. */
  at?: number;
  progress: AchievementProgress;
  /** A hidden entry: until earned the server sends only `name: "???"`, no description, no Shiny. */
  hidden?: true;
}

/** A paid unlock the client has not shown yet; the backfill's are marked. */
export interface AchievementUnlock {
  id: number;
  name: string;
  shiny: number;
  backfill?: true;
}

/** `report` of `achievements/state`. */
export interface AchievementsStateReport {
  /** Every available entry, in Flash's order. */
  achievements: AchievementView[];
  earned: number;
  total: number;
  shinyEarned: number;
  fresh: AchievementUnlock[];
}

/** The player's own list, with progress and Shiny. */
export const achievementsState = async (): Promise<AchievementsStateReport> =>
  (await post<YardResponse<AchievementsStateReport>>(STATE_PATH)).report;

/** `report` of `achievements/seen`: the ids it marked. */
export interface AchievementsSeenReport {
  seen: number[];
}

/**
 * Marks unlocks' pop-ups shown, on the outpost `baseid` when given. An id not
 * earned, already seen or still owed is ignored. Refusal: 400 for a bad `ids`.
 */
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

/** The calls the screen makes, so tests can hand it stand-ins. */
export interface AchievementsApi {
  state: typeof achievementsState;
}

export const achievementsApi: AchievementsApi = {
  state: achievementsState,
};
