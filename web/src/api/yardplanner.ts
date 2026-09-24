import { ApiError, get, post, send } from "./http";
import type {
  ApplyLayoutResponse,
  Layout,
  LayoutPayload,
  LayoutsResponse,
  SaveLayoutResponse,
  TrapPlacement,
  TrapRearmResponse,
  WallUpgradeResponse,
} from "./types";

/**
 * Yard Planner layout slots.
 *
 * Routes (docs/design/yard-planner-redesign.md §8, Q2 — ten slots for everyone,
 * enforced server-side):
 *
 *   GET    /api/:apiVersion/bm/yardplanner/layouts
 *   PUT    /api/:apiVersion/bm/yardplanner/layouts/:slot   name, data
 *   DELETE /api/:apiVersion/bm/yardplanner/layouts/:slot
 *   POST   /api/:apiVersion/bm/yardplanner/apply           data
 *   POST   /api/:apiVersion/bm/yardplanner/walls/upgrade   ids, level
 *   POST   /api/:apiVersion/bm/yardplanner/traps/rearm     traps
 *
 * `data` is a JSON *string* in a single form field, the same convention every
 * other structured field on this server uses (see `http.ts`, `encodeForm`).
 * Inside it, a node's position is lower-case `x` and `y` — see `LayoutNode`,
 * which is not a `buildingdata` row however similar it looks.
 */

const LAYOUTS_PATH = "/api/:apiVersion/bm/yardplanner/layouts";
const APPLY_PATH = "/api/:apiVersion/bm/yardplanner/apply";
const WALLS_UPGRADE_PATH = "/api/:apiVersion/bm/yardplanner/walls/upgrade";
const TRAPS_REARM_PATH = "/api/:apiVersion/bm/yardplanner/traps/rearm";

/** Names are trimmed and cut to this length before being sent. */
export const MAX_LAYOUT_NAME_LENGTH = 20;

/** Trims and caps a layout name the way the save dialog does. */
export const normaliseLayoutName = (name: string): string =>
  name.trim().slice(0, MAX_LAYOUT_NAME_LENGTH);

/** Every saved layout, with the number of slots the account has. */
export const listLayouts = (): Promise<LayoutsResponse> => get<LayoutsResponse>(LAYOUTS_PATH);

/** Writes a layout into a slot, replacing whatever was there. */
export const saveLayout = async (
  slot: number,
  name: string,
  payload: LayoutPayload,
): Promise<Layout> => {
  const response = await send<SaveLayoutResponse>("PUT", `${LAYOUTS_PATH}/${slot}`, {
    form: { name: normaliseLayoutName(name), data: JSON.stringify(payload) },
  });
  return response.layout;
};

/** Empties a slot. */
export const deleteLayout = async (slot: number): Promise<void> => {
  await send("DELETE", `${LAYOUTS_PATH}/${slot}`);
};

/**
 * Writes a layout's positions into the real yard, and optionally starts the
 * upgrades its nodes have planned.
 *
 * Success carries the new `buildingdata`, which the caller uses to rebuild its
 * own model rather than re-fetching the save — the response is the save as the
 * server now holds it, so re-reading it is the honest move and assuming the
 * client's plan won is not. With `startUpgrades` it also carries `resources`
 * and an `upgrades` report of what started, finished, waited and was skipped
 * (`docs/design/planner-upgrades.md` §3.2).
 *
 * The flag is a form field rather than a second route because one Apply has to
 * be one transaction: one timer advance, one `savetime`, one flush (§8, Q1).
 * The moves are all-or-nothing as they have always been; the upgrades are
 * partial by design and reported, never a reason to refuse the request.
 */
export const applyLayout = (
  payload: LayoutPayload,
  options: { startUpgrades?: boolean } = {},
): Promise<ApplyLayoutResponse> =>
  post<ApplyLayoutResponse>(APPLY_PATH, {
    data: JSON.stringify(payload),
    ...(options.startUpgrades ? { startUpgrades: "1" } : {}),
  });

/** Every detail key a rejection can carry a list of building ids under. */
const CONFLICT_KEYS = [
  "unplaced",
  "overlapping",
  "unknown",
  "notWalls",
  "alreadyAtLevel",
  "busy",
  "damaged",
  "planLevel",
  "planCaughtUp",
] as const;

/**
 * Raises every listed wall to `level` in one charged, instant step.
 *
 * `ids` goes over the wire as a JSON string in a single form field, the same
 * convention `data` uses on save and apply. The response carries the save's own
 * `resources` and `buildingdata` afterwards, so the caller rebuilds its yard
 * from the server's answer rather than from its own preview.
 */
export const upgradeWalls = (ids: number[], level: number): Promise<WallUpgradeResponse> =>
  post<WallUpgradeResponse>(WALLS_UPGRADE_PATH, { ids: JSON.stringify(ids), level });

/**
 * Builds a trap at each position, which is what re-arming a fired trap is.
 *
 * A trap that fires is deleted from the save, so there is nothing to revive:
 * the server allocates fresh ids and charges the build cost, and the 5-second
 * countdown completes on the spot under the free-finish rule.
 */
export const rearmTraps = (traps: readonly TrapPlacement[]): Promise<TrapRearmResponse> =>
  post<TrapRearmResponse>(TRAPS_REARM_PATH, { traps: JSON.stringify(traps) });

/**
 * Building ids the server named as the reason a call failed.
 *
 * The error bodies are flat and carry the ids under whichever key fits the
 * fault: `overlapping` and `unknown` on a 400, `unplaced` on a 409, the batch
 * wall upgrade's own four — `notWalls`, `alreadyAtLevel`, `busy` and
 * `damaged` — and the two a planned upgrade can trip, `planLevel` for a target
 * past the ladder and `planCaughtUp` for one a save says the yard has already
 * reached. They all mean the same thing to the planner — outline these and
 * show them to the player — so they are read together rather than teaching the
 * UI a shape per route.
 */
export const applyConflictIds = (caught: unknown): number[] => {
  if (!(caught instanceof ApiError)) return [];

  const sources: unknown[] = [caught.body, caught.details?.data];
  const ids = new Set<number>();

  for (const source of sources) {
    if (typeof source !== "object" || source === null) continue;
    const record = source as Record<string, unknown>;
    for (const key of CONFLICT_KEYS) {
      const value = record[key];
      if (!Array.isArray(value)) continue;
      for (const id of value) if (typeof id === "number") ids.add(id);
    }
  }

  return [...ids];
};
