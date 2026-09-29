import type { StoreData } from "@/api/types";
import { overdriveBlocked, runningUnlock, type LockerContext } from "@/game/monsters/lockerModel";
import type { YardKind } from "./buildingCostData";
import { damagedAt, repairNowPrice } from "./repair";
import type { YardStoreReader } from "./YardStore";

/**
 * The Shop (`docs/design/yard-buildings.md` §8.2, decision D15): what the
 * General Store sells for Shiny, and what each item says and costs right now.
 *
 * Prices and durations are display copies of the store table
 * (`server/src/game-data/store/storeItems.ts`); `shop/buy` always charges
 * its own. The one exception is Repair everything now (`FIX`), which is not a
 * store row but the `repair/instant` route, priced from the damage
 * (`repair.ts` `repairNowPrice`).
 *
 * Pure: {@link shopModel} reads a store and returns rows; the screen
 * (`ui/yard/ShopScreen.ts`) draws them.
 */

/** The General Store, whose panel opens the Shop (`client/scripts/YARD_PROPS.as:1181`). */
export const GENERAL_STORE_TYPE = 12;

/** The Shop's headings, in the order it shows them. */
export const ShopSection = {
  BUILDING: "building",
  STORAGE: "storage",
  MONSTERS: "monsters",
} as const;
export type ShopSection = (typeof ShopSection)[keyof typeof ShopSection];

export const SHOP_SECTION_TITLES: Readonly<Record<ShopSection, string>> = {
  building: "Building",
  storage: "Storage and production",
  monsters: "Monsters",
};

/** One item the Shop sells through `shop/buy`. */
export interface ShopItem {
  /** The store code `shop/buy` takes. */
  readonly item: string;
  readonly name: string;
  /** What it does, in a sentence. */
  readonly blurb: string;
  readonly section: ShopSection;
  /** The price of each step, cheapest first; one entry for an item bought once at a time. */
  readonly prices: readonly number[];
  /** How long a timed item runs, seconds; 0 for one that is kept. */
  readonly seconds: number;
  /** Sold in an outpost too (`client/scripts/STORE.as:198-199`). */
  readonly outposts: boolean;
}

const HOUR = 3_600;
const DAY = 24 * HOUR;

/**
 * Everything the Shop sells, in the order it lists them. `shop/buy`'s
 * allowlist (`server/src/controllers/yard/shopBuy.ts` `SHOP_ITEMS`) is the
 * authority; this is its display copy.
 */
export const SHOP_ITEMS: readonly ShopItem[] = [
  {
    item: "BEW",
    name: "Extra Worker",
    blurb: "One more worker, so one more building can go up or be upgraded at the same time.",
    section: ShopSection.BUILDING,
    prices: [250, 500, 1_000, 2_000],
    seconds: 0,
    outposts: false,
  },
  {
    item: "BST",
    name: "Sharper Tools",
    blurb: "Builds and upgrades started in the next 7 days take 20% less time.",
    section: ShopSection.BUILDING,
    prices: [225],
    seconds: 7 * DAY,
    outposts: true,
  },
  {
    item: "BIP",
    name: "Improved Packing",
    blurb: "Every resource holds 10% more.",
    section: ShopSection.STORAGE,
    prices: [50, 100, 150, 200, 250, 300, 350, 400, 450, 500],
    seconds: 0,
    outposts: false,
  },
  {
    item: "ENL",
    name: "More Yardage",
    blurb: "Your yard grows 10% each way, making room for more.",
    section: ShopSection.STORAGE,
    prices: [50, 100, 150, 200, 250, 300],
    seconds: 0,
    outposts: false,
  },
  {
    item: "POD",
    name: "Production Overdrive",
    blurb: "Harvesters produce twice as fast for 12 hours.",
    section: ShopSection.STORAGE,
    prices: [200],
    seconds: 12 * HOUR,
    outposts: true,
  },
  {
    item: "CLOD",
    name: "Locker Overdrive",
    blurb: "The monster unlocking now unlocks five times as fast for 4 hours.",
    section: ShopSection.MONSTERS,
    prices: [60],
    seconds: 4 * HOUR,
    outposts: false,
  },
  {
    item: "HOD",
    name: "Hatchery Overdrive 4x",
    blurb: "Hatcheries work four times as fast for an hour.",
    section: ShopSection.MONSTERS,
    prices: [30],
    seconds: HOUR,
    outposts: true,
  },
  {
    item: "HOD2",
    name: "Hatchery Overdrive 6x",
    blurb: "Hatcheries work six times as fast for an hour.",
    section: ShopSection.MONSTERS,
    prices: [50],
    seconds: HOUR,
    outposts: true,
  },
  {
    item: "HOD3",
    name: "Hatchery Overdrive 10x",
    blurb: "Hatcheries work ten times as fast for an hour.",
    section: ShopSection.MONSTERS,
    prices: [100],
    seconds: HOUR,
    outposts: true,
  },
  {
    item: "EXH",
    name: "Housing Expansion",
    blurb: "Monster Housing holds 25% more for 24 hours.",
    section: ShopSection.MONSTERS,
    prices: [375],
    seconds: DAY,
    outposts: true,
  },
];

