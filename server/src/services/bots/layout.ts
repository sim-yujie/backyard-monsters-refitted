import { footprintOf } from "../../game-data/buildingFootprints.js";
import { TOWER_STATS } from "../../game-rules/combat/combatStatsData.js";
import { mulberry32, type Rng } from "../../game-rules/combat/rng.js";
import { MAX_EXPANSIONS, rectOf, withinBounds, yardSize } from "../yardplanner/layoutGeometry.js";
import { TOWN_HALL_TYPE } from "../yardplanner/costs.js";
import { wallTargets, type Persona } from "./progression.js";

/**
 * Where a bot's buildings stand (`docs/design/bot-neighbours.md` §4.2 step 2,
 * issues #238, #250 and #252): a seeded layout that reads as the yard of a
 * player who follows the wiki's Base Defense Guide
 * (https://backyardmonsters.fandom.com/wiki/Base_Defense_Guide).
 *
 * ## The plan
 *
 * Each seed draws one plan up front: the Town Hall's spot near the middle of
 * the plot, a small walled core round it, and a 3 x 3 grid of walled
 * compartments with the core as its middle. The core is the guide's Town Hall
 * and Silo Death Trap: the Town Hall with two silos either side (or above and
 * below), sized so the walls a Town Hall 3 yard stands close it
 * ({@link CORE_LONG}, {@link CORE_SHORT}). The eight compartments round it hold
 * the towers with the harvesters in front of them.
 *
 * Walls go up one compartment at a time, the core first, then the four beside
 * it in opposite pairs, then the corners, each compartment's walls running on
 * from walls already standing. A compartment is only started when the walls
 * the yard will stand at its Town Hall level (`wallTargets`, the
 * progression's own fill draws) are enough to close it, so the yard shows
 * closed compartments and at most one being built, the one its walls are
 * catching up on. Walls the next compartment cannot use yet double the core:
 * a second ring hard against it, which the guide likes too, built a side at a
 * time (a side those walls will finish first), so a part-built ring reads as
 * a thicker wall, not a gap. Once that ring is whole, walls carry on round the
 * grid regardless. The grid is sized so the grid and the ring hold every wall
 * a Town Hall 10 allows ({@link TOP_WALLS}), so no wall is ever left over to
 * stand on its own.
 *
 * Only the core has openings: a two-cell hallway in the middle of each of its
 * two long sides, facing the Town Hall between the silos, and the cells of
 * the doubling ring in front of them. Traps fill them before anything else,
 * so a hallway is trapped from the yard's first traps on. The compartments
 * are closed all round: on an enemy yard traps are hidden, so any other gap
 * would read as a hole.
 *
 * The core, every planned wall cell and a walkway either side of it are kept
 * clear from the first building on, so walls built later always find their
 * path free and nothing stands in a wall line or a hallway. Only a big
 * building may back onto a wall, and never in front of a hallway. A wall
 * cell outside the plot waits for the plot to grow; a compartment is not
 * started until all of it is inside.
 *
 * ## Zones
 *
 * A building's zone is measured as how far out it sits: 0 at the Town Hall,
 * {@link CORE_REACH} on the core's walls, 1 on the grid's outer walls; the
 * most important in the middle, as the guide says:
 *
 * - the Town Hall dead centre and the first four Storage Silos at the core's
 *   corners; the fifth and sixth on spots kept for them from the start in the
 *   two compartments walled first, just past the doubling ring;
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
 * - walls on the plan, traps in the hallways, then between harvesters and
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
 * plot and Town Hall the bot had when it was built: each building draws from
 * its own stream of the seed. The progression's yard at a smaller target is a
 * prefix of its yard at a bigger one (`progression.ts`), so the layout of the
 * smaller yard is a prefix of the bigger one's too.
 *
 * ## Expansions
 *
 * The plot grows with the "More Yardage" purchases a player of that level
 * usually holds ({@link expansionFor}, `storedata.ENL.q`, at most 6 like the
 * sandbox yard). A building placed at a level uses the plot of that level.
 * When the free ground is too broken up for a big building, the bot buys its
 * next expansion early, as a player would, rather than build across a wall
 * line, and keeps it: every later building uses that plot too, and the
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

/** The Storage Silo (`buildingFootprints.ts`, 80 x 80). */
const SILO_TYPE = 6;

