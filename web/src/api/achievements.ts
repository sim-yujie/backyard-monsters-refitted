import { actionKey, type YardActionResult, type YardStore } from "@/game/yard/YardStore";
import { get, post } from "./http";
import type { ApiEnvelope, YardResponse } from "./types";
import { yardBody } from "./yard";

/**
 * The achievements routes (`docs/design/achievements.md` §9, issue #204):
 *
 *   POST /api/:apiVersion/bm/yard/achievements/state         the player's own list
 *   POST /api/:apiVersion/bm/yard/achievements/seen  ids     pop-ups shown
 *   GET  /api/:apiVersion/bm/achievements/player/:userid     someone else's
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
const PLAYER_PATH = "/api/:apiVersion/bm/achievements/player";

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

/** One entry of someone else's list: earned or not and when, no progress, no Shiny. */
export interface PublicAchievementView {
  id: number;
  name: string;
  description: string;
  status: AchievementStatus;
  at?: number;
}

/** `GET achievements/player/:userid`. */
export interface PlayerAchievements {
  userid: number;
  name: string;
  earned: number;
  total: number;
  achievements: PublicAchievementView[];
}

type PlayerAchievementsResponse = ApiEnvelope & PlayerAchievements;

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

/**
 * Another player's list (the caller's own too). Refusals: 404 `notFound` for
 * an unknown or banned player, 429 `rateLimited` (30 a minute).
 */
export const playerAchievements = async (userid: number): Promise<PlayerAchievements> => {
  const { userid: id, name, earned, total, achievements } = await get<PlayerAchievementsResponse>(
    `${PLAYER_PATH}/${encodeURIComponent(String(userid))}`,
  );
  return { userid: id, name, earned, total, achievements };
};

/** The calls the screen makes, so tests can hand it stand-ins. */
export interface AchievementsApi {
  state: typeof achievementsState;
  player: typeof playerAchievements;
}

export const achievementsApi: AchievementsApi = {
  state: achievementsState,
  player: playerAchievements,
};
