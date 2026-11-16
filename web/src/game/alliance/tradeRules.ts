import { TRADE_KEYS, type TradeAmounts, type TradeKey, type TradeRequest, type TradeStorage } from "@/api/allianceTrade";

/**
 * The trade sums the tab shows (design v5 §12a, §12b; swaps only, owner 16
 * Nov 2026), the same as the server's (`server/src/services/alliance/trade.ts`),
 * which decides: each side of a 1:1 swap receives 90%; a request is at most
 * 10% of the asker's own storage cap and the accepter's (the smaller cap
 * rules); the accepter holds the full amount; both need room for what they
 * receive.
 */

export const TRADE_LOSS = 0.1;
export const TRADE_CAP_SHARE = 0.1;
const EPS = 1e-9;

/** What arrives when `sent` leaves (before the receiver's storage). */
export const arriveFor = (sent: number, loss = TRADE_LOSS): number => Math.floor(Math.max(0, sent) * (1 - loss) + EPS);

/** The least that must leave for `arrive` to arrive. */
export const sentFor = (arrive: number, loss = TRADE_LOSS): number => {
  if (arrive <= 0) return 0;
  let sent = Math.ceil(arrive / (1 - loss) - EPS);
  while (arriveFor(sent, loss) < arrive) sent += 1;
  return sent;
};

/** The most one trade carries per resource between these caps (what leaves). */
export const carryCap = (capA: number, capB: number, share = TRADE_CAP_SHARE): number =>
  Math.max(0, Math.floor(share * Math.min(capA, capB)));

/** Free room of one resource. */
export const roomOf = (storage: TradeStorage, key: TradeKey): number => Math.max(0, Math.floor(storage.cap - storage.held[key]));

/**
 * "Most" on a new request: what the player holds of what they give, what one
 * trade carries (10% of storage), and what still fits their room for what
 * they get after the 10%.
 */
export const postCap = (storage: TradeStorage, give: TradeKey, want: TradeKey): number =>
  Math.max(0, Math.min(Math.floor(storage.held[give]), carryCap(storage.cap, storage.cap), fitToRoom(storage, want)));

/** The most that can leave so that all of it lands. */
export const fitToRoom = (theirs: TradeStorage, key: TradeKey): number => {
  const room = roomOf(theirs, key);
  // The largest sent whose arrival fits: sentFor(room + 1) - 1. No room, nothing.
  return room >= 1 ? sentFor(room + 1) - 1 : 0;
};

/** Why the caller cannot accept a request now; null when they can. */
export type AcceptBlock = "traded" | "mateTraded" | "overCap" | "mateOverCap" | "short" | "full" | "mateFull";

/**
 * Whether the caller can accept a mate's request, in the server's order:
 * neither swapped today, the amount is within 10% of the caller's own
 * storage cap (and the asker's), the caller holds all of what the asker
 * wants, and both have room for what they receive (nothing is lost to a
 * full silo in a swap).
 */
export const acceptBlock = (
  request: TradeRequest,
  mine: TradeStorage | null,
  today: { readonly swapsLeft: number },
): AcceptBlock | null => {
  if (today.swapsLeft <= 0) return "traded";
  if (!request.ready) return "mateTraded";
  if (!mine) return "short";
  if (request.amount > carryCap(mine.cap, mine.cap)) return "overCap";
  if (request.storage && request.amount > carryCap(request.storage.cap, request.storage.cap)) return "mateOverCap";
  if (mine.held[request.want] < request.amount) return "short";
  if (roomOf(mine, request.give) < request.gets) return "full";
  if (request.storage && roomOf(request.storage, request.want) < request.gets) return "mateFull";
  return null;
};

/** Only the resources with something in them. */
export const nonZero = (amounts: Partial<TradeAmounts>): Partial<TradeAmounts> => {
  const out: Partial<Record<TradeKey, number>> = {};
  for (const key of TRADE_KEYS) {
    const value = Math.floor(Number(amounts[key] ?? 0));
    if (value > 0) out[key] = value;
  }
  return out;
};
