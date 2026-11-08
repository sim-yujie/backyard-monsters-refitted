import { shinyCostOfResources, RESOURCE_KEYS, type ResourceKey } from "../base/economy/resourceBudget.js";

/**
 * Buying resources with Shiny: the General Store's resource packs, as Flash
 * sold them (issue #393, beta 7; owner: "just follow Flash client").
 *
 * Flash's store had three offers per resource (`client/scripts/STORE.as:212-330`),
 * worked out from the yard's pool each time the store opened:
 *
 * - `BRn1`: 10% of the storage cap, offered while `held + 10% < cap`;
 * - `BRn2`: 50% of the storage cap, offered while `held + 50% < cap`;
 * - `BRn3`: fill to the cap, `cap - held`, offered while `held < cap`.
 *
 * `n` is the resource (1 Twigs, 2 Pebbles, 3 Putty, 4 Goo). Each is priced on
 * the one Shiny curve, `ceil((sqrt(amount / 2)) ^ 0.75)`
 * (`STORE.GetShinyCostFromTotalResources`, `:183-185`, here
 * `shinyCostOfResources`), and an offer with no room left costs 0 and cannot
 * be bought (`str_top_10pct_noroom`, `:1175`). Buying funds `ceil(amount)`
 * through `BASE.Fund`, clamped to the cap, and adds `ceil(amount × 0.3)`
 * empire points (`STORE.as:2029-2037`).
 *
 * The `…I` codes (`BR11I`..`BR43I`) are the same three offers for the Inferno's
 * Bone, Coal, Sulfur and Magma: sold in the Inferno yard, and in the main yard
 * once the Descent is passed, where they fund the Inferno purse (`STORE.as:200-211`).
 * Outposts sell the surface packs only, into the main yard's pool.
 *
 * Pure: the route (`controllers/yard/shopBuy.ts`) reads the pool and the cap
 * and charges; the web client keeps a display copy (`web/src/game/yard/resourcePacks.ts`).
 */

/** Which offer: 1 = 10% of the cap, 2 = 50% of the cap, 3 = fill to the cap. */
export type PackSize = 1 | 2 | 3;

/** One resource pack code read apart. */
export interface ResourcePack {
  readonly item: string;
  readonly resource: ResourceKey;
  readonly size: PackSize;
  /** An Inferno pack (`…I`): Bone, Coal, Sulfur or Magma. */
  readonly inferno: boolean;
}

const PACK_CODE = /^BR([1-4])([1-3])(I?)$/;

/** The share of the cap the two fixed offers hold (`STORE.as:215`, `:262`). */
export const PACK_SHARE: Readonly<Record<1 | 2, number>> = { 1: 0.1, 2: 0.5 };

/** Empire points per resource bought (`STORE.as:2031`, `:2035`). */
export const PACK_POINTS_RATE = 0.3;

/** `BR23` → Pebbles, 50%; `BR13I` → Bone, fill; anything else null. */
export const readPack = (item: string): ResourcePack | null => {
  const match = PACK_CODE.exec(item);
  if (!match) return null;
  return {
    item,
    resource: RESOURCE_KEYS[Number(match[1]) - 1]!,
    size: Number(match[2]) as PackSize,
    inferno: match[3] === "I",
  };
};

/** The pack code for one offer: `packCode("r2", 3, false)` → `BR23`. */
export const packCode = (resource: ResourceKey, size: PackSize, inferno: boolean): string =>
  `BR${RESOURCE_KEYS.indexOf(resource) + 1}${size}${inferno ? "I" : ""}`;

/** A finite non-negative number off anything; 0 otherwise. */
const numberOf = (raw: unknown): number => {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : 0;
};

/**
 * What the offer holds for a pool holding `held` under `cap`: the amount, 0
 * when there is no room for it (Flash's strict `<`, `STORE.as:228`, `:275`,
 * `:318`). The fixed offers are not cut down to fit: they are offered only
 * while they fit whole.
 */
export const packAmount = (size: PackSize, held: number, cap: number): number => {
  const have = numberOf(held);
  const room = numberOf(cap);
  if (size === 3) return room > have ? room - have : 0;
  const amount = room * PACK_SHARE[size];
  return have + amount < room ? amount : 0;
};

/** The Shiny for `amount` (`STORE.as:226`, `:273`, `:316`); 0 for nothing. */
export const packPrice = (amount: number): number => (amount > 0 ? shinyCostOfResources(amount) : 0);

/** The whole amount the pack funds (`BASE.Fund(..., Math.ceil(quantity))`, `STORE.as:2034`). */
export const packFunds = (amount: number): number => Math.ceil(numberOf(amount));

/** The empire points the pack adds (`Math.ceil(quantity × 0.3)`, `STORE.as:2035`). */
export const packPoints = (amount: number): number => Math.ceil(numberOf(amount) * PACK_POINTS_RATE);
