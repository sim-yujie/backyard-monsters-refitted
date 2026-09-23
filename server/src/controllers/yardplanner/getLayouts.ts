import { Status } from "../../enums/StatusCodes.js";
import { LAYOUT_SLOTS } from "../../schemas/YardPlannerSchemas.js";
import { readLayouts } from "../../services/yardplanner/layoutStorage.js";
import { postgres } from "../../server.js";
import type { User } from "../../database/models/user.model.js";
import type { KoaController } from "../../utils/KoaController.js";

/**
 * `GET /bm/yardplanner/layouts` — every saved layout, converted to version 2.
 *
 * Layouts the Flash planner wrote are converted on the way out and are not
 * rewritten, so an old layout opens in the new client without a migration step
 * (`docs/design/yard-planner-redesign.md` §5.5).
 *
 * @param {Context} ctx - The Koa context object, which includes the authenticated user.
 * @returns {Promise<void>} - A promise that resolves when the controller is complete.
 */
export const getLayouts: KoaController = async (ctx) => {
  const user: User = ctx.authUser;
  await postgres.em.populate(user, ["save"], { fields: ["save.savetemplate"] });

  ctx.status = Status.OK;
  ctx.body = {
    error: 0,
    slots: LAYOUT_SLOTS,
    layouts: readLayouts(user.save?.savetemplate),
  };
};
