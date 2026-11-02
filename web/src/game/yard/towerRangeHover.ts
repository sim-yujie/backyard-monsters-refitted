import { buildingClass, isBunker, towerRange, towerStats } from "@/game/combat/rules";
import { BuildingCondition, type Yard, type YardBuilding } from "./yardModel";

/**
 * The faint range oval a defence shows while the mouse rests on it in the
 * player's own yard (owner, beta 6 grill, 2 Nov 2026).
 *
 * Flash's `RangeIndicator` (`client/scripts/BTOWER.as:490-529`, the same code
 * in `BUILDING22.as:607-645` and `HOUSINGBUNKER.as:377-415`): 0.25 s after the
 * pointer comes over a tower, one white ellipse — fill at 10 %, a one-pixel
 * edge at 25 % — grows out of the tower's middle in 0.25 s (`TweenLite.from`
 * alpha 0.5, scaleX 0.25, scaleY 0, `Expo.easeOut`), and goes the moment the
 * pointer leaves. Drawn on `MAP._BUILDINGFOOTPRINTS`, under the buildings.
 *
 * Its size is the range the combat engine fires at, not a second number: a
 * tower's `towerRange` (Map Room 2 height stretch included, `stats.ts`) and a
 * bunker's table range, which the engine also reads unstretched
 * (`engine.ts` bunker dispatch, `BUILDING22.as:485`).
 */

/** Seconds the pointer must rest before the oval starts (`TweenLite.delayedCall(0.25, …)`). */
export const RANGE_HOVER_DELAY = 0.25;
/** Seconds the oval takes to grow to full size (`TweenLite.from(…, 0.25, …)`). */
export const RANGE_HOVER_GROW = 0.25;
/** `beginFill(0xFFFFFF, 0.1)`. */
export const RANGE_FILL_ALPHA = 0.1;
/** `lineStyle(1, 0xFFFFFF, 0.25)`. */
export const RANGE_EDGE_ALPHA = 0.25;
export const RANGE_COLOUR = 0xffffff;

/** What the yard knows that decides whether, and how far, an oval is drawn. */
export type RangeHoverYard = Pick<Yard, "foreign" | "kind" | "cellHeight">;

/**
 * The range, in yard units, to show for `building`, or null for no oval.
 *
 * Null on somebody else's yard (visit, attack, replay): Flash only drew it in
 * BUILD mode, and the owner keeps it to the player's own yards. Null for
 * anything that is not a defence (`buildingClass` "tower": the towers, the
 * Inferno towers and both Monster Bunkers; never a trap), and — Flash's
 * `Over` condition — for one still at level 0, with a build, upgrade or
 * fortify countdown, or with no health left.
 */
export const hoverRange = (building: YardBuilding, yard: RangeHoverYard): number | null => {
  if (yard.foreign) return null;
  if (buildingClass(building.type) !== "tower") return null;
  if (building.level <= 0) return null;
  // Any countdown: build, upgrade, fortify, or the rebuild a destroyed one waits on.
  if (building.countdown !== null) return null;
  if (building.condition === BuildingCondition.DESTROYED) return null;
  if (building.hp !== null && building.hp <= 0) return null;

  const range = isBunker(building.type)
    ? towerStats(building.type, building.level, yard.kind)?.range
    : towerRange(building.type, building.level, yard.kind, yard.cellHeight);
  return range !== undefined && range > 0 ? range : null;
};

/** `Expo.easeOut` from GreenSock: `1 - 2^(-10 t)`, landing on exactly 1. */
export const expoEaseOut = (t: number): number => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));

/** One frame of the oval: its opacity and its scale on each axis. */
export interface RangeHoverFrame {
  readonly alpha: number;
  readonly scaleX: number;
  readonly scaleY: number;
}

/**
 * How the oval looks `elapsed` seconds after the pointer came over the tower,
 * or null while the delay is still running.
 *
 * `TweenLite.from` tweens from the given values to the shape's own (alpha 1,
 * scale 1), so alpha runs 0.5 → 1, scaleX 0.25 → 1 and scaleY 0 → 1.
 */
export const rangeHoverFrame = (elapsed: number): RangeHoverFrame | null => {
  if (elapsed < RANGE_HOVER_DELAY) return null;
  const t = expoEaseOut(Math.min(1, (elapsed - RANGE_HOVER_DELAY) / RANGE_HOVER_GROW));
  return {
    alpha: 0.5 + 0.5 * t,
    scaleX: 0.25 + 0.75 * t,
    scaleY: t,
  };
};

/**
 * Whether a pointer can hover at all. Desktop only (owner): a finger has no
 * hover, and a touch drag over a tower must not leave an oval behind, so only
 * a mouse counts — not touch, not a pen.
 */
export const pointerHovers = (pointerType: string): boolean => pointerType === "mouse";
