import { Status } from "../../enums/StatusCodes.js";
import { postgres } from "../../server.js";
import { markNoticeSeen, pendingNotice } from "../../services/admin/moderation.js";
import type { KoaController } from "../../utils/KoaController.js";

/**
 * The game's side of a warning or mute from the game team
 * (`services/admin/moderation.ts`): the pop-up the player gets in their yard.
 *
 * - `GET  /api/:apiVersion/bm/moderation/notice`: `{ notice }`, the oldest one
 *   not closed yet, or null.
 * - `POST /api/:apiVersion/bm/moderation/notice/:id/seen`: the player closed it.
 */
export const getModerationNotice: KoaController = async (ctx) => {
  ctx.status = Status.OK;
  ctx.set("Cache-Control", "no-store");
  ctx.body = { error: 0, notice: await pendingNotice(postgres.em.fork(), ctx.authUser.userid) };
};

export const seeModerationNotice: KoaController = async (ctx) => {
  const id = Number(ctx.params.id);
  if (!Number.isSafeInteger(id) || id < 1) {
    ctx.status = Status.NOT_FOUND;
    ctx.body = { error: "There is no such notice.", reason: "notFound" };
    return;
  }
  await markNoticeSeen(postgres.em.fork(), ctx.authUser.userid, id);
  ctx.status = Status.OK;
  ctx.body = { error: 0 };
};
