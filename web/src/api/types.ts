/**
 * Wire types for the routes this client calls.
 *
 * Only the fields the client actually reads are typed. Responses carry far more
 * (see docs/server-api.md §3 Data models), so every envelope keeps an index
 * signature rather than pretending the list is complete.
 */

/** Every successful game response carries `error: 0`. See ApiError for why. */
export interface ApiEnvelope {
  error?: number | string;
  [key: string]: unknown;
}

/** The `errorDetails` object the global ErrorInterceptor attaches. */
export interface ApiErrorDetails {
  error?: string;
  status?: number;
  message?: string;
  data?: unknown;
  internalInfo?: unknown;
}

/* ── Auth ───────────────────────────────────────────────────────────────── */

/** `sessionType` on the login route. A game session and a launcher session coexist. */
export const SessionType = {
  GAME: "game",
  LAUNCHER: "launcher",
} as const;
export type SessionType = (typeof SessionType)[keyof typeof SessionType];

export interface LoginRequest {
  email?: string;
  password?: string;
  /** A previously issued JWT, for re-login without credentials. */
  token?: string;
  sessionType?: SessionType;
}

export interface LoginResponse extends ApiEnvelope {
  error: number;
  userId: number;
  token: string;
  /** Which Map Room the account is on: 0 none, 1 v1, 2 v2, 3 v3. */
  mapversion: number;
  username?: string;
  email?: string;
  pic_square?: string | null;
  language?: string;
  /**
   * The map bookmark blob, stored unvalidated on `user.bookmarks`. `{}` on a
   * new account. See api/bookmarks.ts for the shape and why it is not an array.
   */
  bookmarks?: unknown;
}

/** What the client keeps once a login succeeds. */
export interface Session {
  token: string;
  userId: number;
  username: string | null;
  sessionType: SessionType;
}

/* ── Base / yard ────────────────────────────────────────────────────────── */

/** `type` on /base/load. Values from server/src/enums/Base.ts (BaseMode). */
export const BaseMode = {
  /** Own yard, editable. */
  BUILD: "build",
  /** Someone else's yard, read-only. */
  VIEW: "view",
  /** Read-only view opened from the world map. */
  WORLD_MAP_VIEW: "wmview",
  ATTACK: "attack",
  WORLD_MAP_ATTACK: "wmattack",
  /** "no base id yet" sentinel; a build load with this id opens the main yard. */
  DEFAULT: "0",
} as const;
export type BaseMode = (typeof BaseMode)[keyof typeof BaseMode];

export interface BaseLoadRequest {
  type: BaseMode;
  /** Accepted but unused by the handler; still required by the schema. */
  userid: string;
  /** `"0"` (BaseMode.DEFAULT) opens the caller's main yard. */
  baseid: string;
  mapversion?: number;
}

/** Resource counts and their caps, as carried on a save and on a map cell. */
export interface Resources {
  r1?: number;
  r2?: number;
  r3?: number;
  r4?: number;
  r1max?: number;
  r2max?: number;
  r3max?: number;
  r4max?: number;
  [key: string]: number | undefined;
}

/**
 * One building in `buildingdata`.
 *
 * Mirrors `server/src/types/BuildingData.ts`, which in turn mirrors what
 * `BFOUNDATION.Export()` writes (`client/scripts/BFOUNDATION.as:2968-3029`).
 * Almost every field is omitted at its default, so absence is meaningful:
 *
 * - **`l` absent means level 1**, not level 0. `Export` only writes the level
 *   when it is not 1 (`:2975-2977`) and `Setup` defaults it to 1
 *   (`:3043-3048`). A building is at level 0 only while `cB` is counting down.
 * - `hp` is written only below full health (`:3025`), so its absence means
 *   undamaged. `buildinghealthdata` carries the same numbers keyed by id.
 * - `fort` is the fortification level. `fz` is *not* fortification: it is the
 *   Champion Chamber's frozen-champion blob (`CHAMPIONCHAMBER.as:376`).
 */
