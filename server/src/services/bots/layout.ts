import { footprintOf } from "../../game-data/buildingFootprints.js";
import { TOWER_STATS } from "../../game-rules/combat/combatStatsData.js";
import { mulberry32, type Rng } from "../../game-rules/combat/rng.js";
import { MAX_EXPANSIONS, rectOf, withinBounds, yardSize } from "../yardplanner/layoutGeometry.js";
import { TOWN_HALL_TYPE } from "../yardplanner/costs.js";
import type { Persona } from "./progression.js";

/**
 * Where a bot's buildings stand (`docs/design/bot-neighbours.md` §4.2 step 2,
 * issues #238 and #250): a seeded layout that reads as the yard of a player
 * who follows the wiki's Base Defense Guide
 * (https://backyardmonsters.fandom.com/wiki/Base_Defense_Guide).
 *
 * ## The plan
 *
 * Each seed draws one plan up front: the Town Hall's spot near the middle of
 * the plot, and a 3 x 3 grid of walled compartments round it. The middle one
 * is the core, a box round the Town Hall and its silos alone (the guide's
 * Town Hall and Silo Death Trap); the eight round it hold the towers with the
 * harvesters in front of them. Walls fill the grid one compartment at a time,
 * the core first, then the four beside it in opposite pairs, then the corners,
 * each compartment's walls running on from walls already standing, so the
 * yard always shows closed compartments and at most one being built. Every
 * compartment has one opening two cells wide (two for the core, on opposite
 * sides): the guide's two-space hallway, which traps fill first. Walls left
 * over once the grid is closed go out as single Eye-ra bait blocks round the
 * outside, spread evenly. The grid is kept clear from the first building on
 * (plus a 10-unit walkway either side, which only a big building may back
 * onto), so walls built later always find their path free and nothing ever
 * straddles a wall line; a wall cell outside the plot is skipped until the
 * plot grows to it. The core is kept for the Town Hall, its silos and the
 * traps between them from the start too.
 *
 * ## Zones
 *
 * A building's zone is measured as how far out it sits, as a share of the
 * grid's outer walls (1 is on them), most important in the middle, as the
 * guide says:
 *
 * - the Town Hall dead centre, the Storage Silos round it inside the core,
 *   a walkway apart so traps fit between them;
 * - Aerial Defense Towers just outside the core by the silos, Monster
 *   Bunkers as close to the Town Hall as the core walls let them;
 * - Laser, Tesla and Railgun towers in the inner half of the compartments,
 *   Cannon and Sniper towers further out as support;
 * - harvesters in the outer half of the compartments, in front of the towers
 *   and inside their range, each kind spread round the yard rather than
 *   bunched;
 * - the general buildings (Store, Locker, Academy, Flinger, Map Room and the
 *   like) and the monster buildings round the edge: once the plot has room
 *   outside the grid they make the guide's Never Ending Chain out there;
 * - walls on the grid, traps in its openings, then between harvesters and
 *   silos and next to towers.
 *
 * Each building tries a few dozen jittered spots in its zone, plus spots
 * lined up beside buildings of its own kind (players build rows), and keeps
 * the best by its zone, its neighbours and a random share. A tower weighs the
 * resource buildings its range would cover, its distance from the other
 * towers and which side of the yard is short of towers (the guide: defences
 * evened out, no weak side); a harvester weighs how many towers' ranges it
 * sits in. Ranges are each tower's level 1 range (`TOWER_STATS`), which only
 * grows. Every spot is on the 5-unit build grid real players' spots are on,
 * inside the plot the bot owned when the building was placed
 * (`withinBounds`), and clear of every other footprint: the rule the build
 * route and the Yard Planner's Apply measure by (`placementProblem`,
 * `checkNodePlacement`). A big building also likes to back onto a wall or a
 * neighbour, which keeps the open ground in one piece for the next one. When
 * the zone is full the building looks further out, then takes the best free
 * spot anywhere off the wall lines; only a full plot makes the layout throw.
 *
 * ## Growth never moves a building
 *
 * Buildings are placed one at a time in id order, which is build order, and
 * each spot depends only on the seed, the buildings placed before it and the
 * plot the bot had at the level it was built at: each building draws from its
 * own stream of the seed. The progression's yard at a smaller target is a
 * prefix of its yard at a bigger one (`progression.ts`), so the layout of the
 * smaller yard is a prefix of the bigger one's too.
 *
 * ## Expansions
 *
 * The plot grows with the "More Yardage" purchases a player of that level
 * usually holds ({@link expansionFor}, `storedata.ENL.q`, at most 6 like the
 * sandbox yard). A building placed at a level uses the plot of that level.
 * When the free ground is too broken up for a big building (most often a
 * second Housing at Town Hall 3 or 4, in about one yard in five), the bot buys
 * its next expansion early, as a player would, rather than build across a
 * wall line, and keeps it: every later building uses that plot too, and the
 * yard's `ENL` counts it.
 *
 * ## Decorations
 *
 * Players rarely put decorations out, so only a few bots have one
 * ({@link DECORATED_SHARE}), and none more than {@link MAX_DECORATIONS}.
 *
 * ## Ids
 *
 * A player's building takes the next free id when it is placed
 * (`nextBuildingId`), decorations included, so the layout numbers the yard
 * the same way: buildings and decorations in the order they went up, from 1.
 * A decoration's place in that order depends only on how many buildings
 * stood before it, so a grown yard keeps every id the smaller one had.
 */

/** Every spot is snapped to the build grid (`mapRoom.ts`, `client/scripts/GRID.as`). */
export const GRID = 5;

