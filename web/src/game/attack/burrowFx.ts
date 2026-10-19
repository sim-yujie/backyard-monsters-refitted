/**
 * How a tunnelling Wormzer looks (issue: Wormzers tunnel like Flash's).
 *
 * ## What Flash did
 *
 * `MonsterBase.renderBurrow` (`client/scripts/com/monsters/monsters/MonsterBase.as:656-691`)
 * hides a burrower outright while it moves — its graphic, health bar and all,
 * at alpha 0 — and marks the spot with dirt: `EFFECTS.Dig`, twenty clods
 * thrown up to 30 px, as it goes down, then `EFFECTS.Burrow`, three clods
 * within 10 px, every fifth frame as it tunnels (`EFFECTS.as:269-275`). When
 * it stops to swing it comes up with another `Dig` and `jump()`s: its body
 * rises 15 px over 0.3 s on a sine ease-in and drops back over 0.6 s on a
 * bounce ease-out (`:693-706`). Flash's sheet names `burrowed` and
 * `transition` frames for it (`SPRITES.as:167-178`), but nothing ever asks for
 * them; underground there is no Wormzer to see, only the dirt.
 *
 * The engine says when it is under (`CreepSnapshot.burrowed`); the
 * battle layer draws the dirt and the hop from the arithmetic here.
 */

import { ANIM_TICKS_PER_FRAME } from "./bombFx";

/** `EFFECTS.Burrow` every fifth frame (`MonsterBase.as:671-673`), at Flash's 40 fps. */
export const BURROW_TRAIL_TICKS = 5 * ANIM_TICKS_PER_FRAME;

/** `jump()`: 15 px up over 0.3 s, then down over 0.6 s, in battle ticks (80 a second). */
export const SURFACE_HOP_PX = 15;
export const SURFACE_RISE_TICKS = 24;
export const SURFACE_FALL_TICKS = 48;

/** Robert Penner's bounce ease-out, which TweenLite's `Bounce.easeOut` is. */
export const bounceOut = (t: number): number => {
  if (t < 1 / 2.75) return 7.5625 * t * t;
  if (t < 2 / 2.75) {
    const u = t - 1.5 / 2.75;
    return 7.5625 * u * u + 0.75;
  }
  if (t < 2.5 / 2.75) {
    const u = t - 2.25 / 2.75;
    return 7.5625 * u * u + 0.9375;
  }
  const u = t - 2.625 / 2.75;
  return 7.5625 * u * u + 0.984375;
};

/**
 * How far above its feet a Wormzer is drawn `age` ticks after it surfaced, in
 * px: up on `Sine.easeIn`, down on `Bounce.easeOut`, 0 before and after.
 */
export const surfaceHop = (age: number): number => {
  if (age < 0 || age >= SURFACE_RISE_TICKS + SURFACE_FALL_TICKS) return 0;
  if (age < SURFACE_RISE_TICKS) {
    const t = age / SURFACE_RISE_TICKS;
    return SURFACE_HOP_PX * (1 - Math.cos((t * Math.PI) / 2));
  }
  const t = (age - SURFACE_RISE_TICKS) / SURFACE_FALL_TICKS;
  return SURFACE_HOP_PX * (1 - bounceOut(t));
};

/** What the dirt does on a tick: a `Dig` (going down or coming up), a trail clod, or nothing. */
export type DirtKind = "dig" | "trail" | null;

/**
 * The dirt a burrower throws on this tick, given whether it was under at the
 * last tick looked at, whether it is now, and the tick of its last clod.
 */
export const dirtFor = (
  wasUnder: boolean,
  isUnder: boolean,
  tick: number,
  lastDirt: number,
): DirtKind => {
  if (wasUnder !== isUnder) return "dig";
  if (isUnder && tick - lastDirt >= BURROW_TRAIL_TICKS) return "trail";
  return null;
};
