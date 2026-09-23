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

/**
 * Camera zoom limits. 1 renders cell art at its native size.
 *
 * MIN_ZOOM is set so the whole world fits a 1080p viewport. The grid is
 * 112.5 x 75 world pixels per cell, so 800 x 800 cells span 90,075 x 60,075
 * pixels; 1080 / 60,075 = 0.01798 is the binding constraint (height, not
 * width). 0.0175 clears it with a little margin on both axes.
 */
export const MIN_ZOOM = 0.0175;
export const MAX_ZOOM = 2.5;
export const DEFAULT_ZOOM = 0.6;

/* ── Level of detail ───────────────────────────────────────────────────────
 * Four thresholds, each chosen by what is legible and then checked against the
 * frame budget, because both constraints point the same way: a cell too small
 * to read is also a cell there are too many of.
 *
 * At zoom z a 1920 x 1080 viewport covers 245.8 / z^2 cells.
 *
 *   LOD_HEX_ZOOM   0.22  cell 24.8 x 16.5 px, ~5,100 cells. Below this the
 *                        renderer switches to the one-texel-per-cell raster;
 *                        hex outlines have stopped reading by then and the
 *                        count doubles for every 30% of zoom given up. Measured
 *                        at 0.16 the rebuild cost was ~10 ms a frame during a
 *                        continuous zoom, against ~4 ms here.
 *   LOD_GLYPH_ZOOM 0.30  cell 33.8 px. Camp glyphs appear. Below it almost
 *                        every land cell is a camp, so the tents are noise
 *                        rather than information, and skipping them halves the
 *                        geometry in the band that costs the most.
 *   LOD_BADGE_ZOOM 0.55  cell 61.9 px, ~810 cells: room for a two-digit level.
 *   LOD_LABEL_ZOOM 0.90  cell 101 px, ~300 cells: room for a name.
 */
export const LOD_HEX_ZOOM = 0.22;
export const LOD_GLYPH_ZOOM = 0.3;
export const LOD_BADGE_ZOOM = 0.55;
export const LOD_LABEL_ZOOM = 0.9;

/**
 * Upper bound on text objects the map may hold at once.
 *
 * Text is the expensive part of the map: every badge and name is its own
 * display object with its own transform. Three things set the size of this
 * number, and the cap has to clear all of them or labels go missing from cells
 * that should have them:
 *
 *   - a cell at the label tier carries two lines, the name and the level;
 *   - text is built per chunk, and a chunk is ten cells square, so the visible
 *     set is rounded up to whole chunks — at the label threshold that is about
 *     16 chunks, or 1,600 cells;
 *   - the badge tier has no names but many more cells: about 20 chunks.
 *
 * 3,200 is the worst of those. 4,000 leaves room for a taller window without
 * pretending the objects are free.
 */
export const MAX_TEXT_OBJECTS = 4_000;

/**
 * Hard cap on hexes built in one geometry pass. At LOD_HEX_ZOOM a 1080p
 * viewport covers about 5,100 cells; the cap is the safety net for a much
 * taller window, not the normal path.
 */
export const MAX_HEX_CELLS = 16_000;

/* ── Zone request budget ───────────────────────────────────────────────────
 * The server allows 120 getarea requests per minute per user
 * (server/src/middleware/rateLimiters.ts, koa2-ratelimit fixed window).
 *
 * A token bucket admits at most `capacity + rate * window` requests in any
 * window, so 20 + 1.5 * 60 = 110 per minute is the worst case here: a burst of
 * 20 to fill the first screen quickly, then a sustained 90/min. The 10-request
 * gap absorbs clock skew between the browser and the server's window edges.
 */
export const AREA_BURST = 20;
export const AREA_REFILL_PER_SECOND = 1.5;

/** Parallel getarea requests. The old Flash client managed one; four keeps the
 * pipe busy without making the priority order meaningless. */
export const AREA_MAX_CONCURRENT = 4;

/**
 * A visible zone older than this is refetched.
 *
 * The Flash client used 30 s plus 0..9 s of jitter (MapRoom.as:521, :634) and
 * stacked a 10-tick per-sprite gate on top, so a cell could lag reality by 40 s.
 * 60 s here covers the same ground at half the request rate, which matters
 * because the web client's viewport is far larger than the old 16 x 14 grid.
 * Camp damage and destroyed state therefore stay fresh without opening a yard —
 * as fresh as the server is willing to report it (docs/specs/maproom2.md §5
 * records that getarea itself never expires a wild monster save).
 */
export const ZONE_STALE_SECONDS = 60;

/** Jitter fraction on the staleness threshold, so zones do not all expire on
 * the same tick and empty the token bucket in one go. */
export const ZONE_STALE_JITTER = 0.25;

/** How often one area request also asks for the caller's resources, which is
 * what keeps the HUD numbers live. The Flash client used 20 s. */
export const RESOURCE_SYNC_SECONDS = 30;

/** localStorage key holding the Bearer token between sessions. */
export const SESSION_STORAGE_KEY = "bymr.session";
