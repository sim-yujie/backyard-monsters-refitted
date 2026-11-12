import { Status } from "../../enums/StatusCodes.js";
import { User } from "../../database/models/user.model.js";
import { ChangeAllianceTypeSchema } from "../../schemas/AllianceSchemas.js";
import { requireAllianceMember } from "../../services/alliance/allianceAccess.js";
import { switchAllianceType } from "../../services/alliance/allianceSettings.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import type { KoaController } from "../../utils/KoaController.js";

/**
 * Switches the leader's alliance to another type (Midas' Council, Conquest
 * Horde, Fortress Legion). Up is free and at once; down waits 14 days after the
 * last switch and keeps a share of the points. `myalliance` lists what each
 * switch would do before the leader confirms.
 *
 * @param {Context} ctx - Koa context.
 */
export const changeAllianceType: KoaController = async (ctx) => {
  const user: User = ctx.authUser;
  const { alliance_type } = ChangeAllianceTypeSchema.parse(ctx.request.body);

  const alliance = await requireAllianceMember(user);
  const now = new Date(getCurrentDateTime() * 1000);

  const quote = await switchAllianceType(user, alliance, alliance_type, now);

  ctx.status = Status.OK;
  ctx.body = { error: 0, type: alliance.type, points: quote.points_after };
};
