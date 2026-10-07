import { CELL_HEIGHT, CELL_WIDTH, WATER_MAX_HEIGHT } from "@/config";
import { CellType, isFogCell, isPlayerCell, isWaterCell, type MapCell, type PlayerCell } from "@/api/types";
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
  /** A camp's level on its badge. Empty means no badge. */
  badge: string;
  /**
   * A player's name plate (#176): "Bramblefoot  24", username and level, the
   * same on the viewer's own cells as everyone else's (#334, owner decision
   * 2026-10-07) - the gold plate and house icon mark those, not the text.
   * Empty means no plate.
   */
  plate: string;
  /** The cell belongs to the caller: a cyan ring and plate. */
  own: boolean;
  /** Damage protection or an active truce. */
  shielded: boolean;
  /**
   * The player's own outpost with an invitation to move onto it still waiting
   * (#205; Flash's `mcInvite`): a small dot on its marker. Only the owner sees it.
   */
  invitePending: boolean;
  /** The cell has not been fetched yet. */
  loading: boolean;
  /**
   * A player cell's level, always shown on a gold star (#334) - unlike `badge`,
   * which is a camp's level and empty on a player cell. Empty off a player cell.
   */
  star: string;
  /** The name plate's fill colour, by {@link PlayerRelation} (#334). */
  plateColour: number;
  /** The small icon drawn by the plate, by {@link PlayerRelation} (#334). */
  relationIcon: "house" | "shield" | "swords" | "none";
  /** An outpost's Starter Kit tint (#334). Null off an outpost. */
  kit: OutpostKit | null;
  /** The kit filter dims this cell (#334): everything but a matching own outpost, unless `ALL`. */
  dimmed: boolean;
}

/** An outpost's Starter Kit (issue #334), as the tower is tinted. */
export const OutpostKit = {
  NONE: "none",
  REGULAR: "regular",
  MEGA: "mega",
  ULTRA: "ultra",
} as const;
export type OutpostKit = (typeof OutpostKit)[keyof typeof OutpostKit];

/** `PlayerCell.kit`'s server ids (0..3), as the client's {@link OutpostKit}. */
const KIT_BY_ID: Record<number, OutpostKit> = {
  0: OutpostKit.NONE,
  1: OutpostKit.REGULAR,
  2: OutpostKit.MEGA,
  3: OutpostKit.ULTRA,
};
export const kitOf = (id: number | undefined): OutpostKit => KIT_BY_ID[id ?? 0] ?? OutpostKit.NONE;

/** The map's kit filter control (#334): dims every cell but a matching own outpost. */
export const KitFilter = {
  ALL: "all",
  NONE: "none",
  REGULAR: "regular",
  MEGA: "mega",
  ULTRA: "ultra",
} as const;
export type KitFilter = (typeof KitFilter)[keyof typeof KitFilter];

/** How a player cell relates to the viewer (#334), driving the plate's colour and icon. */
export type PlayerRelation = "you" | "alliance" | "attacker" | "other";

/** What the map needs to know about the viewer to render relation and kit (#334). */
export interface MapViewerContext {
  /** The viewer's own alliance id (`GetAreaResponse.myalliance`), or null. */
  myAlliance: number | null;
  /** The active kit filter. */
  kitFilter: KitFilter;
}
export const DEFAULT_VIEWER_CONTEXT: MapViewerContext = { myAlliance: null, kitFilter: KitFilter.ALL };

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
 * The world view's unexplored ground (issue #153): diagonal stripes of this
 * over {@link LOADING_COLOUR}, so ground nobody has loaded reads as "not
 * loaded yet" rather than as a blank world. Every {@link UNEXPLORED_PERIOD}
 * cells, {@link UNEXPLORED_STRIPE} of them wide.
 */
export const UNEXPLORED_STRIPE_COLOUR = 0x323848;
export const UNEXPLORED_PERIOD = 8;
export const UNEXPLORED_STRIPE = 3;

/** The raster's colour for a cell nothing has loaded yet. */
export const unexploredColour = (col: number, row: number): number =>
  (col + row) % UNEXPLORED_PERIOD < UNEXPLORED_STRIPE ? UNEXPLORED_STRIPE_COLOUR : LOADING_COLOUR;

/**
 * Marker colours, kept in step with the CSS tokens in ui/styles/tokens.css.
 * The player's own cells wear the accent (`--colour-accent`), as the range's
 * line does (#177): "You" is cyan.
 */
export const RANGE_COLOUR = 0x3dd6f5;
export const OWN_COLOUR = RANGE_COLOUR;
export const SHIELD_COLOUR = 0x9cb9ff;
/** An invitation waiting on the player's own outpost (#205), `--colour-warning`. */
export const INVITE_COLOUR = 0xf5b94a;
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
 * A player cell's name plate colour by {@link PlayerRelation} (#334, Flash-faithful
 * redraw): gold for the viewer's own cell, green for an alliance-mate, red for a
 * cell that attacked the viewer, and the Flash map's plain blue for everyone else.
 */
export const RELATION_YOU_COLOUR = 0xd4af37;
export const RELATION_ALLIANCE_COLOUR = 0x3fae4e;
export const RELATION_ATTACKER_COLOUR = 0xd64545;
export const RELATION_OTHER_COLOUR = 0x2f74c0;

/** An outpost's Starter Kit tint on its tower sprite (#334), visible to every viewer. */
export const KIT_TINT: Record<OutpostKit, number> = {
  [OutpostKit.NONE]: 0xffffff,
  [OutpostKit.REGULAR]: 0xcd7f32,
  [OutpostKit.MEGA]: 0xc0c0c0,
  [OutpostKit.ULTRA]: 0xffd700,
};

