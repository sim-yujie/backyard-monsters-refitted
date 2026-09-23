import type {
  ApplyLayoutResponse,
  BuildingDataMap,
  Layout,
  LayoutPayload,
  LayoutsResponse,
  SaveLayoutResponse,
} from "./types";
import { LAYOUT_VERSION } from "./types";

/**
 * A stand-in for the Yard Planner routes while the server grows them.
 *
 * `yardplanner.ts` probes the real `GET .../layouts` once per session and only
 * falls back here on a 404, so this disappears the moment the routes land
 * without a line changing anywhere else. Everything is kept in `localStorage`
 * under one key so a reload behaves like a real account would, which is what
 * makes the save-reload-load path testable before the server exists.
 *
 * Apply is the one call that cannot be faked honestly: nothing here writes to
 * the real save. It returns the `buildingdata` the layout describes so the
 * client's own post-apply path can be exercised, and `yardplanner.ts` reports
 * that the yard was not actually written.
 */

const STORE_KEY = "bymr.yardplanner.mock";

const readStore = (): Record<string, Layout> => {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, Layout>) : {};
  } catch {
    // A private window, a cleared profile or a half-written value: start empty
    // rather than failing the panel.
    return {};
  }
};

const writeStore = (store: Record<string, Layout>): void => {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    // Storage full or blocked. The layout is lost on reload, which is the same
    // failure the real route would show as a network error.
  }
};

/** Slot count, fixed at ten for every account (design §8, Q2). */
const MOCK_SLOTS = 10;

export const mockListLayouts = (): LayoutsResponse => {
  const store = readStore();
  const layouts = Object.values(store)
    .filter((layout) => layout.slot >= 0 && layout.slot < MOCK_SLOTS)
    .sort((a, b) => a.slot - b.slot);
  return { error: 0, slots: MOCK_SLOTS, layouts };
};

export const mockSaveLayout = (
  slot: number,
  name: string,
  payload: LayoutPayload,
): SaveLayoutResponse => {
  const store = readStore();
  const layout: Layout = {
    slot,
    name,
    version: payload.version || LAYOUT_VERSION,
    expansion: payload.expansion,
    updatedAt: Math.floor(Date.now() / 1000),
    nodes: payload.nodes,
  };
  store[String(slot)] = layout;
  writeStore(store);
  return { error: 0, layout };
};

export const mockDeleteLayout = (slot: number): void => {
  const store = readStore();
  delete store[String(slot)];
  writeStore(store);
};

/**
 * Turns a layout into the `buildingdata` an apply would have written.
 *
 * The real route merges the layout's positions into the stored save and hands
 * the whole map back; this builds an equivalent map from the layout alone,
 * which is enough for the client to prove it repositions its own yard.
 */
export const mockApplyLayout = (payload: LayoutPayload): ApplyLayoutResponse => {
  const buildingdata: BuildingDataMap = {};
  for (const node of payload.nodes) {
    buildingdata[String(node.id)] = {
      id: node.id,
      t: node.t,
      X: node.x,
      Y: node.y,
      ...(node.l !== undefined ? { l: node.l } : {}),
      ...(node.fort ? { fort: node.fort } : {}),
    };
  }
  return { error: 0, moved: payload.nodes.length, buildingdata };
};