export interface BuildingData {
  /** Yard units, origin at the plot centre. */
  X: number;
  Y: number;
  /** Building type id. */
  t: number;
  /** Building id, unique within the yard. */
  id: number;
  /** Level. Absent means 1. */
  l?: number;
  /** Fortification level, 0 when absent. */
  fort?: number;
  /** Seconds left on the initial build. Present means level 0, under construction. */
  cB?: number;
  /** Seconds left on an upgrade. */
  cU?: number;
  /** Seconds left on a rebuild. */
  cR?: number;
  /** Seconds left on a fortification. */
  cF?: number;
  /** Current health. Absent means full. 0 means destroyed. */
  hp?: number;
  /** 1 while a worker is repairing. */
  rE?: number;
  /** Harvester: units banked in the building's own buffer. */
  st?: number;
  /** Harvester: 1 while producing. */
  pr?: number;
  /** Seconds left on the current production cycle. */
  rCP?: number;
  [key: string]: unknown;
}

/** `buildingdata`, keyed by building id as a string. */
export type BuildingDataMap = Record<string, BuildingData>;

/** `buildinghealthdata`: current health keyed by building id. */
export type BuildingHealthData = Record<string, number>;

/**
 * One yard mushroom. Positions are yard units, as for a building
 * (`client/scripts/MUSHROOMS.as:84`).
 */
export interface MushroomData {
  X?: number;
  Y?: number;
  id?: number;
  /** Which of the art's frames this one shows. */
  frame?: number;
  [key: string]: unknown;
}

/** `mushrooms`: a list plus the timestamp of the last spawn. */
export interface MushroomSave {
  l?: MushroomData[];
  s?: number;
}

/**
 * The /base/load envelope. The server spreads every @FrontendKey field of the
 * Save entity into the top level, so this lists the handful the client needs
 * now and leaves the rest to the index signature.
 */
export interface BaseLoadResponse extends ApiEnvelope {
  error: number;
  /** = basesaveid. */
  id: number;
  baseid: string;
  basesaveid: number;
  /** [height, width]; 800 x 800 on Map Room 2. */
  worldsize: [number, number];
  currenttime: number;
  /** When the yard was last saved, in unix seconds. 0 on a yard never saved. */
  savetime?: number;
  resources?: Resources;
  credits?: number;
  homebase?: [number, number];
  buildingdata?: BuildingDataMap | null;
  buildinghealthdata?: BuildingHealthData | null;
  mushrooms?: MushroomSave | null;
  /** Owned store items. `ENL.q` is the yard expansion level, 0..6. */
  storedata?: Record<string, { q?: number } | undefined> | null;
  basename?: string;
  level?: number;
  tutorialstage?: unknown;
  flags?: Record<string, unknown>;
}

/* ── Map Room 2 ─────────────────────────────────────────────────────────── */

/** `b` on a cell payload: server/src/enums/MapRoom.ts (MapRoomCell). */
export const CellType = {
  WILD_MONSTER: 1,
  HOME_CELL: 2,
  OUTPOST: 3,
} as const;
export type CellType = (typeof CellType)[keyof typeof CellType];

/**
 * A water cell. The server short-circuits height <= 99 to terrain height alone,
 * so every other field is absent (createCellData.ts).
 */
export interface WaterCell {
  /** Terrain height. */
  i: number;
  b?: undefined;
}

/**
 * A wild monster camp. Also what every unoccupied land cell is served as —
 * Map Room 2 has no distinct "empty land" shape.
 */
export interface WildMonsterCell {
  uid: 0;
  b: typeof CellType.WILD_MONSTER;
  i: number;
  /** 14 digits: 8 world hash + 3 x + 3 y. */
  bid: string;
  /** Tribe name, derived from (x + y) % 4. */
  n: string;
  /** Camp level, 25..44. */
  l: number;
  /** Damage percent 0..100. */
  dm: number;
  /** 1 once damage >= 90. */
  d: number;
}

