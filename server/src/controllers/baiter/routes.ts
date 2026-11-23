import type Router from "@koa/router";

import { Status } from "../../enums/StatusCodes.js";
import { apiVersion } from "../../middleware/apiVersioning.js";
import { verifyAccountStatus, verifyUserAuth } from "../../middleware/auth.js";
import { logRequest } from "../../middleware/logRequest.js";
import {
  baiterFinishLimiter,
  baiterInviteLimiter,
  baiterReadLimiter,
  baiterStartLimiter,
} from "../../middleware/rateLimiters.js";
import { postgres } from "../../server.js";
import { servedDefenderForces } from "../../services/base/combat/defenderForces.js";
import { FINALISE_REPLAY_DEADLINE_MS, replayAbandonedInWorker, reserveReplaySlot } from "../../services/base/combat/replayRunner.js";
import { redisRunTickets } from "../../services/baiter/baiterRunStore.js";
import {
  baiterRefusedErr,
  cancelAnswer,
  finishAnswer,
  inviteAnswer,
  startAnswer,
  testAnswer,
  testsAnswer,
  type BaiterDeps,
} from "../../services/baiter/baiterTests.js";
import { RULES_VERSION } from "../../services/defences/rulesVersion.js";
import { notifyFriend } from "../../services/friends/friendNotifications.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import type { KoaController } from "../../utils/KoaController.js";

/**
 * The friend-test routes (beta 9 feature #4) bound to Koa, `postgres.em` and
 * the real world: tickets in Redis, battles in a replay worker (one of the
 * capped slots auto-attacks share, so tests never crowd out real attacks'
 * saves), notices through the notification table. What each does is in
 * `services/baiter/baiterTests.ts`.
 */
const deps: BaiterDeps = {
  tickets: redisRunTickets,
  forces: (save, now) => servedDefenderForces(save, null, now),
  fight: async (input) => {
    const release = await reserveReplaySlot();
    if (!release) throw baiterRefusedErr("busy");
    try {
      return await replayAbandonedInWorker(input, FINALISE_REPLAY_DEADLINE_MS);
    } finally {
      release();
    }
  },
  notify: (em, userid, notice) => notifyFriend(em, userid, notice),
  rulesVersion: RULES_VERSION,
};

const ok =
  (answer: (ctx: Parameters<KoaController>[0], now: number) => Promise<Record<string, unknown>>): KoaController =>
  async (ctx) => {
    const body = await answer(ctx, getCurrentDateTime());
    ctx.status = Status.OK;
    ctx.body = body;
  };

export const mountBaiterRoutes = (router: Router): void => {
  const api = "/api/:apiVersion/baiter";
  router.get(`${api}/tests`, apiVersion, verifyUserAuth, verifyAccountStatus, baiterReadLimiter,
    ok((ctx, now) => testsAnswer(postgres.em, ctx.authUser, now, deps)));
  router.get(`${api}/tests/:id`, apiVersion, verifyUserAuth, verifyAccountStatus, baiterReadLimiter, async (ctx) => {
    const answer = await testAnswer(postgres.em, ctx.authUser, ctx.params, getCurrentDateTime(), deps);
    ctx.status = answer.status;
    ctx.body = answer.body;
  });
  router.post(`${api}/invite`, apiVersion, verifyUserAuth, verifyAccountStatus, baiterInviteLimiter, logRequest,
    ok((ctx, now) => inviteAnswer(postgres.em, ctx.authUser, ctx.request.body, now, deps)));
  router.post(`${api}/invite/cancel`, apiVersion, verifyUserAuth, verifyAccountStatus, baiterInviteLimiter, logRequest,
    ok((ctx, now) => cancelAnswer(postgres.em, ctx.authUser, ctx.request.body, now)));
  router.post(`${api}/test/start`, apiVersion, verifyUserAuth, verifyAccountStatus, baiterStartLimiter, logRequest,
    ok((ctx, now) => startAnswer(postgres.em, ctx.authUser, ctx.request.body, now, deps)));
  router.post(`${api}/test/finish`, apiVersion, verifyUserAuth, verifyAccountStatus, baiterFinishLimiter, logRequest,
    ok((ctx, now) => finishAnswer(postgres.em, ctx.authUser, ctx.request.body, now, deps)));
};
