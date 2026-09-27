import { storeItems } from "../../game-data/store/storeItems.js";
import { YardShopBuySchema } from "../../schemas/YardSchemas.js";
import { overdriveGate } from "../../services/yard/hatchery.js";
import { runningOrThrow } from "../../services/yard/locker.js";
import { storeItemPrice } from "../../services/yard/shiny.js";
import { yardBadRequestErr, yardRefusedErr } from "../../services/yard/yardErrors.js";
import type { JsonObject } from "../../types/JsonObject.js";
import { defineYardAction, type YardActionInput } from "./yardAction.js";

/**
 * `POST /bm/yard/shop/buy` — buy a General Store item for Shiny
 * (`docs/design/yard-buildings.md` §3.2, §8.2, decision D15).
 *
 * Only items on {@link SHOP_ITEMS} are sold; everything else is `400
 * notForSale`. The price is always the store table's
 * (`game-data/store/storeItems.ts`, through `storeItemPrice`), never the
 * client's. The purchase is written the way the original wrote it
 * (`client/scripts/STORE.as:2169-2182`): `storedata[item].q` goes up by one,
 * and an item with a duration gets `s = now`, `e = now + du`. The catch-up
 * removes it again once `e` passes.
 *
 * Refusals: `409 alreadyActive {endsAt}` for a timed item that is still
 * running; `409 soldOut {have, max}` once every price tier is bought
 * (`STORE.as:1974-1977`); then the wrapper's `409 shinyLocked` and `409
 * credits`.
 *
 * Later phases add items here (CLOD, HOD*, EXH, …, WP2.3, WP2.4, WP6.2), each
 * with its own `check` for rules beyond the generic ones.
 */

/** One sellable item's extra rules. */
export interface ShopItemRule {
  /** Refusals beyond "already active" and "sold out", thrown as yard errors. */
  check?: (input: YardActionInput<{ item: string }>) => void;
}

/**
 * The items the shop sells. Phase 1: `BEW` (extra worker, 250 / 500 / 1,000 /
 * 2,000, four at most; the worker count reads `storedata.BEW.q`,
 * `services/yardplanner/workers.ts`) and `BST` (Sharper Tools, 225, seven
 * days; upgrades started while it runs take 80% of the time).
 *
 * Phase 2: `CLOD` (Monster Locker Overdrive, 60, four hours; the running
 * unlock counts down 5x while it lasts, `services/yard/catchUpLocker.ts`),
 * sold only while an unlock runs (`409 notUnlocking`), §4.3. `HOD`, `HOD2`,
 * `HOD3` (Hatchery Overdrive 4x / 6x / 10x, 30 / 50 / 100, one hour; one at a
 * time, `409 alreadyActive` naming the running one) and `EXH` (Housing
 * Expansion, 375, 24 hours, housing counts 1.25x), §4.4, §4.5.
 */
export const SHOP_ITEMS: Readonly<Record<string, ShopItemRule>> = {
  BEW: {},
  BST: {},
  CLOD: { check: ({ save }) => void runningOrThrow(save) },
  HOD: { check: ({ save, now }) => overdriveGate(save.storedata, now) },
  HOD2: { check: ({ save, now }) => overdriveGate(save.storedata, now) },
  HOD3: { check: ({ save, now }) => overdriveGate(save.storedata, now) },
  EXH: {},
};

/** What the route sends back as `report`. */
export interface ShopBuyReport {
  item: string;
  /** Shiny charged. */
  credits: number;
  /** How many of the item the yard holds now (`storedata[item].q`). */
  q: number;
  /** When a timed item runs out (unix s); null for an item that does not expire. */
  endsAt: number | null;
}

/** A non-negative whole number off a jsonb field; anything else is 0. */
const count = (raw: unknown): number => {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
};

export const yardShopBuyAction = defineYardAction({
  schema: YardShopBuySchema,
  run: (input) => {
    const { save, body, now } = input;
    const { item } = body;

    const rule = Object.hasOwn(SHOP_ITEMS, item) ? SHOP_ITEMS[item] : undefined;
    const storeItem = Object.hasOwn(storeItems, item) ? storeItems[item] : undefined;
    if (!rule || !storeItem) {
      throw yardBadRequestErr("That item is not for sale.", { item }, "notForSale");
    }

    const entry: JsonObject = save.storedata?.[item] ?? {};
    const timed = storeItem.du > 0;

    if (timed && count(entry.e) > now) {
      throw yardRefusedErr("alreadyActive", "That is already running.", {
        item,
        endsAt: count(entry.e),
      });
    }

    rule.check?.(input);

    // A timed item is bought afresh each time it has run out (its entry is
    // removed on expiry, so the original priced it at `c[0]` too); an item
    // that does not expire climbs its price tiers.
    const owned = timed ? 0 : count(entry.q);
    const price = storeItemPrice(item, owned);
    if (price === undefined) {
      throw yardRefusedErr("soldOut", "You already have all of those.", {
        item,
        have: owned,
        max: storeItem.c.length,
      });
    }

    const q = owned + 1;
    const endsAt = timed ? now + storeItem.du : null;
    const next: JsonObject = timed ? { q, s: now, e: endsAt } : { ...entry, q };

    const report: ShopBuyReport = { item, credits: price, q, endsAt };
    return {
      report,
      slices: { storedata: { ...(save.storedata ?? {}), [item]: next } },
      shiny: price,
    };
  },
});
