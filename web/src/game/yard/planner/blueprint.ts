import { footprintOf, type Point, type Rect } from "../YardGrid";
import { DECORATION_HEIGHT, DECORATION_WIDTH, snap } from "./placement";

/**
 * The blueprint view: the yard drawn flat, from above, one world pixel per yard
 * unit.
 *
 * This is how the original Yard Planner drew the yard
 * (`client/scripts/com/monsters/baseplanner/PlannerDesignView.as`): a grass
 * rectangle, the plot as a lighter rectangle, and each building as a square
 * tile coloured by category with its icon and level in the middle. A footprint
 * is a rectangle on screen, so what is under the cursor, whether two buildings
 * touch and where a wall run lines up are all readable at a glance, which is
 * exactly what the isometric art hides.
 *
 * Nothing here imports Pixi. The projection, the tile geometry and the category
 * table are pure so they can be tested, and `BlueprintLayer` only draws what
 * this describes.
 */

/* ── Projection ───────────────────────────────────────────────────────────── */

/** World pixels of headroom around the decoration area, so an edge tile is not
 * flush against the camera's clamp. */
export const BLUEPRINT_MARGIN = 80;

/** The blueprint world: the decoration area plus the margin on every side. */
export const BLUEPRINT_WORLD = {
  width: DECORATION_WIDTH + BLUEPRINT_MARGIN * 2,
  height: DECORATION_HEIGHT + BLUEPRINT_MARGIN * 2,
  /** World pixel of yard unit (0, 0): the plot centre. */
  originX: DECORATION_WIDTH / 2 + BLUEPRINT_MARGIN,
  originY: DECORATION_HEIGHT / 2 + BLUEPRINT_MARGIN,
} as const;

/** Yard units to blueprint world pixels: a translation, nothing more. */
export const blueprintToWorld = (x: number, y: number): Point => ({
  x: x + BLUEPRINT_WORLD.originX,
  y: y + BLUEPRINT_WORLD.originY,
});

/** Blueprint world pixels back to yard units. */
export const blueprintToYard = (worldX: number, worldY: number): Point => ({
  x: worldX - BLUEPRINT_WORLD.originX,
  y: worldY - BLUEPRINT_WORLD.originY,
});

/** A world-pixel drag in yard units, snapped to the grid. */
export const blueprintDragToYard = (
  worldDx: number,
  worldDy: number,
): { dx: number; dy: number } => ({
  dx: snap(worldDx),
  dy: snap(worldDy),
});

/* ── Tiles ────────────────────────────────────────────────────────────────── */

/** A building's tile in blueprint world pixels: its footprint, translated. */
export const tileRect = (type: number, x: number, y: number): Rect => {
  const [width, height] = footprintOf(type);
  const origin = blueprintToWorld(x, y);
  return { x: origin.x, y: origin.y, width, height };
};

/** The tile's corners, clockwise from the top-left. */
export const rectCorners = (rect: Rect): readonly (readonly [number, number])[] => [
  [rect.x, rect.y],
  [rect.x + rect.width, rect.y],
  [rect.x + rect.width, rect.y + rect.height],
  [rect.x, rect.y + rect.height],
];

/** Whether a world point lies on a tile. Edges count, matching the diamond test. */
export const rectContains = (rect: Rect, x: number, y: number): boolean =>
  x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;

/** A rectangle centred on the plot, in world pixels, from half-extents. */
export const centredRect = (halfWidth: number, halfHeight: number): Rect => ({
  x: BLUEPRINT_WORLD.originX - halfWidth,
  y: BLUEPRINT_WORLD.originY - halfHeight,
  width: halfWidth * 2,
  height: halfHeight * 2,
});

/* ── Categories ───────────────────────────────────────────────────────────── */

/**
 * The tile colour groups, after `BuildingItem.defineCategory`
 * (`client/scripts/com/monsters/baseplanner/components/BuildingItem.as:100-133`),
 * which reads `group` and `type` from the props table.
 */
export const TileCategory = {
  RESOURCE: "resource",
  BUILDING: "building",
  DEFENSIVE: "defensive",
  WALL: "wall",
  TRAP: "trap",
  DECORATION: "decoration",
  MISC: "misc",
} as const;
export type TileCategory = (typeof TileCategory)[keyof typeof TileCategory];

/**
 * Type ids by category, extracted from `client/scripts/YARD_PROPS.as`
 * (`group` and `type` per entry). Group 1 is resource, 2 is building, 3 is
 * defensive with `wall` and `trap` split out, 4 is decoration; everything the
 * table marks with group 999 — mushrooms, enemies, the taunt sign, placeholders
 * — is misc. Decorations are not listed because `isDecoration` already knows
 * them.
 */
const CATEGORY_GROUPS: readonly (readonly [TileCategory, readonly number[]])[] = [
  [TileCategory.RESOURCE, [1, 2, 3, 4, 6]],
  [
    TileCategory.BUILDING,
    [5, 8, 9, 10, 11, 12, 13, 14, 15, 16, 19, 26, 51, 112, 113, 116, 128, 133, 134],
  ],
  [TileCategory.WALL, [17, 18]],
  [TileCategory.TRAP, [24, 117]],
  [
    TileCategory.DEFENSIVE,
    [20, 21, 22, 23, 25, 114, 115, 118, 119, 129, 130, 132, 136, 137, 138, 139, 140],
  ],
];

const CATEGORIES = new Map<number, TileCategory>();
for (const [category, types] of CATEGORY_GROUPS) {
  for (const type of types) CATEGORIES.set(type, category);
}

/** The tile category for a type id. */
export const tileCategory = (type: number, decoration: boolean): TileCategory => {
  if (decoration) return TileCategory.DECORATION;
  return CATEGORIES.get(type) ?? TileCategory.MISC;
};

