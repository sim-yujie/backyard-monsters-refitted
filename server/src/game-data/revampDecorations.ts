/**
 * Decorations Flash never had: this project's own, from type 201 so they stay
 * clear of Flash's ids (owner, 10 Nov 2026: the six autumn decorations,
 * "merge into decoration shop when i release"; prices from the review desk,
 * "25-75 Glimmers each").
 *
 * Each behaves exactly like a Flash decoration: a `decoration` row in the cost
 * table (free, uncapped, `web/tools/gen-building-costs.mjs`), a square
 * footprint, sold for event coins (Glimmers) in the Decorations tab
 * (`store/decorationsForSale.ts`), stored when recycled, never a target in a
 * battle (`game-rules/combat/yard.ts` reads any type it does not name as a
 * decoration). They have no `BUILDING<type>` store row, so the old Shiny
 * purchase path cannot sell them.
 *
 * The web's copy, with the art, is `web/src/game/yard/revampDecorations.ts`
 * (`revampDecorations.test.ts` keeps the two equal).
 */
export interface RevampDecoration {
  readonly type: number;
  /** As the shop shows it. */
  readonly name: string;
  /** Footprint in yard units, square, as a Flash decoration's `size`. */
  readonly size: number;
  /** Price in event coins (Glimmers). */
  readonly price: number;
}

export const REVAMP_DECORATIONS: readonly RevampDecoration[] = [
  { type: 201, name: "Leaf Pile and Rake", size: 40, price: 25 },
  { type: 202, name: "Apple Barrel", size: 30, price: 30 },
  { type: 203, name: "Pie on a Tree Stump", size: 30, price: 35 },
  { type: 204, name: "Harvest Barrow", size: 40, price: 50 },
  { type: 205, name: "Turkey Topiary", size: 40, price: 60 },
  { type: 206, name: "Autumn Maple Tree", size: 40, price: 75 },
  // New decorations (owner, 24 Nov 2026; branch feat/new-decorations). The owner still keeps or drops each one,
  // and these PRICES ARE PLACEHOLDERS until the owner's price card: change a price here (the one the server
  // charges) and in the web's display copy, `web/src/game/yard/decorShop.ts` (a test fails if they differ).
  // To drop one: remove its line here, its row in the web's `revampDecorations.ts`, its entries in both
  // shop lists (`store/decorationsForSale.ts`, `decorShop.ts`) and in `web/tools/gen-building-costs.mjs`.
  // Batch 1, Good (the flag under Flags at a flag's 150).
  { type: 207, name: "Cambodian Flag", size: 20, price: 150 },
  { type: 208, name: "Fire Pit", size: 40, price: 50 },
  { type: 209, name: "Picnic Table", size: 40, price: 40 },
  { type: 210, name: "Wishing Well", size: 40, price: 60 },
  { type: 211, name: "Monster Egg Nest", size: 30, price: 30 },
  { type: 212, name: "Goo Cauldron", size: 30, price: 35 },
  { type: 213, name: "Garden Windmill", size: 40, price: 75 },
  // Wonders, Premium, at the Statue of Liberty's 500.
  { type: 214, name: "Rizal Monument", size: 70, price: 500 },
  { type: 215, name: "Paoay Church", size: 70, price: 500 },
  { type: 216, name: "Fort Santiago Gate", size: 70, price: 500 },
  { type: 217, name: "Magellan's Cross", size: 70, price: 500 },
  { type: 218, name: "Mayon Volcano", size: 70, price: 500 },
  { type: 219, name: "Chocolate Hills", size: 70, price: 500 },
  { type: 220, name: "Banaue Rice Terraces", size: 70, price: 500 },
  { type: 221, name: "Taj Mahal", size: 70, price: 500 },
  { type: 222, name: "Pyramid and Sphinx", size: 70, price: 500 },
  // Plants, by size: small 25, shrubs 35-50, trees 60-75.
  { type: 223, name: "Mango Tree", size: 40, price: 70 },
  { type: 224, name: "Coconut Palm", size: 40, price: 75 },
  { type: 225, name: "Banana Plant", size: 40, price: 60 },
  { type: 226, name: "Bamboo Clump", size: 40, price: 60 },
  { type: 227, name: "Oak Tree", size: 40, price: 75 },
  { type: 228, name: "Kalamansi Tree", size: 30, price: 25 },
  { type: 229, name: "Hibiscus", size: 40, price: 35 },
  { type: 230, name: "Bougainvillea", size: 40, price: 50 },
  { type: 231, name: "Trimmed Hedge", size: 40, price: 40 },
  { type: 232, name: "Rose Bush", size: 30, price: 25 },
];

const BY_TYPE: ReadonlyMap<number, RevampDecoration> = new Map(REVAMP_DECORATIONS.map((one) => [one.type, one]));

/** This project's own decoration of `type`, or undefined. */
export const revampDecoration = (type: number): RevampDecoration | undefined => BY_TYPE.get(type);
