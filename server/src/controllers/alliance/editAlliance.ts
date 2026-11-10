import { Status } from "../../enums/StatusCodes.js";
import { User } from "../../database/models/user.model.js";
import { postgres } from "../../server.js";
import { EditAllianceSchema } from "../../schemas/AllianceSchemas.js";
import { requireAlliancePermission } from "../../services/alliance/allianceAccess.js";
import { AllianceAction, can } from "../../services/alliance/permissions.js";
import { permissionErr } from "../../errors/errors.js";
import { assertDescriptionAllowed } from "../../services/alliance/textFilter.js";
import type { KoaController } from "../../utils/KoaController.js";

/**
 * Updates the shield image and description of the authenticated user's alliance.
 * The name is immutable and is not accepted, so only the description is passed
 * through the profanity filter. The Leader and Officers edit the description
 * (the ad); only the Leader may change the shield (`permissions.ts`).
 *
 * @param {Context} ctx - Koa context.
 */
export const editAlliance: KoaController = async (ctx) => {
  const user: User = ctx.authUser;
  const alliance = await requireAlliancePermission(user, AllianceAction.EDIT_AD);

  const data = EditAllianceSchema.parse(ctx.request.body);

  const newShield = data.alliance_image !== alliance.image;

  if (newShield && !can(user.alliance_role, AllianceAction.PICK_SHIELD)) throw permissionErr();

  assertDescriptionAllowed(data.alliance_desc);

  alliance.image = data.alliance_image;
  alliance.description = data.alliance_desc;

  await postgres.em.flush();

  ctx.status = Status.OK;
  ctx.body = {
    error: 0,
    alliance: {
      alliance_id: alliance.id,
      name: alliance.name,
      image: alliance.image,
      description: alliance.description,
      leader: alliance.leader_name,
      world_id: alliance.world_id,
    },
  };
};
