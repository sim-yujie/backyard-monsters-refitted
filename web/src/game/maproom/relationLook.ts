/**
 * How Map Room 2 tells players apart by their border (owner, 8 Nov 2026): every player's yard and
 * outposts wear a hex border coloured by how the owner relates to the viewer, and the map's legend
 * (`ui/maproom/MapLegend.ts`) explains the colours. One table for the painted map's shader
 * (`painted/BorderLayer.ts`), the tile map's border sprites (`MapChunk`, Classic and the painted
 * look switched off), the far view's dots (`rasterColour`) and the legend's swatches.
 *
 * The palette, and why:
 *  - Yours, cyan `#3cf2ff`, the thickest line: kept from the painted borders the owner approved
 *    on 3 Nov, and the map's "you" accent everywhere else (range line, own plate ring).
 *  - Alliance, green `#54f06e`: kept from 3 Nov. Hidden in the legend until alliances exist.
 *  - Friend, pink-magenta `#ff5fd2`, a double line; Pinned friend, lighter pink `#ffa0ea`, a
 *    bolder double line with a stronger glow. Magenta is the one hue nowhere in the terrain
 *    (green and yellow grass, blue water, sand, grey rock) and far from cyan, green, blue and red.
 *    Gold (the Map Room 1 pinned colour) would vanish on sand and yellow grass.
 *  - Hostile, red `#ff4a3d`, a dashed line: kept from the 3 Nov "attacked you" red.
 *  - Neutral, blue `#4a9bff`, the thinnest solid line and the softest glow: kept from 3 Nov,
 *    calmer because most players are neutral.
 *
 * Every border also sits on a thin dark rim (`BORDER_RIM_COLOUR`): the bright colours alone are
 * only 1.2 to 3.7 times the luminance of sand, water and grass, but against the rim they are 6 to
 * 15 times, so they read on any ground. For colour-blind players the line style carries the
 * meaning too: with red-green blindness green and red both look olive-yellow (hostile is dashed,
 * alliance solid) and magenta looks lavender-blue like neutral (friend is double, neutral single);
 * with blue-yellow blindness pink and red look alike (dashed versus double again).
 */

/** How a player cell relates to the viewer, most important first. */
export type PlayerRelation = "you" | "alliance" | "pinned" | "friend" | "hostile" | "other";

/** The line a relation draws: its weight and pattern. */
export type BorderStyle = "thick" | "solid" | "thin" | "double" | "doubleBold" | "dashed";

export interface RelationLook {
  colour: number;
  style: BorderStyle;
  /** The legend's word: short, one or two words. */
  label: string;
}

export const RELATION_LOOK: Record<PlayerRelation, RelationLook> = {
  you: { colour: 0x3cf2ff, style: "thick", label: "Yours" },
  alliance: { colour: 0x54f06e, style: "solid", label: "Alliance" },
  pinned: { colour: 0xffa0ea, style: "doubleBold", label: "Pinned friend" },
  friend: { colour: 0xff5fd2, style: "double", label: "Friend" },
  hostile: { colour: 0xff4a3d, style: "dashed", label: "Hostile" },
  other: { colour: 0x4a9bff, style: "thin", label: "Neutral" },
};

/** The dark rim under every border, and how opaque it is. */
export const BORDER_RIM_COLOUR = 0x0b0f14;
export const BORDER_RIM_ALPHA = 0.55;

/**
 * Whether alliances exist yet. They do not (beta 7): alliance-mates still get the green border if
 * the server ever sends a shared alliance (`PlayerCell.aid` equal to `GetAreaResponse.myalliance`),
 * but the legend leaves the Alliance row out until this is switched on.
 */
export const ALLIANCES_LIVE = false;

/** The legend's rows, in reading order. */
const LEGEND_ORDER: readonly PlayerRelation[] = ["you", "friend", "pinned", "alliance", "hostile", "other"];

export const legendRows = (alliances: boolean = ALLIANCES_LIVE): PlayerRelation[] =>
  LEGEND_ORDER.filter((relation) => alliances || relation !== "alliance");

/** `0xRRGGBB` as a CSS colour. */
export const cssHex = (colour: number): string => `#${colour.toString(16).padStart(6, "0")}`;
