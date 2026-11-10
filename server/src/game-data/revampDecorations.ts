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
];

const BY_TYPE: ReadonlyMap<number, RevampDecoration> = new Map(REVAMP_DECORATIONS.map((one) => [one.type, one]));

/** This project's own decoration of `type`, or undefined. */
export const revampDecoration = (type: number): RevampDecoration | undefined => BY_TYPE.get(type);