/** The most walls any Town Hall allows (`buildingCosts.ts`, type 17 at hall 10): the plan has a cell for each. */
const TOP_WALLS = 400;

/**
 * The core's inside, long side and short side: the Town Hall (130) with a
 * silo (80) either side, 10 apart, and a silo above and below each of those.
 * Its wall is 58 cells, 4 of them hallway, so the 54 walls the leanest Town
 * Hall 3 stands (`WALL_FILL`, 90% of 60) close it.
 */
const CORE_LONG = 320;
const CORE_SHORT = 220;

/** How far out the core's walls sit on either axis, the grid's outer walls being 1 (see {@link reachAlong}). */
const CORE_REACH = 0.35;

/**
 * How far out a distance `d` from the centre sits along one axis: the core's
 * walls at {@link CORE_REACH}, the grid's outer walls at 1, linear between,
 * so a long core and a short one share their bands. {@link offsetAt} is its
 * inverse.
 */
const reachAlong = (d: number, core: number, outer: number): number =>
  d <= core ? (d / core) * CORE_REACH : CORE_REACH + ((d - core) / (outer - core)) * (1 - CORE_REACH);
const offsetAt = (reach: number, core: number, outer: number): number =>
  reach <= CORE_REACH ? (reach / CORE_REACH) * core : core + ((reach - CORE_REACH) / (1 - CORE_REACH)) * (outer - core);

/** How far a core silo stands in from the core's walls. */
const SILO_INSET = 5;

/** The grid's outer size: drawn in these ranges, then grown until it holds {@link TOP_WALLS} `[PLACEHOLDER]`. */
const GRID_WIDTH = { min: 1000, max: 1040 } as const;
const GRID_HEIGHT = { min: 780, max: 820 } as const;

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
  walls: 0x3c6ef372,
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
  [SILO_TYPE]: "silo",
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
  /** On the core's own wall. */
  core: boolean;
}

/** The walls of a seed's plan (see the file comment). */
interface WallPlan {
  /** Every planned cell, each once. */
  slots: WallSlot[];
  /** The core, then the compartments in the order they are walled: indices into `slots`, in fill order. */
  groups: number[][];
  /** Where each of `groups` sits in the 3 x 3 grid, `[column, row]`: the core is `[1, 1]`. */
  places: [number, number][];
  /**
   * The ring that doubles the core, as its four sides between the grid lines
   * that cross it (each in fill order), then its four corner cells.
   */
  ring: number[][];
  /** The hallway cells, in the order traps fill them. */
  openings: number[];
}

