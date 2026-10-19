import type Router from "@koa/router";

import { apiVersion } from "../../middleware/apiVersioning.js";
import { verifyAccountStatus, verifyUserAuth } from "../../middleware/auth.js";
import { logRequest } from "../../middleware/logRequest.js";
import {
  friendActionLimiter,
  friendRequestLimiter,
  friendSearchLimiter,
  friendsReadLimiter,
} from "../../middleware/rateLimiters.js";
import { Status } from "../../enums/StatusCodes.js";
import { postgres } from "../../server.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import type { KoaController } from "../../utils/KoaController.js";
import {
  answerAnswer,
  blockAnswer,
  blockedAnswer,
  cancelAnswer,
  friendsAnswer,
  removeAnswer,
  requestAnswer,
  requestsAnswer,
  searchAnswer,
  suggestionsAnswer,
  unblockAnswer,
  type FriendsBody,
} from "./friends.js";
import { helpAnswer } from "./help.js";

/** Binds an answer function to Koa: the caller, the body or query, `postgres.em`, now. */
const route =
  (answer: (ctx: Parameters<KoaController>[0], now: number) => Promise<FriendsBody>): KoaController =>
  async (ctx) => {
    const body = await answer(ctx, getCurrentDateTime());
    ctx.status = Status.OK;
    ctx.body = body;
  };

/**
 * Mounts every friends route (`docs/design/friends.md` §6.2, issue #368) on
 * the app's router; `app.routes.ts` calls this once. Later friends packages
 * add their routes here. What each does is in `friends.ts`.
 */
export const mountFriendsRoutes = (router: Router): void => {
  const api = "/api/:apiVersion";

  router.get(`${api}/bm/friends`, apiVersion, verifyUserAuth, verifyAccountStatus, friendsReadLimiter,
    route((ctx, now) => friendsAnswer(postgres.em, ctx.authUser, now)));
  router.get(`${api}/bm/friends/requests`, apiVersion, verifyUserAuth, verifyAccountStatus, friendsReadLimiter,
    route((ctx, now) => requestsAnswer(postgres.em, ctx.authUser, now)));
  router.post(`${api}/bm/friends/request`, apiVersion, verifyUserAuth, verifyAccountStatus, friendRequestLimiter, logRequest,
    route((ctx, now) => requestAnswer(postgres.em, ctx.authUser, ctx.request.body, now)));
  router.post(`${api}/bm/friends/request/answer`, apiVersion, verifyUserAuth, verifyAccountStatus, friendActionLimiter, logRequest,
    route((ctx, now) => answerAnswer(postgres.em, ctx.authUser, ctx.request.body, now)));
  router.post(`${api}/bm/friends/request/cancel`, apiVersion, verifyUserAuth, verifyAccountStatus, friendActionLimiter, logRequest,
    route((ctx, now) => cancelAnswer(postgres.em, ctx.authUser, ctx.request.body, now)));
  router.post(`${api}/bm/friends/remove`, apiVersion, verifyUserAuth, verifyAccountStatus, friendActionLimiter, logRequest,
    route((ctx) => removeAnswer(postgres.em, ctx.authUser, ctx.request.body)));
  router.get(`${api}/bm/friends/search`, apiVersion, verifyUserAuth, verifyAccountStatus, friendSearchLimiter,
    route((ctx, now) => searchAnswer(postgres.em, ctx.authUser, ctx.query, now)));
  router.get(`${api}/bm/friends/suggestions`, apiVersion, verifyUserAuth, verifyAccountStatus, friendsReadLimiter,
    route((ctx, now) => suggestionsAnswer(postgres.em, ctx.authUser, now)));
  router.post(`${api}/bm/friends/help`, apiVersion, verifyUserAuth, verifyAccountStatus, friendActionLimiter, logRequest,
    route((ctx, now) => helpAnswer(postgres.em, ctx.authUser, ctx.request.body, now)));

  router.get(`${api}/player/blocked`, apiVersion, verifyUserAuth, verifyAccountStatus, friendsReadLimiter,
    route((ctx) => blockedAnswer(postgres.em, ctx.authUser)));
  router.post(`${api}/player/block`, apiVersion, verifyUserAuth, verifyAccountStatus, friendActionLimiter, logRequest,
    route((ctx, now) => blockAnswer(postgres.em, ctx.authUser, ctx.request.body, now)));
  router.post(`${api}/player/unblock`, apiVersion, verifyUserAuth, verifyAccountStatus, friendActionLimiter, logRequest,
    route((ctx) => unblockAnswer(postgres.em, ctx.authUser, ctx.request.body)));
};
