import type { Yard } from "./yardModel";

/**
 * How a Thanksgiving turkey roams the yard (owner, 8 Nov 2026: "roaming
 * turkeys as replacement for mushroom picking"). Pure, so tests can walk one.
 *
 * Each turkey is one of the yard's mushrooms (`YardMushroom`), grown by the
 * server where a mushroom would grow; the server still knows it by that spot,
 * and a pick sends it. On screen it wanders near home: it stands about
 * (pecking now and then), picks a free point within {@link WANDER_RADIUS} of
 * home whose straight path crosses no building, walks there slowly, and
 * stands about again. It never leaves the plot. Everything is in yard units
 * (the server's `x`, `y`); the layer turns them into world pixels.
 *
 * A building is more than its footprint: its picture rises above it on
 * screen and hides whatever stands behind (a turkey there could be seen
 * only as a tap that opened the building). So each building also keeps
 * turkeys off the ground its art covers ({@link TurkeyObstacle.rise}).
 */

/** How far from home a turkey wanders, yard units (a mushroom's ground is 30). */
export const WANDER_RADIUS = 110;

/** Walking speed, yard units a second: an amble. */
export const TURKEY_SPEED = 15;

/** How long it stands about between walks, seconds. */
export const IDLE_SECONDS = { min: 1.5, max: 4.5 } as const;

/** Walk cycle frames a second. */
export const WALK_FPS = 7;

/** Kept this far from every building's footprint, yard units. */
export const TURKEY_CLEARANCE = 8;

/** Tries at a free target before it settles for standing a while longer. */
export const TARGET_TRIES = 8;

/** Frames in the turkey strip (`turkey.png`): walk 1-4, the startled hop, pecking. */
export const FRAME = { walk: [0, 1, 2, 3], hop: 4, peck: 5, stand: 1 } as const;

/**
 * A box in yard units: a building's footprint grown by the clearance, swept
 * back by `rise`. Screen-up is yard (-1, -1) (`toIso`: world y is (x + y) / 2,
 * world x is x - y), so ground `t` yard units back along that diagonal sits
 * `t` world pixels higher with the same world x: art rising `rise` world
 * pixels above the footprint covers the box swept back by up to `rise`.
 */
export interface TurkeyObstacle {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  /** World pixels the building's art rises above its footprint (0 or left out: the footprint alone). */
  readonly rise?: number;
}

/** Where turkeys may walk: inside the plot, outside every obstacle. */
export interface TurkeyArea {
  readonly halfW: number;
  readonly halfH: number;
  readonly obstacles: readonly TurkeyObstacle[];
}

export type TurkeyMode = "idle" | "walk" | "held";

export interface TurkeyState {
  readonly homeX: number;
  readonly homeY: number;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  mode: TurkeyMode;
  /** Seconds left standing about (idle). */
  wait: number;
  /** Seconds of animation, for the frame. */
  clock: number;
  /** Which way it faces on screen: 1 right (the art's way), -1 left (mirrored). */
  facing: 1 | -1;
  /** Whether this stand is a peck rather than plain standing. */
  pecking: boolean;
}

/**
 * The plot and the buildings of a yard, as turkeys see them. `rises` gives,
 * by building id, how many world pixels its drawn art rises above its
 * footprint (`YardBuildings.artRises`); a building not in it (its picture
 * not in yet) keeps turkeys off its footprint only.
 */
export const turkeyAreaOf = (
  yard: Pick<Yard, "bounds" | "buildings">,
  rises?: ReadonlyMap<number, number>,
): TurkeyArea => ({
  halfW: yard.bounds.yardWidth / 2,
  halfH: yard.bounds.yardHeight / 2,
  obstacles: yard.buildings.map((building) => {
    const rise = rises?.get(building.id) ?? 0;
    return {
      x0: building.x - TURKEY_CLEARANCE,
      y0: building.y - TURKEY_CLEARANCE,
      x1: building.x + building.footprint[0] + TURKEY_CLEARANCE,
      y1: building.y + building.footprint[1] + TURKEY_CLEARANCE,
      rise: rise > 0 ? rise + TURKEY_CLEARANCE : 0,
    };
  }),
});

/**
 * Whether a point is inside an obstacle (open, so its edge is outside): some
 * `t` in `[0, rise]` puts the point `t` forward along (+1, +1) inside the box.
 */
