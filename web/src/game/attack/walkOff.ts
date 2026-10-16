/**
 * A monster walking off the field instead of vanishing.
 *
 * The engine takes a creep off the field the tick it has nothing left to
 * attack, and an attack whose last target falls ends with its monsters frozen
 * where they stood (`engine.ts` fidelity note 7). On screen that reads as the
 * army blinking out and the end panel slamming down. So the battle layer
 * keeps such a creep's sprite and walks it a short way toward the nearest
 * edge of the yard, fading it out as it goes; a flyer flies off a little
 * faster and climbs. The end panel waits for the walk-offs to finish.
 *
 * Drawing only. The battle, its result, its loot and its replay are the
 * engine's and are untouched: a creep walking off here is already gone there.
 * Every clock is the shown tick, so 2x speed walks twice as fast.
 */

/** Ticks a walk-off takes: 1.75 s at 1x. */
export const WALK_OFF_TICKS = 140;

/** Ticks the end panel waits after the last walk-off is done: 0.4 s at 1x. */
export const WALK_OFF_PAUSE_TICKS = 32;

/** The share of the walk-off spent at full strength before the fade begins. */
const FADE_FROM = 0.4;

/** Yard units a walker covers per tick: 60 a second on foot, 100 in the air. */
const WALK_PACE = 0.75;
const FLY_PACE = 1.25;

/** Screen px a flyer has climbed by the end of its walk-off. */
export const FLY_CLIMB = 28;

/** Where a walk-off starts, which way it goes and when. */
export interface WalkOff {
  readonly fromIx: number;
  readonly fromIy: number;
  /** A unit step along one yard axis, outward. */
  readonly dirX: number;
  readonly dirY: number;
  readonly pace: number;
  readonly flying: boolean;
  /** The shown tick it started on. */
  readonly start: number;
}

/** A walk-off at one moment. */
export interface WalkOffFrame {
  readonly ix: number;
  readonly iy: number;
  /** 1 while it walks, down to 0 as it fades. */
  readonly alpha: number;
  /** Screen px a flyer has risen; 0 on foot. */
  readonly climb: number;
  readonly done: boolean;
}

/**
 * Plans a walk-off from yard point `(ix, iy)` toward the nearest edge of a
 * yard `halfWidth` by `halfHeight` units either side of its centre. A creep
 * already near or past an edge heads straight out over it; one dead in the
 * middle of an axis takes the near side.
 */
export const planWalkOff = (
  ix: number,
  iy: number,
  flying: boolean,
  start: number,
  halfWidth: number,
  halfHeight: number,
): WalkOff => {
  const alongX = halfWidth - Math.abs(ix) <= halfHeight - Math.abs(iy);
  const outward = (value: number): number => (value > 0 ? 1 : -1);
  return {
    fromIx: ix,
    fromIy: iy,
    dirX: alongX ? outward(ix) : 0,
    dirY: alongX ? 0 : outward(iy),
    pace: flying ? FLY_PACE : WALK_PACE,
    flying,
    start,
  };
};

/**
 * Where a walk-off is at shown tick `tick`. Under reduced motion the creep
 * fades where it stands, with no walk and no climb.
 */
export const walkOffAt = (plan: WalkOff, tick: number, reducedMotion: boolean): WalkOffFrame => {
  const elapsed = Math.max(0, Math.min(WALK_OFF_TICKS, tick - plan.start));
  const share = elapsed / WALK_OFF_TICKS;
  const alpha = share <= FADE_FROM ? 1 : Math.max(0, 1 - (share - FADE_FROM) / (1 - FADE_FROM));
  const done = tick - plan.start >= WALK_OFF_TICKS;
  if (reducedMotion) return { ix: plan.fromIx, iy: plan.fromIy, alpha, climb: 0, done };
  const distance = elapsed * plan.pace;
  return {
    ix: plan.fromIx + plan.dirX * distance,
    iy: plan.fromIy + plan.dirY * distance,
    alpha,
    climb: plan.flying ? FLY_CLIMB * share : 0,
    done,
  };
};
