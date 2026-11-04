/**
 * The decorations bought with Shiny (owner decision 2026-11-04,
 * `docs/design/yard-buildings.md` §8.3): Flash's Decorations tab, in its order
 * (the Evil, Plants, Good, Flags and Premium sub-tabs one after the other,
 * each by its `order`), at Flash's price.
 *
 * A display copy of `server/src/game-data/store/decorationsForSale.ts`, whose
 * test keeps the two equal; `decor/buy` always charges the server's own price.
 * Flash's `block`ed decorations (the event and reward ones) and the store rows
 * priced 0 are not sold; one of those still shows while it is in storage.
 */
export const DECORATIONS_FOR_SALE: readonly (readonly [type: number, price: number])[] = [
  // Evil
  [107, 20], [74, 10], [75, 15], [76, 15], [77, 15], [78, 15], [79, 15], [81, 15], [82, 15],
  [83, 15], [84, 15], [85, 15], [80, 25], [73, 50],
  // Plants
  [55, 5], [66, 5], [72, 5], [91, 10], [92, 10], [94, 10], [95, 10], [93, 15], [56, 20], [90, 10],
  [86, 25], [88, 25], [89, 25], [87, 50],
  // Good
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

/** The Shiny a decoration of `type` costs, or null when it is not sold. */
export const decorationPrice = (type: number): number | null => PRICES.get(type) ?? null;
