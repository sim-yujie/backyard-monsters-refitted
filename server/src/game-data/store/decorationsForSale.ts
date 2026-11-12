import { revampDecoration } from "../revampDecorations.js";
import { storeItems } from "./storeItems.js";

/**
 * The decorations bought with Shiny (`docs/design/yard-buildings.md` §8.3,
 * owner decision 2026-11-04: "the decos from flash client", bought using
 * Shiny).
 *
 * Exactly what Flash's Decorations tab sold: every `type: "decoration"` entry
 * of `client/scripts/YARD_PROPS.as` in the tab (`group` 4) that is not
 * `block`ed and has a `BUILDING<type>` store row (`BUILDINGSPOPUP.as:132`
 * lists an entry only when `!block || buildingStorageCount(id)`;
 * `BUILDINGBUTTON.as:59-65` prices it `STORE._storeItems["BUILDING" + id].c[0]`
 * Shiny). In the tab's order: Flash's five sub-tabs one after the other (Evil,
 * Plants, Good, Flags, Premium, `BUILDINGSPOPUP.as:104`), each by its `order`.
 *
 * Not sold, as in Flash, because their props entry is `block`ed (they came
 * from events, promotions or rewards and showed only while one was in
 * storage): 58 Camping Tent, 59 Childrens Jax, 67 Rock, 69 Scarecrow, 70 Sun
 * Dial, 110 and 111 the Halloween pumpkins, 120 Big Gulp, 121 and 131 the
 * Wild Monster totems, 135 the D.A.V.E. trophy. The store rows `BUILDING122`
 * to `BUILDING126` (price 0) have no props entry at all. Every type here has
 * a price above 0.
 *
 * No limit: Flash's decorations all have `quantity: [0]`, which
 * `BASE.CanBuild` reads as "no cap" for a decoration (`BASE.as:3720-3740`).
 *
 * Then this project's own decorations (`../revampDecorations.ts`, owner
 * 10 Nov 2026: the six autumn ones), first in their sub-tab so a player sees
 * them on its first page: 201, 205 and 206 under Plants, 202, 203 and 204
 * under Good, cheapest first. They have no store row; their price is their own.
 *
 * The web's display copy is `web/src/game/yard/decorShop.ts`
 * (`decorationsForSale.test.ts` keeps the two equal).
 */
export const DECORATIONS_FOR_SALE: readonly number[] = [
  // Evil (subgroup 0)
  107, 74, 75, 76, 77, 78, 79, 81, 82, 83, 84, 85, 80, 73,
  // Plants (subgroup 1), this project's autumn ones first
  201, 205, 206,
  55, 66, 72, 91, 92, 94, 95, 93, 56, 90, 86, 88, 89, 87,
  // Good (subgroup 2), this project's autumn ones first
  202, 203, 204,
  57, 65, 63, 64, 71, 108, 109, 61, 62, 60, 102, 103, 68, 104, 105, 106,
  // Flags (subgroup 3)
  49, 50, 28, 29, 30, 31, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 32,
  // Premium (subgroup 4)
  96, 97, 98, 99, 100, 101,
];

const FOR_SALE: ReadonlySet<number> = new Set(DECORATIONS_FOR_SALE);

/**
 * What a decoration of `type` costs (its store row's `c[0]`), or undefined
 * when it is not sold. Flash charged it in Shiny; since beta 7 it is charged
 * in event coins, the same number (owner, 6 Nov 2026). This project's own
 * decorations cost their own price, in event coins.
 */
export const decorationPrice = (type: number): number | undefined => {
  if (!FOR_SALE.has(type)) return undefined;
  const own = revampDecoration(type);
  if (own) return own.price;
  const item = storeItems[`BUILDING${type}`];
  const price = item?.c[0];
  return typeof price === "number" && price > 0 ? price : undefined;
};