/** A seed's layout plan (see the file comment). */
interface Plan extends WallPlan {
  cx: number;
  cy: number;
  /** Half extents of the core box's and the grid's outer edges. */
  core: { hx: number; hy: number };
  outer: { hx: number; hy: number };
  /** The silos' spots, in the order silos take them: the core's four corners, then two kept beside it. */
  silos: { x: number; y: number }[];
  /** How strongly buildings line up beside their own kind. */
  align: number;
  /** How far out each role sits (see {@link Layout.reachOf}). */
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

/** The compartments' depths, in cells, out from the core on each side. */
interface Depths {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * The wall plan round the core box with cell corners (`x0`, `y0`) and
 * (`x1`, `y1`): the core, the grid compartment by compartment, the doubling
 * ring (see the file comment). `rng` draws the order and the hallways only.
 */
const wallPlan = (rng: Rng, x0: number, y0: number, x1: number, y1: number, wide: boolean, depths: Depths): WallPlan => {
  // The left (top) cell edge of each grid line.
  const xs = [x0 - depths.left * WALL_CELL, x0, x1, x1 + depths.right * WALL_CELL];
  const ys = [y0 - depths.top * WALL_CELL, y0, y1, y1 + depths.bottom * WALL_CELL];

  const slots: WallSlot[] = [];
  const index = new Map<string, number>();
  const add = (x: number, y: number, opening = false, core = false): number => {
    const key = keyOf(x, y);
    const known = index.get(key);
    if (known !== undefined) return known;
    index.set(key, slots.length);
    slots.push({ x, y, opening, core });
    return slots.length - 1;
  };

  // The core: a hallway in the middle of each long side, give or take a cell, facing the Town Hall between the silos.
  const core = boxSides(x0, y0, x1, y1);
  const hallwaySides = wide ? [0, 2] : [1, 3];
  const hallway = new Set<string>();
  for (const side of hallwaySides) {
    const cells = core[side]!;
    const at = Math.floor(cells.length / 2) - 1 + rng.int(2) - (cells.length % 2 === 0 ? rng.int(2) : 0);
    for (const cell of cells.slice(at, at + 2)) hallway.add(keyOf(cell.x, cell.y));
  }
  const corePath = core.flat();
  const coreStart = rng.int(corePath.length);
  const groups: number[][] = [[]];
  for (let k = 0; k < corePath.length; k++) {
    const cell = corePath[(coreStart + k) % corePath.length]!;
    groups[0]!.push(add(cell.x, cell.y, hallway.has(keyOf(cell.x, cell.y)), true));
  }
  const places: [number, number][] = [[1, 1]];

  // The doubling ring, planned before the grid so the grid lines run through its cells.
  const ringSides = boxSides(x0 - WALL_CELL, y0 - WALL_CELL, x1 + WALL_CELL, y1 + WALL_CELL);
  const outward = new Set<string>();
  for (const key of hallway) {
    const [x, y] = key.split(",").map(Number) as [number, number];
    const dx = x === x0 ? -WALL_CELL : x === x1 ? WALL_CELL : 0;
    const dy = y === y0 ? -WALL_CELL : y === y1 ? WALL_CELL : 0;
    outward.add(keyOf(x + dx, y + dy));
  }
  // Each side of the ring runs between the two grid lines crossing it, one way or the other; its corners come last.
  const ringFirst = rng.int(ringSides.length);
  const ring: number[][] = [];
  const ringCorners: number[] = [];
  for (let k = 0; k < ringSides.length; k++) {
    const [corner, ...side] = ringSides[(ringFirst + k) % ringSides.length]!;
    if (rng.int(2) === 1) side.reverse();
    ring.push(side.map((cell) => add(cell.x, cell.y, outward.has(keyOf(cell.x, cell.y)))));
    ringCorners.push(add(corner!.x, corner!.y));
  }
  ring.push(ringCorners);

  // The compartments beside the core in opposite pairs, then the corners in diagonal pairs.
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
  const order: [number, number][] = [];
  for (const pair of [...sides, ...corners]) {
    if (rng.int(2) === 1) pair.reverse();
    order.push(...pair);
  }
  // Walls of the core and of the compartments before, which each compartment runs on from.
  const walled = new Set<string>(corePath.map((cell) => keyOf(cell.x, cell.y)));
  for (const [i, j] of order) {
    const path = boxSides(xs[i]!, ys[j]!, xs[i + 1]!, ys[j + 1]!).flat();
    let start = 0;
    for (let k = 0; k < path.length; k++) {
      const here = path[k]!;
      const next = path[(k + 1) % path.length]!;
      if (walled.has(keyOf(here.x, here.y)) && !walled.has(keyOf(next.x, next.y))) {
        start = (k + 1) % path.length;
        break;
      }
    }
    const group: number[] = [];
    for (let k = 0; k < path.length; k++) {
      const cell = path[(start + k) % path.length]!;
      group.push(add(cell.x, cell.y));
      walled.add(keyOf(cell.x, cell.y));
    }
    groups.push(group);
    places.push([i, j]);
  }

  const openings = [...groups[0]!, ...ring.flat()].filter((at) => slots[at]!.opening);
  return { slots, groups, places, ring, openings };
};

/** The seed's plan: centre, walls, bands. */
const planFor = (seed: number, persona: Persona): Plan => {
  const rng = streamOf(seed, SALT.plan);
  const cx = snap(between(rng, -30, 30), GRID);
  const cy = snap(between(rng, -20, 20), GRID);
  // The core's inside: wide with the silos either side, or tall with them above and below.
  const wide = rng.int(2) === 0;
  const insideW = wide ? CORE_LONG : CORE_SHORT;
  const insideH = wide ? CORE_SHORT : CORE_LONG;
  const x0 = cx - insideW / 2 - WALL_CELL;
  const x1 = cx + insideW / 2;
  const y0 = cy - insideH / 2 - WALL_CELL;
  const y1 = cy + insideH / 2;
  const silos = [
    { x: x0 + WALL_CELL + SILO_INSET, y: y0 + WALL_CELL + SILO_INSET },
    { x: x1 - SILO_INSET - 80, y: y0 + WALL_CELL + SILO_INSET },
    { x: x0 + WALL_CELL + SILO_INSET, y: y1 - SILO_INSET - 80 },
    { x: x1 - SILO_INSET - 80, y: y1 - SILO_INSET - 80 },
  ];
  for (let k = silos.length - 1; k > 0; k--) {
    const j = rng.int(k + 1);
    [silos[k], silos[j]] = [silos[j]!, silos[k]!];
  }

  // The grid: whole cells out from the core, split unevenly between the sides.
  const width = GRID_WIDTH.min + WALL_CELL * rng.int((GRID_WIDTH.max - GRID_WIDTH.min) / WALL_CELL + 1);
  const height = GRID_HEIGHT.min + WALL_CELL * rng.int((GRID_HEIGHT.max - GRID_HEIGHT.min) / WALL_CELL + 1);
  const across = Math.round((width - insideW - 2 * WALL_CELL) / WALL_CELL);
  const down = Math.round((height - insideH - 2 * WALL_CELL) / WALL_CELL);
  const left = Math.floor(across / 2) + rng.int(3) - 1;
  const top = Math.floor(down / 2) + rng.int(3) - 1;
  const depths: Depths = { left, right: across - left, top, bottom: down - top };
  // Grown a cell at a time, round the sides, until it holds every wall.
  let walls = wallPlan(streamOf(seed, SALT.walls), x0, y0, x1, y1, wide, depths);
  const grow: (keyof Depths)[] = ["left", "top", "right", "bottom"];
  for (let k = 0; walls.slots.filter((slot) => !slot.opening).length < TOP_WALLS; k++) {
    depths[grow[k % grow.length]!]++;
    walls = wallPlan(streamOf(seed, SALT.walls), x0, y0, x1, y1, wide, depths);
  }

  // Silos 5 and 6 (Town Halls 5 and 9) in the two compartments walled first, past the ring and its walkway,
  // and on a hallway's side of the core well clear of it.
  const off = 2 * WALL_CELL + WALL_MARGIN + SILO_INSET;
  const along = (low: number, high: number, middle: number, hallways: boolean) =>
    hallways ? (rng.int(2) === 0 ? low + 2 * WALL_CELL : high - 2 * WALL_CELL - 80) : middle - 40;
  for (const [i, j] of walls.places.slice(1, 3)) {
    if (j === 1) {
      silos.push({ x: i === 0 ? x0 - off - 80 : x1 + WALL_CELL + off, y: along(y0, y1, cy, !wide) });
    } else {
      silos.push({ x: along(x0, x1, cx, wide), y: j === 0 ? y0 - off - 80 : y1 + WALL_CELL + off });
    }
  }

  const core = { hx: (x1 + WALL_CELL - x0) / 2, hy: (y1 + WALL_CELL - y0) / 2 };
  const outer = {
    hx: core.hx + (WALL_CELL * (depths.left + depths.right)) / 2,
    hy: core.hy + (WALL_CELL * (depths.top + depths.bottom)) / 2,
  };
  const inner = CORE_REACH;
  const towersIn = persona === "towers" ? 0.07 : 0;
  return {
    ...walls,
    cx,
    cy,
    core,
    outer,
    silos,
    align: between(rng, 0.5, 1.2),
    bands: {
      hall: { min: 0, max: 0.1 },
      silo: { min: 0.1, max: inner },
      aerial: { min: inner + 0.02, max: inner + 0.22 },
      bunker: { min: inner + 0.03, max: inner + 0.3 },
      tower: { min: inner + 0.02, max: 0.72 - towersIn },
      support: { min: inner + 0.02, max: 0.95 },
      harvester: { min: 0.55, max: persona === "economy" ? 0.92 : 0.97 },
      general: { min: 0.75, max: 1.15 },
      army: { min: inner + 0.1, max: persona === "army" ? 0.85 : 0.95 },
      wall: { min: 0.9, max: 1.4 },
      trap: { min: 0.3, max: 1 },
      decoration: { min: 0.2, max: 1.3 },
    },
    outside: { min: 1.1, max: 1.55 },
  };
};

/** A planned wall cell, for checking a layout against its plan. */
export interface PlannedWallCell {
  x: number;
  y: number;
  /** A hallway cell: a trap, never a wall. */
  opening: boolean;
  /** On the core's own wall. */
  core: boolean;
}

/** Every cell of a seed's wall plan (see the file comment): for tests and tools. */
export const botWallPlan = (seed: number): PlannedWallCell[] =>
  planFor(seed, "economy").slots.map((slot) => ({ ...slot }));

/** Cell marks: what may stand on a cell of the core or the reserved wall lines. */
const FREE = 0;
const CORE = 1;
/** A silo's spot kept beside the core (see {@link Plan.silos}). */
const KEPT = 2;
const WALKWAY = 3;
/** The walkway in front of a hallway: traps only, so no big building plugs it. */
const APPROACH = 4;
const WALL_LINE = 5;
const OPENING = 6;

/** What each kind of thing may stand on. */
const ON_FREE = 1 << FREE;
const ON_CORE = 1 << CORE;
const ON_KEPT = 1 << KEPT;
const ON_WALKWAY = 1 << WALKWAY;
const ON_APPROACH = 1 << APPROACH;
const ON_WALL_LINE = 1 << WALL_LINE;
const ON_OPENING = 1 << OPENING;
const ANYWHERE = ON_FREE | ON_CORE | ON_KEPT | ON_WALKWAY | ON_APPROACH | ON_WALL_LINE | ON_OPENING;

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