/** The step of the first search over the whole plot: twice the grid, as `mapRoom.ts` searches. */
const SCAN_STEP = 10;

/** A wall block's side (`buildingFootprints.ts`, type 17). */
const WALL_CELL = 20;

/** Wall Block and the two traps (`buildingFootprints.ts`). */
export const WALL_TYPE = 17;
export const TRAP_TYPES: ReadonlySet<number> = new Set([24, 117]);

/** The most walls any Town Hall allows (`buildingCosts.ts`, type 17 at hall 10): the Eye-ra bait tops the grid up to it. */
const TOP_WALLS = 400;

/** Eye-ra bait blocks: at least and at most this many `[PLACEHOLDER]`. */
const BAIT = { min: 6, max: 40 } as const;

/** Past this distance from the nearest tower a tower gains nothing more by spreading `[PLACEHOLDER]`. */
const TOWER_SPREAD = 200;

/** How far a crowded zone looks past its band before trying every spot of the plot. */
const WIDEN = 0.4;

/** Walkway kept clear either side of a reserved wall line. */
const WALL_MARGIN = 10;

/** A footprint this wide or wider may stand on the walkway, hard against the wall. */
const BIG = 100;

/** Room a plot needs outside the grid, on one axis, before the edge buildings move out there: a Housing and its walkway. */
const OUTSIDE_ROOM = 170;

/** The share of bots that put out a decoration at all `[PLACEHOLDER]`. */
export const DECORATED_SHARE = 0.15;

/** The most decorations a bot puts out. */
export const MAX_DECORATIONS = 1;

/**
 * Decorations a bot may own: the flags, gnomes, flowers and garden pieces a
 * player picks up early, nothing from an event and no totem (they keep a
 * level) `[PLACEHOLDER]`.
 */
export const DECORATION_TYPES: readonly number[] = [
  28, 29, 30, 33, 35, 37, 41, 43, 45, 49, 50, 56, 57, 60, 61, 62, 63, 64, 67, 69, 70, 71, 87, 88, 91, 92, 93,
  94, 95, 105,
];

/**
 * The empire levels at which a player usually holds one more expansion
 * `[PLACEHOLDER]`; each seed shifts them all by -2 to +2 levels.
 */
export const EXPANSION_LEVELS: readonly number[] = [10, 14, 19, 24, 29, 34];

/** Salts that split the seed into independent streams. */
const SALT = {
  plan: 0x1b873593,
  expansion: 0x5bd1e995,
  building: 0x7feb352d,
  decorations: 0x846ca68b,
} as const;

/** A stream of the seed for `salt` and `index`, independent of every other. */
const streamOf = (seed: number, salt: number, index = 0): Rng =>
  mulberry32((Math.imul((Math.floor(seed) ^ salt) >>> 0, 0x9e3779b1) ^ Math.imul(index + 1, 0x85ebca77)) >>> 0);

/** A uniform draw in `[min, max)`. */
const between = (rng: Rng, min: number, max: number): number => min + (max - min) * rng.float();

const snap = (value: number, step = GRID): number => Math.round(value / step) * step || 0;

/** The yard expansions (`storedata.ENL.q`) a bot of `level` holds, for its seed. */
export const expansionFor = (seed: number, level: number): number => {
  const shift = streamOf(seed, SALT.expansion).int(5) - 2;
  const held = EXPANSION_LEVELS.filter((at) => level >= at + shift).length;
  return Math.min(held, MAX_EXPANSIONS);
};

/** What a building is laid out as. */
type Role =
  | "hall"
  | "silo"
  | "aerial"
  | "bunker"
  | "tower"
  | "support"
  | "harvester"
  | "general"
  | "army"
  | "wall"
  | "trap"
  | "decoration";

const ROLE_OF: Readonly<Record<number, Role>> = {
  [TOWN_HALL_TYPE]: "hall",
  6: "silo",
  115: "aerial",
  22: "bunker",
  // Laser, Tesla, Railgun: the guide puts them between or behind harvesters.
  23: "tower",
  25: "tower",
  118: "tower",
  // Cannon and Sniper: support further out.
  20: "support",
  21: "support",
  // Monster buildings.
  9: "army",
  13: "army",
  15: "army",
  16: "army",
  114: "army",
  116: "army",
  119: "army",
  // General Store, Monster Locker, Monster Academy, Flinger, Yard Planner, Map Room, Baiter, Catapult.
  12: "general",
  8: "general",
  26: "general",
  5: "general",
  10: "general",
  11: "general",
  19: "general",
  51: "general",
  // Harvesters.
  1: "harvester",
  2: "harvester",
  3: "harvester",
  4: "harvester",
  [WALL_TYPE]: "wall",
  24: "trap",
  117: "trap",
};

const roleOf = (type: number): Role => ROLE_OF[type] ?? (footprintOf(type).decoration ? "decoration" : "general");

/** Roles whose range covers the resource buildings. */
const DEFENDERS: ReadonlySet<Role> = new Set(["tower", "support", "aerial"]);

/** Roles a tower's range is there to cover (the guide: the Town Hall, silos, harvesters). */
const RESOURCES: ReadonlySet<Role> = new Set(["hall", "silo", "harvester"]);

/** A tower's level 1 range (`TOWER_STATS`); its range only grows with its level. */
const rangeOf = (type: number): number => TOWER_STATS[type]?.[0]?.range ?? 0;

/** Types laid out as one group: built side by side, as players do. Hatcheries keep their control centre. */
const groupOf = (type: number): number => (type === 16 ? 13 : type);

