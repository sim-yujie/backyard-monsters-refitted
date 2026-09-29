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
