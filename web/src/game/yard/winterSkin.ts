import { artUrl } from "../../artUrl";
import { buildingArtCopy } from "./buildingArtCopies";
import { GROUNDS, type GroundSpec } from "./groundChoice";
import type { DressUpSet, DressPiece } from "./YardDressUp";

/**
 * The Christmas yard dress-up (owner, 27 Nov 2026: "FULL snow look"), on
 * while Christmas 2026 runs (`game/season.ts`, season `christmas`) and off
 * after. Each look keeps its own art (`game/classicLook.ts`):
 *
 * - **Ground**: a grass ground (Original, Meadow) turns to snow, as
 *   Halloween turned it dusky (`YardGround.ts`): the Modern look lays its
 *   painted Snow ground (`groundChoice.ts`), the Classic look
 *   {@link CLASSIC_SNOW}, snow tiles painted in the Flash grass tiles' style
 *   (Codex, `art-samples/christmas/snow`). A player who picked another ground
 *   (Rocky, Sand, Desert...) keeps it, as at Halloween; lava stays lava.
 * - **Props** round the plot's edge (`YardDressUp.ts`), sparse: snowmen
 *   and Christmas trees, the winter decorations' own pictures
 *   in the look in use, so a yard that already shows one of them fetches
 *   nothing more.
 * - **Falling snow** over the yard (`YardSnowfall.ts`), by the Quality setting.
 *
 * None of it is fetched outside the event: the pictures are asked for only
 * once the season is `christmas`.
 */

/**
 * The Classic look's snow: four 400 x 200 tiles painted in the style of
 * Flash's grass tiles, blended as Flash blends its grass (`MAPBG.MakeTile`),
 * at 1x like Flash's tiles. The range ring is drawn dark on it, as on the
 * Modern Snow.
 */
export const CLASSIC_SNOW: GroundSpec = {
  id: "snow",
  name: "Snow",
  root: artUrl("/assets/yardbg/snow-classic/"),
  files: ["layer1.webp", "layer2.webp", "layer3.webp", "layer4.webp"],
  tile: [400, 200],
  repeat: [2, 2],
  painted: false,
  fill: 0x9a9fae,
  rangeInk: GROUNDS.snow.rangeInk!,
};

/** The props laid round the plot, in turn. */
export type WinterPropName = "snowman" | "tree";

const WINTER = artUrl("/assets/buildings/decorations/winter/");

/** The file stem of each prop: the winter decoration it is. */
const STEMS: Readonly<Record<WinterPropName, string>> = {
  snowman: "snowman",
  tree: "christmas-tree",
};

const piece = (url: string): readonly DressPiece[] => [{ url, dx: 0, dy: 0, scale: 1 }];

/**
 * The winter props: snowman, Christmas tree in turn round the
 * plot, one every 190 world px (Thanksgiving's corn shocks stood every 96 to
 * 130: the owner found those too many). The pictures are `@2x`, so Pixi draws
 * them at their in-game size; the Modern ones in the Quality's copy.
 */
export const winterDressUp = (): DressUpSet<WinterPropName> => ({
  id: "winter",
  // No present piles: round the plot they read as the hunt's presents (neon, 27 Nov 2026).
  props: { pattern: ["snowman", "tree", "snowman", "tree"], spacing: 190 },
  pieces: (classic) => {
    const out = {} as Record<WinterPropName, readonly DressPiece[]>;
    for (const name of Object.keys(STEMS) as WinterPropName[]) {
      out[name] = piece(classic ? `${WINTER}${STEMS[name]}@2x.png` : buildingArtCopy(`${WINTER}${STEMS[name]}.modern@2x.webp`));
    }
    return out;
  },
});
