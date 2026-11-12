import type { Context, Next } from "koa";
import { allianceTradeEnabled } from "../../config/AllianceConfig.js";
import { Status } from "../../enums/StatusCodes.js";
import { progressRefusedErr } from "./allianceProgress.js";

/**
 * Trading's switch on the routes (`ALLIANCE_TRADE_ENABLED`, off by default:
 * owner 11 Nov 2026, "disable trades for now. We can polish it for beta 8").
 * While it is off every `/alliance/trade` route refuses before it reads or
 * changes anything; the web hides the Trade tab, so a player only meets this
 * from an old page or by hand.
 */

/** The reason a refusal carries while trading is off. */
export const TRADE_OFF_REASON = "trade_off";

/** The refusal every trade route gives while trading is off. */
export const tradeOffErr = () =>
  progressRefusedErr(TRADE_OFF_REASON, "Alliance trading is switched off for now.", Status.FORBIDDEN);

/** Throws {@link tradeOffErr} unless trading is on. */
export const requireTradeOn = (env: Record<string, string | undefined> = process.env): void => {
  if (!allianceTradeEnabled(env)) throw tradeOffErr();
};

/** Koa middleware in front of every trade route: refuses while trading is off. */
export const tradeSwitchGate = async (_ctx: Context, next: Next): Promise<void> => {
  requireTradeOn();
  await next();
};
