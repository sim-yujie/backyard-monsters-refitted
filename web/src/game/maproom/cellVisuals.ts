import { WATER_MAX_HEIGHT } from "@/config";
import { CellType, isPlayerCell, isWaterCell, type MapCell } from "@/api/types";
import { avatarOf, type AvatarId } from "@/game/avatars";

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
   * A key into the tribe portraits, not text to draw: the map writes no names
   * on camps (#176), only their level on a badge.
   */
  tribe: string;
  /** A player's critter (#175), drawn in the round marker. Null for everything else. */
  avatar: AvatarId | null;
  /** A camp's level on its badge. Empty means no badge. */
  badge: string;
  /**
   * A player's name plate (#176): "Bramblefoot  24", or "You" and "Outpost"
   * on the player's own. Empty means no plate.
   */
  plate: string;
  /** The cell belongs to the caller: a cyan ring and plate. */
  own: boolean;
  /** Damage protection or an active truce. */
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
 *
 * The shades are the toned-down ground of the approved "one calm look"
 * (#176, R-MR2-Map-A): quieter water, sand and grass, so the camps and the
 * players carry the colour.
 */
const TERRAIN_BANDS: { maxHeight: number; colour: number }[] = [
  { maxHeight: 79, colour: 0x1a3048 },
  { maxHeight: 89, colour: 0x1d3a57 },
  { maxHeight: WATER_MAX_HEIGHT, colour: 0x234565 },
  { maxHeight: 104, colour: 0xb9ad86 },
  { maxHeight: 109, colour: 0xaa9d75 },
  { maxHeight: 119, colour: 0x557a48 },
  { maxHeight: 139, colour: 0x4b6d41 },
  { maxHeight: 159, colour: 0x43623a },
  { maxHeight: 169, colour: 0x3c5835 },
  { maxHeight: 174, colour: 0x6d6b64 },
  { maxHeight: Number.POSITIVE_INFINITY, colour: 0x64625c },
];

/** Fill for a cell whose zone has not arrived yet. */
export const LOADING_COLOUR = 0x272c38;

/**
 * Marker colours, kept in step with the CSS tokens in ui/styles/tokens.css.
 * The player's own cells wear the accent (`--colour-accent`), as the range's
 * line does (#177): "You" is cyan.
 */
export const RANGE_COLOUR = 0x3dd6f5;
export const OWN_COLOUR = RANGE_COLOUR;
export const SHIELD_COLOUR = 0x9cb9ff;
export const DAMAGE_COLOUR = 0xe05252;
export const SELECT_COLOUR = 0xffffff;
export const HOVER_COLOUR = 0xffffff;
export const GRID_LINE_COLOUR = 0x0d1017;
/** Another player's marker ring and a plate's text, `--colour-text`. */
export const PLAYER_RING_COLOUR = 0xedf1f5;
/** The fill behind a marker, a badge and a plate: the panels' dark glass. */
export const MARKER_FILL_COLOUR = 0x0c1016;
/** Text on the player's own cyan plate, `--colour-accent-text`. */
export const OWN_PLATE_TEXT_COLOUR = 0x04212a;

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
  avatar: null,
  badge: "",
  plate: "",
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
    avatar: null,
    badge: "",
    plate: "",
    own: false,
    shielded: false,
    loading: false,
  };

  if (isWaterCell(cell)) {
    return { ...base, marker: CellMarker.NONE, markerColour: 0 };
  }

  if (isPlayerCell(cell)) {
    const truceActive = cell.t !== undefined && cell.t > nowSeconds;
    const outpost = cell.b === CellType.OUTPOST;
    const own = cell.mine === 1;
    return {
      ...base,
      marker: outpost ? CellMarker.OUTPOST : CellMarker.YARD,
      markerColour: outpost ? OUTPOST_COLOUR : PLAYER_COLOUR,
      avatar: avatarOf(cell.pic_square, cell.uid),
      plate: own ? (outpost ? "Outpost" : "You") : `${plateName(cell.n)}  ${cell.l}`,
      own,
      shielded: cell.p === 1 || truceActive,
    };
  }

  // Wild monster camp, which is also how every unoccupied land cell arrives.
  return {
    ...base,
    marker: cell.d === 1 ? CellMarker.CAMP_DESTROYED : CellMarker.CAMP,
    markerColour: TRIBE_COLOURS[cell.n] ?? TRIBE_FALLBACK,
    tribe: cell.n,
    badge: String(cell.l),
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

/** Names longer than this are cut on a plate, because no plate would fit them. */
const MAX_PLATE_NAME = 12;

/**
 * A name as a plate shows it: cut short with three dots, which the map's
 * ASCII bitmap font can draw (it has no ellipsis).
 */
export const plateName = (name: string): string =>
  name.length > MAX_PLATE_NAME ? `${name.slice(0, MAX_PLATE_NAME)}...` : name;