/** A player's main yard (`b` 2) or captured outpost (`b` 3). */
export interface PlayerCell {
  uid: number;
  b: typeof CellType.HOME_CELL | typeof CellType.OUTPOST;
  i: number;
  bid: string;
  /** Owner's alliance id. */
  aid: number | null;
  /** Owner username. */
  n: string;
  /** Owner's base level. */
  l: number;
  /** Empire value. */
  v: number;
  /** Flinger level 0..4. */
  f: number;
  /** Catapult level 0..3. */
  c: number;
  /** Effective damage percent; reported as 0 once protection lapses. */
  dm: number;
  /** 1 when damage >= 90, i.e. takeover-eligible. */
  d: number;
  /** Lock owner user id; non-zero means busy. Always 0 on the caller's cell. */
  lo: number;
  /** 1 while damage protection is active. */
  p: number;
  /** Truce expiry, unix seconds. Absent on the caller's own cell. */
  t?: number;
  /** 1 when the cell belongs to the caller. */
  mine: 0 | 1;
  pic_square: string | null;
  /** Always 0 from this endpoint. */
  pi: number;
  /** Always 0. */
  fr: number;
  /** Own cells only: the owner's live resources. */
  r?: Resources;
  /** Own cells only: hatchery and garrison state. */
  m?: Record<string, unknown>;
}

export type MapCell = WaterCell | WildMonsterCell | PlayerCell;

/** `data[x][y]`, exactly as the client stores it (`_zones[zoneId].data`). */
export type AreaCellGrid = Record<string, Record<string, MapCell>>;

export interface GetAreaRequest {
  /** Zone origin x, 0..799, a multiple of 10 by convention. */
  x: number;
  /** Zone origin y, 0..799. */
  y: number;
  /** 1 asks the server to include the caller's own resources and credits. */
  sendresources?: 0 | 1;
}

export interface GetAreaResponse extends ApiEnvelope {
  error: number;
  x: number;
  y: number;
  /** 11 x 11 cells covering x..x+10, y..y+10. */
  data: AreaCellGrid;
  alliancedata?: unknown;
  resources?: Resources;
  credits?: number;
}

/** Narrows a cell payload to water, which carries terrain height only. */
export const isWaterCell = (cell: MapCell): cell is WaterCell => cell.b === undefined;

/** Narrows a cell payload to a player-owned main yard or outpost. */
export const isPlayerCell = (cell: MapCell): cell is PlayerCell =>
  cell.b === CellType.HOME_CELL || cell.b === CellType.OUTPOST;

/* ── Yard Planner ───────────────────────────────────────────────────────── */

/**
 * One building in a saved layout.
 *
 * Same units as `buildingdata` — yard units with the origin at the plot centre
 * — but the position fields are lower case `x` and `y` where a save row spells
 * them `X` and `Y`. That is the server's contract, not a slip: a layout node is
 * its own record rather than a save row, and keeping the case different makes
 * it obvious which of the two a value came from.
 *
 * `l` and `fort` carry the level and fortification a layout was designed
 * around, which phase 2 needs for planned upgrades and which phase 1 only
 * round-trips.
 */
export interface LayoutNode {
  /** Building id, matching the id in `buildingdata`. */
  id: number;
  /** Building type id. */
  t: number;
  x: number;
  y: number;
  l?: number;
  fort?: number;
}

/** The layout format version this client writes and reads. */
export const LAYOUT_VERSION = 2;

/** A saved layout in one of the account's slots. */
export interface Layout {
  slot: number;
  name: string;
  version: number;
  /** `storedata.ENL.q` at save time: the plot the layout was designed for. */
  expansion: number;
  /** Unix seconds, or an ISO string; the client formats whichever arrives. */
  updatedAt: number | string;
  nodes: LayoutNode[];
}

/** The body of the `data` form field on save and apply. */
export interface LayoutPayload {
  version: number;
  expansion: number;
  nodes: LayoutNode[];
}

export interface LayoutsResponse extends ApiEnvelope {
  error: number;
  /** How many slots the account has. Ten for everyone (design §8, Q2). */
  slots: number;
  layouts: Layout[];
}

export interface SaveLayoutResponse extends ApiEnvelope {
  error: number;
  layout: Layout;
}

export interface ApplyLayoutResponse extends ApiEnvelope {
  error: number;
  /** How many buildings changed position. */
  moved: number;
  buildingdata: BuildingDataMap;
}

/**
 * The failure bodies, which are flat rather than wrapped in `errorDetails`.
 *
 * 400 carries `overlapping` or `unknown`, 409 carries `unplaced`. All three are
 * building ids the planner should outline and offer to show, which is why
 * `applyConflictIds` reads them together.
 */
export interface ApplyConflictDetails {
  error?: string;
  unplaced?: number[];
  overlapping?: number[];
  unknown?: number[];
}