  /** Marks a rectangle of the core or a reserved wall line; a stronger mark wins. */
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

/** One building the layout places, in build order. */
export interface LayoutEntry {
  t: number;
  /** The empire level the yard stood at when it was built (`builtAtLevel`). */
  level: number;
  /** The Town Hall level the yard had when it was built (`builtAtHall`): how many walls that hall will stand. */
  hall: number;
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

/** What a wall's plan cell may stand on. */
const ON_LINE = ON_FREE | ON_WALKWAY | ON_APPROACH | ON_WALL_LINE;

/** The layout run: one plan, one grid, buildings placed one at a time. */
class Layout {
  private readonly grid = new Grid();
  private readonly towers: Tower[] = [];
  private readonly resources: Resource[] = [];
  private readonly byGroup = new Map<number, PlacedSpot[]>();
  /** Placed buildings per role and sector (see {@link sectorOf}). */
  private readonly sectors = new Map<Role, number[]>();
  private readonly slotUsed: boolean[];
  /** Wall groups started (see the file comment); the core always is. */
  private readonly started = new Set<number>([0]);
  /** Sides of the doubling ring started. */
  private readonly ringStarted = new Set<number>();
  /** Cells holding a wall, by {@link keyOf}. */
  private readonly wallAt = new Set<string>();
  /** Walls the yard stands once caught up, by Town Hall level (`wallTargets`). */
  private readonly budgets: number[];
  private wallsPlaced = 0;
  /** Expansions bought early because a building found no room (see the file comment). */
  bought = 0;

