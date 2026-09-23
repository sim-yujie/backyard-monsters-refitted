import { Status } from "../../enums/StatusCodes.js";
import { readLayouts, toLegacyEntry } from "../../services/yardplanner/layoutStorage.js";
import { postgres } from "../../server.js";
import type { User } from "../../database/models/user.model.js";
import type { KoaController } from "../../utils/KoaController.js";

/**
 * Controller to handle the retrieval of Yard Planner slots/templates for the authenticated user.
 *
 * Deprecated: the Flash client's route. It keeps its original quirk of
 * spreading the array into the response body, so the client receives a
 * numeric-string-keyed object rather than a JSON array, and each entry keeps
 * the version 1 shape with `data` as a JSON string, because the client runs
 * `JSON.parse(template.data)` on it
 * (`com/monsters/baseplanner/BasePlannerService.as:48`).
 *
 * Layouts written by the new client are converted down to that shape on the
 * way out, so a layout saved by either client is visible to both.
 *
 * @param {Context} ctx - The Koa context object, which includes the authenticated user.
 * @returns {Promise<void>} - A promise that resolves when the controller is complete.
 */
export const getTemplates: KoaController = async (ctx) => {
  const user: User = ctx.authUser;
  await postgres.em.populate(user, ["save"], { fields: ["save.savetemplate"] });

  const templates = readLayouts(user.save?.savetemplate).map(toLegacyEntry);

  ctx.status = Status.OK;
  ctx.body = {
    error: 0,
    ...templates,
  };
};
