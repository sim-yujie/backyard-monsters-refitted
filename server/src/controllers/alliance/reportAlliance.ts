import { Status } from "../../enums/StatusCodes.js";
import { User } from "../../database/models/user.model.js";
import { postgres } from "../../server.js";
import { ReportAllianceSchema } from "../../schemas/AllianceSchemas.js";
import { reportAlliance } from "../../services/alliance/allianceModeration.js";
import type { KoaController } from "../../utils/KoaController.js";

/**
 * `POST /alliance/report {alliance_id, reason?}`: reports an alliance's name,
 * ad or shield to the admin dashboard (design v5 §13).
 *
 * @param {Context} ctx - Koa context.
 */
export const reportAllianceController: KoaController = async (ctx) => {
  const user: User = ctx.authUser;
  const { alliance_id, reason } = ReportAllianceSchema.parse(ctx.request.body);

  await reportAlliance(postgres.em, user, alliance_id, reason);

  ctx.status = Status.OK;
  ctx.body = { error: 0 };
};