/** Alpha applied to a cell the active kit filter dims (#334). */
export const DIMMED_ALPHA = 0.35;

const RELATION_STYLE: Record<PlayerRelation, { colour: number; icon: CellAppearance["relationIcon"] }> = {
  you: { colour: RELATION_YOU_COLOUR, icon: "house" },
  alliance: { colour: RELATION_ALLIANCE_COLOUR, icon: "shield" },
  attacker: { colour: RELATION_ATTACKER_COLOUR, icon: "swords" },
  other: { colour: RELATION_OTHER_COLOUR, icon: "none" },
};

/**
 * How a player cell relates to the viewer (#334).
 *
 * `"attacker"` is deliberately unreachable today: it needs attacker history
 * that only the fog-of-war sight service (issue #329, branch `feat/fog-wp1`,
 * not yet merged) will provide. No cheap source exists on this payload, so
 * every cell falls through to `"other"` until that lands.
 */
const relationOf = (cell: PlayerCell, myAlliance: number | null): PlayerRelation => {
  if (cell.mine === 1) return "you";
  if (myAlliance !== null && cell.aid !== null && cell.aid === myAlliance) return "alliance";
  return "other";
};

/** Whether a cell stays bright under the active kit filter (#334). */
const matchesKitFilter = (cell: PlayerCell, filter: KitFilter): boolean => {
  if (filter === KitFilter.ALL) return true;
  if (cell.mine !== 1 || cell.b !== CellType.OUTPOST) return false;
  return kitOf(cell.kit) === filter;
};

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
  badge: "",
  plate: "",
  own: false,
  shielded: false,
  invitePending: false,
  loading: true,
  star: "",
  plateColour: 0,
  relationIcon: "none",
  kit: null,
  dimmed: false,
});

/**
 * A placeholder colour for a fogged cell, distinct from {@link LOADING_COLOUR}
 * — the design (`docs/design/fog-of-war.md` §6) wants fog and "not loaded
 * yet" to never look the same. The actual clouds and sight-edge feather are
 * issue #331; this is only the server's `{ fog: 1 }` kept from crashing the
 * renderer until then.
 */
export const FOG_COLOUR = 0x1a1e24;

/** The appearance of a cell outside the viewer's fog of war sight (#330, #331 draws the real one). */
export const fogAppearance = (): CellAppearance => ({
  terrain: FOG_COLOUR,
  marker: CellMarker.NONE,
  markerColour: 0,
  tribe: "",
  avatar: null,
  badge: "",
  plate: "",
  own: false,
  shielded: false,
  invitePending: false,
  loading: false,
});

/** Reads one cell payload into the shapes and text that represent it. */
export const appearanceOf = (
  cell: MapCell | undefined,
  nowSeconds: number,
  context: MapViewerContext = DEFAULT_VIEWER_CONTEXT,
): CellAppearance => {
  if (!cell) return loadingAppearance();
  if (isFogCell(cell)) return fogAppearance();

  const base = {
    terrain: terrainColour(cell.i),
    tribe: "",
    badge: "",
    plate: "",
    own: false,
    shielded: false,
    invitePending: false,
    loading: false,
    star: "",
    plateColour: 0,
    relationIcon: "none" as CellAppearance["relationIcon"],
    kit: null,
    dimmed: false,
  };

  if (isWaterCell(cell)) {
    return { ...base, marker: CellMarker.NONE, markerColour: 0, dimmed: context.kitFilter !== KitFilter.ALL };
  }

  if (isPlayerCell(cell)) {
    const truceActive = cell.t !== undefined && cell.t > nowSeconds;
    const outpost = cell.b === CellType.OUTPOST;
    const own = cell.mine === 1;
    const relation = relationOf(cell, context.myAlliance);
    const style = RELATION_STYLE[relation];
    return {
      ...base,
      marker: outpost ? CellMarker.OUTPOST : CellMarker.YARD,
      markerColour: outpost ? OUTPOST_COLOUR : PLAYER_COLOUR,
      // Every player cell's plate carries the owner's username (#334, owner
      // decision 2026-10-07) - including the viewer's own cells, which used to
      // say "You"/"Outpost" instead. The gold plate and house icon already
      // mark a cell as the viewer's own, so the text no longer needs to.
      plate: `${plateName(cell.n)}  ${cell.l}`,
      own,
      shielded: cell.p === 1 || truceActive,
      invitePending: own && outpost && Number(cell.pi) > 0,
      star: String(cell.l),
      plateColour: style.colour,
      relationIcon: style.icon,
      kit: outpost ? kitOf(cell.kit) : null,
      dimmed: !matchesKitFilter(cell, context.kitFilter),
    };
  }

  // Wild monster camp, which is also how every unoccupied land cell arrives.
  return {
    ...base,
    dimmed: context.kitFilter !== KitFilter.ALL,
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
  if (isFogCell(cell)) return FOG_COLOUR;
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

/**
 * How wide the hex is at a vertical offset from its centre (#334).
 *
 * The hex is `CELL_WIDTH` wide at its centre line and narrows in a straight
 * line to `CELL_WIDTH / 2` at its top and bottom points, `CELL_HEIGHT / 2`
 * away (see `mapAtlas.ts`'s `hexPoints`). A name plate placed at `dy` from the
 * centre must stay within this width, or it spills into the neighbour hex
 * sharing that edge. Offsets past the hex's own vertical extent clamp to the
 * narrowest width rather than going negative.
 */
export const hexWidthAt = (dy: number): number => {
  const half = Math.min(Math.abs(dy), CELL_HEIGHT / 2);
  return CELL_WIDTH - (CELL_WIDTH / 2) * (half / (CELL_HEIGHT / 2));
};
