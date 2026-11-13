import { GIFT_RESOURCES, type GiftResource } from "./giftRules.js";

/**
 * "Gift all" (owner, 13 Nov 2026: "make it easier to send gifts to multiple
 * people"), pure: which resource each friend gets and who is left out. The
 * database side and the gates are `controllers/friends/giftAll.ts`; each
 * gift is the same as one sent alone (`gift.ts`): the same amount, the same
 * one-a-day key, taken from the sender's main yard.
 *
 * - A friend with wishes gets their first wish the sender can still afford,
 *   counting what the earlier gifts in this batch already used; a friend
 *   with none gets the sender's pick (`fallback`).
 * - No resource they would take is affordable: they are skipped, and nothing
 *   is taken for them. A gift is never cut short.
 * - Friends are planned in the order given (pinned first, then by name), so
 *   when the store runs short it is the friends at the end who miss out.
 */

export type GiftAmounts = Record<GiftResource, number>;

/** One friend who can take a gift from the sender today. */
export interface GiftAllCandidate {
  readonly userid: number;
  readonly username: string;
  /** Their wishes, best first; empty for none. */
  readonly wishes: readonly GiftResource[];
  /** What one gift to them is worth (`giftAmountOf`). */
  readonly amount: number;
}

/** A gift the batch sends. */
export interface PlannedGift {
  readonly userid: number;
  readonly username: string;
  readonly resource: GiftResource;
  readonly amount: number;
  /** Which of their wishes it is, 1 to 3; 0 when they had none (the sender's pick). */
  readonly wish: number;
}

/**
 * Why a friend is left out: the store ran short, or (sending, a friend the
 * player confirmed) a gift to them already went today, or they cannot take
 * one any more (no longer a friend, blocked, banned).
 */
export type GiftAllSkipReason = "notEnough" | "giftSentToday" | "cannotSend";

/** A friend the batch leaves out. */
export interface SkippedGift {
  readonly userid: number;
  readonly username: string;
  readonly reason: GiftAllSkipReason;
  /** The resources they would have taken, best first, none of them affordable. */
  readonly lacking: readonly GiftResource[];
  readonly amount: number;
}

export interface GiftAllPlan {
  readonly gifts: PlannedGift[];
  readonly skipped: SkippedGift[];
  /** What the gifts take, per resource. */
  readonly cost: GiftAmounts;
}

export const noGiftAmounts = (): GiftAmounts => ({ r1: 0, r2: 0, r3: 0, r4: 0 });

/** The resource the sender holds most of (the first on a tie): the default pick for friends with no wish. */
export const mostHeld = (held: Readonly<GiftAmounts>): GiftResource =>
  GIFT_RESOURCES.reduce((best, key) => (held[key] > held[best] ? key : best), GIFT_RESOURCES[0]);

/**
 * Plans a "Gift all".
 *
 * @param candidates - The friends who can take a gift today, in the order to plan them.
 * @param held - What the sender's main yard holds.
 * @param fallback - The resource for friends with no wish.
 */
export const planGiftAll = (
  candidates: readonly GiftAllCandidate[],
  held: Readonly<GiftAmounts>,
  fallback: GiftResource
): GiftAllPlan => {
  const left = { ...held };
  const cost = noGiftAmounts();
  const gifts: PlannedGift[] = [];
  const skipped: SkippedGift[] = [];
  for (const friend of candidates) {
    const choices = friend.wishes.length > 0 ? friend.wishes : [fallback];
    const pick = choices.find((key) => left[key] >= friend.amount);
    if (pick === undefined) {
      skipped.push({ userid: friend.userid, username: friend.username, reason: "notEnough", lacking: [...choices], amount: friend.amount });
      continue;
    }
    left[pick] -= friend.amount;
    cost[pick] += friend.amount;
    gifts.push({
      userid: friend.userid,
      username: friend.username,
      resource: pick,
      amount: friend.amount,
      wish: friend.wishes.length > 0 ? friend.wishes.indexOf(pick) + 1 : 0,
    });
  }
  return { gifts, skipped, cost };
};
