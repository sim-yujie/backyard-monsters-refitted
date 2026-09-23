import { Status } from "../../enums/StatusCodes.js";
import { removeLayout } from "../../services/yardplanner/layoutStorage.js";
import { parseSlot } from "../../services/yardplanner/validateLayout.js";
import { postgres } from "../../server.js";
import type { User } from "../../database/models/user.model.js";
import type { KoaController } from "../../utils/KoaController.js";

/**
 * `DELETE /bm/yardplanner/layouts/:slot`, and the legacy
 * `POST /bm/yardplanner/deletetemplate` with a `slotid` form field.
 *
 * The Flash planner has always called `deletetemplate`
 * (`com/monsters/baseplanner/BasePlannerService.as:64-67`); the server never
 * implemented it, so a slot could only ever be overwritten. Both spellings now
 * reach the same handler.
 *
 * Deleting an empty slot succeeds: the client's intent is "this slot is empty",
 * and that is already true.
 *
 * @param {Context} ctx - The Koa context object, which includes the authenticated user.
 * @returns {Promise<void>} - A promise that resolves when the controller is complete.
 */
export const deleteLayout: KoaController = async (ctx) => {
  const user: User = ctx.authUser;
  await postgres.em.populate(user, ["save"]);
  const save = user.save!;

  const body = (ctx.request.body ?? {}) as { slotid?: unknown };
  const slot = parseSlot(ctx.params.slot ?? body.slotid);

  save.savetemplate = removeLayout(save.savetemplate, slot);
  postgres.em.persist(save);
  await postgres.em.flush();

  ctx.status = Status.OK;
  ctx.body = { error: 0 };
};
