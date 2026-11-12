/**
 * How Map Room 2 tells players apart by their border (owner, 8 Nov 2026): every player's yard and
 * outposts wear a hex border coloured by how the owner relates to the viewer, and the map's legend
 * (`ui/maproom/MapLegend.ts`) explains the colours. One table for the painted map's shader
 * (`painted/BorderLayer.ts`), the tile map's border sprites (`MapChunk`, Classic and the painted
 * look switched off), the far view's dots (`rasterColour`) and the legend's swatches.
 *
 * The palette, and why (owner, 8 Nov 2026: "dont use pink for friends. Green for friends?
 * Alliance dark blue? red for enemies"):
 *  - Yours, cyan `#3cf2ff`, the thickest line: kept from the painted borders the owner approved
 *    on 3 Nov, and the map's "you" accent everywhere else (range line, own plate ring). Kept next
 *    to the dark-blue alliance: cyan is far lighter (14 times the rim's luminance to 3.7) and thick.
 *  - Alliance, dark blue `#2f5bff`, a solid line (in the legend since alliances went live, beta 7).
 *    Dark against the ground, so the rim carries it: its glowing middle is 7.5 times the rim.
 *  - Friend, bright green `#4dff86` (was `#2ee86b`, which sank into Classic's dark grass), a double line; Pinned friend, light mint `#a4ffbe`, a
 *    triple line (a third stroke down the middle, so it differs by shape and not only by tint)
 *    with a stronger glow. The greens are a cool green (hue 137 to 140) well apart from the
 *    yellow-green grass (hue 75 to 85) and far brighter: 3.1 and 4.2 times the main grass's
 *    luminance (the old pink was only 1.9), and 12 and 16 times the rim.
 *  - Hostile, red `#ff4a3d`, a dashed line: kept from the 3 Nov "attacked you" red.
 *  - Neutral, pale grey `#c2c9d2`, the thinnest solid line and the softest glow: calm because
 *    most players are neutral, and no longer a blue beside the alliance's dark blue. It is the far
 *    view's neutral player colour too (a near-white dot).
 *
 * Every border also sits on a thin dark rim (`BORDER_RIM_COLOUR`): on sand, water or grass the
 * colours alone can be as little as 1.0 to 1.5 times the ground's luminance (blue on grass and
 * water, grey and green on sand), but against the rim they are 6.8 to 17 times (the line's middle,
 * 40 per cent towards white), so they read on any ground. For colour-blind players the line style
 * carries the meaning too: with red-green blindness the friend greens and the hostile red both look
 * olive-yellow (double or triple versus dashed); blue and cyan stay apart by weight (solid versus
 * thick) and grey neutral is a single thin line against the friends' double and triple.
 */

/** How a player cell relates to the viewer, most important first. */
export type PlayerRelation = "you" | "alliance" | "pinned" | "friend" | "hostile" | "other";

/** The line a relation draws: its weight and pattern. */
export type BorderStyle = "thick" | "solid" | "thin" | "double" | "triple" | "dashed";

export interface RelationLook {
  colour: number;
  style: BorderStyle;
  /** The legend's word: short, one or two words. */
  label: string;
}

export const RELATION_LOOK: Record<PlayerRelation, RelationLook> = {
  you: { colour: 0x3cf2ff, style: "thick", label: "Yours" },
  alliance: { colour: 0x2f5bff, style: "solid", label: "Alliance" },
  pinned: { colour: 0xa4ffbe, style: "triple", label: "Pinned friend" },
  friend: { colour: 0x4dff86, style: "double", label: "Friend" },
  hostile: { colour: 0xff4a3d, style: "dashed", label: "Hostile" },
  other: { colour: 0xc2c9d2, style: "thin", label: "Neutral" },
};

/**
 * A pinned friend's middle stroke, gold (`#ffd23c`): the green triple line with a gold centre reads
 * as different from a plain friend's green double at normal size, and stays in the green family.
 */
export const PINNED_CENTRE_COLOUR = 0xffd23c;

/**
 * The tile map (Classic, painted look off) draws on busier, darker grass than the painted map, so
 * its rim is darker and friends' lines a little heavier there (`mapAtlas.RELATION_LINES`).
 */
export const TILE_RIM_ALPHA = 0.85;

/** The dark rim under every border, and how opaque it is. */
export const BORDER_RIM_COLOUR = 0x0b0f14;
export const BORDER_RIM_ALPHA = 0.55;

/**
 * Whether alliances exist: yes, from beta 7 (lead, 10 Nov 2026, branch feat/alliances). Alliance-mates
 * (`PlayerCell.aid` equal to `GetAreaResponse.myalliance`) get the dark-blue border and their
 * alliance's shield on the name plate, and the legend shows the Alliance row. Switched off, the
 * legend would leave that row out again.
 */
export const ALLIANCES_LIVE = true;

/** The legend's rows, in reading order. */
const LEGEND_ORDER: readonly PlayerRelation[] = ["you", "friend", "pinned", "alliance", "hostile", "other"];

export const legendRows = (alliances: boolean = ALLIANCES_LIVE): PlayerRelation[] =>
  LEGEND_ORDER.filter((relation) => alliances || relation !== "alliance");

/** `0xRRGGBB` as a CSS colour. */
export const cssHex = (colour: number): string => `#${colour.toString(16).padStart(6, "0")}`;
