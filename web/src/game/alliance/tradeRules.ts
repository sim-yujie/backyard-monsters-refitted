import { TRADE_KEYS, type TradeAmounts, type TradeKey, type TradeRequest, type TradeStorage } from "@/api/allianceTrade";

/**
 * The trade sums the tab shows (design v5 §12a, §12b; a request is a 1:1
 * swap, owner 10 and 11 Nov 2026), the same as the server's
 * (`server/src/services/alliance/trade.ts`), which decides: 10% lost on the
 * way, up to 10% of the smaller storage cap leaves per resource; a Send loses
 * what has no room, a swap needs room on both sides.
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

/** The most the giver can send of one resource: the carry cap and what they hold. */
export const sendCap = (mine: TradeStorage, theirs: TradeStorage, key: TradeKey): number =>
  Math.min(carryCap(mine.cap, theirs.cap), Math.max(0, Math.floor(mine.held[key])));

/** What really lands of `sent`, and what is lost for want of room. */
export const landing = (sent: number, theirs: TradeStorage, key: TradeKey) => {
  const arrive = arriveFor(sent);
  const lands = Math.min(arrive, roomOf(theirs, key));
  return { arrive, lands, lost: arrive - lands };
};

/** The most that can leave so that all of it lands. */
export const fitToRoom = (theirs: TradeStorage, key: TradeKey): number => {
  const room = roomOf(theirs, key);
  // The largest sent whose arrival fits: sentFor(room + 1) - 1. No room, nothing.
  return room >= 1 ? sentFor(room + 1) - 1 : 0;
};

/** Why the caller cannot accept a request now; null when they can. */
export type AcceptBlock = "traded" | "mateTraded" | "short" | "overCap" | "full" | "mateFull";

/**
 * Whether the caller can accept a mate's request, as the server will check:
 * neither traded today, the caller holds the amount of what the asker wants,
 * it is within what one trade carries between the yards, and both have room
 * for what they receive (nothing is lost to a full silo in a swap).
 */
export const acceptBlock = (
  request: TradeRequest,
  mine: TradeStorage | null,
  today: { readonly sendsLeft: number; readonly receivesLeft: number },
): AcceptBlock | null => {
  if (today.sendsLeft <= 0 || today.receivesLeft <= 0) return "traded";
  if (!request.ready) return "mateTraded";
  if (!mine || mine.held[request.want] < request.amount) return "short";
  if (request.storage && request.amount > carryCap(mine.cap, request.storage.cap)) return "overCap";
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
