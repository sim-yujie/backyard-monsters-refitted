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
import type { User } from "../../database/models/user.model.js";
import type { KoaController } from "../../utils/KoaController.js";
import { onLayoutYard } from "./plannerYard.js";

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
 * A layout may keep buildings in the drawer (`stored`): a half-finished plan
 * is saved as it stands (owner decision 2026-10-05). Those are held to the
 * same ownership rules as the placed nodes, and Apply still refuses anything
 * a layout leaves off the plot.
 *
 * With the caller's Inferno `baseid` the layout goes into the Inferno yard's
 * own slots, checked with the Inferno's footprints and ladders
 * (`plannerYard.ts`, `onLayoutYard`); an outpost's is refused.
 *
 * @param {Context} ctx - The Koa context object, which includes the authenticated user.
 * @returns {Promise<void>} - A promise that resolves when the controller is complete.
 */
export const saveLayout: KoaController = async (ctx) => {
  const user: User = ctx.authUser;
  const slot = parseSlot(ctx.params.slot);
  const body = SaveLayoutSchema.parse(ctx.request.body ?? {});
  const name = parseName(body.name);
  const payload = parsePayload(body.data);

  // Flash's planner could not save layouts in an outpost (`BasePlanner.as:41`).
  const layout = await onLayoutYard(
    user,
    ctx.request.body,
    (save, kind) => {
      const stored = payload.stored ?? [];
      checkNodesOwned([...payload.nodes, ...stored], save.buildingdata);
      checkPlans(payload.nodes, save.buildingdata, { refuseCaughtUp: true, kind });
      checkNodePlacement(payload.nodes, payload.expansion, save.buildingdata, kind);

      const made = makeLayout(slot, name, payload.expansion, payload.nodes, stored);
      save.savetemplate = writeLayout(save.savetemplate, made);
      return made;
    },
    true
  );

  ctx.status = Status.OK;
  ctx.body = { error: 0, layout };
};
