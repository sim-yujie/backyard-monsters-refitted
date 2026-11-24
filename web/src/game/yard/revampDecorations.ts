import type { ArtAnim, ArtRow } from "./buildingArtData";
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
  // New decorations (owner, 24 Nov 2026; branch feat/new-decorations, not yet kept or priced by the owner).
  // Batch 1 (art/decor-new, `art-samples/decor-new`). The Cambodian flag is a Flash flag: Flash's pole and
  // shadow, its own cloth (printed on Flash's flag cloth, 21 cells) in the flags' folder.
  [207, "Cambodian Flag", "buildings/decorations/flags/", [
    [1, ["flagpole.png", -5, -43], null, null, ["shadow.jpg", -3, 5], null, null,
      [["flag-cambodia.png", 1, -35, 24, 30, 21]]],
  ], [100], 20],
  // The Fire Pit's flames are the Tiki Torch's Flash flame (three, out of step); the windmill's wheel turns.
  [208, "Fire Pit", "buildings/decorations/props/", [
    [1, ["fire-pit@2x.png", -20, 2], null, null, ["fire-pit-shadow.jpg", -16, 18], null, null,
      [["fire-pit-anim@2x.png", -14, -18, 25, 38, 25]]],
  ], [100], 40],
  [209, "Picnic Table", "buildings/decorations/props/", [
    [1, ["picnic-table@2x.png", -24, -5], null, null, ["picnic-table-shadow.jpg", -18, 19], null, null],
  ], [100], 40],
  [210, "Wishing Well", "buildings/decorations/props/", [
    [1, ["wishing-well@2x.png", -24, -30], null, null, ["wishing-well-shadow.jpg", -16, 12], null, null],
  ], [100], 40],
  [211, "Monster Egg Nest", "buildings/decorations/props/", [
    [1, ["egg-nest@2x.png", -17, -11], null, null, ["egg-nest-shadow.jpg", -13, 12], null, null],
  ], [100], 30],
  [212, "Goo Cauldron", "buildings/decorations/props/", [
    [1, ["goo-cauldron@2x.png", -18, -12], null, null, ["goo-cauldron-shadow.jpg", -14, 11], null, null],
  ], [100], 30],
  [213, "Garden Windmill", "buildings/decorations/props/", [
    [1, ["windpump@2x.png", -22, -40], null, null, ["windpump-shadow.jpg", -17, 9], null, null,
      [["windpump-anim@2x.png", -25, -43, 36, 47, 48]]],
  ], [100], 40],
  // Batch 2 (art/decor-wonders, `art-samples/decor-wonders`): nine wonders on the 70 spot of the Statue of
  // Liberty, Eiffel Tower and Big Ben, and ten plants.
  [214, "Rizal Monument", "buildings/decorations/wonders/", [
    [1, ["rizal-monument@2x.png", -49, -80], null, null, ["rizal-monument-shadow.jpg", -51, 7], null, null],
  ], [100], 70],
  [215, "Paoay Church", "buildings/decorations/wonders/", [
    [1, ["paoay-church@2x.png", -68, -43], null, null, ["paoay-church-shadow.jpg", -70, -3], null, null],
  ], [100], 70],
  [216, "Fort Santiago Gate", "buildings/decorations/wonders/", [
    [1, ["fort-santiago@2x.png", -68, -30], null, null, ["fort-santiago-shadow.jpg", -70, -3], null, null],
  ], [100], 70],
  [217, "Magellan's Cross", "buildings/decorations/wonders/", [
    [1, ["magellans-cross@2x.png", -64, -42], null, null, ["magellans-cross-shadow.jpg", -66, -1], null, null],
  ], [100], 70],
  [218, "Mayon Volcano", "buildings/decorations/wonders/", [
    [1, ["mayon-volcano@2x.png", -64, -39], null, null, ["mayon-volcano-shadow.jpg", -66, -1], null, null],
  ], [100], 70],
  [219, "Chocolate Hills", "buildings/decorations/wonders/", [
    [1, ["chocolate-hills@2x.png", -63, -12], null, null, ["chocolate-hills-shadow.jpg", -65, -1], null, null],
  ], [100], 70],
  [220, "Banaue Rice Terraces", "buildings/decorations/wonders/", [
    [1, ["banaue-terraces@2x.png", -63, -20], null, null, ["banaue-terraces-shadow.jpg", -65, -1], null, null],
  ], [100], 70],
  [221, "Taj Mahal", "buildings/decorations/wonders/", [
    [1, ["taj-mahal@2x.png", -52, -59], null, null, ["taj-mahal-shadow.jpg", -54, 5], null, null],
  ], [100], 70],
  [222, "Pyramid and Sphinx", "buildings/decorations/wonders/", [
    [1, ["pyramids@2x.png", -67, -37], null, null, ["pyramids-shadow.jpg", -69, -2], null, null],
  ], [100], 70],
  [223, "Mango Tree", "buildings/decorations/plants/", [
    [1, ["mango-tree@2x.png", -38, -48], null, null, ["mango-tree-shadow.jpg", -22, 7], null, null],
  ], [100], 40],
  [224, "Coconut Palm", "buildings/decorations/plants/", [
    [1, ["coconut-palm@2x.png", -40, -62], null, null, ["coconut-palm-shadow.jpg", -21, 3], null, null],
  ], [100], 40],
  [225, "Banana Plant", "buildings/decorations/plants/", [
    [1, ["banana-plant@2x.png", -34, -40], null, null, ["banana-plant-shadow.jpg", -18, 9], null, null],
  ], [100], 40],
  [226, "Bamboo Clump", "buildings/decorations/plants/", [
    [1, ["bamboo-clump@2x.png", -30, -48], null, null, ["bamboo-clump-shadow.jpg", -12, 7], null, null],
  ], [100], 40],
  [227, "Oak Tree", "buildings/decorations/plants/", [
    [1, ["oak-tree@2x.png", -40, -50], null, null, ["oak-tree-shadow.jpg", -26, 7], null, null],
  ], [100], 40],
  [228, "Kalamansi Tree", "buildings/decorations/plants/", [
    [1, ["kalamansi-tree@2x.png", -21, -30], null, null, ["kalamansi-tree-shadow.jpg", -8, 6], null, null],
  ], [100], 30],
  [229, "Hibiscus", "buildings/decorations/plants/", [
    [1, ["hibiscus-shrub@2x.png", -24, -12], null, null, ["hibiscus-shrub-shadow.jpg", -20, 17], null, null],
  ], [100], 40],
  [230, "Bougainvillea", "buildings/decorations/plants/", [
    [1, ["bougainvillea@2x.png", -26, -20], null, null, ["bougainvillea-shadow.jpg", -14, 15], null, null],
  ], [100], 40],
  [231, "Trimmed Hedge", "buildings/decorations/plants/", [
    [1, ["trimmed-hedge@2x.png", -29, 10], null, null, ["trimmed-hedge-shadow.jpg", -25, 23], null, null],
  ], [100], 40],
  [232, "Rose Bush", "buildings/decorations/plants/", [
    [1, ["rose-bush@2x.png", -24, -14], null, null, ["rose-bush-shadow.jpg", -19, 11], null, null],
  ], [100], 30],
];

