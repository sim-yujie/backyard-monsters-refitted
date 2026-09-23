/**
 * Client-wide constants.
 *
 * World and terrain numbers are mirrored from the server so the client can lay
 * out a grid before any network call. Each block names the file it came from;
 * if the server changes one, change it here too.
 */

/**
 * Server origin. Empty string means same-origin, which in development is the
 * Vite dev server proxying every game route to the real server (vite.config.ts).
 */
export const SERVER_URL: string = import.meta.env.VITE_SERVER_URL ?? "";

/**
 * Sent as the `:apiVersion` path segment on `/api/...` routes. The server only
 * enforces a match when USE_VERSION_MANAGEMENT=enabled
 * (server/src/middleware/apiVersioning.ts); otherwise any value passes.
 */
export const API_VERSION: string = import.meta.env.VITE_API_VERSION ?? "v1.6.1-beta";

/* ── Map Room 2 world ──────────────────────────────────────────────────────
 * Source: server/src/enums/MapRoom.ts (MapRoom2) via
 * server/src/config/MapRoom2Config.ts, where WORLD_SIZE = [HEIGHT, WIDTH].
 * The same pair reaches the client as `worldsize` on the /base/load response.
 */
export const WORLD_WIDTH = 800;
export const WORLD_HEIGHT = 800;
export const MAX_PLAYERS_PER_WORLD = 2500;

/* ── Map Room 2 terrain ────────────────────────────────────────────────────
 * Source: server/src/config/MapRoom2Config.ts. The client does not generate
 * terrain, but it needs the bands to colour cells and the water cut-off to
 * know which cells can never be occupied.
 */
export const NOISE_SCALE = 12;
export const TERRAIN_SCALE = 95;
export const EDGE_TRANSITION_WIDTH = 3;
export const MAX_RESOURCE_CAPACITY = 7_046_100_000;

/** A cell is water at height <= 99 (Terrain.WATER3, server/src/enums/MapRoom.ts). */
export const WATER_MAX_HEIGHT = 99;

/* ── Map Room 2 area requests ──────────────────────────────────────────────
 * Source: server/src/controllers/maproom/v2/getArea.ts. The client asks for a
 * zone origin on a multiple of 10; the server iterates x..x+10 inclusive, so a
 * response covers 11 x 11 cells and neighbouring zones overlap by one row and
 * one column.
 */
export const AREA_ZONE_SIZE = 10;
export const AREA_RESPONSE_SPAN = 11;

/* ── Rendering ─────────────────────────────────────────────────────────────
 * Cell art is 150 x 75 with a 0.75 horizontal step, from the Flash client
 * (client/scripts/com/monsters/maproom_advanced/MapRoomPopup.as:44-45).
 */
export const CELL_WIDTH = 150;
export const CELL_HEIGHT = 75;

/** Camera zoom limits. 1 renders cell art at its native size. */
export const MIN_ZOOM = 0.15;
export const MAX_ZOOM = 2.5;
export const DEFAULT_ZOOM = 0.6;

/** localStorage key holding the Bearer token between sessions. */
export const SESSION_STORAGE_KEY = "bymr.session";
