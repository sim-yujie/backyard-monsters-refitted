import type { EntityManager } from "@mikro-orm/core";
import z from "zod";
import type { User } from "../../database/models/user.model.js";
import { Status } from "../../enums/StatusCodes.js";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  unreadNotificationCount,
} from "../../services/notifications/notifications.js";

/**
 * The notification list's routes (issue #257,
 * `services/notifications/notifications.ts`), as functions of an entity
 * manager and the caller so they run under test; `routes.ts` binds them to
 * Koa and `postgres.em`. Each reads or marks the caller's own rows only.
 *
 * - `GET  /bm/notifications`         → `{ error: 0, notifications, unread }`
 * - `GET  /bm/notifications/unread`  → `{ error: 0, unread }`
 * - `POST /bm/notifications/read`    `{ id }` → `{ error: 0, unread }`
 * - `POST /bm/notifications/readall` → `{ error: 0, unread }`
 *
 * The bell's count also rides every yard answer and the owner's yard load
 * (`notifications`), so the client never polls for it.
 */

export interface NotificationAnswer {
  status: number;
  body: Record<string, unknown>;
}

const ReadSchema = z.object({ id: z.coerce.number().int().positive() });

export const listAnswer = async (em: EntityManager, user: User): Promise<NotificationAnswer> => {
  const now = new Date();
  const notifications = await listNotifications(em, user.userid, now);
  return {
    status: Status.OK,
    body: { error: 0, notifications, unread: notifications.filter((one) => !one.read).length },
  };
};

export const unreadAnswer = async (em: EntityManager, user: User): Promise<NotificationAnswer> => ({
  status: Status.OK,
  body: { error: 0, unread: await unreadNotificationCount(em, user.userid) },
});

export const readAnswer = async (em: EntityManager, user: User, rawBody: unknown): Promise<NotificationAnswer> => {
  const parsed = ReadSchema.safeParse(rawBody ?? {});
  if (!parsed.success) {
    return { status: Status.BAD_REQUEST, body: { error: "That notification could not be read.", reason: "badRequest" } };
  }
  await markNotificationRead(em, user.userid, parsed.data.id);
  return unreadAnswer(em, user);
};

export const readAllAnswer = async (em: EntityManager, user: User): Promise<NotificationAnswer> => {
  await markAllNotificationsRead(em, user.userid);
  return unreadAnswer(em, user);
};
