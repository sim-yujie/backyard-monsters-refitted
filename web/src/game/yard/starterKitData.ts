/**
 * What the Starter Kit picker shows (outposts WP9, issue #188). GENERATED — do not edit by hand.
 *
 * Source: `client/scripts/popup_prefab.as`, `GetBuildings` (:278-311): each
 * kit's building map and its price, less the Ultra Kit's Yard Planner, which
 * an outpost no longer builds (owner decision 2026-09-30; prices unchanged).
 * Regenerate with `node tools/gen-starter-kits.mjs` from `web/`.
 */

export interface StarterKitSummary {
  /** 1 Regular, 2 Mega, 3 Ultra: the id `POST /bm/yard/starterkit` takes. */
  readonly id: 1 | 2 | 3;
  readonly name: string;
  readonly resources: { readonly r1: number; readonly r2: number; readonly r3: number };
  readonly shiny: number;
  /** `ui/prefab-${id + 1}.v5.jpg` (`popup_prefab.as:23`). */
  readonly thumbnail: string;
  /** Buildings besides the core. */
  readonly buildingCount: number;
  /** `[type, level, count]`: what the kit builds, the core left out. */
  readonly contents: readonly (readonly [number, number, number])[];
}

export const STARTER_KIT_SUMMARIES: readonly StarterKitSummary[] = [
  {
    id: 1,
    name: "Regular Kit",
    resources: { r1: 12000000, r2: 12000000, r3: 6000000 },
    shiny: 420,
    thumbnail: "/assets/ui/prefab-2.v5.jpg",
    buildingCount: 112,
    contents: [[21, 5, 3], [20, 5, 3], [25, 1, 1], [15, 2, 1], [13, 2, 2], [5, 2, 1], [22, 1, 1], [1, 8, 2], [2, 8, 2], [17, 2, 24], [3, 8, 2], [4, 8, 2], [17, 3, 68]],
  },
  {
    id: 2,
    name: "Mega Kit",
    resources: { r1: 50000000, r2: 50000000, r3: 25000000 },
    shiny: 800,
    thumbnail: "/assets/ui/prefab-3.v5.jpg",
    buildingCount: 147,
    contents: [[21, 6, 4], [20, 6, 4], [25, 1, 2], [23, 1, 2], [15, 3, 1], [13, 3, 2], [16, 1, 1], [5, 3, 1], [1, 8, 2], [2, 8, 2], [3, 8, 2], [4, 8, 2], [17, 4, 100], [24, 1, 20], [22, 1, 2]],
  },
  {
    id: 3,
    name: "Ultra Kit",
    resources: { r1: 200000000, r2: 200000000, r3: 100000000 },
    shiny: 1500,
    thumbnail: "/assets/ui/prefab-4.v5.jpg",
    buildingCount: 169,
    contents: [[17, 5, 100], [115, 5, 2], [117, 1, 5], [23, 3, 2], [118, 3, 1], [24, 1, 25], [15, 6, 1], [22, 3, 2], [25, 3, 2], [21, 8, 4], [20, 8, 4], [9, 1, 1], [13, 3, 2], [1, 8, 4], [2, 8, 4], [3, 8, 4], [4, 8, 4], [5, 4, 1], [16, 1, 1]],
  },
];
