/**
 * Alliance trading's switch as the server last said it (`trade_on` on
 * `myalliance` and on the main yard load's `alliancedata`; the server's
 * `ALLIANCE_TRADE_ENABLED`, off in beta 7: owner 11 Nov 2026, "disable trades
 * for now. We can polish it for beta 8").
 *
 * Off until the server says on, so the Trade tab and every Send / Trade
 * button stay hidden rather than appear and vanish. Chat reads it here; the
 * alliance window reads its own `myalliance` answer and keeps this in step.
 */
let tradeOn = false;

/** Whether alliance trading is on. */
export const allianceTradeOn = (): boolean => tradeOn;

/** Keeps the server's answer: only `true` turns trading on. */
export const setAllianceTradeOn = (value: unknown): void => {
  tradeOn = value === true;
};

/** Reads the switch off a main yard load's `alliancedata` (none: no alliance, so no trading). */
export const setAllianceTradeFrom = (alliancedata: unknown): void => {
  setAllianceTradeOn(
    alliancedata && typeof alliancedata === "object" ? (alliancedata as { trade_on?: unknown }).trade_on : false,
  );
};
