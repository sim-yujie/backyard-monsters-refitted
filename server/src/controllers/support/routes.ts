import type Router from "@koa/router";

import { Status } from "../../enums/StatusCodes.js";
import { apiVersion } from "../../middleware/apiVersioning.js";
import { verifyAccountStatus, verifyUserAuth } from "../../middleware/auth.js";
import { eventsLimiter } from "../../middleware/rateLimiters.js";
import { postgres } from "../../server.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import { supportReminderAnswer, supportReminderSeenAnswer } from "./supportReminder.js";

/**
 * Mounts the "Support the game" reminder's read and record
 * (`supportReminder.ts`); `app.routes.ts` calls this once. The web client asks
 * at most once per visit, after 30 minutes of play, so the Events page's
 * limiter is plenty.
 */
export const mountSupportRoutes = (router: Router): void => {
  const api = "/api/:apiVersion";

  router.get(`${api}/bm/support/reminder`, apiVersion, verifyUserAuth, verifyAccountStatus, eventsLimiter, async (ctx) => {
    ctx.status = Status.OK;
    ctx.body = await supportReminderAnswer(postgres.em, ctx.authUser.userid, getCurrentDateTime());
  });
  router.post(`${api}/bm/support/reminder`, apiVersion, verifyUserAuth, verifyAccountStatus, eventsLimiter, async (ctx) => {
    ctx.status = Status.OK;
    ctx.body = await supportReminderSeenAnswer(postgres.em, ctx.authUser.userid, ctx.request.body);
  });
};
