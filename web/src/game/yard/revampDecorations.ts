import type { ArtRow } from "./buildingArtData";
import type { TierArt, TierImage, TierState } from "./buildingArtTiers";

/**
 * Decorations Flash never had: this project's own, from type 201 so they stay
 * clear of Flash's ids (owner, 10 Nov 2026: the six autumn decorations,
 * "merge into decoration shop when i release").
 *
 * Painted in the Flash decorations' style (Codex, branch art/autumn-decor,
 * `art-samples/autumn-decor/v2`), and made into game files by
 * `art-samples/autumn-decor/make_game_files.py`: each picture at exactly twice
 * its in-game size (`@2x`, so Pixi draws it at 1x and it stays sharp when the
 * yard is zoomed), a Flash-style shadow (a JPEG on white, drawn with a multiply
 * blend like every Flash shadow) and a Flash-style 120 x 160 build-menu button
 * (`/assets/buildingbuttons/<type>.jpg`). That is the Classic look; the Modern
 * look has its own pictures ({@link REVAMP_DECORATION_MODERN_ART}). Building
 * art has no Quality copies (only monster sheets and the map do), so there are
 * none here.
 *
 * Each row is in `buildingArtData.ts`'s shape, read beside the generated rows
 * by `buildingArt.ts`. The picture's bottom edge stands 3/4 of the footprint
 * below the origin, as Flash's decorations of the same size do (the Acorn and
 * Walnut at 21 for size 30, the Scarecrow and Lawn Chair at 29 to 30 for 40).
 *
 * The server's copy is `server/src/game-data/revampDecorations.ts`, whose test
 * keeps the types, names and sizes equal; the prices are in `decorShop.ts`.
 */
export const REVAMP_DECORATION_ROWS: readonly ArtRow[] = [
  [201, "Leaf Pile and Rake", "buildings/decorations/autumn/", [
    [1, ["leaf-pile-rake@2x.png", -23, -10], null, null, ["leaf-pile-rake-shadow.jpg", -20, 18], null, null],
  ], [100], 40],
  [202, "Apple Barrel", "buildings/decorations/autumn/", [
    [1, ["apple-barrel@2x.png", -19, -22], null, null, ["apple-barrel-shadow.jpg", -14, 9], null, null],
  ], [100], 30],
  [203, "Pie on a Tree Stump", "buildings/decorations/autumn/", [
    [1, ["pie-stump@2x.png", -21, -14], null, null, ["pie-stump-shadow.jpg", -18, 11], null, null],
  ], [100], 30],
  [204, "Harvest Barrow", "buildings/decorations/autumn/", [
    [1, ["harvest-wheelbarrow@2x.png", -26, -16], null, null, ["harvest-wheelbarrow-shadow.jpg", -25, 16], null, null],
  ], [100], 40],
  [205, "Turkey Topiary", "buildings/decorations/autumn/", [
    [1, ["turkey-topiary@2x.png", -24, -24], null, null, ["turkey-topiary-shadow.jpg", -10, 14], null, null],
  ], [100], 40],
  [206, "Autumn Maple Tree", "buildings/decorations/autumn/", [
    [1, ["autumn-maple@2x.png", -37, -50], null, null, ["autumn-maple-shadow.jpg", -17, 7], null, null],
  ], [100], 40],
];

/** One Modern look: its picture and shadow, for every level and state (a decoration has no damage). */
const modern = (top: TierImage, shadow: TierImage): readonly TierArt[] => {
  const still: TierState = { top, shadow };
  return [{ from: 1, top, shadow, lift: 0, damaged: still, destroyed: still }];
};

/**
 * The same six in the Modern look (owner, 10 Nov 2026: "generate assets for
 * the modern look ... that match the look and feel of the buildings"): the
 * same objects redrawn by Codex as clean 3D renders like the Modern buildings
 * (branch art/autumn-decor-modern, `art-samples/autumn-decor/modern`), made
 * into game files by the game-art skill's `make_game_files.py` at the Classic
 * pictures' heights, so each stands on the same spot. Read by `tierArtFor`
 * (`buildingArtTiers.ts`) like a 3D building's look: with the Modern look the
 * yard draws these, with Classic the rows above; the build menu's Modern
 * picture is made from them by `web/tools/build-pictures/make.py`.
 */
export const REVAMP_DECORATION_MODERN_ART: Readonly<Record<number, readonly TierArt[]>> = {
  201: modern(["leaf-pile-rake.modern@2x.webp", -22, -10], ["leaf-pile-rake.modern-shadow.jpg", -20, 18]),
  202: modern(["apple-barrel.modern@2x.webp", -18, -22], ["apple-barrel.modern-shadow.jpg", -15, 8]),
  203: modern(["pie-stump.modern@2x.webp", -20, -14], ["pie-stump.modern-shadow.jpg", -18, 10]),
  204: modern(["harvest-wheelbarrow.modern@2x.webp", -27, -16], ["harvest-wheelbarrow.modern-shadow.jpg", -26, 16]),
  205: modern(["turkey-topiary.modern@2x.webp", -22, -24], ["turkey-topiary.modern-shadow.jpg", -10, 13]),
  206: modern(["autumn-maple.modern@2x.webp", -36, -50], ["autumn-maple.modern-shadow.jpg", -18, 6]),
};

const TYPES: ReadonlySet<number> = new Set(REVAMP_DECORATION_ROWS.map((row) => row[0]));

/** True for one of this project's own decorations. */
export const isRevampDecoration = (type: number): boolean => TYPES.has(type);
