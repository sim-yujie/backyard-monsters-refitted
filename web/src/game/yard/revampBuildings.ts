import type { ArtRow } from "./buildingArtData";
import type { TierArt } from "./buildingArtTiers";

/**
 * Buildings Flash never had: this project's own, in `buildingArtData.ts`'s
 * row shape, read beside the generated rows by `buildingArt.ts`.
 *
 * 150 Observatory (alliances, owner 10 Nov 2026): design C, the lookout deck,
 * modelled in Blender on branch art/observatory-3d
 * (`art-samples/observatory-3d/game/`), one level only. It has two looks of
 * its own, as Flash had none to fall back on: the Modern one (`3d1` files,
 * {@link OBSERVATORY_MODERN_ART}) and the Classic one (`c1` files,
 * {@link OBSERVATORY_CLASSIC_ART}), each with its damaged and destroyed
 * stills and an idle loop of 48 cells in rows of 22 (`yardAnim.ts` runs it
 * idle, held while it is being built). The row below is the Classic look as
 * stills, for anything that reads the row directly (the Flash fallback). Its
 * health (10,000, the Map Room's at level 2, a placeholder) and props size
 * (120) are the combat table's (`web/tools/gen-combat-stats.mjs`, "This
 * project's own buildings"), so the yard's damaged and destroyed art switch
 * at the health the battle uses.
 */
export const REVAMP_BUILDING_ROWS: readonly ArtRow[] = [
  [150, "Observatory", "buildings/observatory/", [
    [1, ["top.c1@2x.webp", -52, -84], ["top.c1.damaged@2x.webp", -57, -55], ["top.c1.destroyed@2x.webp", -66, 1],
      ["shadow.c1.jpg", -51, 13], ["shadow.c1.damaged.jpg", -57, 12], ["shadow.c1.destroyed.jpg", -66, 19]],
  ], [10000], 120],
];

/** The Observatory's Modern look (`rows.json` "modern" on art/observatory-3d). */
export const OBSERVATORY_MODERN_ART: readonly TierArt[] = [
  { from: 1, top: ["top.3d1@2x.webp", -52, -84], shadow: ["shadow.3d1.jpg", -51, 13], lift: 0,
    anim: { strip: ["anim.3d1@2x.webp", -32, -84, 92, 117, 48], columns: 22, body: ["body.3d1@2x.webp", -52, -53] },
    damaged: { top: ["top.3d1.damaged@2x.webp", -57, -55], shadow: ["shadow.3d1.damaged.jpg", -57, 12] },
    destroyed: { top: ["top.3d1.destroyed@2x.webp", -66, 1], shadow: ["shadow.3d1.destroyed.jpg", -66, 19] } },
];

/** The Observatory's Classic look (`rows.json` "classic" on art/observatory-3d). */
export const OBSERVATORY_CLASSIC_ART: readonly TierArt[] = [
  { from: 1, top: ["top.c1@2x.webp", -52, -84], shadow: ["shadow.c1.jpg", -51, 13], lift: 0,
    anim: { strip: ["anim.c1@2x.webp", -32, -84, 92, 117, 48], columns: 22, body: ["body.c1@2x.webp", -52, -53] },
    damaged: { top: ["top.c1.damaged@2x.webp", -57, -55], shadow: ["shadow.c1.damaged.jpg", -57, 12] },
    destroyed: { top: ["top.c1.destroyed@2x.webp", -66, 1], shadow: ["shadow.c1.destroyed.jpg", -66, 19] } },
];

/**
 * The Classic looks of this project's own buildings, which Flash cannot
 * supply: the Classic look draws these instead of a Flash row's art.
 */
export const CLASSIC_OWN_ART: Readonly<Record<number, readonly TierArt[]>> = {
  150: OBSERVATORY_CLASSIC_ART,
};