/** Roles that line up beside their own kind, and the gaps they leave. Silos keep room for a trap between. */
const CLUSTER_GAPS: Readonly<Partial<Record<Role, readonly number[]>>> = {
  army: [0, 0, 10, 20],
  silo: [20, 20, 25, 30, 40],
  decoration: [0, 10],
};

/** One cell of the wall plan. */
interface WallSlot {
  x: number;
  y: number;
  /** A hallway cell: no wall, a trap. */
  opening: boolean;
  /** A single Eye-ra bait block outside the grid, not a grid line. */
  bait: boolean;
  /** On the core's wall. */
  core: boolean;
}

/** A seed's layout plan (see the file comment). */
interface Plan {
  cx: number;
  cy: number;
  /** Half extents of the core box's and the grid's outer edges. */
  core: { hx: number; hy: number };
  outer: { hx: number; hy: number };
  /** Every wall cell, in the order walls fill them; hallway cells in place. */
  walls: WallSlot[];
  /** How strongly buildings line up beside their own kind. */
  align: number;
  /** How far out each role sits, in shares of the grid's outer walls. */
  bands: Readonly<Record<Role, { min: number; max: number }>>;
  /** The edge buildings' band once the plot has room outside the grid. */
  outside: { min: number; max: number };
}

const keyOf = (x: number, y: number): string => `${x},${y}`;

/**
 * The cells of a box's wall from cell corner (`x0`, `y0`) to (`x1`, `y1`),
 * clockwise from the top left, each side with its corners and its cells
 * between them.
 */
const boxSides = (x0: number, y0: number, x1: number, y1: number): { x: number; y: number }[][] => {
  const top: { x: number; y: number }[] = [];
  const right: { x: number; y: number }[] = [];
  const bottom: { x: number; y: number }[] = [];
  const left: { x: number; y: number }[] = [];
  for (let x = x0; x < x1; x += WALL_CELL) top.push({ x, y: y0 });
  for (let y = y0; y < y1; y += WALL_CELL) right.push({ x: x1, y });
  for (let x = x1; x > x0; x -= WALL_CELL) bottom.push({ x, y: y1 });
  for (let y = y1; y > y0; y -= WALL_CELL) left.push({ x: x0, y });
  return [top, right, bottom, left];
};

/**
 * The wall plan: the 3 x 3 grid round `cx`, `cy`, compartment by
 * compartment (see the file comment), then the Eye-ra bait.
 */
const wallPlan = (
  rng: Rng,
  cx: number,
  cy: number,
  core: { hx: number; hy: number },
  outer: { hx: number; hy: number }
): WallSlot[] => {
  // The left (top) cell edge of each grid line.
  const xs = [cx - outer.hx, cx - core.hx, cx + core.hx - WALL_CELL, cx + outer.hx - WALL_CELL];
  const ys = [cy - outer.hy, cy - core.hy, cy + core.hy - WALL_CELL, cy + outer.hy - WALL_CELL];

  // The core, then the compartments beside it in opposite pairs, then the corners in diagonal pairs.
  const sides: [number, number][][] = [
    [
      [1, 0],
      [1, 2],
    ],
    [
      [0, 1],
      [2, 1],
    ],
  ];
  if (rng.int(2) === 1) sides.reverse();
  const corners: [number, number][][] = [
    [
      [0, 0],
      [2, 2],
    ],
    [
      [2, 0],
      [0, 2],
    ],
  ];
  if (rng.int(2) === 1) corners.reverse();
  const order: [number, number][] = [[1, 1]];
  for (const pair of [...sides, ...corners]) {
    if (rng.int(2) === 1) pair.reverse();
    order.push(...pair);
  }

  const slots: WallSlot[] = [];
  const planned = new Set<string>();
  for (const [i, j] of order) {
    const box = boxSides(xs[i]!, ys[j]!, xs[i + 1]!, ys[j + 1]!);
    // Hallways: two on opposite sides of the core, one on an outer side of every other compartment.
    const outerSides = [
      ...(j === 0 ? [0] : []),
      ...(i === 2 ? [1] : []),
      ...(j === 2 ? [2] : []),
      ...(i === 0 ? [3] : []),
    ];
    const first = rng.int(2);
    const hallwaySides = outerSides.length === 0 ? [first, first + 2] : [outerSides[rng.int(outerSides.length)]!];
    const hallway = new Set<string>();
    for (const side of hallwaySides) {
      const cells = box[side]!;
      // Two cells, at least two clear of either corner.
      const at = 2 + rng.int(Math.max(1, cells.length - 5));
      for (const cell of cells.slice(at, at + 2)) hallway.add(keyOf(cell.x, cell.y));
    }
    // Run on from a wall already standing, so a part-built compartment hangs off the rest.
    const path = box.flat();
    let start = rng.int(path.length);
    for (let k = 0; k < path.length; k++) {
      const here = path[k]!;
      const next = path[(k + 1) % path.length]!;
      if (planned.has(keyOf(here.x, here.y)) && !planned.has(keyOf(next.x, next.y))) {
        start = (k + 1) % path.length;
        break;
      }
    }
    for (let k = 0; k < path.length; k++) {
      const cell = path[(start + k) % path.length]!;
      const key = keyOf(cell.x, cell.y);
      if (planned.has(key)) continue;
      planned.add(key);
      slots.push({ ...cell, opening: hallway.has(key), bait: false, core: i === 1 && j === 1 });
    }
  }

  // Eye-ra bait: single blocks spread evenly round the outside, as many as top the grid up to the wall cap.
  const grid = slots.filter((slot) => !slot.opening).length;
  const bait = Math.min(BAIT.max, Math.max(BAIT.min, TOP_WALLS - grid));
  const offset = between(rng, 0, 1);
  const away = between(rng, 60, 110);
  for (let k = 0; k < bait; k++) {
    const along = ((k + offset) / bait) * 4;
    const side = Math.floor(along);
    const t = (along - side) * 2 - 1;
    const [ux, uy] = side === 0 ? [t, -1] : side === 1 ? [1, t] : side === 2 ? [-t, 1] : [-1, -t];
    slots.push({
      x: snap(cx + ux * (outer.hx + away) - WALL_CELL / 2),
      y: snap(cy + uy * (outer.hy + away) - WALL_CELL / 2),
      opening: false,
      bait: true,
      core: false,
    });
  }
  return slots;
};

