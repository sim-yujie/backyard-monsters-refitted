import { call, getFrom, postTo, type AllianceResult } from "@/api/alliance";

/**
 * Trading between alliance members (design v5 §12a, §12b), served by
 * `server/src/controllers/alliance/trade.ts`. Amounts are whole numbers per
 * resource, `r1`..`r4` (Twigs, Pebbles, Putty, Goo); Shiny cannot be sent.
 */

export type TradeKey = "r1" | "r2" | "r3" | "r4";
export const TRADE_KEYS: readonly TradeKey[] = ["r1", "r2", "r3", "r4"];
export type TradeAmounts = Readonly<Record<TradeKey, number>>;

/**
 * What a request is for (owner, 10 Nov 2026): one of the asker's buildings at
 * its next level, or one of their unlocked monsters (server `tradeFor.ts`).
 */
export type TradeFor =
  | { readonly kind: "building"; readonly type: number; readonly level: number }
  | { readonly kind: "monster"; readonly id: string };

/** What the player can pick on Ask's "For": buildings' next levels and unlocked monsters. */
export interface TradeChoices {
  readonly buildings: readonly { readonly type: number; readonly level: number }[];
  readonly monsters: readonly string[];
}

/** The short text the server stores: `b:<type>:<level>` or `m:<id>`. */
export const tradeForText = (value: TradeFor): string =>
  value.kind === "building" ? `b:${value.type}:${value.level}` : `m:${value.id}`;

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
  /** What a mate gives, 1:1; the asker gets 10% less. */
  readonly amounts: Partial<TradeAmounts>;
  readonly for: TradeFor | null;
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
  /** What the player can ask for (Ask's "For"). */
  readonly choices?: TradeChoices;
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
  /** `amounts` = what a mate gives. */
  ask(amounts: Partial<TradeAmounts>, forWhat: TradeFor | null): Promise<AllianceResult<object>>;
  cancel(): Promise<AllianceResult<object>>;
  /** Gives exactly what was asked (1:1, 10% lost on the way). */
  give(requestId: number): Promise<AllianceResult<{ done: TradeDone }>>;
  /** `amounts` = what leaves. */
  send(to: number, amounts: Partial<TradeAmounts>): Promise<AllianceResult<{ done: TradeDone }>>;
}

const flat = (amounts: Partial<TradeAmounts>) => {
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
  ask: (amounts, forWhat) => call(postTo("trade/ask", { ...flat(amounts), ...(forWhat ? { for: tradeForText(forWhat) } : {}) }), () => ({})),
  cancel: () => call(postTo("trade/cancel"), () => ({})),
  give: (requestId) => call(postTo("trade/give", { request_id: requestId }), doneOf),
  send: (to, amounts) => call(postTo("trade/send", { to, ...flat(amounts) }), doneOf),
};
