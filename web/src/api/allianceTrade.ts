import { call, getFrom, postTo, type AllianceResult } from "@/api/alliance";

/**
 * Trading between alliance members (design v5 §12a, §12b), served by
 * `server/src/controllers/alliance/trade.ts`. Amounts are whole numbers per
 * resource, `r1`..`r4` (Twigs, Pebbles, Putty, Goo); Shiny cannot be sent.
 */

export type TradeKey = "r1" | "r2" | "r3" | "r4";
export const TRADE_KEYS: readonly TradeKey[] = ["r1", "r2", "r3", "r4"];
export type TradeAmounts = Readonly<Record<TradeKey, number>>;
export type TradeReason = "upgrade" | "monsters" | "outpost" | "other";
export const TRADE_REASONS: readonly TradeReason[] = ["upgrade", "monsters", "outpost", "other"];

/** A main yard's storage: what it holds and its one cap. */
export interface TradeStorage {
  readonly held: TradeAmounts;
  readonly cap: number;
}

export interface TradeRequest {
  readonly id: number;
  readonly userid: number;
  readonly username: string;
  readonly role: string | null;
  /** What should arrive. */
  readonly amounts: Partial<TradeAmounts>;
  readonly reason: TradeReason | null;
  readonly created_at: number;
  readonly expires_at: number;
  readonly status: "open" | "given";
  readonly given_by: string | null;
  readonly storage: TradeStorage | null;
}

export interface TradeRecent {
  readonly from: string;
  readonly to: string;
  readonly arrived: Partial<TradeAmounts>;
  readonly at: number;
}

export interface TradeView {
  readonly today: { readonly sendsLeft: number; readonly receivesLeft: number; readonly asksLeft: number; readonly newDayIn: number };
  readonly rules: { readonly loss: number; readonly capShare: number; readonly requestSeconds: number };
  readonly me: TradeStorage | null;
  readonly myRequest: TradeRequest | null;
  readonly requests: readonly TradeRequest[];
  readonly recent: readonly TradeRecent[];
  /** With `to`: that mate and their storage, for the Send sheet. */
  readonly mate: { readonly userid: number; readonly username: string; readonly storage: TradeStorage | null } | null;
}

export interface TradeDone {
  readonly sent: Partial<TradeAmounts>;
  readonly arrived: Partial<TradeAmounts>;
  readonly lostFull: Partial<TradeAmounts>;
  readonly resources: TradeAmounts;
  readonly to: { readonly userid: number; readonly username: string };
}

export interface AllianceTradeApi {
  view(to?: number): Promise<AllianceResult<{ view: TradeView }>>;
  ask(amounts: Partial<TradeAmounts>, reason: TradeReason | null): Promise<AllianceResult<object>>;
  cancel(): Promise<AllianceResult<object>>;
  /** `amounts` = what should arrive; null = all they asked. */
  give(requestId: number, amounts: Partial<TradeAmounts> | null): Promise<AllianceResult<{ done: TradeDone }>>;
  /** `amounts` = what leaves. */
  send(to: number, amounts: Partial<TradeAmounts>): Promise<AllianceResult<{ done: TradeDone }>>;
}

const flat = (amounts: Partial<TradeAmounts> | null) => {
  const out: Record<string, number> = {};
  for (const key of TRADE_KEYS) {
    const value = Math.floor(Number(amounts?.[key] ?? 0));
    if (value > 0) out[key] = value;
  }
  return out;
};

const doneOf = (body: Record<string, unknown>) => ({ done: body as unknown as TradeDone });

export const allianceTradeApi: AllianceTradeApi = {
  view: (to) => call(getFrom(to ? `trade?to=${to}` : "trade"), (body) => ({ view: body as unknown as TradeView })),
  ask: (amounts, reason) => call(postTo("trade/ask", { ...flat(amounts), ...(reason ? { reason } : {}) }), () => ({})),
  cancel: () => call(postTo("trade/cancel"), () => ({})),
  give: (requestId, amounts) => call(postTo("trade/give", { request_id: requestId, ...flat(amounts) }), doneOf),
  send: (to, amounts) => call(postTo("trade/send", { to, ...flat(amounts) }), doneOf),
};