/** The seed's plan: centre, walls, bands. */
const planFor = (seed: number, persona: Persona): Plan => {
  const rng = streamOf(seed, SALT.plan);
  const cx = snap(between(rng, -40, 40), GRID);
  const cy = snap(between(rng, -40, 40), GRID);
  // Whole cells, so every grid line tiles exactly. The core takes the Town Hall
  // with a silo either side; a compartment takes a tower or two with
  // harvesters in front. The grid runs a little past the smallest plot: its
  // outer walls go up once the plot has grown to them.
  const core = { hx: 200 + WALL_CELL * rng.int(2), hy: 180 + WALL_CELL * rng.int(2) };
  const outer = { hx: core.hx + 220 + WALL_CELL * rng.int(4), hy: core.hy + 220 + WALL_CELL * rng.int(3) };
  const walls = wallPlan(rng, cx, cy, core, outer);
  const inner = Math.max(core.hx / outer.hx, core.hy / outer.hy);
  const towersIn = persona === "towers" ? 0.07 : 0;
  return {
    cx,
    cy,
    core,
    outer,
    walls,
    align: between(rng, 0.5, 1.2),
    bands: {
      hall: { min: 0, max: 0.1 },
      silo: { min: 0.1, max: inner - 0.12 },
      aerial: { min: inner + 0.02, max: inner + 0.22 },
      bunker: { min: inner + 0.03, max: inner + 0.3 },
      tower: { min: inner + 0.06, max: 0.72 - towersIn },
      support: { min: inner + 0.06, max: 0.95 },
      harvester: { min: 0.55, max: persona === "economy" ? 0.92 : 0.97 },
      general: { min: 0.75, max: 1.15 },
      army: { min: inner + 0.05, max: persona === "army" ? 0.85 : 0.95 },
      wall: { min: 0.9, max: 1.4 },
      trap: { min: 0.3, max: 1 },
      decoration: { min: 0.2, max: 1.3 },
    },
    outside: { min: 1.1, max: 1.55 },
  };
};

/** Cell marks: what may stand on a cell of the core or the reserved wall lines. */
const FREE = 0;
const CORE = 1;
const WALKWAY = 2;
const WALL_LINE = 3;
const OPENING = 4;

/** What each kind of thing may stand on. */
const ON_FREE = 1 << FREE;
const ON_CORE = 1 << CORE;
const ON_WALKWAY = 1 << WALKWAY;
const ON_WALL_LINE = 1 << WALL_LINE;
const ON_OPENING = 1 << OPENING;
const ANYWHERE = ON_FREE | ON_CORE | ON_WALKWAY | ON_WALL_LINE | ON_OPENING;

/** Roles the core is kept for (see the file comment); traps go between the silos. */
const IN_CORE: ReadonlySet<Role> = new Set(["hall", "silo", "trap", "decoration"]);

/** The occupancy grid over the largest plot, one cell per {@link GRID} units. */
class Grid {
  private readonly ox: number;
  private readonly oy: number;
  private readonly cols: number;
  private readonly rows: number;
  private readonly taken: Uint8Array;
  private readonly marks: Uint8Array;

  constructor() {
    const [width, height] = yardSize(MAX_EXPANSIONS);
    this.ox = -width / 2;
    this.oy = -height / 2;
    this.cols = width / GRID;
    this.rows = height / GRID;
    this.taken = new Uint8Array(this.cols * this.rows);
    this.marks = new Uint8Array(this.cols * this.rows);
  }

  /** The cell span of a rectangle, or null when it leaves the grid. */
  private span(x: number, y: number, w: number, h: number): [number, number, number, number] | null {
    const c0 = Math.floor((x - this.ox) / GRID);
    const r0 = Math.floor((y - this.oy) / GRID);
    const c1 = Math.ceil((x + w - this.ox) / GRID);
    const r1 = Math.ceil((y + h - this.oy) / GRID);
    if (c0 < 0 || r0 < 0 || c1 > this.cols || r1 > this.rows) return null;
    return [c0, r0, c1, r1];
  }

  /** Marks a rectangle of a reserved wall line; a stronger mark wins. */
  mark(x: number, y: number, w: number, h: number, mark: number): void {
    const span = this.span(x, y, w, h);
    if (!span) return;
    const [c0, r0, c1, r1] = span;
    for (let r = r0; r < r1; r++) {
      for (let i = r * this.cols + c0, end = r * this.cols + c1; i < end; i++) {
        if (this.marks[i]! < mark) this.marks[i] = mark;
      }
    }
  }

