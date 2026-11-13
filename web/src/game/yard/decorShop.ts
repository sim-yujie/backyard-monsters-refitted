/**
 * The decorations bought with EVENT COINS (owner decision 2026-11-04,
 * changed to coins 6 Nov 2026, beta 7 grill item 29: Flash's Shiny price, as
 * coins; `game/eventCoins.ts`;
 * `docs/design/yard-buildings.md` §8.3): Flash's Decorations tab, in its order
 * (the Evil, Plants, Good, Flags and Premium sub-tabs one after the other,
 * each by its `order`), at Flash's price.
 *
 * A display copy of `server/src/game-data/store/decorationsForSale.ts`, whose
 * test keeps the two equal; `decor/buy` always charges the server's own price.
 * Flash's `block`ed decorations (the event and reward ones) and the store rows
 * priced 0 are not sold; one of those still shows while it is in storage.
 *
 * This project's own decorations (`revampDecorations.ts`; owner, 10 Nov 2026:
 * the six autumn ones, 25 to 75 coins) come first in their sub-tab, cheapest
 * first, so a player meets them on its first page.
 */
export const DECORATIONS_FOR_SALE: readonly (readonly [type: number, price: number])[] = [
  // Evil
  [107, 20], [74, 10], [75, 15], [76, 15], [77, 15], [78, 15], [79, 15], [81, 15], [82, 15],
  [83, 15], [84, 15], [85, 15], [80, 25], [73, 50],
  // Plants: the autumn Leaf Pile and Rake, Turkey Topiary and Autumn Maple Tree first
  [201, 25], [205, 60], [206, 75],
  [55, 5], [66, 5], [72, 5], [91, 10], [92, 10], [94, 10], [95, 10], [93, 15], [56, 20], [90, 10],
  [86, 25], [88, 25], [89, 25], [87, 50],
  // Good: the autumn Apple Barrel, Pie on a Tree Stump and Harvest Barrow first
  [202, 30], [203, 35], [204, 50],
  [57, 20], [65, 20], [63, 20], [64, 20], [71, 25], [108, 25], [109, 50], [61, 25], [62, 25],
  [60, 35], [102, 200], [103, 200], [68, 250], [104, 250], [105, 250], [106, 250],
  // Flags
  [49, 125], [50, 125], [28, 150], [29, 150], [30, 150], [31, 150], [33, 150], [34, 150],
  [35, 150], [36, 150], [37, 150], [38, 150], [39, 150], [40, 150], [41, 150], [42, 150],
  [43, 150], [44, 150], [45, 150], [46, 150], [47, 150], [48, 150], [32, 150],
  // Premium
  [96, 225], [97, 250], [98, 250], [99, 500], [100, 500], [101, 500],
];

const PRICES: ReadonlyMap<number, number> = new Map(DECORATIONS_FOR_SALE);

/** The price (in event coins since beta 7, Flash's Shiny price) a decoration of `type` costs, or null when it is not sold. */
export const decorationPrice = (type: number): number | null => PRICES.get(type) ?? null;

/** Flash's five Decorations sub-tabs, in its order (`BUILDINGSPOPUP.as:104-105`). */
export const DecorKind = {
  EVIL: "evil",
  PLANTS: "plants",
  GOOD: "good",
  FLAGS: "flags",
  PREMIUM: "premium",
} as const;
export type DecorKind = (typeof DecorKind)[keyof typeof DecorKind];

export interface DecorKindDefinition {
  readonly id: DecorKind;
  /** One word, as Flash's button (`btn_evil` and so on). */
  readonly label: string;
  /**
   * Every decoration type in it, by Flash's `order`: its `subgroup` in
   * `client/scripts/YARD_PROPS.as`. The `block`ed ones (not sold) are here
   * too, so one in storage shows in its own sub-tab.
   */
  readonly types: readonly number[];
}

/**
 * Which sub-tab each decoration is under in Flash: every one of the 84
 * decoration types (`isDecoration`) has a `subgroup`, 0 to 4. This project's
 * own go under Plants and Good.
 */
/**
 * The sub-tab whose first tiles are this project's own seasonal decorations
 * (now the autumn ones: Leaf Pile and Rake, Turkey Topiary, Autumn Maple
 * Tree). An announcement's "Shop" opens here, so a Glimmers gift leads to
 * what the current event is about; the top bar's Glimmers keeps Flash's Evil.
 * Change it when a new season's decorations lead another sub-tab.
 */
export const SEASONAL_DECOR_KIND: DecorKind = DecorKind.PLANTS;

export const DECOR_KINDS: readonly DecorKindDefinition[] = [
  { id: DecorKind.EVIL, label: "Evil", types: [107, 74, 75, 76, 77, 78, 79, 81, 82, 83, 84, 85, 80, 73] },
  {
    id: DecorKind.PLANTS,
    label: "Plants",
    // Blocked: 67 Rock, 59 Childrens Jax, 69 Scarecrow. This project's autumn ones first.
    types: [201, 205, 206, 55, 66, 72, 67, 59, 91, 92, 94, 95, 93, 56, 69, 90, 86, 88, 89, 87],
  },
  {
    id: DecorKind.GOOD,
    label: "Good",
    // Blocked: 70 Sun Dial, 58 Camping Tent. This project's autumn ones first.
    types: [202, 203, 204, 70, 57, 58, 65, 63, 64, 71, 108, 109, 61, 62, 60, 102, 103, 68, 104, 105, 106],
  },
  {
    id: DecorKind.FLAGS,
    label: "Flags",
    types: [49, 50, 28, 29, 30, 31, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 32],
  },
  {
    id: DecorKind.PREMIUM,
    label: "Premium",
    // Blocked: 120 Big Gulp, 121 and 131 the totems, 110 and 111 the pumpkins, 135 the trophy.
    types: [120, 96, 97, 121, 98, 131, 99, 100, 101, 110, 135, 111],
  },
];

const KIND_OF: ReadonlyMap<number, DecorKind> = new Map(
  DECOR_KINDS.flatMap((kind) => kind.types.map((type): [number, DecorKind] => [type, kind.id])),
);

const FLASH_ORDER: ReadonlyMap<number, number> = new Map(
  DECOR_KINDS.flatMap((kind) => kind.types).map((type, index): [number, number] => [type, index]),
);

/** The sub-tab a decoration of `type` is under, or null when it is not a decoration. */
export const decorKindOf = (type: number): DecorKind | null => KIND_OF.get(type) ?? null;

/** Where `type` comes in Flash's tab: sub-tab by sub-tab, each by its `order`. */
export const decorOrder = (type: number): number => FLASH_ORDER.get(type) ?? Number.MAX_SAFE_INTEGER;
