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
 */
export type EventReward =
  | { readonly kind: "resources"; readonly amounts: Readonly<Partial<ResourceAmounts>> }
  | { readonly kind: "shiny"; readonly amount: number }
  | { readonly kind: "shopItem"; readonly item: TimedRewardItem }
  | { readonly kind: "speedup"; readonly item: FreeSpeedupItem; readonly count: number }
  | { readonly kind: "decoration"; readonly type: number; readonly count: number }
  | { readonly kind: "krallen" };

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
