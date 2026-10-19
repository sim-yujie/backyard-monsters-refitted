import type { ResourceKey } from "../base/economy/resourceBudget.js";
import { GIFT_RULES } from "./helpConfig.js";

/**
 * The gift rules (`docs/design/friends.md` §5 and §7, issue #375), pure: how
 * much a gift is worth, when it lapses and how many more a player can
 * collect today. Who may send one is the help gates (`helpRules.gateRefusal`);
 * the database side is `gifts.ts`.
 */

/** The four resources a gift can be: Twigs, Pebbles, Putty, Goo. */
export const GIFT_RESOURCES = ["r1", "r2", "r3", "r4"] as const satisfies readonly ResourceKey[];
export type GiftResource = (typeof GIFT_RESOURCES)[number];

const DAY = 24 * 60 * 60;

/**
 * One gift's amount (§5, §7 rule 3): 3% of the lower of the sender's and the
 * receiver's storage caps, rounded down. The sender's cap is how "scaled to
 * the sender's level" is measured; taking the lower one means a small fake
 * yard sends very little and a big player cannot flood a beginner.
 */
export const giftAmountOf = (senderCap: number, receiverCap: number): number =>
  Math.max(0, Math.floor(Math.min(senderCap, receiverCap) * GIFT_RULES.share));

/** When a gift sent at `now` lapses, unix seconds. */
export const giftExpiresAt = (now: number): number => now + GIFT_RULES.waitDays * DAY;

/** Gifts the player can still collect today, having collected `collectedToday`. */
export const collectsLeftOf = (collectedToday: number): number => Math.max(0, GIFT_RULES.collectsPerDay - collectedToday);
