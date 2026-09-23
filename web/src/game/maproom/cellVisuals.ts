import { WATER_MAX_HEIGHT } from "@/config";
import { CellType, isPlayerCell, isWaterCell, type MapCell } from "@/api/types";

/**
 * What a cell looks like, as data.
 *
 * The renderer turns a `CellAppearance` into vector shapes today. When a sprite
 * atlas exists, the same appearance drives `Sprite` placement instead:
 * `marker` becomes a frame name, `markerColour` becomes a tint and nothing else
 * has to move. Keeping the decision here rather than inside the draw loop is
 * the whole point — the draw loop should not know what a truce is.
 */

/** Which glyph sits on top of the terrain. */
export const CellMarker = {
  NONE: "none",
  CAMP: "camp",
  CAMP_DESTROYED: "camp-destroyed",
  YARD: "yard",
  OUTPOST: "outpost",
} as const;
export type CellMarker = (typeof CellMarker)[keyof typeof CellMarker];

export interface CellAppearance {
  /** Terrain fill for the hex body. */
  terrain: number;
  marker: CellMarker;
  markerColour: number;
  /**
   * Which tribe's portrait a camp should wear. Empty for everything else.
   *
   * Separate from `label` even though a camp's label is the same string: the
   * label is text to draw, this is a key into the avatar set, and a player
   * cell has a label but no tribe.
   */
  tribe: string;
  /** Damage bar fraction, 0..1. Zero means no bar. */
  damage: number;
  /** Short badge text, usually the level. Empty means no badge. */
  badge: string;
  /** Long label, the owner or tribe name. Empty means no label. */
  label: string;
  /** Gold ring: this cell belongs to the caller. */
  own: boolean;
  /** Blue ring: damage protection or an active truce. */
  shielded: boolean;
  /** The cell has not been fetched yet. */
  loading: boolean;
}

/**
 * Terrain bands from server/src/enums/MapRoom.ts, as fill colours.
 *
 * The cut-offs are the server's, not a rounding of them: height <= 99 is water
 * and can never be occupied, 100..109 is sand, 110..169 is grass in four
 * shades, 170 and above is rock.
 */
const TERRAIN_BANDS: { maxHeight: number; colour: number }[] = [
  { maxHeight: 79, colour: 0x123253 },
  { maxHeight: 89, colour: 0x17416b },
  { maxHeight: WATER_MAX_HEIGHT, colour: 0x1d5183 },
  { maxHeight: 104, colour: 0xd9c489 },
  { maxHeight: 109, colour: 0xc9b070 },
  { maxHeight: 119, colour: 0x5c8f47 },
  { maxHeight: 139, colour: 0x4b7b3c },
  { maxHeight: 159, colour: 0x3f6833 },
  { maxHeight: 169, colour: 0x37592c },
  { maxHeight: 174, colour: 0x7a776e },
  { maxHeight: Number.POSITIVE_INFINITY, colour: 0x6e6b63 },
];

/** Fill for a cell whose zone has not arrived yet. */
export const LOADING_COLOUR = 0x272c38;

/** Ring colours, kept in step with the CSS tokens in ui/styles/tokens.css. */
export const OWN_COLOUR = 0xf0a12e;
export const SHIELD_COLOUR = 0x4f9fe0;
export const DAMAGE_COLOUR = 0xe05252;
export const SELECT_COLOUR = 0xffffff;
export const HOVER_COLOUR = 0xf0a12e;
export const GRID_LINE_COLOUR = 0x0d1017;

/**
 * The four tribes, in the server's order.
 *
 * Tribe is a pure function of the coordinates — `Tribes[(x + y) % 4]` — so the
 * colour is stable for a cell forever, which makes a region of the map
 * recognisable at a glance (docs/specs/maproom2.md §10.3).
 */
export const TRIBE_COLOURS: Record<string, number> = {
  Legionnaire: 0xb85c38,
  Kozu: 0x8f5fb8,
  Abunakki: 0xc9a227,
  Dreadnaut: 0x4a8fa8,
};
const TRIBE_FALLBACK = 0x9aa3b8;

const PLAYER_COLOUR = 0xe8ecf5;
const OUTPOST_COLOUR = 0xb9c2d6;

export const terrainColour = (height: number): number => {
  for (const band of TERRAIN_BANDS) {
    if (height <= band.maxHeight) return band.colour;
  }
  return LOADING_COLOUR;
};

/** The appearance of a cell that has not loaded. */
export const loadingAppearance = (): CellAppearance => ({
  terrain: LOADING_COLOUR,
  marker: CellMarker.NONE,
  markerColour: 0,
  tribe: "",
  damage: 0,
  badge: "",
  label: "",
  own: false,
  shielded: false,
  loading: true,
});

/** Reads one cell payload into the shapes and text that represent it. */
export const appearanceOf = (cell: MapCell | undefined, nowSeconds: number): CellAppearance => {
  if (!cell) return loadingAppearance();

  const base = {
    terrain: terrainColour(cell.i),
    tribe: "",
    damage: 0,
    badge: "",
    label: "",
    own: false,
    shielded: false,
    loading: false,
  };

  if (isWaterCell(cell)) {
    return { ...base, marker: CellMarker.NONE, markerColour: 0 };
  }

  if (isPlayerCell(cell)) {
    const truceActive = cell.t !== undefined && cell.t > nowSeconds;
    return {
      ...base,
      marker: cell.b === CellType.OUTPOST ? CellMarker.OUTPOST : CellMarker.YARD,
      markerColour: cell.b === CellType.OUTPOST ? OUTPOST_COLOUR : PLAYER_COLOUR,
      damage: clamp01(cell.dm / 100),
      badge: String(cell.l),
      label: cell.n,
      own: cell.mine === 1,
      shielded: cell.p === 1 || truceActive,
    };
  }

  // Wild monster camp, which is also how every unoccupied land cell arrives.
  return {
    ...base,
    marker: cell.d === 1 ? CellMarker.CAMP_DESTROYED : CellMarker.CAMP,
    markerColour: TRIBE_COLOURS[cell.n] ?? TRIBE_FALLBACK,
    tribe: cell.n,
    damage: clamp01(cell.dm / 100),
    badge: String(cell.l),
    label: cell.n,
  };
};

/**
 * The colour one cell contributes to the zoomed-out raster.
 *
 * Occupied cells are drawn in their marker colour rather than their terrain, so
 * at world scale the map reads as "who is where" instead of a height map.
 */
export const rasterColour = (cell: MapCell | undefined): number => {
  if (!cell) return LOADING_COLOUR;
  if (isWaterCell(cell)) return terrainColour(cell.i);
  if (isPlayerCell(cell)) {
    if (cell.mine === 1) return OWN_COLOUR;
    return cell.b === CellType.OUTPOST ? OUTPOST_COLOUR : PLAYER_COLOUR;
  }
  // Camps are the common case and would swamp the view in tribe colours, so
  // they keep their terrain and only a destroyed one is called out.
  return cell.d === 1 ? 0x6b2b2b : terrainColour(cell.i);
};

const clamp01 = (value: number): number => Math.min(Math.max(value, 0), 1);