  constructor(
    private readonly seed: number,
    private readonly plan: Plan
  ) {
    this.slotUsed = plan.slots.map(() => false);
    this.budgets = wallTargets(seed);
    // The core is kept for the Town Hall and its silos, the wall cells clear, from the start (see the file comment).
    const { cx, cy, core } = plan;
    this.grid.mark(cx - core.hx, cy - core.hy, 2 * core.hx, 2 * core.hy, CORE);
    for (const spot of plan.silos) this.grid.mark(spot.x, spot.y, 80, 80, KEPT);
    for (const slot of plan.slots) {
      const mark = slot.opening ? APPROACH : WALKWAY;
      this.grid.mark(slot.x - WALL_MARGIN, slot.y - WALL_MARGIN, WALL_CELL + 2 * WALL_MARGIN, WALL_CELL + 2 * WALL_MARGIN, mark);
    }
    for (const slot of plan.slots) this.grid.mark(slot.x, slot.y, WALL_CELL, WALL_CELL, slot.opening ? OPENING : WALL_LINE);
  }

  /** How far out a point sits: the core's walls at {@link CORE_REACH}, the grid's outer walls at 1. */
  private reachOf(x: number, y: number): number {
    const { core, outer } = this.plan;
    return Math.max(
      reachAlong(Math.abs(x - this.plan.cx), core.hx, outer.hx),
      reachAlong(Math.abs(y - this.plan.cy), core.hy, outer.hy)
    );
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
    if (role === "wall") {
      this.wallsPlaced++;
      this.wallAt.add(keyOf(x, y));
    }
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
        const silos = this.byGroup.get(SILO_TYPE) ?? [];
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
    const { core, outer } = this.plan;
    const spots: { x: number; y: number }[] = [];
    for (let i = 0; i < count; i++) {
      const reach = between(rng, band.min, Math.max(band.max, band.min + 0.01));
      // A point on the rectangle `reach` of the way out, anywhere round it.
      const along = rng.float() * 4;
      const side = Math.floor(along);
      const t = (along - side) * 2 - 1;
      const [ux, uy] = side === 0 ? [t, -1] : side === 1 ? [1, t] : side === 2 ? [-t, 1] : [-1, -t];
      const dx = Math.sign(ux) * offsetAt(Math.abs(ux) * reach, core.hx, outer.hx);
      const dy = Math.sign(uy) * offsetAt(Math.abs(uy) * reach, core.hy, outer.hy);
      const x = this.plan.cx + dx - w / 2 + between(rng, -15, 15);
      const y = this.plan.cy + dy - h / 2 + between(rng, -15, 15);
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

  /** Marks a plan cell used and returns it. */
  private takeSlot(at: number): WallSlot {
    this.slotUsed[at] = true;
    return this.plan.slots[at]!;
  }

  /**
   * A wall's cell (see the file comment), or null when no planned cell is
   * free on this plot. In order: the next cell of the compartment being
   * walled; the first of the next compartment, when the walls a Town Hall at
   * `hall` stands will close it; the next of the ring side being built, or
   * of the first side those walls will finish, or of any side; a ring corner
   * once the two walls beside it stand; the next compartment's first
   * regardless; any free cell.
   */
  private wallCell(type: number, expansion: number, hall: number): WallSlot | null {
    const { slots, groups, ring } = this.plan;
    const budget = this.budgets[Math.min(Math.max(hall, 0), this.budgets.length - 1)] ?? 0;
    const free = (at: number) => !this.slotUsed[at] && !slots[at]!.opening && this.fits(type, slots[at]!.x, slots[at]!.y, expansion, ON_LINE);
    for (let g = 0; g < groups.length; g++) {
      const left = groups[g]!.filter((at) => !this.slotUsed[at] && !slots[at]!.opening);
      if (left.length === 0) continue;
      if (!this.started.has(g)) {
        if (this.wallsPlaced + left.length > budget || !left.every(free)) break;
        this.started.add(g);
      }
      const next = left.find(free);
      if (next !== undefined) return this.takeSlot(next);
      break;
    }
    const sides = ring.slice(0, -1);
    const building = sides.findIndex((side, r) => this.ringStarted.has(r) && side.some(free));
    if (building >= 0) return this.takeSlot(sides[building]!.find(free)!);
    // The first side those walls finish, else the first with room: a short run hugging the core reads as a thicker wall.
    let closes = sides.findIndex((side) => {
      const left = side.filter(free);
      return left.length > 0 && left.length <= budget - this.wallsPlaced;
    });
    if (closes < 0) closes = sides.findIndex((side) => side.some(free));
    if (closes >= 0) {
      this.ringStarted.add(closes);
      return this.takeSlot(sides[closes]!.find(free)!);
    }
    const corner = ring[ring.length - 1]!.find((at) => free(at) && this.cornered(slots[at]!));
    if (corner !== undefined) return this.takeSlot(corner);
    for (const pass of [groups, ring]) {
      for (let g = 0; g < pass.length; g++) {
        const next = pass[g]!.find(free);
        if (next === undefined) continue;
        if (pass === groups) this.started.add(g);
        return this.takeSlot(next);
      }
    }
    return null;
  }

  /** Whether walls stand on two sides of a cell that meet at a corner. */
  private cornered({ x, y }: { x: number; y: number }): boolean {
    const across = this.wallAt.has(keyOf(x - WALL_CELL, y)) || this.wallAt.has(keyOf(x + WALL_CELL, y));
    const down = this.wallAt.has(keyOf(x, y - WALL_CELL)) || this.wallAt.has(keyOf(x, y + WALL_CELL));
    return across && down;
  }

  /** The next free hallway cell, for a trap, or null. */
  private trapCell(type: number, expansion: number): WallSlot | null {
    const { slots, openings } = this.plan;
    const next = openings.find(
      (at) => !this.slotUsed[at] && this.fits(type, slots[at]!.x, slots[at]!.y, expansion, ON_OPENING)
    );
    return next === undefined ? null : this.takeSlot(next);
  }

  /** Places one building (see the file comment) and returns its spot. */
  place(id: number, type: number, level: number, hall: number): PlacedSpot {
    const expansion = Math.max(expansionFor(this.seed, level), this.bought);
    const role = roleOf(type);
    const rng = streamOf(this.seed, SALT.building, id);
    const { w, h } = footprintOf(type);

    if (role === "hall") {
      const x = snap(this.plan.cx - w / 2);
      const y = snap(this.plan.cy - h / 2);
      if (this.fits(type, x, y, expansion, ON_FREE | ON_CORE)) return this.put(id, type, x, y);
    }
    const silos = this.byGroup.get(SILO_TYPE)?.length ?? 0;
    if (type === SILO_TYPE && silos < this.plan.silos.length) {
      const spot = this.plan.silos[silos]!;
      if (this.fits(type, spot.x, spot.y, expansion, ON_FREE | ON_CORE | ON_KEPT | ON_WALKWAY)) {
        return this.put(id, type, spot.x, spot.y);
      }
    }
    if (role === "wall") {
      const slot = this.wallCell(type, expansion, hall);
      if (slot) return this.put(id, type, slot.x, slot.y);
    }
    if (role === "trap") {
      const slot = this.trapCell(type, expansion);
      if (slot) return this.put(id, type, slot.x, slot.y);
    }

    // A big building may stand hard against a wall: a compartment keeps no walkway for it.
    const allowed =
      (role === "wall"
        ? ON_FREE | ON_WALKWAY
        : role === "trap"
          ? ON_FREE | ON_WALKWAY | ON_APPROACH | ON_OPENING
          : ON_FREE) |
      (IN_CORE.has(role) ? ON_CORE : 0) |
      (w >= BIG ? ON_WALKWAY : 0);
    const spots: { x: number; y: number }[] = this.zoneSpots(rng, type, role, expansion, 40);
    const gaps = CLUSTER_GAPS[role];
    if (gaps) spots.push(...this.beside(rng, type, this.byGroup.get(groupOf(type)) ?? [], gaps, 24));
    if (role === "wall") spots.push(...this.beside(rng, type, this.byGroup.get(WALL_TYPE) ?? [], [0], 24));
    if (role === "trap") {
      const resources = [
        ...(this.byGroup.get(SILO_TYPE) ?? []),
        ...[1, 2, 3, 4].flatMap((t) => this.byGroup.get(t) ?? []),
      ];
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
 * @param entries - Every building in build order, with the level and Town Hall it was built at.
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
    buildings.push(layout.place(nextId++, entry.t, entry.level, entry.hall));
    const next = decorations[placedDecorations.length];
    if (next && buildings.length >= next.after) {
      placedDecorations.push(layout.place(nextId++, next.t, entry.level, entry.hall));
    }
  }
  return {
    buildings,
    decorations: placedDecorations,
    expansion: Math.max(expansionFor(seed, level), layout.bought),
  };
};
