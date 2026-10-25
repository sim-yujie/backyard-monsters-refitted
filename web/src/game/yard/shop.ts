import type { StoreData } from "@/api/types";
import { overdriveBlocked, runningUnlock, type LockerContext } from "@/game/monsters/lockerModel";
import type { YardKind } from "./buildingCostData";
import { townHallLevel } from "./buildingCosts";
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
 * (`repair.ts` `repairNowPrice`). The wall upgrades (`BLK2`..`BLK5`) are
 * priced from the yard's Blocks as the server prices them ({@link wallOffers}).
 *
 * The Inferno yard has its own store (WP 1.17, {@link INFERNO_SHOP_ITEMS}):
 * Flash's Inferno list (`client/scripts/STORE.as:210`) plus its workers,
 * bought into the Inferno's own `storedata`; Shiny is the player's one purse.
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
  BOOSTS: "boosts",
  PROTECTION: "protection",
} as const;
export type ShopSection = (typeof ShopSection)[keyof typeof ShopSection];

export const SHOP_SECTION_TITLES: Readonly<Record<ShopSection, string>> = {
  building: "Building",
  storage: "Storage and production",
  monsters: "Monsters",
  boosts: "Battle boosts",
  protection: "Protection",
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
  /**
   * Bought again while it runs, its time added on top (damage protection):
   * never "running", always on sale.
   */
  readonly stacks?: true;
  /**
   * Bought again while it runs, it starts its full time again from then
   * (the battle boosts): on sale while it runs, its time left beside the price.
   */
  readonly restarts?: true;
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
  // The battle boosts (beta.4): in battle from the moment they are bought
  // (`combat/rules/defence.ts` `storeBuffs`). Tower Overdrive is the yard's
  // own, so an outpost sells it too; the monster boosts are the main yard's,
  // and its monsters take them into every attack.
  {
    item: "TOD",
    name: "Tower Overdrive",
    blurb: "This yard's towers do 25% more damage for 24 hours.",
    section: ShopSection.BOOSTS,
    prices: [600],
    seconds: DAY,
    outposts: true,
    restarts: true,
  },
  {
    item: "MOD",
    name: "Monster Overdrive",
    blurb: "Your monsters do 25% more damage for 24 hours, in your attacks and at home.",
    section: ShopSection.BOOSTS,
    prices: [500],
    seconds: DAY,
    outposts: false,
    restarts: true,
  },
  {
    item: "MDOD",
    name: "Monster Defensive Buff",
    blurb: "Your monsters take 30% less damage for 24 hours, in your attacks and at home.",
    section: ShopSection.BOOSTS,
    prices: [500],
    seconds: DAY,
    outposts: false,
    restarts: true,
  },
  {
    item: "MSOD",
    name: "Monster Speed Buff",
    blurb: "Your monsters move and attack 50% faster for 24 hours, in your attacks and at home.",
    section: ShopSection.BOOSTS,
    prices: [500],
    seconds: DAY,
    outposts: false,
    restarts: true,
  },
  // Damage protection: added on top of whatever protection is left, main yard
  // only (owner decision 2026-09-29).
  {
    item: "PRO1",
    name: "24 Hours Protection",
    blurb: "Nobody can attack your yard for 24 more hours. Attacking anyone ends it.",
    section: ShopSection.PROTECTION,
    prices: [32],
    seconds: DAY,
    outposts: false,
    stacks: true,
  },
  {
    item: "PRO2",
    name: "Holiday Protection",
    blurb: "Nobody can attack your yard for 7 more days. Attacking anyone ends it.",
    section: ShopSection.PROTECTION,
    prices: [250],
    seconds: 7 * DAY,
    outposts: false,
    stacks: true,
  },
  {
    item: "PRO3",
    name: "Ultimate Protection",
    blurb: "Nobody can attack your yard for 28 more days. Attacking anyone ends it.",
    section: ShopSection.PROTECTION,
    prices: [1_100],
    seconds: 28 * DAY,
    outposts: false,
    stacks: true,
  },
];

/**
 * What the Inferno yard's store sells (WP 1.17, `shop/buy`'s
 * `INFERNO_SHOP_ITEMS`), in Flash's order (`STORE.as:210`): More Yardage and
 * the walls ({@link INFERNO_WALL_TIERS}), Improved Packing, the Inferno's three
 * Hatchery Overdrives, the protections, Housing Expansion and Tower
 * Overdrive. The Extra Worker is not Flash's here: owner decision I3, the
 * Inferno's own ladder at the surface's prices, five workers at most. The
 * Inferno's codes end in `I`; Improved Packing, the workers and protection
 * share the surface's codes, and land in the Inferno row all the same.
 */