  /** Whether a footprint is free and every cell's mark is one `allowed` lets it stand on. */
  free(x: number, y: number, w: number, h: number, allowed: number): boolean {
    const span = this.span(x, y, w, h);
    if (!span) return false;
    const [c0, r0, c1, r1] = span;
    for (let r = r0; r < r1; r++) {
      for (let i = r * this.cols + c0, end = r * this.cols + c1; i < end; i++) {
        if (this.taken[i] || ((1 << this.marks[i]!) & allowed) === 0) return false;
      }
    }
    return true;
  }

  /**
   * How many sides of a footprint lie against something: a wall line or its
   * walkway, another footprint, or the edge of the grid. A side counts when
   * most of the strip just outside it does.
   */
  sidesAgainst(x: number, y: number, w: number, h: number): number {
    const blocked = (c: number, r: number) =>
      c < 0 || r < 0 || c >= this.cols || r >= this.rows || this.taken[r * this.cols + c] === 1 || this.marks[r * this.cols + c]! >= WALKWAY;
    const c0 = Math.floor((x - this.ox) / GRID);
    const r0 = Math.floor((y - this.oy) / GRID);
    const c1 = Math.ceil((x + w - this.ox) / GRID);
    const r1 = Math.ceil((y + h - this.oy) / GRID);
    let sides = 0;
    const strip = (cells: [number, number][]) => {
      if (cells.filter(([c, r]) => blocked(c, r)).length * 2 >= cells.length) sides++;
    };
    const across = Array.from({ length: c1 - c0 }, (_, k) => c0 + k);
    const down = Array.from({ length: r1 - r0 }, (_, k) => r0 + k);
    strip(across.map((c) => [c, r0 - 1]));
    strip(across.map((c) => [c, r1]));
    strip(down.map((r) => [c0 - 1, r]));
    strip(down.map((r) => [c1, r]));
    return sides;
  }

  take(x: number, y: number, w: number, h: number): void {
    const span = this.span(x, y, w, h);
    if (!span) return;
    const [c0, r0, c1, r1] = span;
    for (let r = r0; r < r1; r++) this.taken.fill(1, r * this.cols + c0, r * this.cols + c1);
  }
}

/** One building the layout places, in build order: its type and the empire level it was built at. */
export interface LayoutEntry {
  t: number;
  /** The empire level the yard stood at when it was built (`builtAtLevel`). */
  level: number;
}

/** A placed footprint origin, with the yard id it went up with. */
export interface PlacedSpot {
  id: number;
  t: number;
  X: number;
  Y: number;
}

/** The layout of a bot's yard. */
export interface BotLayout {
  /** Every building's spot and id, in the order given. */
  buildings: PlacedSpot[];
  /** The decorations, in id order. */
  decorations: PlacedSpot[];
  /** `storedata.ENL.q`: what the yard's level usually holds, or more if the bot bought early. */
  expansion: number;
}

/** A spot being weighed. */
interface Candidate {
  x: number;
  y: number;
  score: number;
}

/** A placed tower: its centre and level 1 range. */
interface Tower {
  x: number;
  y: number;
  range: number;
}

/** A placed resource building: its centre, its type and how many towers' ranges it sits in. */
interface Resource {
  x: number;
  y: number;
  t: number;
  covered: number;
}

/** The sectors the yard is split into round its centre, for keeping every side defended. */
const SECTORS = 8;

/** The layout run: one plan, one grid, buildings placed one at a time. */
class Layout {
  private readonly grid = new Grid();
  private readonly towers: Tower[] = [];
  private readonly resources: Resource[] = [];
  private readonly byGroup = new Map<number, PlacedSpot[]>();
  /** Placed buildings per role and sector (see {@link sectorOf}). */
  private readonly sectors = new Map<Role, number[]>();
  private readonly slotUsed: boolean[];
  /** Cells holding a wall, by {@link keyOf}. */
  private readonly walls = new Set<string>();
  /** Expansions bought early because a building found no room (see the file comment). */
  bought = 0;

  constructor(
    private readonly seed: number,
    private readonly plan: Plan
  ) {
    this.slotUsed = plan.walls.map(() => false);
    // The core is kept for the Town Hall and its silos, the grid lines clear, from the start (see the file comment).
    const { cx, cy, core } = plan;
    this.grid.mark(cx - core.hx, cy - core.hy, 2 * core.hx, 2 * core.hy, CORE);
    const lines = plan.walls.filter((slot) => !slot.bait);
    for (const slot of lines) {
      this.grid.mark(
        slot.x - WALL_MARGIN,
        slot.y - WALL_MARGIN,
        WALL_CELL + 2 * WALL_MARGIN,
        WALL_CELL + 2 * WALL_MARGIN,
        WALKWAY
      );
    }
    for (const slot of lines) this.grid.mark(slot.x, slot.y, WALL_CELL, WALL_CELL, slot.opening ? OPENING : WALL_LINE);
  }

  /** How far out a point sits, in shares of the grid's outer walls. */
  private reachOf(x: number, y: number): number {
    const { outer } = this.plan;
    return Math.max(Math.abs(x - this.plan.cx) / outer.hx, Math.abs(y - this.plan.cy) / outer.hy);
  }

  /** Which of the {@link SECTORS} round the centre a point is in. */
  private sectorOf(x: number, y: number): number {
    const { outer } = this.plan;
    const angle = Math.atan2((y - this.plan.cy) / outer.hy, (x - this.plan.cx) / outer.hx);
    return Math.min(SECTORS - 1, Math.floor(((angle + Math.PI) / (2 * Math.PI)) * SECTORS));
  }

  /** How many more of `role` a sector holds than the emptiest one. */
  private crowding(role: Role, x: number, y: number): number {
    const counts = this.sectors.get(role);
    if (!counts) return 0;
    return counts[this.sectorOf(x, y)]! - Math.min(...counts);
  }

