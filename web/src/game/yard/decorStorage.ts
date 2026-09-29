import type { BaseLoadResponse } from "@/api/types";
import { isDecoration } from "./planner/placement";

/**
 * Decoration storage on the client (`docs/design/yard-buildings.md` §8.3,
 * #128): what `researchdata` holds, read the way the server keeps it
 * (`server/src/services/yard/decor.ts`). A count per decoration type in
 * `"b<type>"`; the two Wild Monster totems also keep their level in
 * `"bl<type>"`.
 *
 * Recycling a decoration and a planner Apply that leaves one unplaced put it
 * here; the Build menu's Decorations tab (`decor/place`) and the planner's
 * drawer take it out. Only what is stored can be placed (owner decision
 * 2026-09-29): nothing is bought.
 */

type Researchdata = BaseLoadResponse["researchdata"];

/** The Wild Monster totems keep their level in storage (`BTOTEM.as:264-270`). */
const TOTEM_TYPES: ReadonlySet<number> = new Set([121, 131]);

/** One decoration type in storage. */
export interface StoredDecoration {
  readonly type: number;
  readonly count: number;
  /** The level it comes back at: a totem's stored level, else 1. */
  readonly level: number;
}

const whole = (raw: unknown): number => {
  const value = Math.floor(Number(raw));
  return Number.isFinite(value) && value > 0 ? value : 0;
};

/** How many of `type` are in storage. */
export const storedCount = (researchdata: Researchdata, type: number): number =>
  whole(researchdata?.[`b${type}`]);

/** The level a stored `type` comes back at. */
export const storedLevel = (researchdata: Researchdata, type: number): number =>
  TOTEM_TYPES.has(type) ? whole(researchdata?.[`bl${type}`]) || 1 : 1;

/**
 * The ids the planner gives stored decorations while it is open (#128): one
 * per decoration, `base + type × 1000 + n`, above every building id and the
 * planner's mushrooms (`planner/plan.ts`, `MUSHROOM_ID_BASE`), and stable
 * across a rebase so a decoration the player has put down keeps its node.
 */
export const STORAGE_ID_BASE = 1_500_000;
const STORAGE_ID_END = 2_000_000;
/** Per type; a stock beyond this many shows this many. */
const STORAGE_PER_TYPE = 1_000;

/** Whether `id` is one of {@link STORAGE_ID_BASE}'s. */
export const isStorageId = (id: number): boolean => id >= STORAGE_ID_BASE && id < STORAGE_ID_END;

/** Every decoration type with at least one in storage, lowest type first. */
export const storedDecorations = (researchdata: Researchdata): StoredDecoration[] => {
  const stored: StoredDecoration[] = [];
  for (const key of Object.keys(researchdata ?? {})) {
    const match = /^b(\d+)$/.exec(key);
    if (!match) continue;
    const type = Number(match[1]);
    const count = storedCount(researchdata, type);
    if (!isDecoration(type) || count === 0) continue;
    stored.push({ type, count, level: storedLevel(researchdata, type) });
  }
  return stored.sort((a, b) => a.type - b.type);
};

/**
 * The save with every stored decoration added as a building, for the
 * planner's drawer (#128): the planner draws, carries and places buildings,
 * so a decoration still in storage is handed to it as one, with a
 * {@link STORAGE_ID_BASE} id, which the plan keeps in the drawer and Apply
 * sends as `fromStorage` rather than as a node.
 */
export const withStoredDecorations = (save: BaseLoadResponse): BaseLoadResponse => {
  const stored = storedDecorations(save.researchdata);
  if (stored.length === 0) return save;
  const buildingdata = { ...(save.buildingdata ?? {}) };
  for (const { type, count, level } of stored) {
    for (let n = 0; n < Math.min(count, STORAGE_PER_TYPE); n++) {
      const id = STORAGE_ID_BASE + type * STORAGE_PER_TYPE + n;
      buildingdata[String(id)] = { id, t: type, X: 0, Y: 0, ...(level > 1 ? { l: level } : {}) };
    }
  }
  return { ...save, buildingdata };
};
