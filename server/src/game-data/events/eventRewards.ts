import type { ResourceAmounts } from "../../services/yardplanner/costs.js";

/**
 * What an event can hand a player (`services/events/grant.ts` pays it). Every
 * kind lands on the player's main yard, server-side:
 *
 * - `resources`: Twigs `r1`, Pebbles `r2`, Putty `r3`, Goo `r4`, clamped to
 *   the storage cap like every other credit (`services/yard/credit.ts`).
 * - `shiny`: added to the main yard's Shiny (`save.credits`).
 * - `shopItem`: a timed General Store buff (`TIMED_REWARD_ITEMS`), switched
 *   on now, or lengthened by its full duration when it is already running.
 * - `speedup`: free building speed-ups kept in the yard
 *   (`storedata[FREE_SPEEDUP_KEYS[item]].q`); the speed-up route spends one
 *   instead of Shiny (`controllers/yard/speedup.ts`).
 * - `decoration`: decorations put in the yard's storage
 *   (`researchdata["b<type>"]`, `services/yard/decor.ts`), placed from the
 *   decorations drawer. Only real decorations (`isDecoration`) are allowed:
 *   the Halloween props 53 and 54 are immovable and cannot be placed.
 * - `krallen`: the champion Krallen (type 5) in the `champion` list: level 1
 *   for a player without one, one level more for a player who has one, up
 *   to {@link KRALLEN_MAX_LEVEL}, and nothing more at the top. She is kept
 *   for good. This is the only way a Krallen is made or raised.
 * - `korath`: one of Korath's powers, `power` 1 Burn, 2 Breath of Fire, 3
 *   Fists of Doom (Monster Madness, `monsterMadness.ts`). It sets his power
 *   level to at least `power`, never lower, and is kept in the yard's
 *   `rewards` so a Korath raised later hatches with it
 *   (`services/events/korathPower.ts`).
 * - `eventCoins`: event coins (`services/events/eventCoins.ts`), the
 *   currency the decorations shop takes. They live in `bym.event_coins`,
 *   not in the yard, and never expire. Only big events pay them, through
 *   their `coins` field ({@link BIG_EVENT_COINS}); nobody writes these by
 *   hand in a calendar or a ladder.
 */
export type EventReward =
  | { readonly kind: "resources"; readonly amounts: Readonly<Partial<ResourceAmounts>> }
  | { readonly kind: "shiny"; readonly amount: number }
  | { readonly kind: "shopItem"; readonly item: TimedRewardItem }
  | { readonly kind: "speedup"; readonly item: FreeSpeedupItem; readonly count: number }
  | { readonly kind: "decoration"; readonly type: number; readonly count: number }
  | { readonly kind: "krallen" }
  | { readonly kind: "korath"; readonly power: number }
  | { readonly kind: "eventCoins"; readonly amount: number };

/**
 * What a big event pays in event coins, on top of its own rewards: each day
 * of its login calendar pays `perCalendarDay`, and each tier of its ladder
 * pays the matching entry of `milestones` (lowest tier first, one entry per
 * tier). Put on an event as its `coins` field (`events.ts`).
 */
export interface EventCoins {
  readonly perCalendarDay: number;
  readonly milestones: readonly number[];
}

/**
 * ═══════════════════════════════════════════════════════════════════════
 * EVENT COIN NUMBERS: the one place to change them.
 *
 * Owner, 8 Nov 2026: event coins come only from the big 1-2 week events
 * (Halloween, Thanksgiving and the like), never from weekend events. A big
 * event pays them by carrying `coins: BIG_EVENT_COINS` in `events.ts`.
 *
 * A full 14-day event with a four-tier ladder pays 400 (the owner's target):
 * 15 a calendar day (15 x 14 = 210) plus 20 + 35 + 55 + 80 = 190 over its
 * ladder's four tiers.
 * ═══════════════════════════════════════════════════════════════════════
 */
export const BIG_EVENT_COINS: EventCoins = {
  perCalendarDay: 15,
  milestones: [20, 35, 55, 80],
};

/** {@link BIG_EVENT_COINS}' per-day coins, and its ladder's coins in all (190). */
export const EVENT_COINS_PER_CALENDAR_DAY = BIG_EVENT_COINS.perCalendarDay;
export const EVENT_COINS_LADDER_TOTAL = BIG_EVENT_COINS.milestones.reduce((sum, coins) => sum + coins, 0);

/** The coin reward for `amount`, or none for 0. */
export const coinRewards = (amount: number | undefined): EventReward[] =>
  amount && amount > 0 ? [{ kind: "eventCoins", amount }] : [];

/** Krallen's champion type, and the highest level an event raises her to (her catalogue's `levels`). */
export const KRALLEN_TYPE = 5;
export const KRALLEN_MAX_LEVEL = 5;

/** Timed store buffs an event may give (`game-data/store/storeItems.ts`). */
export const TIMED_REWARD_ITEMS = ["BST", "POD", "EXH"] as const;
export type TimedRewardItem = (typeof TIMED_REWARD_ITEMS)[number];

/** The speed-ups that can be kept for later: an hour off, two hours off. */
export const FREE_SPEEDUP_ITEMS = ["SP2", "SP3"] as const;
export type FreeSpeedupItem = (typeof FREE_SPEEDUP_ITEMS)[number];

/**
 * Where a yard keeps its free speed-ups, `storedata[key].q`. Not `SP2`/`SP3`
 * themselves: the Flash client counted every bought speed-up there
 * (`client/scripts/STORE.as:2169-2182`), so old saves carry those keys and
 * reading them as free ones would hand out speed-ups nobody earned.
 */
export const FREE_SPEEDUP_KEYS: Readonly<Record<FreeSpeedupItem, string>> = {
  SP2: "FREESP2",
  SP3: "FREESP3",
};
