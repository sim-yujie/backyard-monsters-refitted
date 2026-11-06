/**
 * Marilyn Monstroe, the Decoy, in the fight (Inferno WP 6.5,
 * `docs/design/inferno.md` S6): the figures and the geometry the engine's
 * Decoy reads, each from Flash's `com/monsters/siege/weapons/Decoy.as`.
 *
 * The weapon falls for 0.6 s (`onActivation`, its `TweenLite.from`), then
 * every frame pulls the defenders within its range to stand around it and
 * empties the bunkers its range touches (`updateDecoy`). Its timer runs from
 * the drop, `duration` seconds (`SiegeWeapons.activateWeapon`), and when it
 * runs out it blows up (`onDeactivation`): `DealLinearAEDamage` over its range
 * at the defenders in it and every building but a mushroom closer than
 * {@link DECOY_BUILDING_REACH} of it, and everyone it held goes back to
 * defending.
 *
 * Positions here are screen points (`screenOf`, `screenPointOf`), the space
 * Flash measured all of this in.
 */

import { DECOY, decoyDamage, siegeLevel, siegeValue } from "./siege.js";
import { ellipseEdgeSquared, squashedEllipse, TICKS_PER_SECOND } from "./stats.js";
import type { Rng } from "./rng.js";
import type { Cart } from "./yard.js";

/** The fall before it lands and starts to pull: 0.6 s (`Decoy.as:206-210`). */
export const DECOY_FALL_TICKS = Math.round(0.6 * TICKS_PER_SECOND);

/**
 * It pulls on its own `ENTER_FRAME` (`Decoy.as:318-330`), a frame of the
 * 40 fps stage: every second tick, from the one it lands on.
 */
export const DECOY_FRAME_TICKS = 2;

/**
 * Half the height of its wave animation, 70 px a frame (`SPRITES.as:92`):
 * the defenders gather this far below the drop point (`CreepBase.as:503`).
 */
export const DECOY_STAND_DROP = 35;

/** The blast reaches a building closer than this share of the range (`Decoy.as:286`). */
export const DECOY_BUILDING_REACH = 0.65;

/** A flyer this close to where they gather, squared, stays put (`CreepBase.as:536`). */
export const DECOY_FLYER_STAY_SQUARED = 2_500;

/** One Decoy dropped at a level, on the battle's clock. */
export interface DecoyPlan {
  readonly range: number;
  readonly damage: number;
  /** The tick it lands and starts to pull. */
  readonly landsAt: number;
  /** The tick it blows up: `duration` seconds after the drop. */
  readonly explodesAt: number;
}

/** A Decoy dropped on tick `droppedAt` at `level`, or null for level 0 (not researched). */
export const decoyPlan = (level: number, droppedAt: number): DecoyPlan | null => {
  const at = siegeLevel(level);
  const range = siegeValue(DECOY.range, at);
  const duration = siegeValue(DECOY.duration, at);
  if (range === null || duration === null) return null;
  return {
    range,
    damage: decoyDamage(at),
    landsAt: droppedAt + DECOY_FALL_TICKS,
    explodesAt: droppedAt + duration * TICKS_PER_SECOND,
  };
};

/**
 * Where a pulled defender goes to stand (`changeModeDecoy`,
 * `CreepBase.as:483-563`, `ChampionBase.as:320`): around the point
 * {@link DECOY_STAND_DROP} below the drop, on its own side of it give or take
 * 45°, 30 to 40 px out and stretched 1.7 times across. A walker lands within
 * 5 px of that; a flyer exactly on it, and one already within 50 px of the
 * middle stays where it is (returns `from`). Flash's burrowers take a ground
 * square of their own; here they walk like the rest.
 */
export const decoyStandPoint = (rng: Rng, from: Cart, drop: Cart, flying: boolean): Cart => {
  const centre = { x: drop.x, y: drop.y + DECOY_STAND_DROP };
  const dx = from.x - centre.x;
  const dy = from.y - centre.y;
  if (flying && dx * dx + dy * dy < DECOY_FLYER_STAY_SQUARED) return from;
  const degrees = Math.atan2(dy, dx) * 57.2957795 + (rng.float() * 90 - 45);
  const angle = degrees / (180 / Math.PI);
  const out = 30 + rng.float() * 10;
  let x = centre.x + Math.cos(angle) * out * 1.7;
  let y = centre.y + Math.sin(angle) * out;
  if (!flying) {
    x += rng.float() * -10 + 5;
    y += rng.float() * -10 + 5;
  }
  return { x, y };
};

/**
 * Whether its range touches a building, `(dx, dy)` apart on screen from the
 * drop to the building's `_mc.y + _middle` (`BASE.GetBuildingOverlap`,
 * `BASE.as:4934-4962`): the range as an ellipse's full width against the
 * building's half `size`, the gap truncated, edge distance plus edge distance.
 */
export const decoyTouchesBuilding = (
  range: number,
  dx: number,
  dy: number,
  buildingSize: number,
): boolean => {
  const gap = Math.trunc(Math.sqrt(dx * dx + dy * dy));
  const reach =
    Math.sqrt(ellipseEdgeSquared(squashedEllipse(range), dx, dy)) +
    Math.sqrt(ellipseEdgeSquared(squashedEllipse(buildingSize * 0.5), dx, dy));
  return gap < reach;
};