export const covers = (box: TurkeyObstacle, x: number, y: number): boolean => {
  const after = Math.max(box.x0 - x, box.y0 - y);
  const before = Math.min(box.x1 - x, box.y1 - y);
  return after < before && before > 0 && after < (box.rise ?? 0);
};

/** Whether a turkey may stand at a point. */
export const isFree = (area: TurkeyArea, x: number, y: number): boolean => {
  const edge = 16;
  if (Math.abs(x) > area.halfW - edge || Math.abs(y) > area.halfH - edge) return false;
  return !area.obstacles.some((box) => covers(box, x, y));
};

/**
 * The corners of a swept obstacle, in order round it: the box's top corner
 * and its two side corners lifted back by `rise`, then its other three.
 */
const sweptCorners = (box: TurkeyObstacle, rise: number): readonly (readonly [number, number])[] => [
  [box.x0 - rise, box.y0 - rise],
  [box.x1 - rise, box.y0 - rise],
  [box.x1, box.y0],
  [box.x1, box.y1],
  [box.x0, box.y1],
  [box.x0 - rise, box.y1 - rise],
];

/**
 * Whether the segment from (x0, y0) to (x1, y1) passes through an open
 * obstacle: the slab test for a plain box, the same clip against each side
 * of the (convex) swept shape otherwise.
 */
const crosses = (box: TurkeyObstacle, x0: number, y0: number, x1: number, y1: number): boolean => {
  const rise = box.rise ?? 0;
  return rise > 0 ? crossesSwept(box, rise, x0, y0, x1, y1) : crossesBox(box, x0, y0, x1, y1);
};

const crossesSwept = (
  box: TurkeyObstacle,
  rise: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): boolean => {
  const corners = sweptCorners(box, rise);
  const midX = corners.reduce((sum, [x]) => sum + x, 0) / corners.length;
  const midY = corners.reduce((sum, [, y]) => sum + y, 0) / corners.length;
  const dx = x1 - x0;
  const dy = y1 - y0;
  let enter = 0;
  let leave = 1;
  for (let index = 0; index < corners.length; index++) {
    const [ax, ay] = corners[index]!;
    const [bx, by] = corners[(index + 1) % corners.length]!;
    // The side's normal, turned to point out of the shape.
    let nx = by - ay;
    let ny = ax - bx;
    if (nx * (midX - ax) + ny * (midY - ay) > 0) {
      nx = -nx;
      ny = -ny;
    }
    // Inside is n . (p - a) < 0.
    const start = nx * (x0 - ax) + ny * (y0 - ay);
    const along = nx * dx + ny * dy;
    if (Math.abs(along) < 1e-9) {
      if (start >= 0) return false;
      continue;
    }
    const at = -start / along;
    if (along < 0) enter = Math.max(enter, at);
    else leave = Math.min(leave, at);
    if (enter >= leave) return false;
  }
  return true;
};

/** Whether the segment from (x0, y0) to (x1, y1) passes through the open box (slab test). */
const crossesBox = (box: TurkeyObstacle, x0: number, y0: number, x1: number, y1: number): boolean => {
  let enter = 0;
  let leave = 1;
  for (const [start, delta, low, high] of [
    [x0, x1 - x0, box.x0, box.x1],
    [y0, y1 - y0, box.y0, box.y1],
  ] as const) {
    if (Math.abs(delta) < 1e-9) {
      if (start <= low || start >= high) return false;
      continue;
    }
    let t0 = (low - start) / delta;
    let t1 = (high - start) / delta;
    if (t0 > t1) [t0, t1] = [t1, t0];
    enter = Math.max(enter, t0);
    leave = Math.min(leave, t1);
    if (enter >= leave) return false;
  }
  return true;
};

/**
 * Whether the straight walk from one point to another stays free. The plot
 * is a rectangle in yard units, so a free end point keeps the whole walk in
 * it; each building is checked exactly, so no corner is clipped between checks.
 */
export const pathFree = (area: TurkeyArea, x0: number, y0: number, x1: number, y1: number): boolean =>
  isFree(area, x1, y1) &&
  // One that finds itself inside a shape (its art came in after it stood
  // there) may walk out of that one.
  !area.obstacles.some((box) => !covers(box, x0, y0) && crosses(box, x0, y0, x1, y1));

/**
 * Where a turkey whose home is covered (a mushroom grew behind a building)
 * starts instead: the nearest free point on rings round home, or home itself
 * if none is within {@link WANDER_RADIUS}.
 */