/** Fill and edge colours per category. Muted, so the selection chrome wins. */
export const TILE_COLOURS: Readonly<Record<TileCategory, { fill: number; edge: number }>> = {
  resource: { fill: 0x6ea84f, edge: 0x3e6a2a },
  building: { fill: 0x5b8fd6, edge: 0x2f5a99 },
  defensive: { fill: 0xd66a5b, edge: 0x8f3a2f },
  wall: { fill: 0x9a9a9a, edge: 0x5c5c5c },
  trap: { fill: 0xe0a33c, edge: 0x8f6318 },
  decoration: { fill: 0xa47bd1, edge: 0x6a4a94 },
  misc: { fill: 0x7d8a99, edge: 0x4a5561 },
};

/** Fixed obstacles the planner cannot move: mushrooms. */
export const OBSTACLE_COLOURS = { fill: 0x8a6a4a, edge: 0x5a4330 } as const;

/* ── Icons ────────────────────────────────────────────────────────────────── */

/**
 * The building's own top-down art, shrunk into its tile.
 *
 * This is what the original drew (`BuildingItem.as` puts the type's icon in the
 * middle of the tile), and it is what makes a blueprint readable at a glance: a
 * player recognises a Sniper Tower's silhouette far faster than they read the
 * word "Sniper" at nine pixels. The name stays as the fallback for anything
 * with no art, and for the moment before the picture arrives.
 */

/** Yard units of clear space between a tile's edge and its icon. */
export const ICON_PADDING = 3;

/**
 * Icons are never drawn larger than their own pixels.
 *
 * The art is isometric and mostly bigger than the footprint, so this only ever
 * bites on a small decoration in a large tile, where magnifying a 24 pixel
 * bitmap to 90 units would be a blur pretending to be detail.
 */
export const MAX_ICON_SCALE = 1;

/**
 * Tiles narrower than this get no icon.
 *
 * At 40 units a tile is 40 screen pixels at zoom 1, and the padding leaves 34
 * for the picture. Below that a shrunk tower is a few dark pixels, which says
 * less than the flat colour underneath it.
 */
export const MIN_ICON_WIDTH = 40;

/** Categories whose tiles are too small or too repetitive to carry a picture. */
const ICONLESS: ReadonlySet<TileCategory> = new Set([TileCategory.WALL, TileCategory.TRAP]);

/**
 * Whether a tile of this category and size is worth drawing a picture on.
 *
 * Walls and traps are excluded by category as well as by size: four hundred
 * walls all wearing the same twenty-pixel sprite is noise, and a wall run reads
 * better as an unbroken band of grey.
 */
export const tileShowsIcon = (
  category: TileCategory,
  width: number,
  height: number,
): boolean =>
  !ICONLESS.has(category) && Math.min(width, height) >= MIN_ICON_WIDTH;

/** Where a picture of `artWidth × artHeight` goes inside a tile, in tile units. */
export interface IconBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Fits a picture inside a tile: aspect ratio kept, centred, never overflowing.
 *
 * The art is isometric and the tile is the footprint, so the two shapes rarely
 * agree — a 190 × 160 portal wears a 260 × 180 picture. Scaling by whichever
 * side runs out first keeps the whole silhouette on the tile, and centring what
 * is left over means the icon sits where the eye already is. Null when there is
 * nothing sensible to draw: a tile with no room, or art with no size, which is
 * a texture that has not finished loading.
 */
export const iconBox = (
  tileWidth: number,
  tileHeight: number,
  artWidth: number,
  artHeight: number,
): IconBox | null => {
  if (artWidth <= 0 || artHeight <= 0) return null;

  // A tile smaller than twice the padding would have a negative box; the
  // padding gives way rather than the icon vanishing.
  const pad = Math.min(ICON_PADDING, tileWidth / 4, tileHeight / 4);
  const boxWidth = tileWidth - pad * 2;
  const boxHeight = tileHeight - pad * 2;
  if (boxWidth <= 0 || boxHeight <= 0) return null;

  const scale = Math.min(boxWidth / artWidth, boxHeight / artHeight, MAX_ICON_SCALE);
  const width = artWidth * scale;
  const height = artHeight * scale;
  return { x: (tileWidth - width) / 2, y: (tileHeight - height) / 2, width, height };
};

/* ── Labels ───────────────────────────────────────────────────────────────── */

/** Tiles narrower than this get no name, only a level. Walls and traps. */
export const MIN_NAMED_WIDTH = 60;

/**
 * What a tile says on it.
 *
 * A 70 unit tile at zoom 1 is 70 pixels, so a name has to be short. The name is
 * the fallback, shown while the icon is still loading and kept for good on a
 * type the art table does not know; `iconBox` is the usual answer. Levels are
 * shown as a number because that is what the player scans a plan for.
 */
export const tileLabel = (
  name: string,
  level: number,
  width: number,
): { name: string; level: string } => ({
  name: width >= MIN_NAMED_WIDTH ? shorten(name, width) : "",
  level: level > 0 ? String(level) : "",
});

/**
 * Cuts a name to what fits a tile of `width` units at the label's font size:
 * roughly one character per six units, minus room for the edge. A multi-word
 * name drops "Tower" and "Harvester" first, since the colour already says so.
 */
const shorten = (name: string, width: number): string => {
  const limit = Math.max(4, Math.floor(width / 6) - 1);
  if (name.length <= limit) return name;
  const trimmed = name.replace(/\s+(Tower|Harvester|Silo|Portal)$/i, "");
  if (trimmed.length <= limit) return trimmed;
  return trimmed.slice(0, Math.max(3, limit - 1)) + "…";
};
