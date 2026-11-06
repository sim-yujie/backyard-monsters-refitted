/**
 * How Malphus looks hopping over a wall.
 *
 * ## What Flash did
 *
 * `CreepBase.move` (`client/scripts/com/monsters/monsters/creeps/CreepBase.as:1505-1526`)
 * starts a hop when a jumper's next waypoint is on a standing wall: TweenLite
 * takes its graphic 60 px up over 0.4 s on `Sine.easeOut`, then back down over
 * 0.4 s on `Bounce.easeOut`. Only the graphic moves; the creep's own point
 * walks on beneath it, faster for the hop (the engine's `moveCreep`).
 *
 * The engine says how far into a hop it is (`CreepSnapshot.hop`); the battle
 * layer lifts the body by the arithmetic here.
 */

import { HOP_TICKS, HOP_UP_TICKS } from "@/game/combat/rules";
import { bounceOut } from "./burrowFx";

/** The tween's `"y": _graphicMC.y - 60` (`CreepBase.as:1510`). */
export const JUMP_LIFT_PX = 60;

/**
 * How far above its feet Malphus is drawn `hop` ticks after it took off, in
 * px: up on `Sine.easeOut`, down on `Bounce.easeOut`, 0 before and after.
 */
export const jumpLift = (hop: number): number => {
  if (hop < 0 || hop >= HOP_TICKS) return 0;
  if (hop < HOP_UP_TICKS) return JUMP_LIFT_PX * Math.sin(((hop / HOP_UP_TICKS) * Math.PI) / 2);
  const t = (hop - HOP_UP_TICKS) / (HOP_TICKS - HOP_UP_TICKS);
  return JUMP_LIFT_PX * (1 - bounceOut(t));
};
