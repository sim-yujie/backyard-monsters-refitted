import type { KoaController } from "../../utils/KoaController.js";
import { postgres } from "../../server.js";
import { Status } from "../../enums/StatusCodes.js";
import { LookReportSchema, recordLook } from "../../services/user/lookReport.js";

/**
 * `POST /player/look`: the web client's Look and sound choices (Style, Music,
 * Quality, Font), sent once per load and on every change, for the owner's
 * dashboard (`services/user/lookReport.ts`). Nothing in the game reads them.
 *
 * @returns `{ error: 0 }`.
 */
export const reportLook: KoaController = async (ctx) => {
  const report = LookReportSchema.parse(ctx.request.body);
  await recordLook(postgres.em.fork(), ctx.authUser, report);

  ctx.status = Status.OK;
  ctx.body = { error: 0 };
};
