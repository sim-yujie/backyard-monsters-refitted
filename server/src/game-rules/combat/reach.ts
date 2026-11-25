/**
 * Named distances (beta 9, reach audit): every reach rule says in its name
 * which space it measures in and from which point of a building.
 *
 * Flash measured some rules on screen (pixels, `_tmpPoint` and `_position`)
 * and others in yard units (`FromISO` points), some from a building's drawn
 * top corner and others from the middle of its footprint. A yard circle is
 * not a screen circle (a screen pixel is 0.71 yard units straight across and
 * 1.41 straight down), and the corner is half a footprint from the middle,
 * so a rule measured in the wrong space or from the wrong point reaches
 * further on some sides than on others. Two such slips (splash on buildings,
 * Eye-ra's blast on the monster it fights) went unnoticed for weeks, and a
 * third difference, a tower's hold on its target, is kept on purpose
 * ({@link towerHolds}); `reach.test.ts` keeps a table of every rule here
 * against Flash, and `rawDistance.test.ts` stops new unnamed distance sums in
 * `engine.ts`.
 *
 * Spaces: `screenPx` is screen pixels; `yard` is yard units. Anchors:
 * `Corner` is a building's drawn top corner (`_position`, `sx`/`sy`);
 * `Anchor` is the same corner in yard units (`cx`/`cy`, the stored X/Y);
 * `Centre` is the middle of the footprint ({@link towerScanPoint}).
 *
 * Only `+ - * /` and `Math.trunc`/`Math.ceil`/`Math.sqrt` here, so the server
 * and every browser agree to the bit.
 */

import type { EngineBuilding } from "./yard.js";
import { distanceSquared, screenDistanceSquared, screenPointOf, towerScanPoint } from "./yard.js";

/** A creep's position as the reach rules read it: `_tmpPoint` in yard units. */
export interface ReachPoint {
  /** The exact yard point of `_tmpPoint`. */
  readonly ix: number;
  readonly iy: number;
  /** `PATHING.FromISO(_tmpPoint)`, truncated ({@link rangePointOf}). */
  readonly x: number;
  readonly y: number;
}

/* ── Distances ────────────────────────────────────────────────────────────── */

/**
 * Screen pixels, squared, from a yard point's screen point (a creep's
 * `_tmpPoint`) to a building's drawn top corner (`_position`): what
 * `Targeting.getBuildingsInRange` (`Targeting.as:151-173`) measures, and with
 * it every splash and quake on buildings.
 */
export const screenPxToCornerSquared = (
  ix: number,
  iy: number,
  building: EngineBuilding,
): number => {
  const at = screenPointOf(ix, iy);
  return distanceSquared(at.x, at.y, building.sx, building.sy);
};

/** Yard units, squared, from a yard point to a building's anchor (`cx`/`cy`, its stored X/Y). */
export const yardToAnchorSquared = (x: number, y: number, building: EngineBuilding): number =>
  distanceSquared(x, y, building.cx, building.cy);

/**
 * Yard units, squared, from a yard point to the middle of a building's
 * footprint ({@link towerScanPoint}): where a tower looks for targets from.
 */
export const yardToCentreSquared = (x: number, y: number, building: EngineBuilding): number => {
  const scan = towerScanPoint(building);
  return distanceSquared(scan.x, scan.y, x, y);
};

/**
 * Screen pixels, squared, between two creeps' `_tmpPoint`s: what Flash's
 * creep-against-creep tests measure (`_tmpPoint.subtract`, `QuickDistance`).
 */
export const screenPxCreepsSquared = (
  one: { readonly ix: number; readonly iy: number },
  other: { readonly ix: number; readonly iy: number },
): number => screenDistanceSquared(one.ix, one.iy, other.ix, other.iy);

/* ── Rules ────────────────────────────────────────────────────────────────── */

/**
 * How far a splash or quake centred on a creep is from a building, in screen
 * pixels, or `undefined` when it is out of `radius`:
 * `int(QuickDistanceSquared(_tmpPoint, _mc)) < radius * radius`, the distance
 * the square root of that (`Targeting.as:163-167`), which the falloff reads
 * (`DealLinearAEDamage`, `:358-361`).
 */
export const screenPxBlastDistance = (
  ix: number,
  iy: number,
  building: EngineBuilding,
  radius: number,
): number | undefined => {
  const squared = Math.trunc(screenPxToCornerSquared(ix, iy, building));
  return squared < radius * radius ? Math.sqrt(squared) : undefined;
};

/**
 * Whether a tower finds a creep: within `range` yard units of the middle of
 * its footprint (`FindTargets`, `BTOWER.as:394`; `getCreepsInRange`'s
 * `int(QuickDistanceSquared) < range * range`, `Targeting.as:241`).
 */
export const towerAcquires = (
  creep: ReachPoint,
  building: EngineBuilding,
  range: number,
): boolean => Math.trunc(yardToCentreSquared(creep.x, creep.y, building)) < range * range;

/**
 * Whether a tower may go on shooting a creep it found: within `range` yard
 * units of the middle of its footprint, where it found it
 * ({@link towerAcquires}).
 *
 * Deliberately not Flash. Flash's `targetInRange` (`BTOWER.as:234-249`)
 * means to measure from the middle too, but `Point.add` returns a new point
 * and the result of `_loc2_.add(...)` at `BTOWER.as:238` is thrown away, so
 * it measures from `GRID.FromISO(_mc)`, the anchor: a creep in front of a
 * tower, in range of the middle but not of the anchor, is found every round
 * and never shot. The owner kept towers as they are (pick B, reach-merge,
 * 25 Nov 2026), so here the hold is measured from the middle and that creep
 * is shot. `reach.test.ts` keeps the difference in its table.
 */
export const towerHolds = (
  creep: { readonly x: number; readonly y: number },
  building: EngineBuilding,
  range: number,
): boolean => yardToCentreSquared(creep.x, creep.y, building) < range * range;
