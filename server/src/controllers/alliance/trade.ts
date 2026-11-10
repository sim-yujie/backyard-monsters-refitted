import { postgres } from "../../server.js";
import { Status } from "../../enums/StatusCodes.js";
import type { User } from "../../database/models/user.model.js";
import { TradeAskSchema, TradeGiveSchema, TradeSendSchema, TradeViewSchema } from "../../schemas/AllianceSchemas.js";
import {
  askForResources,
  cancelRequest,
  giveToRequest,
  sendToMate,
  tradeView,
} from "../../services/alliance/trade.js";
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

/** POST /alliance/trade/ask {r1..r4 (what should arrive), reason?} */
export const tradeAskController: KoaController = async (ctx) => {
  const user: User = ctx.authUser;
  const body = TradeAskSchema.parse(ctx.request.body ?? {});
  const request = await askForResources(postgres.em, user.userid, amountsOf(body), body.reason ?? null, getCurrentDateTime());
  ctx.status = Status.OK;
  ctx.body = { error: 0, request };
};

/** POST /alliance/trade/cancel */
export const tradeCancelController: KoaController = async (ctx) => {
  const user: User = ctx.authUser;
  const { cancelled } = await cancelRequest(postgres.em, user.userid, getCurrentDateTime());
  ctx.status = Status.OK;
  ctx.body = { error: 0, cancelled };
};

/** POST /alliance/trade/give {request_id, r1..r4? (what should arrive)} */
export const tradeGiveController: KoaController = async (ctx) => {
  const user: User = ctx.authUser;
  const body = TradeGiveSchema.parse(ctx.request.body ?? {});
  const wanted = amountsOf(body);
  const anything = Object.values(wanted).some((n) => n > 0);
  const result = await giveToRequest(postgres.em, user.userid, body.request_id, anything ? wanted : null, getCurrentDateTime());
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
