import { ApiError, get, post, send } from "./http";
import type {
  ApplyLayoutResponse,
  Layout,
  LayoutPayload,
  LayoutsResponse,
  SaveLayoutResponse,
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
 *
 * `data` is a JSON *string* in a single form field, the same convention every
 * other structured field on this server uses (see `http.ts`, `encodeForm`).
 * Inside it, a node's position is lower-case `x` and `y` — see `LayoutNode`,
 * which is not a `buildingdata` row however similar it looks.
 */

const LAYOUTS_PATH = "/api/:apiVersion/bm/yardplanner/layouts";
const APPLY_PATH = "/api/:apiVersion/bm/yardplanner/apply";

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
 * Writes a layout's positions into the real yard.
 *
 * Success carries the new `buildingdata`, which the caller uses to rebuild its
 * own model rather than re-fetching the save — the response is the save as the
 * server now holds it, so re-reading it is the honest move and assuming the
 * client's plan won is not.
 */
export const applyLayout = (payload: LayoutPayload): Promise<ApplyLayoutResponse> =>
  post<ApplyLayoutResponse>(APPLY_PATH, { data: JSON.stringify(payload) });

/**
 * Building ids the server named as the reason a call failed.
 *
 * The error bodies are flat and carry the ids under whichever key fits the
 * fault: `overlapping` and `unknown` on a 400, `unplaced` on a 409. All three
 * mean the same thing to the planner — outline these and show them to the
 * player — so they are read together rather than teaching the UI three shapes.
 */
export const applyConflictIds = (caught: unknown): number[] => {
  if (!(caught instanceof ApiError)) return [];

  const sources: unknown[] = [caught.body, caught.details?.data];
  const ids = new Set<number>();

  for (const source of sources) {
    if (typeof source !== "object" || source === null) continue;
    const record = source as Record<string, unknown>;
    for (const key of ["unplaced", "overlapping", "unknown"]) {
      const value = record[key];
      if (!Array.isArray(value)) continue;
      for (const id of value) if (typeof id === "number") ids.add(id);
    }
  }

  return [...ids];
};
