import type z from "zod";
import type { Save } from "../../database/models/save.model.js";
import type { User } from "../../database/models/user.model.js";
import { postgres } from "../../server.js";
import { notifyAndCount } from "../../services/notifications/notifications.js";
import type { CompletedJob } from "../../services/yard/catchUp.js";
import type { KoaController } from "../../utils/KoaController.js";
import {
  catchUpLockedOutpost,
  catchUpLockedYard,
  runYardAction,
  type YardAction,
} from "./yardAction.js";

/**
 * `yardRoute(action)`: a yard action as a Koa controller, run against the
 * request's `postgres.em` (`docs/design/yard-buildings.md` §2.1). Everything
 * it does is in `yardAction.ts`; this file only binds it to Koa.
 *
 * After a successful action, once its transaction has committed, what the
 * catch-up finished goes into the player's notification list, one row per
 * kind of job, and the answer carries the unread count as `notifications`
 * for the yard's bell (issue #257, `services/notifications/notifications.ts`).
 * A failure there is logged and leaves the count out; the action stands.
 *
 * FROZEN (2026-09-27): `yardRoute(action: YardAction<Schema, Report>): KoaController`.
 */
export const yardRoute =
  <Schema extends z.ZodType, Report>(action: YardAction<Schema, Report>): KoaController =>
  async (ctx) => {
    const user: User = ctx.authUser;
    const answer = await runYardAction(postgres.em, user, action, ctx.request.body);

    if (answer.outpost !== undefined) {
      const completed = (answer.body["completed"] ?? []) as CompletedJob[];
      const unread = await notifyAndCount(postgres.em, user.userid, answer.outpost, "jobs", completed);
      if (unread !== undefined) answer.body["notifications"] = unread;
    }

    ctx.status = answer.status;
    ctx.body = answer.body;
  };

/**
 * The catch-up on the owner's build-mode `/base/load` of their main yard,
 * locked and written (`catchUpLockedYard`): the save, and what finished.
 */
export const catchUpOwnerYard = (save: Save): Promise<{ save: Save; completed: CompletedJob[] }> =>
  catchUpLockedYard(postgres.em, save);

/**
 * The catch-up on the owner's build-mode `/base/load` of one of their Map
 * Room 2 outposts, locked (main row, then outpost) and written
 * (`catchUpLockedOutpost`): the outpost, and what finished.
 */
export const catchUpOwnerOutpost = (
  user: User,
  outpost: Save
): Promise<{ save: Save; completed: CompletedJob[] }> =>
  catchUpLockedOutpost(postgres.em, user, outpost);
