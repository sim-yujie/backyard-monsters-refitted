import { postgres } from "../../server.js";
import { Status } from "../../enums/StatusCodes.js";
import type { User } from "../../database/models/user.model.js";
import { TradeAcceptSchema, TradePostSchema } from "../../schemas/AllianceSchemas.js";
import { acceptRequest, cancelRequest, postRequest, tradeView } from "../../services/alliance/trade.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import type { KoaController } from "../../utils/KoaController.js";

/**
 * The Trade tab's routes (alliances, design v5 §12a, §12b): swaps only
 * (owner, 16 Nov 2026: no Send). Every rule is in
 * `services/alliance/trade.ts`; refusals carry `data.reason`.
 */

/** GET /alliance/trade */
export const tradeViewController: KoaController = async (ctx) => {
  const user: User = ctx.authUser;
  ctx.status = Status.OK;
  ctx.body = await tradeView(postgres.em, user.userid, getCurrentDateTime());
};

/** POST /alliance/trade/post {give, want, amount}: "I give N of one, I want N of another". */
export const tradePostController: KoaController = async (ctx) => {
  const user: User = ctx.authUser;
  const body = TradePostSchema.parse(ctx.request.body ?? {});
  const request = await postRequest(postgres.em, user.userid, body.give, body.want, body.amount, getCurrentDateTime());
  ctx.status = Status.OK;
  ctx.body = { error: 0, request };
};

/** POST /alliance/trade/cancel: gives back what the request holds. */
export const tradeCancelController: KoaController = async (ctx) => {
  const user: User = ctx.authUser;
  const result = await cancelRequest(postgres.em, user.userid, getCurrentDateTime());
  ctx.status = Status.OK;
  ctx.body = { error: 0, ...result };
};

/** POST /alliance/trade/accept {request_id}: the swap, whole. */
export const tradeAcceptController: KoaController = async (ctx) => {
  const user: User = ctx.authUser;
  const body = TradeAcceptSchema.parse(ctx.request.body ?? {});
  const result = await acceptRequest(postgres.em, user.userid, body.request_id, getCurrentDateTime());
  ctx.status = Status.OK;
  ctx.body = { error: 0, ...result };
};
