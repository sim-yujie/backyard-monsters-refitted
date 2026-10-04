import type { User } from "../../database/models/user.model.js";
import { postgres } from "../../server.js";
import type { KoaController } from "../../utils/KoaController.js";
import { listAnswer, readAllAnswer, readAnswer, unreadAnswer, type NotificationAnswer } from "./notifications.js";

/**
 * The notification routes bound to Koa and `postgres.em` (issue #257); what
 * each does is in `notifications.ts`.
 */
const bind =
  (answer: (user: User, body: unknown) => Promise<NotificationAnswer>): KoaController =>
  async (ctx) => {
    const result = await answer(ctx.authUser, ctx.request.body);
    ctx.status = result.status;
    ctx.body = result.body;
  };

export const getNotifications = bind((user) => listAnswer(postgres.em, user));
export const getUnreadNotifications = bind((user) => unreadAnswer(postgres.em, user));
export const readNotification = bind((user, body) => readAnswer(postgres.em, user, body));
export const readAllNotifications = bind((user) => readAllAnswer(postgres.em, user));
