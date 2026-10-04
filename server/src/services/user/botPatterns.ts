import { redis } from "../../server.js";

/**
 * The bot-like patterns that ask a player for the in-game check (#273).
 *
 * Fed every successful real game action (`realActions.ts`) by the real-action
 * middleware, with the route the router matched. Three rules, any one enough:
 *
 * - `regular`: {@link REGULAR_RUN_ACTIONS} real actions in a row whose gaps
 *   are near-identical (their coefficient of variation under
 *   {@link REGULAR_MAX_CV}), every gap at least {@link REGULAR_MIN_GAP_MS}.
 *   A script on a timer, at any pace. The floor keeps ordinary fast play out:
 *   a player tapping through a row of buildings does it in under two seconds a
 *   tap, and the timing of a hand is never that even for thirty taps anyway.
 * - `repeat`: one route {@link SAME_ROUTE_LIMIT} times or more in
 *   {@link SAME_ROUTE_WINDOW_SECONDS}. Counted in
 *   {@link SAME_ROUTE_BUCKET_SECONDS} buckets, so the hour slides in steps of
 *   ten minutes rather than resetting on the clock's hour.
 * - `stay`: the "Stay protected?" tap {@link STAY_STREAK_LIMIT} times running
 *   with no other real action in between: someone, or something, keeping the
 *   yard safe without playing.
 *
 * The state is the player's, in Redis, and every key has a life: the last 30
 * action times live {@link REGULAR_TIMES_TTL_SECONDS} after the last action,
 * a bucket of route counts a little over the hour, the tap streak
 * {@link STAY_STREAK_TTL_SECONDS}. Times are milliseconds: whole seconds would
 * make a steady two-second timer look ragged.
 */

/** How many actions in a row the `regular` rule looks at. */
export const REGULAR_RUN_ACTIONS = 30;
/** The gaps' standard deviation over their mean, below which they count as identical. */
export const REGULAR_MAX_CV = 0.05;
/** Every gap in the run at least this long, or the run does not count. */
export const REGULAR_MIN_GAP_MS = 2_000;
/**
 * The action times go this long after the last action. Long enough to catch a
 * script that acts every nine minutes, just inside the ten-minute protection,
 * for the thirty actions the rule wants (four and a half hours).
 */
export const REGULAR_TIMES_TTL_SECONDS = 6 * 60 * 60;

/** One route this many times in the window is the `repeat` rule. */
export const SAME_ROUTE_LIMIT = 200;
export const SAME_ROUTE_WINDOW_SECONDS = 60 * 60;
export const SAME_ROUTE_BUCKET_SECONDS = 10 * 60;
const SAME_ROUTE_BUCKETS = SAME_ROUTE_WINDOW_SECONDS / SAME_ROUTE_BUCKET_SECONDS;

/** The "Stay protected?" tap this many times running is the `stay` rule. */
export const STAY_STREAK_LIMIT = 6;
/** The streak goes this long after its last tap; the prompt comes every nine minutes at most. */
export const STAY_STREAK_TTL_SECONDS = 60 * 60;

/** The "Stay protected?" tap's route, as `app.routes.ts` writes it. */
export const STAY_ROUTE = "/api/:apiVersion/bm/presence/stay";

/** Which rule fired; `dev` is the DEV-only forced check. */
export type BotRule = "regular" | "repeat" | "stay" | "dev";

export interface BotTrigger {
  readonly rule: BotRule;
  /** The evidence, in a line, for the review log. */
  readonly detail: string;
}

const timesKey = (userid: number): string => `bot-check:times:${userid}`;
const routesKey = (userid: number, bucket: number): string => `bot-check:routes:${userid}:${bucket}`;
const stayKey = (userid: number): string => `bot-check:stay:${userid}`;
const bucketOf = (nowMs: number): number => Math.floor(nowMs / 1000 / SAME_ROUTE_BUCKET_SECONDS);

/** What the `regular` rule saw in a run that fired. */
export interface RegularRun {
  readonly meanGapMs: number;
  readonly cv: number;
}

/**
 * The `regular` rule over action times, oldest first: the last
 * {@link REGULAR_RUN_ACTIONS} of them, if there are that many, with even
 * gaps none shorter than the floor. Null when it does not fire.
 */
export const regularRun = (timesMs: readonly number[]): RegularRun | null => {
  if (timesMs.length < REGULAR_RUN_ACTIONS) return null;
  const run = timesMs.slice(-REGULAR_RUN_ACTIONS);
  const gaps = run.slice(1).map((time, i) => time - run[i]!);
  if (gaps.some((gap) => gap < REGULAR_MIN_GAP_MS)) return null;
  const mean = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
  const variance = gaps.reduce((sum, gap) => sum + (gap - mean) ** 2, 0) / gaps.length;
  const cv = Math.sqrt(variance) / mean;
  return cv < REGULAR_MAX_CV ? { meanGapMs: mean, cv } : null;
};

/**
 * Notes one real action and says whether it makes a pattern. `route` is the
 * method and pattern, e.g. `POST /api/:apiVersion/bm/yard/bank`.
 */
export const observeRealAction = async (userid: number, route: string, nowMs: number): Promise<BotTrigger | null> => {
  const times = timesKey(userid);
  const bucket = bucketOf(nowMs);
  const current = routesKey(userid, bucket);
  const isStay = route === `POST ${STAY_ROUTE}`;
  // One round trip: the client pipelines these, and Redis runs them in order.
  const [, , , recent, count, , ...earlier] = await Promise.all([
    redis.lpush(times, String(nowMs)),
    redis.ltrim(times, 0, REGULAR_RUN_ACTIONS - 1),
    redis.expire(times, REGULAR_TIMES_TTL_SECONDS),
    redis.lrange(times, 0, REGULAR_RUN_ACTIONS - 1),
    redis.send("HINCRBY", [current, route, "1"]),
    redis.expire(current, SAME_ROUTE_WINDOW_SECONDS + SAME_ROUTE_BUCKET_SECONDS),
    ...Array.from({ length: SAME_ROUTE_BUCKETS - 1 }, (_, i) =>
      redis.send("HGET", [routesKey(userid, bucket - 1 - i), route])
    ),
  ]);
  let streak = 0;
  if (isStay) {
    streak = await redis.incr(stayKey(userid));
    await redis.expire(stayKey(userid), STAY_STREAK_TTL_SECONDS);
  } else {
    await redis.del(stayKey(userid));
  }

  if (streak >= STAY_STREAK_LIMIT) {
    return { rule: "stay", detail: `"Stay protected" tapped ${streak} times running with no other real action` };
  }
  const inWindow = Number(count) + earlier.reduce((sum: number, n) => sum + (Number(n) || 0), 0);
  if (inWindow >= SAME_ROUTE_LIMIT) {
    return { rule: "repeat", detail: `${route} ${inWindow} times in the last hour` };
  }
  const run = regularRun((recent as string[]).map(Number).reverse());
  if (run !== null) {
    return {
      rule: "regular",
      detail: `${REGULAR_RUN_ACTIONS} real actions ${(run.meanGapMs / 1000).toFixed(2)} s apart, gaps varying ${(run.cv * 100).toFixed(2)}%`,
    };
  }
  return null;
};

/** Forgets the player's patterns: a solved check starts them clean. */
export const resetPatterns = async (userid: number, nowMs: number): Promise<void> => {
  const bucket = bucketOf(nowMs);
  await redis.del(
    timesKey(userid),
    stayKey(userid),
    ...Array.from({ length: SAME_ROUTE_BUCKETS }, (_, i) => routesKey(userid, bucket - i))
  );
};
