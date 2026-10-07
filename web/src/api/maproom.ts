import { AREA_ZONE_SIZE, WORLD_HEIGHT, WORLD_WIDTH } from "@/config";
import { unlockInbox } from "@/game/achievements/unlockInbox";
import { post, type RequestOptions } from "./http";
import type {
  AchievementUnlock,
  ApiEnvelope,
  GetAreaRequest,
  GetAreaResponse,
  MapCell,
  SightResponse,
  TakeoverQuoteResponse,
} from "./types";

/**
 * Map Room 2 routes. Mounted at /worldmapv2/... with no /api/:apiVersion
 * prefix (docs/server-api.md §Map Room 2).
 */
const GET_AREA_PATH = "/worldmapv2/getarea";
const SIGHT_PATH = "/worldmapv2/sight";

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
 * Fetches the caller's whole Map Room 2 fog of war sight (issue #331,
 * `docs/design/fog-of-war.md` §5.2): every sight circle and always-visible
 * cell, so the map can draw the fog edge and the minimap, and skip a zone
 * entirely outside it with no `getarea` request at all.
 */
export const getSight = (): Promise<SightResponse> => post<SightResponse>(SIGHT_PATH);

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

/* ── Takeover (issue #82) ─────────────────────────────────────────────── */

/**
 * What taking a cell over would cost the caller, and whether the server
 * would allow it now (`POST /worldmapv2/takeoverquote`). Always a 200 with
 * `eligible` and `reason`; a cell the server cannot find answers
 * `reason: "notFound"` with no price.
 */
export const getTakeoverQuote = (baseid: string): Promise<TakeoverQuoteResponse> =>
  post<TakeoverQuoteResponse>("/worldmapv2/takeoverquote", { baseid });

/** How a takeover is paid: Flash's "Use resources" or "Use N Shiny". */
export type TakeoverPayment = "resources" | "shiny";

/** `takeoverCell`'s answer. */
export interface TakeoverCellResponse extends ApiEnvelope {
  /** Paid unlocks not yet shown (#204); absent when none, and while rewards are off. */
  achievements?: AchievementUnlock[];
}

/**
 * Takes the cell over (`POST /worldmapv2/takeoverCell`). The server charges
 * its own price whatever is posted; a positive `shiny` only says which of the
 * two payments was chosen. A refusal is an {@link ApiError} with the reason in
 * `details.data.reason` and Flash's `err_takeoverproblem` suffix as the message.
 * The answer's `achievements` join the unlock pop-up's queue, which shows them
 * on the yard that opens next (`game/achievements/unlockInbox.ts`).
 */
export const takeOverCell = async (baseid: string, payment: TakeoverPayment): Promise<TakeoverCellResponse> => {
  const answer = await post<TakeoverCellResponse>("/worldmapv2/takeoverCell", {
    baseid,
    shiny: payment === "shiny" ? "1" : undefined,
  });
  unlockInbox.add(answer.achievements);
  return answer;
};

/**
 * Turns down the one chance at a destroyed player outpost
 * (`POST /worldmapv2/declinetakeover`, issue #182). Its 8 hours of damage
 * protection start now. `keepalive` lets it go out with a closing page.
 */
export const declineTakeover = (
  baseid: string,
  options: RequestOptions = {},
): Promise<ApiEnvelope & { protectedUntil?: number }> =>
  post<ApiEnvelope & { protectedUntil?: number }>("/worldmapv2/declinetakeover", { baseid }, options);

/* ── Move between own yards (outposts WP7, #186) ───────────────────────── */

/** How a move of the main yard is paid: Flash's "Use Resources" or "Use 1,500 Shiny". */
export type RelocatePayment = "resources" | "shiny";

/**
 * `POST /base/migrate`'s answer: the new home cell, or, inside the day after
 * the last move, when the next one may be made (and nothing was charged).
 */
export interface RelocateResponse extends ApiEnvelope {
  coords?: [number, number];
  cantMoveTill?: number;
  currenttime?: number;
}

/**
 * Moves the main yard onto one of the player's own outposts, destroying the
 * outpost (`PopupRelocateMe.as`). The server charges its own price; a
 * positive `shiny` only says the Shiny button was pressed (issue #181). A
 * refusal is an {@link ApiError} whose message is the reason, for Flash's
 * `msg_err_relocate` prefix.
 */
export const moveMainYard = (baseid: string, payment: RelocatePayment): Promise<RelocateResponse> =>
  post<RelocateResponse>("/base/migrate", {
    type: "outpost",
    baseid,
    shiny: payment === "shiny" ? "1" : "0",
  });

/**
 * Moves monsters between two of the player's yards
 * (`POST /worldmapv2/transferassets`): the counts moved, `{ C1: 5 }` (#196).
 * The server applies them to both yards' rosters as it has them now, so a
 * monster that hatched since the map was read stays where it is; Flash posted
 * both whole rosters instead (`MapRoom.as:856-888`), which dropped it. The
 * server checks the source houses them and the target can house the result.
 */
export const transferMonsters = (
  frombaseid: string,
  tobaseid: string,
  moved: Readonly<Record<string, number>>,
): Promise<ApiEnvelope> =>
  post<ApiEnvelope>("/worldmapv2/transferassets", {
    frombaseid,
    tobaseid,
    moved: JSON.stringify(moved),
  });
