import type Router from "@koa/router";
import type { EntityManager } from "@mikro-orm/postgresql";
import type { Context, Middleware } from "koa";

import { Status } from "../../enums/StatusCodes.js";
import { apiVersion } from "../../middleware/apiVersioning.js";
import type { WordFilter } from "../../services/chat/badWords.js";
import {
  baseidOf,
  checkOutpostName,
  OUTPOST_LABEL_REFUSAL_WORDS,
  type OutpostLabelRefusal,
} from "../../services/outposts/outpostLabelRules.js";
import {
  readOutpostLabels,
  setOutpostName,
  setOutpostPinned,
  type LabelOutcome,
} from "../../services/outposts/outpostLabels.js";

/**
 * Outpost names and pins (beta 7, `services/outposts/outpostLabels.ts`).
 * Signed in; a player names and pins only outposts they own.
 *
 *   GET  /api/:apiVersion/bm/outposts/labels   { labels: { names, pins } }
 *   POST /api/:apiVersion/bm/outposts/name     { baseid, name }: "" clears it
 *   POST /api/:apiVersion/bm/outposts/pin      { baseid, pin: boolean }
 *
 * Each write answers with the player's whole set, so the game's list never
 * drifts from the server's. The owner's yard loads carry the same set as
 * `outpostlabels` (`baseLoad.ts`). The middleware comes in as arguments so a
 * test can mount these on a bare router.
 */

export interface OutpostLabelRouteDeps {
  readonly em: () => EntityManager;
  /** The game's sign-in check (`verifyUserAuth`) and account checks. */
  readonly signedIn: readonly Middleware[];
  readonly limiter: Middleware;
  readonly filter: () => WordFilter;
  readonly now?: () => Date;
}

const refuse = (ctx: Context, status: number, reason: OutpostLabelRefusal): void => {
  ctx.status = status;
  ctx.set("Cache-Control", "no-store");
  ctx.body = { error: OUTPOST_LABEL_REFUSAL_WORDS[reason], reason };
};

const answer = (ctx: Context, done: LabelOutcome): void => {
  // 409/404, never 403: the game reads 401/403 as signed out.
  if (done.outcome === "notOwner") return refuse(ctx, Status.NOT_FOUND, "notOwner");
  if (done.outcome === "pinLimit") return refuse(ctx, Status.CONFLICT, "pinLimit");
  ctx.status = Status.OK;
  ctx.set("Cache-Control", "no-store");
  ctx.body = { error: 0, labels: done.labels };
};

const bodyOf = (ctx: Context): Record<string, unknown> => (ctx.request.body ?? {}) as Record<string, unknown>;

export const mountOutpostLabelRoutes = (router: Router, deps: OutpostLabelRouteDeps): void => {
  const api = "/api/:apiVersion/bm/outposts";
  const now = deps.now ?? (() => new Date());

  router.get(`${api}/labels`, apiVersion, ...deps.signedIn, deps.limiter, async (ctx) => {
    ctx.status = Status.OK;
    ctx.set("Cache-Control", "no-store");
    ctx.body = { error: 0, labels: await readOutpostLabels(deps.em(), ctx.authUser.userid) };
  });

  router.post(`${api}/name`, apiVersion, ...deps.signedIn, deps.limiter, async (ctx) => {
    const body = bodyOf(ctx);
    const baseid = baseidOf(body.baseid);
    if (!baseid) return refuse(ctx, Status.BAD_REQUEST, "badRequest");
    const checked = checkOutpostName(body.name, deps.filter());
    if (!checked.ok) return refuse(ctx, Status.BAD_REQUEST, checked.reason);
    answer(ctx, await setOutpostName(deps.em(), ctx.authUser.userid, baseid, checked.name, now()));
  });

  router.post(`${api}/pin`, apiVersion, ...deps.signedIn, deps.limiter, async (ctx) => {
    const body = bodyOf(ctx);
    const baseid = baseidOf(body.baseid);
    if (!baseid || typeof body.pin !== "boolean") return refuse(ctx, Status.BAD_REQUEST, "badRequest");
    answer(ctx, await setOutpostPinned(deps.em(), ctx.authUser.userid, baseid, body.pin, now()));
  });
};