  private fits(type: number, x: number, y: number, expansion: number, allowed: number): boolean {
    const { w, h } = footprintOf(type);
    return withinBounds(rectOf(type, x, y), expansion) && this.grid.free(x, y, w, h, allowed);
  }

  private put(id: number, type: number, x: number, y: number): PlacedSpot {
    const { w, h } = footprintOf(type);
    this.grid.take(x, y, w, h);
    const spot = { id, t: type, X: x, Y: y };
    const role = roleOf(type);
    if (role === "wall") this.walls.add(keyOf(x, y));
    const cx = x + w / 2;
    const cy = y + h / 2;
    if (DEFENDERS.has(role)) {
      const tower = { x: cx, y: cy, range: rangeOf(type) };
      this.towers.push(tower);
      for (const resource of this.resources) {
        if (Math.hypot(resource.x - cx, resource.y - cy) <= tower.range) resource.covered++;
      }
    }
    if (RESOURCES.has(role)) this.resources.push({ x: cx, y: cy, t: type, covered: this.coverAt(cx, cy) });
    const counts = this.sectors.get(role) ?? new Array<number>(SECTORS).fill(0);
    counts[this.sectorOf(cx, cy)]!++;
    this.sectors.set(role, counts);
    const group = this.byGroup.get(groupOf(type)) ?? [];
    group.push(spot);
    this.byGroup.set(groupOf(type), group);
    return spot;
  }

  /** How many towers' ranges a point sits in. */
  private coverAt(x: number, y: number): number {
    let count = 0;
    for (const tower of this.towers) if (Math.hypot(tower.x - x, tower.y - y) <= tower.range) count++;
    return count;
  }

  /** Whether the plot of `expansion` has room outside the grid for the edge buildings. */
  private roomOutside(expansion: number): boolean {
    const [width, height] = yardSize(expansion);
    const { outer } = this.plan;
    return width / 2 >= outer.hx + OUTSIDE_ROOM || height / 2 >= outer.hy + OUTSIDE_ROOM;
  }

  /** The band a building of `role` aims for on the plot of `expansion`. */
  private bandOf(role: Role, expansion: number): { min: number; max: number } {
    if ((role === "general" || role === "army") && this.roomOutside(expansion)) return this.plan.outside;
    return this.plan.bands[role];
  }

  /** A spot's score: lower is better (see the file comment). */
  private score(rng: Rng, type: number, role: Role, expansion: number, x: number, y: number): number {
    const { w, h } = footprintOf(type);
    const band = this.bandOf(role, expansion);
    const cx = x + w / 2;
    const cy = y + h / 2;
    const reach = this.reachOf(cx, cy);
    let score = 0;
    if (reach < band.min) score += (band.min - reach) / 0.05;
    if (reach > band.max) score += (reach - band.max) / 0.05;
    score += rng.float() * 0.6;

    if (CLUSTER_GAPS[role]) {
      const kin = this.byGroup.get(groupOf(type)) ?? [];
      let nearest = Number.POSITIVE_INFINITY;
      for (const other of kin) {
        const size = footprintOf(other.t);
        const gapX = Math.max(other.X - (x + w), x - (other.X + size.w), 0);
        const gapY = Math.max(other.Y - (y + h), y - (other.Y + size.h), 0);
        nearest = Math.min(nearest, Math.max(gapX, gapY));
      }
      if (Number.isFinite(nearest)) score += (Math.min(nearest, 200) / 100) * this.plan.align;
    }

    if (DEFENDERS.has(role)) {
      // Cover the resource buildings that have least cover.
      const range = rangeOf(type);
      let gain = 0;
      for (const resource of this.resources) {
        if (resource.covered < 2 && Math.hypot(resource.x - cx, resource.y - cy) <= range) {
          gain += resource.covered === 0 ? 1 : 0.5;
        }
      }
      score -= Math.min(gain, 5) * 0.8;
      if (this.towers.length > 0) {
        let nearest = Number.POSITIVE_INFINITY;
        for (const tower of this.towers) nearest = Math.min(nearest, Math.hypot(tower.x - cx, tower.y - cy));
        // Spread out, but a tower hard by another reads as a mistake, not cover.
        score -= Math.min(nearest, TOWER_SPREAD) / 100;
        if (nearest < TOWER_SPREAD / 2) score += 3;
      }
      score += 0.6 * this.crowding(role, cx, cy);
      if (role === "aerial") {
        // Between and behind the silos.
        const silos = this.byGroup.get(6) ?? [];
        if (silos.some((silo) => Math.hypot(silo.X + 40 - cx, silo.Y + 40 - cy) < 160)) score -= 1;
      }
    }

    if (role === "harvester") {
      // In front of the towers, inside their range: the more ranges the better, up to two.
      const cover = this.coverAt(cx, cy);
      score -= 1.5 * Math.min(cover, 2);
      if (this.towers.length > 0 && cover === 0) score += 2;
      // Each kind spread round the yard, never bunched (the guide: don't put all of one resource together).
      for (const other of this.resources) {
        if (other.t === type && Math.hypot(other.x - cx, other.y - cy) < 160) score += 1;
      }
      score += 0.5 * this.crowding(role, cx, cy);
    }

    if (role === "general") score += 0.4 * this.crowding(role, cx, cy);

    // A big building backs onto a wall or a neighbour, leaving the open ground in one piece.
    if (w >= BIG) score -= 0.8 * this.grid.sidesAgainst(x, y, w, h);

    if (role === "bunker" && this.towers.length > 0) {
      let nearest = Number.POSITIVE_INFINITY;
      for (const tower of this.towers) nearest = Math.min(nearest, Math.hypot(tower.x - cx, tower.y - cy));
      score += nearest / 250;
    }

    if (role === "trap") {
      // Between the harvesters and silos (the guide's ARGoH) and by the towers.
      let tower = 400;
      for (const one of this.towers) tower = Math.min(tower, Math.hypot(one.x - cx, one.y - cy));
      let resource = 400;
      for (const one of this.resources) resource = Math.min(resource, Math.hypot(one.x - cx, one.y - cy));
      score += tower / 120 + resource / 60;
    }
    return score;
  }

