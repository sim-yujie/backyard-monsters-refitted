import type Router from "@koa/router";

import { Status } from "../../enums/StatusCodes.js";
import { apiVersion } from "../../middleware/apiVersioning.js";
import { verifyAccountStatus, verifyUserAuth } from "../../middleware/auth.js";
import { logRequest } from "../../middleware/logRequest.js";
import { eventsLimiter } from "../../middleware/rateLimiters.js";
import { postgres } from "../../server.js";
import { sqlProgressStore } from "../../services/events/progressStore.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import { weekendCheckinState } from "../../services/events/weekendCoins.js";
import { weekendState } from "../../services/events/weekendSchedule.js";
import { weekendSettings } from "../../services/events/weekendSettings.js";
import { eventsAnswer, whatsNewSeenAnswer } from "./eventsState.js";

/**
 * Mounts the Events page's read, the weekend event's read and the "What's
 * new" record (`eventsState.ts`); `app.routes.ts` calls this once. The claims are yard
 * actions (`controllers/yard/events.ts`).
 */
export const mountEventsRoutes = (router: Router): void => {
  const api = "/api/:apiVersion";

  router.get(`${api}/bm/events`, apiVersion, verifyUserAuth, verifyAccountStatus, eventsLimiter, async (ctx) => {
    // The main yard says who may take part and Krallen's level.
    await postgres.em.populate(ctx.authUser, ["save"]);
    ctx.status = Status.OK;
    ctx.body = await eventsAnswer(postgres.em, sqlProgressStore, ctx.authUser, getCurrentDateTime());
  });
  // The weekend event on now and the next one (`services/events/weekendSchedule.ts`),
  // with the server's clock, and the player's check-in for the one on now
  // (`services/events/weekendCoins.ts`; left out when none runs or the coin
  // tables cannot be read): the Events card and the pop-up read it.
  router.get(`${api}/bm/weekend`, apiVersion, verifyUserAuth, verifyAccountStatus, eventsLimiter, async (ctx) => {
    const now = getCurrentDateTime();
    const checkin = await weekendCheckinState(postgres.em.fork(), ctx.authUser.userid, now).catch(() => null);
    ctx.status = Status.OK;
    ctx.set("Cache-Control", "no-store");
    ctx.body = { error: 0, now, ...weekendState(weekendSettings(), now), ...(checkin && { checkin }) };
  });
  router.post(`${api}/bm/whatsnew/seen`, apiVersion, verifyUserAuth, verifyAccountStatus, eventsLimiter, logRequest, async (ctx) => {
    ctx.status = Status.OK;
    ctx.body = await whatsNewSeenAnswer(postgres.em, ctx.authUser, ctx.request.body);
  });
};
