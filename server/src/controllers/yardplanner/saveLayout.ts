import { Status } from "../../enums/StatusCodes.js";
import { SaveLayoutSchema } from "../../schemas/YardPlannerSchemas.js";
import { makeLayout, writeLayout } from "../../services/yardplanner/layoutStorage.js";
import {
  checkNodesOwned,
  checkNodePlacement,
  checkPlans,
  parseName,
  parsePayload,
  parseSlot,
} from "../../services/yardplanner/validateLayout.js";
import { postgres } from "../../server.js";
import type { User } from "../../database/models/user.model.js";
import type { KoaController } from "../../utils/KoaController.js";

/**
 * `PUT /bm/yardplanner/layouts/:slot` — store one layout, overwriting the slot.
 *
 * Positions are checked against the plot the layout claims to be drawn for, not
 * the one the player currently has: a layout may be saved for a bigger yard
 * than the player owns, and loading it into a smaller one is the client's
 * problem to report (`docs/design/yard-planner-redesign.md` §8, decision Q8).
 * Mushrooms are ignored here for the same reason — they move.
 *
 * Planned upgrades are checked here too, and more strictly than Apply checks
 * them: a target past the top of a type's ladder is refused as `planLevel`, and
 * so is one at or below the level the building is already at, as
 * `planCaughtUp`. Apply reports that second case rather than refusing it,
 * because by then the layout may simply be older than a job that finished, but
 * a client *writing* a plan the yard has already passed has lost track of the
 * yard (`docs/design/planner-upgrades.md` §2.2).
 *
 * @param {Context} ctx - The Koa context object, which includes the authenticated user.
 * @returns {Promise<void>} - A promise that resolves when the controller is complete.
 */
export const saveLayout: KoaController = async (ctx) => {
  const user: User = ctx.authUser;
  await postgres.em.populate(user, ["save"]);
  const save = user.save!;

  const slot = parseSlot(ctx.params.slot);
  const body = SaveLayoutSchema.parse(ctx.request.body ?? {});
  const name = parseName(body.name);
  const payload = parsePayload(body.data);

  checkNodesOwned(payload.nodes, save.buildingdata);
  checkPlans(payload.nodes, save.buildingdata, { refuseCaughtUp: true });
  checkNodePlacement(payload.nodes, payload.expansion);

  const layout = makeLayout(slot, name, payload.expansion, payload.nodes);
  save.savetemplate = writeLayout(save.savetemplate, layout);

  postgres.em.persist(save);
  await postgres.em.flush();

  ctx.status = Status.OK;
  ctx.body = { error: 0, layout };
};