/** One Modern look: its picture and shadow, for every level and state (a decoration has no damage). */
const modern = (top: TierImage, shadow: TierImage): readonly TierArt[] => {
  const still: TierState = { top, shadow };
  return [{ from: 1, top, shadow, lift: 0, damaged: still, destroyed: still }];
};

/**
 * A Modern still with a moving part on top (the flag's cloth, the fire pit's flames, the windmill's wheel): the
 * strip plays as a Flash decoration's `anim` layer does. Damaged or destroyed (never, for a decoration in a
 * yard) it shows the still alone, as Flash's flags and torch do.
 */
const moving = (top: TierImage, shadow: TierImage, strip: ArtAnim): readonly TierArt[] => {
  const still: TierState = { top, shadow };
  return [{ from: 1, top, shadow, lift: 0, anim: { strip }, damaged: still, destroyed: still }];
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
  202: modern(["apple-barrel.modern@2x.webp", -18, -22], ["apple-barrel.modern-shadow.jpg", -14, 9]),
  203: modern(["pie-stump.modern@2x.webp", -20, -14], ["pie-stump.modern-shadow.jpg", -18, 11]),
  204: modern(["harvest-wheelbarrow.modern@2x.webp", -27, -16], ["harvest-wheelbarrow.modern-shadow.jpg", -25, 16]),
  205: modern(["turkey-topiary.modern@2x.webp", -22, -24], ["turkey-topiary.modern-shadow.jpg", -9, 14]),
  206: modern(["autumn-maple.modern@2x.webp", -36, -50], ["autumn-maple.modern-shadow.jpg", -18, 7]),
  // New decorations (24 Nov 2026), batch 1. The Cambodian flag stands on the Modern flagpole every Flash flag
  // has (`decorationModernArt.ts`), under its own cloth and Flash's flag shadow, as those do.
  207: moving(["flagpole.modern@2x.webp", 0, -41], ["shadow.jpg", -3, 5], ["flag-cambodia.png", 1, -35, 24, 30, 21]),
  208: moving(["fire-pit.modern@2x.webp", -19, 2], ["fire-pit.modern-shadow.jpg", -15, 18],
    ["fire-pit-anim.modern@2x.webp", -14, -18, 25, 38, 25]),
  209: modern(["picnic-table.modern@2x.webp", -23, -5], ["picnic-table.modern-shadow.jpg", -17, 19]),
  210: modern(["wishing-well.modern@2x.webp", -24, -30], ["wishing-well.modern-shadow.jpg", -17, 12]),
  211: modern(["egg-nest.modern@2x.webp", -16, -11], ["egg-nest.modern-shadow.jpg", -13, 12]),
  212: modern(["goo-cauldron.modern@2x.webp", -18, -12], ["goo-cauldron.modern-shadow.jpg", -14, 11]),
  213: moving(["windpump.modern@2x.webp", -22, -40], ["windpump.modern-shadow.jpg", -17, 9],
    ["windpump-anim.modern@2x.webp", -25, -43, 36, 47, 48]),
  // Batch 2: the wonders and plants.
  214: modern(["rizal-monument.modern@2x.webp", -49, -81], ["rizal-monument.modern-shadow.jpg", -51, 7]),
  215: modern(["paoay-church.modern@2x.webp", -68, -43], ["paoay-church.modern-shadow.jpg", -70, -3]),
  216: modern(["fort-santiago.modern@2x.webp", -68, -31], ["fort-santiago.modern-shadow.jpg", -70, -3]),
  217: modern(["magellans-cross.modern@2x.webp", -64, -42], ["magellans-cross.modern-shadow.jpg", -66, -1]),
  218: modern(["mayon-volcano.modern@2x.webp", -64, -39], ["mayon-volcano.modern-shadow.jpg", -66, -1]),
  219: modern(["chocolate-hills.modern@2x.webp", -63, -12], ["chocolate-hills.modern-shadow.jpg", -65, -1]),
  220: modern(["banaue-terraces.modern@2x.webp", -63, -20], ["banaue-terraces.modern-shadow.jpg", -65, -1]),
  221: modern(["taj-mahal.modern@2x.webp", -52, -59], ["taj-mahal.modern-shadow.jpg", -54, 5]),
  222: modern(["pyramids.modern@2x.webp", -67, -37], ["pyramids.modern-shadow.jpg", -69, -2]),
  223: modern(["mango-tree.modern@2x.webp", -38, -48], ["mango-tree.modern-shadow.jpg", -22, 7]),
  224: modern(["coconut-palm.modern@2x.webp", -42, -62], ["coconut-palm.modern-shadow.jpg", -23, 3]),
  225: modern(["banana-plant.modern@2x.webp", -34, -40], ["banana-plant.modern-shadow.jpg", -20, 9]),
  226: modern(["bamboo-clump.modern@2x.webp", -34, -48], ["bamboo-clump.modern-shadow.jpg", -16, 7]),
  227: modern(["oak-tree.modern@2x.webp", -40, -50], ["oak-tree.modern-shadow.jpg", -24, 7]),
  228: modern(["kalamansi-tree.modern@2x.webp", -20, -30], ["kalamansi-tree.modern-shadow.jpg", -7, 6]),
  229: modern(["hibiscus-shrub.modern@2x.webp", -24, -12], ["hibiscus-shrub.modern-shadow.jpg", -19, 17]),
  230: modern(["bougainvillea.modern@2x.webp", -26, -20], ["bougainvillea.modern-shadow.jpg", -15, 15]),
  231: modern(["trimmed-hedge.modern@2x.webp", -28, 7], ["trimmed-hedge.modern-shadow.jpg", -25, 23]),
  232: modern(["rose-bush.modern@2x.webp", -23, -14], ["rose-bush.modern-shadow.jpg", -18, 11]),
};

const TYPES: ReadonlySet<number> = new Set(REVAMP_DECORATION_ROWS.map((row) => row[0]));

/** True for one of this project's own decorations. */
export const isRevampDecoration = (type: number): boolean => TYPES.has(type);
