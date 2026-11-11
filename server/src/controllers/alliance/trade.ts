import { postgres } from "../../server.js";
import { Status } from "../../enums/StatusCodes.js";
import type { User } from "../../database/models/user.model.js";
import { TradeAcceptSchema, TradePostSchema, TradeSendSchema, TradeViewSchema } from "../../schemas/AllianceSchemas.js";
import { acceptRequest, cancelRequest, postRequest, sendToMate, tradeView } from "../../services/alliance/trade.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import type { KoaController } from "../../utils/KoaController.js";

/**
 * The Trade tab's routes (beta 7 alliances, design v5 §12a, §12b). Every rule
 * is in `services/alliance/trade.ts`; refusals carry `data.reason`.
 */

const amountsOf = (body: { r1?: number; r2?: number; r3?: number; r4?: number }) => ({
  r1: body.r1 ?? 0,
  r2: body.r2 ?? 0,
  r3: body.r3 ?? 0,
  r4: body.r4 ?? 0,
});

/** GET /alliance/trade[?to=] */
export const tradeViewController: KoaController = async (ctx) => {
  const user: User = ctx.authUser;
  const { to } = TradeViewSchema.parse(ctx.query ?? {});
  ctx.status = Status.OK;
  ctx.body = await tradeView(postgres.em, user.userid, getCurrentDateTime(), to);
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

/** POST /alliance/trade/send {to, r1..r4 (what leaves)} */
export const tradeSendController: KoaController = async (ctx) => {
  const user: User = ctx.authUser;
  const body = TradeSendSchema.parse(ctx.request.body ?? {});
  const result = await sendToMate(postgres.em, user.userid, body.to, amountsOf(body), getCurrentDateTime());
  ctx.status = Status.OK;
  ctx.body = { error: 0, ...result };
};
