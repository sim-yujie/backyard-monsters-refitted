import { call, getFrom, postTo, type AllianceResult } from "@/api/alliance";

/**
 * Trading between alliance members (design v5 §12a, §12b), served by
 * `server/src/controllers/alliance/trade.ts`: swaps only (owner, 16 Nov
 * 2026). Amounts are whole numbers per resource, `r1`..`r4` (Twigs,
 * Pebbles, Putty, Goo); Shiny cannot be traded.
 */

export type TradeKey = "r1" | "r2" | "r3" | "r4";
export const TRADE_KEYS: readonly TradeKey[] = ["r1", "r2", "r3", "r4"];
export type TradeAmounts = Readonly<Record<TradeKey, number>>;

/** A main yard's storage: what it holds and its one cap. */
export interface TradeStorage {
  readonly held: TradeAmounts;
  readonly cap: number;
}

/**
 * A trade request (owner, 11 Nov 2026): "I give `amount` of `give`, I want
 * `amount` of `want`", 1:1. What the asker gives is held by the request; a
 * mate who accepts sends `amount` of `want`; each side receives `gets`
 * (the amount less 10%).
 */
export interface TradeRequest {
  readonly id: number;
  readonly userid: number;
  readonly username: string;
  readonly role: string | null;
  readonly give: TradeKey;
  readonly want: TradeKey;
  readonly amount: number;
  readonly gets: number;
  readonly created_at: number;
  readonly expires_at: number;
  readonly status: "open" | "done";
  /** Who accepted it (done requests). */
  readonly taken_by: string | null;
  /** The asker's storage (open requests), for the room check. */
  readonly storage: TradeStorage | null;
  /** False when the asker already traded today: it can be accepted from the next UTC day. */
  readonly ready: boolean;
}

export interface TradeRecent {
  readonly from: string;
  readonly to: string;
  readonly arrived: Partial<TradeAmounts>;
  readonly at: number;
}

export interface TradeView {
  /** `swapsLeft`: 1 until the player's one swap of the UTC day, then 0. */
  readonly today: { readonly swapsLeft: number; readonly postsLeft: number; readonly newDayIn: number };
  readonly rules: { readonly loss: number; readonly capShare: number; readonly requestSeconds: number };
  readonly me: TradeStorage | null;
  readonly myRequest: TradeRequest | null;
  readonly requests: readonly TradeRequest[];
  readonly recent: readonly TradeRecent[];
}

/** What an accept did, for the accepter. */
export interface SwapDone {
  /** What left the accepter. */
  readonly gave: Partial<TradeAmounts>;
  /** What landed in their storage. */
  readonly got: Partial<TradeAmounts>;
  readonly resources: TradeAmounts;
  readonly with: { readonly userid: number; readonly username: string };
}

export interface AllianceTradeApi {
  view(): Promise<AllianceResult<{ view: TradeView }>>;
  /** "I give `amount` of `give`, I want `amount` of `want`." */
  post(give: TradeKey, want: TradeKey, amount: number): Promise<AllianceResult<object>>;
  /** Takes the caller's request down; what it held comes back. */
  cancel(): Promise<AllianceResult<object>>;
  /** Takes a mate's request whole: the swap. */
  accept(requestId: number): Promise<AllianceResult<{ done: SwapDone }>>;
}

export const allianceTradeApi: AllianceTradeApi = {
  view: () => call(getFrom("trade"), (body) => ({ view: body as unknown as TradeView })),
  post: (give, want, amount) => call(postTo("trade/post", { give, want, amount: Math.floor(amount) }), () => ({})),
  cancel: () => call(postTo("trade/cancel"), () => ({})),
  accept: (requestId) => call(postTo("trade/accept", { request_id: requestId }), (body) => ({ done: body as unknown as SwapDone })),
};
