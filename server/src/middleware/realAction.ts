import type { Context, Next } from "koa";

import { logger } from "../utils/logger.js";
import { getCurrentDateTime } from "../utils/getCurrentDateTime.js";
import { recordRealAction } from "../services/user/online.js";
import { answeredOk, isRealActionRequest } from "../services/user/realActions.js";

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
 * @param {Function} record - Writes the time; `recordRealAction` by default
 * @param {Function} now - Unix seconds; `getCurrentDateTime` by default
 * @returns {Function} Koa middleware
 */
export const realActionTracker =
  (
    record: (userid: number, now: number) => Promise<void> = recordRealAction,
    now: () => number = getCurrentDateTime
  ) =>
  async (ctx: Context, next: Next): Promise<void> => {
    await next();
    const userid = (ctx as { authUser?: { userid?: unknown } }).authUser?.userid;
    if (typeof userid !== "number") return;
    const matched = (ctx as { _matchedRoute?: string | RegExp })._matchedRoute;
    if (typeof matched !== "string" || !isRealActionRequest(ctx, matched) || !answeredOk(ctx)) return;
    try {
      const at = now();
      await record(userid, at);
      const body: unknown = ctx.body;
      if (body !== null && typeof body === "object" && !Array.isArray(body) && !Buffer.isBuffer(body)) {
        (body as Record<string, unknown>).lastAction = at;
      }
    } catch (err) {
      // The action itself is done; a lost mark only lets the player read as away sooner.
      logger.warn(`last-action not written for user ${userid}: ${err}`);
    }
  };
