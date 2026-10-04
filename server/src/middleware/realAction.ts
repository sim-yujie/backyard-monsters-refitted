import type { Context, Next } from "koa";

import { logger } from "../utils/logger.js";
import { getCurrentDateTime } from "../utils/getCurrentDateTime.js";
import { recordRealAction } from "../services/user/online.js";
import { answeredOk, isRealActionRequest } from "../services/user/realActions.js";
import { watchRealAction } from "../services/user/botChallenge.js";

/**
 * Records a player's real game actions (#271): after a request to one of the
 * routes in `services/user/realActions.ts` succeeds, the player's
 * `last-action` time moves to now (`services/user/online.ts`). Mounted ahead
 * of the router, so it reads the route the router matched once the request
 * is answered; a refused or failed action records nothing.
 *
 * A JSON object answer also carries the time written, as `lastAction` (#275):
 * the web client's "Stay protected?" prompt measures from it, and so goes
 * away the moment the player does something real.
 *
 * Each one is also watched for bot-like patterns (#273, `botPatterns.ts`):
 * one may ask the player for the in-game check, and while a check waits the
 * answer says so with `checkPending: true`, which the web client shows.
 *
 * @param {Function} record - Writes the time; `recordRealAction` by default
 * @param {Function} now - Unix seconds; `getCurrentDateTime` by default
 * @param {Function} watch - Notes the action, given its method and route and
 *   the time in milliseconds, and says whether a check waits;
 *   `watchRealAction` by default
 * @returns {Function} Koa middleware
 */
export const realActionTracker =
  (
    record: (userid: number, now: number) => Promise<void> = recordRealAction,
    now: () => number = getCurrentDateTime,
    watch: (userid: number, route: string, nowMs: number) => Promise<boolean> = watchRealAction
  ) =>
  async (ctx: Context, next: Next): Promise<void> => {
    await next();
    const userid = (ctx as { authUser?: { userid?: unknown } }).authUser?.userid;
    if (typeof userid !== "number") return;
    const matched = (ctx as { _matchedRoute?: string | RegExp })._matchedRoute;
    if (typeof matched !== "string" || !isRealActionRequest(ctx, matched) || !answeredOk(ctx)) return;
    const body: unknown = ctx.body;
    const answer =
      body !== null && typeof body === "object" && !Array.isArray(body) && !Buffer.isBuffer(body)
        ? (body as Record<string, unknown>)
        : null;
    try {
      const at = now();
      await record(userid, at);
      if (answer) answer.lastAction = at;
    } catch (err) {
      // The action itself is done; a lost mark only lets the player read as away sooner.
      logger.warn(`last-action not written for user ${userid}: ${err}`);
    }
    try {
      if ((await watch(userid, `${ctx.method} ${matched}`, Date.now())) && answer) answer.checkPending = true;
    } catch (err) {
      // A missed pattern is caught on a later action; the action itself stands.
      logger.warn(`bot check not watched for user ${userid}: ${err}`);
    }
  };