export const INFERNO_SHOP_ITEMS: readonly ShopItem[] = [
  {
    item: "BEW",
    name: "Extra Worker",
    blurb:
      "One more Inferno worker, so one more building can go up or be upgraded at the same time.",
    section: ShopSection.BUILDING,
    prices: [250, 500, 1_000, 2_000],
    seconds: 0,
    outposts: false,
  },
  {
    item: "ENLI",
    name: "More Yardage",
    blurb: "Your Inferno yard grows 10% each way, making room for more.",
    section: ShopSection.STORAGE,
    prices: [50, 100, 150, 200, 250],
    seconds: 0,
    outposts: false,
  },
  {
    item: "BIP",
    name: "Improved Packing",
    blurb: "Every Inferno resource holds 10% more.",
    section: ShopSection.STORAGE,
    prices: [50, 100, 150, 200, 250, 300, 350, 400, 450, 500],
    seconds: 0,
    outposts: false,
  },
  {
    item: "HODI",
    name: "Hatchery Overdrive 4x",
    blurb: "Incubators work four times as fast for an hour.",
    section: ShopSection.MONSTERS,
    prices: [30],
    seconds: HOUR,
    outposts: false,
  },
  {
    item: "HOD2I",
    name: "Hatchery Overdrive 6x",
    blurb: "Incubators work six times as fast for an hour.",
    section: ShopSection.MONSTERS,
    prices: [50],
    seconds: HOUR,
    outposts: false,
  },
  {
    item: "HOD3I",
    name: "Hatchery Overdrive 10x",
    blurb: "Incubators work ten times as fast for an hour.",
    section: ShopSection.MONSTERS,
    prices: [100],
    seconds: HOUR,
    outposts: false,
  },
  {
    item: "EXHI",
    name: "Housing Expansion",
    blurb: "Compounds hold 25% more monsters for 24 hours.",
    section: ShopSection.MONSTERS,
    prices: [375],
    seconds: DAY,
    outposts: false,
  },
  {
    item: "TODI",
    name: "Tower Overdrive",
    blurb: "Your Inferno towers do 25% more damage for 24 hours.",
    section: ShopSection.BOOSTS,
    prices: [600],
    seconds: DAY,
    outposts: false,
    restarts: true,
  },
  {
    item: "PRO1",
    name: "24 Hours Protection",
    blurb: "Nobody can attack your Inferno yard for 24 more hours. Attacking anyone ends it.",
    section: ShopSection.PROTECTION,
    prices: [32],
    seconds: DAY,
    outposts: false,
    stacks: true,
  },
  {
    item: "PRO2",
    name: "Holiday Protection",
    blurb: "Nobody can attack your Inferno yard for 7 more days. Attacking anyone ends it.",
    section: ShopSection.PROTECTION,
    prices: [250],
    seconds: 7 * DAY,
    outposts: false,
    stacks: true,
  },
  {
    item: "PRO3",
    name: "Ultimate Protection",
    blurb: "Nobody can attack your Inferno yard for 28 more days. Attacking anyone ends it.",
    section: ShopSection.PROTECTION,
    prices: [1_100],
    seconds: 28 * DAY,
    outposts: false,
    stacks: true,
  },
];

/** An item shown as "coming later": this client does not model its effect yet (§8.2). */
export interface ComingLaterItem {
  /** The store codes it stands for. */
  readonly items: readonly string[];
  readonly name: string;
  readonly blurb: string;
}

/**
 * What the original sold that is held back until its effect is modelled
 * (§8.2). Listed, never sold: `shop/buy` refuses every one of them. The four
 * battle boosts and the wall upgrades were here until beta.4.
 */
export const COMING_LATER: readonly ComingLaterItem[] = [
  { items: ["BUILDING28"], name: "Shiny Decorations", blurb: "Decorations bought with Shiny." },
];

/** One wall upgrade: every Block below `tier` raised to it (`server/src/services/yard/wallBlocks.ts`). */
export interface WallTier {
  readonly item: string;
  readonly tier: number;
  readonly name: string;
  /** "stone", "metal", … for the lines on the card. */
  readonly material: string;
  /** The Town Hall level it needs in the main yard (`client/scripts/STORE.as:1674-1690`); outposts have no gate. */
  readonly townHall: number;
}

export const WALL_TIERS: readonly WallTier[] = [
  { item: "BLK2", tier: 2, name: "Stone Blocks", material: "stone", townHall: 3 },
  { item: "BLK3", tier: 3, name: "Metal Blocks", material: "metal", townHall: 4 },
  { item: "BLK4", tier: 4, name: "Gold Blocks", material: "gold", townHall: 5 },
  { item: "BLK5", tier: 5, name: "Black Diamond Blocks", material: "black diamond", townHall: 6 },
];

/**
 * The Inferno's two (`STORE.as:210`, `services/yard/wallBlocks.ts`): Flash's
 * Stone and Metal under Inferno names, the same Block, prices and rule, behind
 * the Under Hall (`townHall`) at 3 and 4.
 */
export const INFERNO_WALL_TIERS: readonly WallTier[] = [
  { item: "BLK2I", tier: 2, name: "Granite Blocks", material: "granite", townHall: 3 },
  {
    item: "BLK3I",
    tier: 3,
    name: "Forged Steel Blocks",
    material: "forged steel",
    townHall: 4,
  },
];

/** The wall upgrades a yard of `kind` sells. */
export const wallTiersFor = (kind: YardKind): readonly WallTier[] =>
  kind === "inferno" ? INFERNO_WALL_TIERS : WALL_TIERS;