  /** Jittered spots in a building's band (widened by `widen` both ways), round the plan's centre. */
  private zoneSpots(
    rng: Rng,
    type: number,
    role: Role,
    expansion: number,
    count: number,
    widen = 0
  ): { x: number; y: number }[] {
    const { w, h } = footprintOf(type);
    const own = this.bandOf(role, expansion);
    const band = { min: Math.max(0, own.min - widen), max: own.max + widen };
    const { outer } = this.plan;
    const spots: { x: number; y: number }[] = [];
    for (let i = 0; i < count; i++) {
      const reach = between(rng, band.min, Math.max(band.max, band.min + 0.01));
      // A point on the rectangle `reach` of the way out, anywhere round it.
      const along = rng.float() * 4;
      const side = Math.floor(along);
      const t = (along - side) * 2 - 1;
      const [ux, uy] = side === 0 ? [t, -1] : side === 1 ? [1, t] : side === 2 ? [-t, 1] : [-1, -t];
      const x = this.plan.cx + ux * reach * outer.hx - w / 2 + between(rng, -15, 15);
      const y = this.plan.cy + uy * reach * outer.hy - h / 2 + between(rng, -15, 15);
      spots.push({ x: snap(x), y: snap(y) });
    }
    return spots;
  }

  /** Spots beside one of `others`, `gaps` apart, on any side. */
  private beside(
    rng: Rng,
    type: number,
    others: readonly { X: number; Y: number; t: number }[],
    gaps: readonly number[],
    count: number
  ): { x: number; y: number }[] {
    if (others.length === 0) return [];
    const { w, h } = footprintOf(type);
    const spots: { x: number; y: number }[] = [];
    for (let i = 0; i < count; i++) {
      const other = others[rng.int(others.length)]!;
      const size = footprintOf(other.t);
      const gap = gaps[rng.int(gaps.length)]!;
      const side = rng.int(4);
      // Anywhere along the side, not only flush with its corner.
      const slideX = snap(between(rng, -w + WALL_CELL, size.w - WALL_CELL) * rng.int(2));
      const slideY = snap(between(rng, -h + WALL_CELL, size.h - WALL_CELL) * rng.int(2));
      if (side === 0) spots.push({ x: other.X + size.w + gap, y: other.Y + slideY });
      else if (side === 1) spots.push({ x: other.X - w - gap, y: other.Y + slideY });
      else if (side === 2) spots.push({ x: other.X + slideX, y: other.Y + size.h + gap });
      else spots.push({ x: other.X + slideX, y: other.Y - h - gap });
    }
    return spots;
  }

  /** Spots next to towers, for a trap. */
  private besideTowers(rng: Rng, count: number): { x: number; y: number }[] {
    if (this.towers.length === 0) return [];
    const spots: { x: number; y: number }[] = [];
    for (let i = 0; i < count; i++) {
      const tower = this.towers[rng.int(this.towers.length)]!;
      const angle = rng.float() * Math.PI * 2;
      const distance = between(rng, 50, 90);
      spots.push({
        x: snap(tower.x + Math.cos(angle) * distance - 10),
        y: snap(tower.y + Math.sin(angle) * distance - 10),
      });
    }
    return spots;
  }

  /** The best of `spots` that fits, or null. */
  private best(
    rng: Rng,
    type: number,
    role: Role,
    expansion: number,
    allowed: number,
    spots: readonly { x: number; y: number }[]
  ): Candidate | null {
    let best: Candidate | null = null;
    for (const spot of spots) {
      if (!this.fits(type, spot.x, spot.y, expansion, allowed)) continue;
      const score = this.score(rng, type, role, expansion, spot.x, spot.y);
      if (!best || score < best.score) best = { x: spot.x, y: spot.y, score };
    }
    return best;
  }

  /** Every spot of the plot `step` apart, for the last resort. */
  private everySpot(type: number, expansion: number, step: number): { x: number; y: number }[] {
    const [width, height] = yardSize(expansion);
    const { w, h } = footprintOf(type);
    const spots: { x: number; y: number }[] = [];
    for (let y = -height / 2; y + h <= height / 2; y += step) {
      for (let x = -width / 2; x + w <= width / 2; x += step) spots.push({ x, y });
    }
    return spots;
  }

  /**
   * The next free cell of the wall plan of the kind asked for, or null: a
   * wall's cell, or for a trap a hallway of the core or with a wall already
   * beside it.
   */
  private planSlot(type: number, expansion: number, opening: boolean): { x: number; y: number } | null {
    const allowed = opening ? ON_OPENING : ON_FREE | ON_WALKWAY | ON_WALL_LINE;
    const walled = ({ x, y }: { x: number; y: number }) =>
      [
        [WALL_CELL, 0],
        [-WALL_CELL, 0],
        [0, WALL_CELL],
        [0, -WALL_CELL],
      ].some(([dx, dy]) => this.walls.has(keyOf(x + dx!, y + dy!)));
    for (let i = 0; i < this.plan.walls.length; i++) {
      const slot = this.plan.walls[i]!;
      if (this.slotUsed[i] || slot.opening !== opening) continue;
      if (opening && !slot.core && !walled(slot)) continue;
      if (!this.fits(type, slot.x, slot.y, expansion, allowed)) continue;
      this.slotUsed[i] = true;
      return slot;
    }
    return null;
  }

