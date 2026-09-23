import { Status } from "../../enums/StatusCodes.js";
import { layoutInvalidErr } from "../../errors/errors.js";
import {
  LAYOUT_NAME_MAX,
  LEGACY_PAYLOAD_MAX,
  LegacySaveTemplateSchema,
} from "../../schemas/YardPlannerSchemas.js";
import {
  makeLayout,
  parseLegacyNodes,
  readLayouts,
  toLegacyEntry,
  writeLayout,
} from "../../services/yardplanner/layoutStorage.js";
import { parseSlot } from "../../services/yardplanner/validateLayout.js";
import { postgres } from "../../server.js";
import type { User } from "../../database/models/user.model.js";
import type { KoaController } from "../../utils/KoaController.js";

/**
 * Controller to handle saving a Yard Planner slot/template for the authenticated user.
 *
 * Deprecated: the Flash client's route. The version 1 body is kept, but the
 * slot is now bounded and the payload is capped, where before the request body
 * was spread into the column with no checks at all. The nodes are converted to
 * version 2 and stored alongside anything the new client wrote, so a layout
 * saved here is visible to both clients.
 *
 * Only the two limits reject. Anything else the old client sends is taken as
 * best it can be — a name is trimmed and clipped, an unreadable node is
 * dropped — because a Flash client has no way to show a validation message
 * from here and would simply lose the save.
 *
 * @param {Context} ctx - The Koa context object, which includes the authenticated user and request body.
 * @returns {Promise<void>} - A promise that resolves when the controller is complete.
 */
export const saveTemplate: KoaController = async (ctx) => {
  const user: User = ctx.authUser;
  await postgres.em.populate(user, ["save"]);
  const save = user.save!;

  const parsed = LegacySaveTemplateSchema.safeParse(ctx.request.body ?? {});
  if (!parsed.success) {
    // Re-run the slot on its own so an out-of-range slot gets the message that
    // names the real range rather than a generic schema failure.
    parseSlot((ctx.request.body as { slotid?: unknown } | undefined)?.slotid);
    throw layoutInvalidErr("That layout could not be read.");
  }

  const { slotid, data } = parsed.data;
  const size = typeof data === "string" ? data.length : JSON.stringify(data).length;
  if (size > LEGACY_PAYLOAD_MAX) {
    throw layoutInvalidErr(
      `That layout is too large to save. The limit is ${LEGACY_PAYLOAD_MAX / 1024} KB.`,
      { bytes: size }
    );
  }

  const name = (parsed.data.name ?? "").trim().slice(0, LAYOUT_NAME_MAX);
  const layout = makeLayout(
    slotid,
    name || `Slot${slotid + 1}`,
    // A v1 body never says which plot it was drawn for.
    0,
    parseLegacyNodes(data)
  );

  save.savetemplate = writeLayout(save.savetemplate, layout);
  postgres.em.persist(save);
  await postgres.em.flush();

  // The client feeds this response straight back into its template list, so it
  // has to match `gettemplates` exactly, spread-array quirk included
  // (`com/monsters/baseplanner/BasePlannerService.as:22-27`).
  ctx.status = Status.OK;
  ctx.body = {
    error: 0,
    ...readLayouts(save.savetemplate).map(toLegacyEntry),
  };
};