/** The Hatchery Overdrives: one of the three at a time (§4.4). */
const HATCHERY_OVERDRIVES: readonly string[] = ["HOD", "HOD2", "HOD3"];

/** What a row offers now. */
export type ShopOfferState =
  /** On sale; `blocked` says why it cannot be bought now. */
  | { readonly kind: "buy"; readonly price: number; readonly blocked: string | null }
  /** A timed item that is running; it can be bought again once it ends. */
  | { readonly kind: "running"; readonly endsAt: number }
  /** Every step is bought. */
  | { readonly kind: "soldOut" };

/** One row of the Shop. */
export interface ShopOffer {
  readonly item: ShopItem;
  /** Steps bought, for an item with more than one price; null otherwise. */
  readonly owned: number | null;
  readonly state: ShopOfferState;
}

/** Repair everything now (`FIX`): offered only while something is damaged. */
export interface RepairAllOffer {
  /** How many buildings it heals. */
  readonly count: number;
  readonly price: number;
  readonly blocked: string | null;
}

/** Everything the Shop shows. */
export interface ShopModel {
  readonly offers: readonly ShopOffer[];
  /** Null when nothing is damaged. */
  readonly repair: RepairAllOffer | null;
}

export const NOT_ENOUGH_SHINY = "Not enough Shiny.";

const finite = (raw: unknown): number | null => {
  if (raw === undefined || raw === null || raw === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
};

/** Steps bought: `storedata[item].q`, whole and non-negative. */
const ownedOf = (storedata: StoreData | null | undefined, item: string): number => {
  const q = finite(storedata?.[item]?.q);
  return q !== null && q > 0 ? Math.floor(q) : 0;
};

/** When a timed item runs out, or null when it is not running. */
const runningUntil = (
  storedata: StoreData | null | undefined,
  item: string,
  now: number,
): number | null => {
  const ends = finite(storedata?.[item]?.e);
  return ends !== null && ends > now ? ends : null;
};

/** The items a yard of `kind` sells. */
export const shopItemsFor = (kind: YardKind): readonly ShopItem[] =>
  kind === "outpost" ? SHOP_ITEMS.filter((one) => one.outposts) : SHOP_ITEMS;

/** Why an item on sale cannot be bought now, or null. */
const blockedReason = (item: ShopItem, price: number, reader: YardStoreReader, now: number): string | null => {
  if (item.item === "CLOD") {
    const context: LockerContext = reader;
    // The shop's `notUnlocking` (§4.3), said before the price.
    if (!runningUnlock(context)) return "Only while a monster is unlocking.";
    return overdriveBlocked(context);
  }
  if (HATCHERY_OVERDRIVES.includes(item.item)) {
    const running = HATCHERY_OVERDRIVES.some((other) => runningUntil(reader.save.storedata, other, now) !== null);
    if (running) return "Another Hatchery Overdrive is running.";
  }
  return reader.credits < price ? NOT_ENOUGH_SHINY : null;
};

/**
 * One row: the next step's price, or that it is running or sold out, and why
 * it cannot be bought now. A timed item climbs no steps: it is bought afresh
 * each time it runs out, as `shop/buy` prices it.
 */
export const shopOffer = (item: ShopItem, reader: YardStoreReader): ShopOffer => {
  const now = reader.now();
  const storedata = reader.save.storedata;

  if (item.seconds > 0) {
    const endsAt = runningUntil(storedata, item.item, now);
    if (endsAt !== null) return { item, owned: null, state: { kind: "running", endsAt } };
  }

  const owned = item.prices.length > 1 ? ownedOf(storedata, item.item) : null;
  const price = item.prices[owned ?? 0];
  if (price === undefined) return { item, owned, state: { kind: "soldOut" } };
  return { item, owned, state: { kind: "buy", price, blocked: blockedReason(item, price, reader, now) } };
};

/** Repair everything now, or null when nothing is damaged. */
export const repairAllOffer = (reader: YardStoreReader): RepairAllOffer | null => {
  const damaged = damagedAt(reader.save, reader.now());
  if (damaged.length === 0) return null;
  const price = repairNowPrice(damaged);
  return { count: damaged.length, price, blocked: reader.credits < price ? NOT_ENOUGH_SHINY : null };
};

/** The whole Shop for a yard as it stands now. */
export const shopModel = (reader: YardStoreReader): ShopModel => ({
  offers: shopItemsFor(reader.kind).map((item) => shopOffer(item, reader)),
  repair: repairAllOffer(reader),
});