  /** Places one building (see the file comment) and returns its spot. */
  place(id: number, type: number, level: number): PlacedSpot {
    const expansion = Math.max(expansionFor(this.seed, level), this.bought);
    const role = roleOf(type);
    const rng = streamOf(this.seed, SALT.building, id);
    const { w, h } = footprintOf(type);

    if (role === "hall") {
      const x = snap(this.plan.cx - w / 2);
      const y = snap(this.plan.cy - h / 2);
      if (this.fits(type, x, y, expansion, ON_FREE | ON_CORE)) return this.put(id, type, x, y);
    }
    if (role === "wall" || role === "trap") {
      const slot = this.planSlot(type, expansion, role === "trap");
      if (slot) return this.put(id, type, slot.x, slot.y);
    }

    // A big building may stand hard against a wall: a compartment keeps no walkway for it.
    const allowed =
      (role === "wall" ? ON_FREE | ON_WALKWAY : role === "trap" ? ON_FREE | ON_WALKWAY | ON_OPENING : ON_FREE) |
      (IN_CORE.has(role) ? ON_CORE : 0) |
      (w >= BIG ? ON_WALKWAY : 0);
    const spots: { x: number; y: number }[] = this.zoneSpots(rng, type, role, expansion, 40);
    const gaps = CLUSTER_GAPS[role];
    if (gaps) spots.push(...this.beside(rng, type, this.byGroup.get(groupOf(type)) ?? [], gaps, 24));
    if (role === "wall") spots.push(...this.beside(rng, type, this.byGroup.get(WALL_TYPE) ?? [], [0], 24));
    if (role === "trap") {
      const resources = [...(this.byGroup.get(6) ?? []), ...[1, 2, 3, 4].flatMap((t) => this.byGroup.get(t) ?? [])];
      spots.push(...this.beside(rng, type, resources, [0, 0, 5, 10], 24), ...this.besideTowers(rng, 16));
    }

    // Off the wall lines and their hallways, so the walls always find their path free.
    const offLines = allowed | ON_WALKWAY;
    let found =
      this.best(rng, type, role, expansion, allowed, spots) ??
      this.best(rng, type, role, expansion, allowed, this.zoneSpots(rng, type, role, expansion, 160, WIDEN)) ??
      this.best(rng, type, role, expansion, allowed, this.everySpot(type, expansion, SCAN_STEP)) ??
      // A gap a footprint just fills may start on an odd 5: try every grid spot, walkways too.
      this.best(rng, type, role, expansion, offLines, this.everySpot(type, expansion, GRID));
    for (let more = expansion + 1; !found && more <= MAX_EXPANSIONS; more++) {
      found = this.best(rng, type, role, more, offLines, this.everySpot(type, more, SCAN_STEP));
      if (found) this.bought = more;
    }
    // A full plot: the core, then anywhere at all, before giving up.
    found ??=
      this.best(rng, type, role, expansion, offLines | ON_CORE, this.everySpot(type, expansion, GRID)) ??
      this.best(rng, type, role, expansion, ANYWHERE, this.everySpot(type, expansion, GRID));
    if (!found) throw new Error(`No room in the bot's yard for building ${id} (type ${type}).`);
    return this.put(id, type, found.x, found.y);
  }
}

/**
 * The decorations' place in the build order: on {@link DECORATED_SHARE} of
 * seeds, one decoration put out once 20 to 79 buildings stand.
 */
const decorationPlan = (seed: number): { after: number; t: number }[] => {
  const rng = streamOf(seed, SALT.decorations);
  if (rng.float() >= DECORATED_SHARE) return [];
  const plan: { after: number; t: number }[] = [];
  let after = 20 + rng.int(60);
  for (let k = 0; k < MAX_DECORATIONS; k++) {
    plan.push({ after, t: DECORATION_TYPES[rng.int(DECORATION_TYPES.length)]! });
    after += 40 + rng.int(60);
  }
  return plan;
};

/**
 * Lays out and numbers a bot's yard (see the file comment). Pure: the same
 * seed, persona and buildings always give the same spots and ids, and the
 * result for a prefix of `entries` is a prefix of the result for the whole.
 *
 * @param seed - `bot.seed`.
 * @param persona - `bot.persona`.
 * @param entries - Every building in build order, with the level it was built at.
 * @param level - The yard's empire level now, for its expansions.
 */
export const layoutBotYard = (
  seed: number,
  persona: Persona,
  entries: readonly LayoutEntry[],
  level: number
): BotLayout => {
  const layout = new Layout(seed, planFor(seed, persona));
  const decorations = decorationPlan(seed);
  const buildings: PlacedSpot[] = [];
  const placedDecorations: PlacedSpot[] = [];
  let nextId = 1;
  for (const entry of entries) {
    buildings.push(layout.place(nextId++, entry.t, entry.level));
    const next = decorations[placedDecorations.length];
    if (next && buildings.length >= next.after) {
      placedDecorations.push(layout.place(nextId++, next.t, entry.level));
    }
  }
  return {
    buildings,
    decorations: placedDecorations,
    expansion: Math.max(expansionFor(seed, level), layout.bought),
  };
};
