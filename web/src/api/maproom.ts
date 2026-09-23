import { AREA_ZONE_SIZE, WORLD_HEIGHT, WORLD_WIDTH } from "@/config";
import { post } from "./http";
import type { GetAreaRequest, GetAreaResponse, MapCell } from "./types";

/**
 * Map Room 2 routes. Mounted at /worldmapv2/... with no /api/:apiVersion
 * prefix (docs/server-api.md §Map Room 2).
 */
const GET_AREA_PATH = "/worldmapv2/getarea";

/**
 * Rounds a coordinate down to a zone origin.
 *
 * The client divides the world into 10 x 10 zones aligned to multiples of 10
 * and asks for one zone at a time (docs/specs/maproom2.md §2). The server then
 * iterates x..x+10 inclusive, so what comes back is 11 x 11 and neighbouring
 * zones overlap by one row and one column.
 */
export const zoneOrigin = (value: number): number =>
  Math.floor(value / AREA_ZONE_SIZE) * AREA_ZONE_SIZE;

/** Stable id for a zone, matching the Flash client's `zoneX * 10000 + zoneY`. */
export const zoneId = (originX: number, originY: number): number =>
  (originX / AREA_ZONE_SIZE) * 10000 + originY / AREA_ZONE_SIZE;

/**
 * Fetches one area of the Map Room 2 grid.
 *
 * `x` and `y` are the zone origin, coerced to ints in 0..799 by the server's
 * zod schema; anything outside that range is a 400. `width` and `height` exist
 * in the old client's request but the server hardcodes both to 10 and ignores
 * what is sent, so they are not included here.
 *
 * No field on this call is a JSON string.
 *
 * The route sits behind verifyAccountStatus, so an account without an aged
 * Discord link gets a 401. It is also rate limited to 120 requests per minute
 * per user, which caps how fast the map may be panned.
 */
export const getArea = async (
  x: number,
  y: number,
  options: { sendResources?: boolean } = {},
): Promise<GetAreaResponse> => {
  const body: GetAreaRequest = {
    x: clampCoordinate(x, WORLD_WIDTH),
    y: clampCoordinate(y, WORLD_HEIGHT),
    sendresources: options.sendResources ? 1 : 0,
  };

  return post<GetAreaResponse>(GET_AREA_PATH, { ...body });
};

const clampCoordinate = (value: number, size: number): number =>
  Math.min(Math.max(Math.trunc(value), 0), size - 1);

/**
 * Reads one cell out of an area response.
 *
 * The payload is indexed `data[x][y]` with string keys, exactly as the server
 * builds it and the old client stored it.
 */
export const cellAt = (response: GetAreaResponse, x: number, y: number): MapCell | undefined =>
  response.data[String(x)]?.[String(y)];

/** Walks every cell in an area response with its coordinates. */
export function* iterateCells(
  response: GetAreaResponse,
): Generator<{ x: number; y: number; cell: MapCell }> {
  for (const [xKey, column] of Object.entries(response.data)) {
    const x = Number(xKey);
    for (const [yKey, cell] of Object.entries(column)) {
      yield { x, y: Number(yKey), cell };
    }
  }
}