export const freeSpotNear = (area: TurkeyArea, x: number, y: number): { x: number; y: number } => {
  if (isFree(area, x, y)) return { x, y };
  for (let reach = 10; reach <= WANDER_RADIUS; reach += 10) {
    for (let turn = 0; turn < 16; turn++) {
      const angle = (turn / 16) * Math.PI * 2;
      const spotX = x + Math.cos(angle) * reach;
      const spotY = y + Math.sin(angle) * reach;
      if (isFree(area, spotX, spotY)) return { x: spotX, y: spotY };
    }
  }
  return { x, y };
};

/** Screen direction of a step in yard units: the isometric x is `x - y`. */
const facingOf = (dx: number, dy: number, was: 1 | -1): 1 | -1 => {
  const screen = dx - dy;
  if (Math.abs(screen) < 0.01) return was;
  return screen > 0 ? 1 : -1;
};

const idleFor = (random: () => number): number => IDLE_SECONDS.min + random() * (IDLE_SECONDS.max - IDLE_SECONDS.min);

/** A turkey standing at home (the mushroom's ground centre), about to look round. */
export const newTurkey = (homeX: number, homeY: number, random: () => number = Math.random): TurkeyState => ({
  homeX,
  homeY,
  x: homeX,
  y: homeY,
  targetX: homeX,
  targetY: homeY,
  mode: "idle",
  // Staggered, so a yard of turkeys does not set off in step.
  wait: random() * IDLE_SECONDS.max,
  clock: random() * 10,
  facing: random() < 0.5 ? 1 : -1,
  pecking: random() < 0.4,
});

/** A free point near home with a free straight path to it, or null after a few tries. */
export const pickTarget = (
  state: Pick<TurkeyState, "homeX" | "homeY" | "x" | "y">,
  area: TurkeyArea,
  random: () => number,
): { x: number; y: number } | null => {
  for (let attempt = 0; attempt < TARGET_TRIES; attempt++) {
    const angle = random() * Math.PI * 2;
    const reach = WANDER_RADIUS * Math.sqrt(random());
    const x = state.homeX + Math.cos(angle) * reach;
    const y = state.homeY + Math.sin(angle) * reach;
    if (Math.hypot(x - state.x, y - state.y) < 20) continue;
    if (isFree(area, x, y) && pathFree(area, state.x, state.y, x, y)) return { x, y };
  }
  return null;
};

/** Moves a turkey on by `seconds`. A held one (being picked) stays put. */
export const stepTurkey = (
  state: TurkeyState,
  seconds: number,
  area: TurkeyArea,
  random: () => number = Math.random,
): void => {
  state.clock += seconds;
  if (state.mode === "held") return;

  if (state.mode === "idle") {
    state.wait -= seconds;
    if (state.wait > 0) return;
    const target = pickTarget(state, area, random);
    if (!target) {
      state.wait = idleFor(random);
      state.pecking = random() < 0.5;
      return;
    }
    state.targetX = target.x;
    state.targetY = target.y;
    state.facing = facingOf(target.x - state.x, target.y - state.y, state.facing);
    state.mode = "walk";
    return;
  }

  const dx = state.targetX - state.x;
  const dy = state.targetY - state.y;
  const left = Math.hypot(dx, dy);
  const travel = TURKEY_SPEED * seconds;
  if (left <= travel) {
    state.x = state.targetX;
    state.y = state.targetY;
    state.mode = "idle";
    state.wait = idleFor(random);
    state.pecking = random() < 0.5;
    return;
  }
  state.x += (dx / left) * travel;
  state.y += (dy / left) * travel;
};

/** Holds a turkey still while it is picked, or lets it go back to standing about. */
export const holdTurkey = (state: TurkeyState, on: boolean): void => {
  if (on) {
    state.mode = "held";
    return;
  }
  if (state.mode !== "held") return;
  state.mode = "idle";
  state.wait = IDLE_SECONDS.min;
};

/** The strip frame to show now. */
export const turkeyFrame = (state: Pick<TurkeyState, "mode" | "clock" | "pecking">): number => {
  if (state.mode === "walk") return FRAME.walk[Math.floor(state.clock * WALK_FPS) % FRAME.walk.length]!;
  // Being picked: it flaps, startled, between the hop and standing.
  if (state.mode === "held") return Math.floor(state.clock * 10) % 2 === 0 ? FRAME.hop : FRAME.stand;
  // Pecking: head down and up again, about once a second.
  if (state.pecking) return state.clock % 1.2 < 0.5 ? FRAME.peck : FRAME.stand;
  return FRAME.stand;
};
