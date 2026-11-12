import { Status } from "../../enums/StatusCodes.js";
import { User } from "../../database/models/user.model.js";
import { RenameAllianceSchema } from "../../schemas/AllianceSchemas.js";
import { AllianceAction } from "../../services/alliance/permissions.js";
import { requireAlliancePermission } from "../../services/alliance/allianceAccess.js";
import { renameAlliance } from "../../services/alliance/leadership.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import type { KoaController } from "../../utils/KoaController.js";

/**
 * `POST /alliance/rename {alliance_name}`: the leader renames the alliance,
 * once per 7 days, through the word filter; at once after an admin rename.
 *
 * @param {Context} ctx - Koa context.
 */
export const renameAllianceController: KoaController = async (ctx) => {
  const user: User = ctx.authUser;
  const { alliance_name } = RenameAllianceSchema.parse(ctx.request.body);
  const alliance = await requireAlliancePermission(user, AllianceAction.RENAME);

  await renameAlliance(user, alliance, alliance_name, new Date(getCurrentDateTime() * 1000));

  ctx.status = Status.OK;
  ctx.body = { error: 0, name: alliance.name };
};