/** Shiny per Block to climb into level `n` (index = n), as `shop/buy` charges it (`STORE.as:404-519`). */
export const WALL_STEP_SHINY: readonly number[] = [0, 0, 3, 6, 10, 15];

/** The Block, and the legacy Stone Block row the server reads as at least level 2. */
const WALL_TYPE = 17;
const LEGACY_WALL_TYPE = 18;

/** What a wall upgrade offers now. */
export type WallOfferState =
  | { readonly kind: "buy"; readonly price: number; readonly blocked: string | null }
  /** Every Block is at the tier or better. */
  | { readonly kind: "reached" }
  /** The yard has no Blocks. */
  | { readonly kind: "none" };

export interface WallOffer {
  readonly tier: WallTier;
  /** Blocks it would raise. */
  readonly blocks: number;
  readonly state: WallOfferState;
}

/** A Block's level for pricing: one still being built (level 0) is level 1, a legacy Stone row at least 2. */
const blockLevel = (type: number, level: number): number =>
  type === LEGACY_WALL_TYPE ? Math.max(2, level) : Math.max(1, level);

/** The Hatchery Overdrives: one of the three at a time (§4.4); the Inferno's are its own three. */
const HATCHERY_OVERDRIVES: readonly string[] = [
  "HOD",
  "HOD2",
  "HOD3",
  "HODI",
  "HOD2I",
  "HOD3I",
];

/** What a row offers now. */
export type ShopOfferState =
  /**
   * On sale; `blocked` says why it cannot be bought now. A restarting item
   * that is running says when it ends: buying it again starts it afresh.
   */
  | { readonly kind: "buy"; readonly price: number; readonly blocked: string | null; readonly endsAt?: number }
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
  /** The wall upgrades, Stone to Black Diamond. */
  readonly walls: readonly WallOffer[];
  /** Null when nothing is damaged. */
  readonly repair: RepairAllOffer | null;
  /** When the yard's damage protection ends (unix s), or null when it has none. */
  readonly protectedUntil: number | null;
}

export const NOT_ENOUGH_SHINY = "Not enough Shiny.";

/** The wall upgrades for the yard as it stands: price, Blocks raised, and why not. */
export const wallOffers = (reader: YardStoreReader): readonly WallOffer[] => {
  const levels = reader.yard.buildings
    .filter((one) => one.type === WALL_TYPE || one.type === LEGACY_WALL_TYPE)
    .map((one) => blockLevel(one.type, one.level));
  const hall = townHallLevel(reader.yard);
  const hallWord = reader.kind === "inferno" ? "Under Hall" : "Town Hall";
  return wallTiersFor(reader.kind).map((tier): WallOffer => {
    if (levels.length === 0) return { tier, blocks: 0, state: { kind: "none" } };
    let blocks = 0;
    let price = 0;
    for (const level of levels) {
      if (level >= tier.tier) continue;
      blocks++;
      for (let step = level + 1; step <= tier.tier; step++) price += WALL_STEP_SHINY[step] ?? 0;
    }
    if (blocks === 0) return { tier, blocks, state: { kind: "reached" } };
    const blocked =
      reader.kind !== "outpost" && hall < tier.townHall
        ? `Needs ${hallWord} level ${tier.townHall}.`
        : reader.credits < price
          ? NOT_ENOUGH_SHINY
          : null;
    return { tier, blocks, state: { kind: "buy", price, blocked } };
  });
};

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
  kind === "inferno"
    ? INFERNO_SHOP_ITEMS
    : kind === "outpost"
      ? SHOP_ITEMS.filter((one) => one.outposts)
      : SHOP_ITEMS;

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

  const endsAt = item.seconds > 0 && !item.stacks ? runningUntil(storedata, item.item, now) : null;
  if (endsAt !== null && !item.restarts) return { item, owned: null, state: { kind: "running", endsAt } };

  const owned = item.prices.length > 1 ? ownedOf(storedata, item.item) : null;
  const price = item.prices[owned ?? 0];
  if (price === undefined) return { item, owned, state: { kind: "soldOut" } };
  const blocked = blockedReason(item, price, reader, now);
  return { item, owned, state: { kind: "buy", price, blocked, ...(endsAt !== null && { endsAt }) } };
};

/** Repair everything now, or null when nothing is damaged. */
export const repairAllOffer = (reader: YardStoreReader): RepairAllOffer | null => {
  const damaged = damagedAt(reader.save, reader.now());
  if (damaged.length === 0) return null;
  const price = repairNowPrice(damaged);
  return { count: damaged.length, price, blocked: reader.credits < price ? NOT_ENOUGH_SHINY : null };
};

/** When the yard's damage protection ends, or null when it has none now. */
export const protectedUntil = (reader: YardStoreReader): number | null => {
  const until = finite(reader.save.protected);
  return until !== null && until > reader.now() ? until : null;
};

/** The whole Shop for a yard as it stands now. */
export const shopModel = (reader: YardStoreReader): ShopModel => ({
  offers: shopItemsFor(reader.kind).map((item) => shopOffer(item, reader)),
  walls: wallOffers(reader),
  repair: repairAllOffer(reader),
  protectedUntil: protectedUntil(reader),
});
