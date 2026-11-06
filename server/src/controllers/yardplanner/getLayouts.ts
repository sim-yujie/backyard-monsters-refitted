import { Status } from "../../enums/StatusCodes.js";
import { LAYOUT_SLOTS } from "../../schemas/YardPlannerSchemas.js";
import { readLayouts } from "../../services/yardplanner/layoutStorage.js";
import type { User } from "../../database/models/user.model.js";
import type { KoaController } from "../../utils/KoaController.js";
import { onLayoutYard } from "./plannerYard.js";

/**
 * `GET /bm/yardplanner/layouts` — every saved layout, converted to version 2.
 *
 * Layouts the Flash planner wrote are converted on the way out and are not
 * rewritten, so an old layout opens in the new client without a migration step
 * (`docs/design/yard-planner-redesign.md` §5.5).
 *
 * With the caller's Inferno `baseid` they are the Inferno yard's own slots
 * (`plannerYard.ts`, `onLayoutYard`); an outpost's is refused.
 *
 * @param {Context} ctx - The Koa context object, which includes the authenticated user.
 * @returns {Promise<void>} - A promise that resolves when the controller is complete.
 */
export const getLayouts: KoaController = async (ctx) => {
  const user: User = ctx.authUser;
  // Flash's planner could not load layouts in an outpost (`BasePlanner.as:41`).
  const layouts = await onLayoutYard(user, ctx.query, (save) => readLayouts(save.savetemplate), false);

  ctx.status = Status.OK;
  ctx.body = {
    error: 0,
    slots: LAYOUT_SLOTS,
    layouts,
  };
};
