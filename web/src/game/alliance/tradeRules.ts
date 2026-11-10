import { TRADE_KEYS, type TradeAmounts, type TradeKey, type TradeStorage } from "@/api/allianceTrade";

/**
 * The trade sums the sheets show (design v5 §12a, §12b; Give is 1:1, owner
 * 10 Nov 2026), the same as the
 * server's (`server/src/services/alliance/trade.ts`), which decides: 10% lost
 * on the way, up to 10% of the smaller storage cap leaves per resource, and
 * whatever has no room is lost.
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
 * "Most" on Ask (what a mate gives, 1:1): what one trade carries, and what
 * still fits the free room after the 10%.
 */
export const askCap = (storage: TradeStorage, key: TradeKey): number =>
  Math.min(carryCap(storage.cap, storage.cap), fitToRoom(storage, key));

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

/**
 * Whether the caller can fill a request 1:1 (owner, 10 Nov 2026: no part
 * gifts): per asked resource, what they hold and the carry cap between the
 * two yards. `short` / `overCap` list what stops it; both empty = can give.
 */
export const giveCheck = (
  asked: Partial<TradeAmounts>,
  mine: TradeStorage | null,
  theirs: TradeStorage | null,
): { short: TradeKey[]; overCap: TradeKey[] } => {
  const short: TradeKey[] = [];
  const overCap: TradeKey[] = [];
  for (const key of TRADE_KEYS) {
    const amount = asked[key] ?? 0;
    if (amount <= 0) continue;
    if (!mine || mine.held[key] < amount) short.push(key);
    if (mine && theirs && amount > carryCap(mine.cap, theirs.cap)) overCap.push(key);
  }
  return { short, overCap };
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
