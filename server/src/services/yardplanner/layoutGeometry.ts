import { footprintOf, MUSHROOM_TYPE } from "../../game-data/buildingFootprints.js";
import type { JsonObject } from "../../types/JsonObject.js";

/**
 * Yard geometry for the Yard Planner: how big the plot is at each expansion
 * level, and whether two footprints collide.
 *
 * This is the server half of `web/src/game/yard/YardGrid.ts`. The two must
 * agree exactly or a layout the client drew as legal would be rejected here, so
 * the plot ladder is computed with the same compounding as the client's
 * `YARD_SIZES` rather than being transcribed as a table — see that file for why
 * the two differ from the Flash planner's own hardcoded ladder at one rung.
 */

/** The most "More Yardage" purchases an account can hold. */
export const MAX_EXPANSIONS = 6;

/**
 * Plot dimensions in yard units, indexed by `storedata.ENL.q`.
 *
 * `STORE.ProcessPurchases` starts at 1000 x 800, multiplies both axes by 1.1
 * once per purchase with no rounding in between, and rounds up to a multiple of
 * 20 only at the end (`client/scripts/STORE.as:2346-2365`).
 */
export const YARD_SIZES: readonly (readonly [width: number, height: number])[] = (() => {
  const sizes: [number, number][] = [];
  for (let purchases = 0; purchases <= MAX_EXPANSIONS; purchases++) {
    let width = 1000;
    let height = 800;
    for (let i = 0; i < purchases; i++) {
      width *= 1.1;
      height *= 1.1;
    }
    sizes.push([Math.ceil(width / 20) * 20, Math.ceil(height / 20) * 20]);
  }
  return sizes;
})();

/**
 * The planner's separate, much larger bound for decorations
 * (`client/scripts/com/monsters/baseplanner/PlannerDesignView.as:104`, applied
 * at `:576-579`). Decorations may be placed outside the plot in the live yard
 * too (`client/scripts/BASE.as:4635-4640`), so the Flash planner allowed this
 * and so do we.
 */
export const MAX_YARD_DIMENSIONS: readonly [width: number, height: number] = [3240, 2600];

/** Plot size in yard units for an expansion level, clamped to the ladder. */
export const yardSize = (expansion: number): readonly [number, number] => {
  const index = Math.min(Math.max(Math.trunc(expansion) || 0, 0), YARD_SIZES.length - 1);
  return YARD_SIZES[index] ?? YARD_SIZES[0]!;
};

/**
 * The caller's current expansion level, from `storedata.ENL.q`.
 *
 * Absent or malformed store data means no purchases, which is the same default
 * the client falls back to.
 */
export const currentExpansion = (storedata: JsonObject | null | undefined): number => {
  const enl = (storedata as Record<string, { q?: unknown }> | null | undefined)?.ENL;
  const quantity = Number(enl?.q);
  if (!Number.isFinite(quantity)) return 0;
  return Math.min(Math.max(Math.trunc(quantity), 0), MAX_EXPANSIONS);
};

/** An axis-aligned footprint rectangle in yard units, `[x, x + w) x [y, y + h)`. */
export interface FootprintRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The rectangle a building of `type` occupies when its origin is at `(x, y)`. */
export const rectOf = (type: number, x: number, y: number): FootprintRect => {
  const { w, h } = footprintOf(type);
  return { x, y, w, h };
};

/** Whether two footprint rectangles share any area. Touching edges do not count. */
export const overlaps = (a: FootprintRect, b: FootprintRect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Whether a footprint fits inside the plot.
 *
 * The plot spans `[-width/2, width/2) x [-height/2, height/2)`
 * (`docs/specs/base-building.md` §2) and a footprint extends positively from its
 * origin (`client/scripts/GRID.as:86-98`), so the origin must be at least a
 * whole footprint short of the far edge. Decorations are measured against
 * {@link MAX_YARD_DIMENSIONS} instead.
 */
export const withinBounds = (rect: FootprintRect, type: number, expansion: number): boolean => {
  const [width, height] = footprintOf(type).decoration
    ? MAX_YARD_DIMENSIONS
    : yardSize(expansion);
  const halfW = width / 2;
  const halfH = height / 2;
  return (
    rect.x >= -halfW &&
    rect.x + rect.w <= halfW &&
    rect.y >= -halfH &&
    rect.y + rect.h <= halfH
  );
};

/**
 * Mushroom footprints from `save.mushrooms`, which stores `{ l: [[frame, X, Y], ...] }`
 * (`client/scripts/MUSHROOMS.as:84-90`). Entries that are not a usable
 * coordinate pair are skipped rather than treated as an obstacle at the origin.
 */
export const mushroomRects = (mushrooms: JsonObject | null | undefined): FootprintRect[] => {
  const list = (mushrooms as { l?: unknown } | null | undefined)?.l;
  if (!Array.isArray(list)) return [];

  const rects: FootprintRect[] = [];
  for (const entry of list.slice(0, 20)) {
    if (!Array.isArray(entry)) continue;
    const x = Number(entry[1]);
    const y = Number(entry[2]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    rects.push(rectOf(MUSHROOM_TYPE, x, y));
  }
  return rects;
};
