import { gridCost } from "./stats.js";
import { blocksPathing } from "./yard.js";
import type { Cart, EngineBuilding, EngineYard } from "./yard.js";
import type { Rng } from "./rng.js";

/**
 * The pathing grid: what a yard costs to walk across, and the route through it.
 *
 * The Flash client keeps one 260 x 260 grid of cells, ten yard units to a cell,
 * over the cartesian yard that `buildingdata` is saved in
 * (`client/scripts/com/monsters/pathing/PATHING.as:34-36`, `:84`), so a
 * building's anchor and a creep's position index it with no conversion. Flash
 * hands its waypoints back on screen (`PATHING.ToISO`, `:420`, `:482`), because
 * its creeps walk on screen; the engine keeps them in yard units, the space its
 * creeps are held in. Every cell
 * starts at cost 10 and each building adds its `_gridCost` rectangles on top
 * (`:93-119`), so a creep prefers open ground, skirts the expensive middle of a
 * building, and treats a wall line as a price rather than a barrier. Walls are
 * the only class that also *register* on the grid
 * (`client/scripts/BWALL.as:11-13`), which is what lets a route be cut short at
 * the wall in the way so the creep attacks it instead.
 *
 * A route is found by flooding outwards from the target's footprint and then
 * walking downhill from the creep (`:225-269`, `:303-392`, `:412-493`). The
 * flood is per target, shared by every creep heading there, and thrown away
 * when the costs change under it.
 *
 * ## Fidelity notes
 *
 * 1. **Exact Dijkstra, not the client's time-sliced best-first flood.** The
 *    client expands its frontier inside a wall-clock budget and throttles on a
 *    running `minDepth` (`PATHING.as:303-392`), which lets a cell be admitted
 *    at a depth that is not its cheapest and makes the result depend on how
 *    fast the machine is. That is exactly what `docs/design/server-combat.md`
 *    §3.4 forbids. The engine runs an exact shortest-path flood with the same
 *    cost model, stopping as soon as the creep's own cell is settled, which is
 *    the same early exit `CheckStartReached` makes (`:394-410`), though only
 *    once that cell's neighbours are priced, so a flood resumed for the next
 *    creep carries on exactly as an unbroken one would and a route never
 *    depends on which creep asked first. Routes through open ground are
 *    identical; a route through a dense cost field can be
 *    cheaper here than the one Flash drew.
 * 2. **One flood cache, invalidated where the costs changed.** A building's
 *    death makes the client call `ResetCosts`, which restamps the grid and
 *    drops every flood (`:140-168`, `:535-561`; `BFOUNDATION.as:2010-2011`).
 *    The engine's {@link PathGrid.removeBuilding} subtracts that building's
 *    rectangles, bumps `version`, and discards every flood that had priced a
 *    changed cell. A flood that never gave one a depth never read its cost,
 *    so it is exactly the flood a fresh start would grow, and is kept: the
 *    routes are the ones dropping every flood gives, with fewer floods. The
 *    subtraction is exact rather than a restamp because no `_gridCost`
 *    rectangle in the table is negative, so the `cost < 2` floor at `:104-105`
 *    never fires and adding then subtracting is a round trip; `grid.test.ts`
 *    asserts the table has no negative cost.
 * 3. **No time slicing and no pending queue.** The client answers a path
 *    request over many frames and calls back when it is ready, so a creep walks
 *    on stale waypoints in the meantime. The engine answers within the tick.
 *    A creep therefore turns a few ticks earlier than in Flash.
 * 4. **The trailing duplicate waypoint is kept.** `PATHING.Path` never resets
 *    `foundLowerDepth`, so the last pass of its descent pushes the final cell a
 *    second time with a fresh jiggle (`:478-482`). It is reproduced, because it
 *    consumes two draws from the battle's random stream and dropping it would
 *    shift every draw after it.
 */

/** Cells across and down; the grid covers 2,600 x 2,600 cartesian units. */
export const GRID_WIDTH = 260;
export const GRID_HEIGHT = 260;

/** Cartesian units to a cell (`PATHING.Cost` scales every rectangle by 0.1). */
export const GRID_CELL = 10;

/** What an empty cell costs to enter (`PATHING.Setup`, `PATHING.as:84`). */
export const GRID_BASE_COST = 10;

/** The floor `PATHING.Cost` clamps a cell to (`:104-105`). */
export const GRID_MIN_COST = 2;

/** Diagonal steps cost half again as much (`:360-362`). */
export const GRID_DIAGONAL_MULTIPLIER = 1.5;

/** What a registered building costs a flood that ignores walls (`:355-357`). */
export const GRID_IGNORE_WALLS_COST = 20;

/** Below this depth the descent scatters sideways (`:453`). */
export const SCATTER_DEPTH = 20;

/** How often it does (`:454`). */
export const SCATTER_CHANCE = 0.6;

/** How far to either side it looks, diagonals only (`:456-460`). */
export const SCATTER_SPREAD = 3;

/** How far a waypoint is nudged off the cell centre (`PATHING.Jiggle`, `:496`). */
export const JIGGLE_SPREAD = 0.4;

const CELL_COUNT = GRID_WIDTH * GRID_HEIGHT;

/** Cartesian units to a cell coordinate (`PATHING.GlobalLocal`, `:653-661`). */
const toCellAxis = (value: number, extent: number): number =>
  Math.trunc(value * 0.1 + (extent >> 1));

/** A cell coordinate back to cartesian (`PATHING.LocalGlobal`, `:663-669`). */
const toCartAxis = (cell: number, extent: number): number => (cell - (extent >> 1)) * GRID_CELL;

/** The flat index of a cell, or -1 when it is off the grid. */
export const cellIndexOf = (cellX: number, cellY: number): number =>
  cellX < 0 || cellY < 0 || cellX >= GRID_WIDTH || cellY >= GRID_HEIGHT
    ? -1
    : cellX * GRID_HEIGHT + cellY;

/** The cell a yard point falls in, or -1 when it is off the grid. */
export const cellOf = (cartX: number, cartY: number): number =>
  cellIndexOf(toCellAxis(cartX, GRID_WIDTH), toCellAxis(cartY, GRID_HEIGHT));

/** The yard corner of a cell, which is what the client's waypoints are. */
export const cellCorner = (index: number): Cart => ({
  x: toCartAxis(Math.floor(index / GRID_HEIGHT), GRID_WIDTH),
  y: toCartAxis(index % GRID_HEIGHT, GRID_HEIGHT),
});

/** A route through the grid. */
export interface PathResult {
  /**
   * Waypoints in yard units, the space the engine holds creeps in.
   *
   * Empty when the flood never reached the creep, which is the client's
   * "no path" answer and makes the creep walk straight at its target.
   */
  readonly waypoints: readonly Cart[];
  /**
   * The wall that cut the route short, or -1.
   *
   * `PATHING.Path` hands the callback the blocking wall instead of the target
   * when the route walks into one (`:445-452`), and the creep retargets onto it.
   */
  readonly blockedBy: number;
  /** Whether the flood reached the creep's cell at all. */
  readonly reached: boolean;
}

/** What a caller asks a route for. */
export interface PathRequest {
  /** The creep, in yard units. */
  readonly fromX: number;
  readonly fromY: number;
  /** The building being walked to. */
  readonly target: EngineBuilding;
  /** Behaviours that walk through walls rather than into them (`:1174-1177`). */
  readonly ignoreWalls?: boolean;
}

/** The grid of one battle. */
export interface PathGrid {
  /**
   * Bumped whenever the costs change, which discards every cached flood that
   * had reached a changed cell.
   */
  readonly version: number;
  /** What it costs to enter a cell; 0 for a cell off the grid. */
  costAt(index: number): number;
  /** The id of the wall occupying a cell, or -1. */
  wallAt(index: number): number;
  /** Subtract a dead building's rectangles and clear its registration. */
  removeBuilding(building: EngineBuilding): void;
  /** Walk from a creep to a building. */
  path(request: PathRequest, rng: Rng): PathResult;
  /** How many floods have been computed, which is what the bench watches. */
  floodCount(): number;
}

/** A resumable shortest-path flood out of one target footprint. */
interface Flood {
  readonly depth: Int32Array;
  readonly settled: Uint8Array;
  readonly ignoreWalls: boolean;
  /**
   * A binary min-heap of (depth, cell) entries, ordered by depth and then by
   * cell index, held as two parallel arrays.
   */
  heapDepth: Int32Array;
  heapCell: Int32Array;
  size: number;
  exhausted: boolean;
}

/** Whether heap entry `one` sorts strictly before entry `other`. */
const before = (depths: Int32Array, cells: Int32Array, one: number, other: number): boolean => {
  const oneDepth = depths[one] as number;
  const otherDepth = depths[other] as number;
  return (
    oneDepth < otherDepth ||
    (oneDepth === otherDepth && (cells[one] as number) < (cells[other] as number))
  );
};

const push = (flood: Flood, depth: number, cell: number): void => {
  if (flood.size === flood.heapDepth.length) {
    const grownDepth = new Int32Array(flood.heapDepth.length * 2);
    grownDepth.set(flood.heapDepth);
    flood.heapDepth = grownDepth;
    const grownCell = new Int32Array(flood.heapCell.length * 2);
    grownCell.set(flood.heapCell);
    flood.heapCell = grownCell;
  }
  const depths = flood.heapDepth;
  const cells = flood.heapCell;
  let child = flood.size;
  flood.size += 1;
  depths[child] = depth;
  cells[child] = cell;
  while (child > 0) {
    const parent = (child - 1) >> 1;
    if (!before(depths, cells, child, parent)) break;
    const swapDepth = depths[parent] as number;
    const swapCell = cells[parent] as number;
    depths[parent] = depths[child] as number;
    cells[parent] = cells[child] as number;
    depths[child] = swapDepth;
    cells[child] = swapCell;
    child = parent;
  }
};

/** Remove the top entry; read it from index 0 of both arrays first. */
const pop = (flood: Flood): void => {
  const depths = flood.heapDepth;
  const cells = flood.heapCell;
  flood.size -= 1;
  depths[0] = depths[flood.size] as number;
  cells[0] = cells[flood.size] as number;
  let parent = 0;
  for (;;) {
    const left = parent * 2 + 1;
    if (left >= flood.size) break;
    const right = left + 1;
    let smallest = left;
    if (right < flood.size && before(depths, cells, right, left)) smallest = right;
    if (!before(depths, cells, smallest, parent)) break;
    const swapDepth = depths[parent] as number;
    const swapCell = cells[parent] as number;
    depths[parent] = depths[smallest] as number;
    cells[parent] = cells[smallest] as number;
    depths[smallest] = swapDepth;
    cells[smallest] = swapCell;
    parent = smallest;
  }
};

/**
 * Build the grid of a yard.
 *
 * Every living building stamps its `_gridCost` rectangles, and every wall also
 * registers itself on the cells its footprint covers. Buildings are visited in
 * the yard's id order, which is the order every rule iterates in (§3.4 rule 4);
 * addition is commutative, so the order only matters for reproducibility of the
 * `cost < 2` floor, which this table never reaches.
 */
export const buildPathGrid = (yard: EngineYard): PathGrid => {
  const cost = new Int32Array(CELL_COUNT).fill(GRID_BASE_COST);
  const wall = new Int32Array(CELL_COUNT).fill(-1);
  let version = 0;
  const floods = new Map<number, Flood>();
  let floodsComputed = 0;
  /**
   * The depth and settled arrays of discarded floods, kept for the next ones.
   * A battle computes thousands of floods and each needs two full-grid arrays;
   * clearing a used pair is far cheaper than allocating and collecting one.
   */
  const spare: { depth: Int32Array; settled: Uint8Array }[] = [];

  /**
   * `PATHING.Cost`: add one rectangle's price to the cells it covers, noting
   * each cell in `touched` when given.
   */
  const stamp = (building: EngineBuilding, sign: number, touched?: number[]): void => {
    for (const rect of gridCost(building.type, building.level)) {
      const originX = toCellAxis(building.cx + rect[0], GRID_WIDTH);
      const originY = toCellAxis(building.cy + rect[1], GRID_HEIGHT);
      const across = Math.ceil(rect[2] * 0.1);
      const down = Math.ceil(rect[3] * 0.1);
      for (let stepX = 0; stepX < across; stepX += 1) {
        for (let stepY = 0; stepY < down; stepY += 1) {
          const index = cellIndexOf(originX + stepX, originY + stepY);
          if (index < 0) continue;
          const next = (cost[index] as number) + sign * rect[4];
          cost[index] = next < GRID_MIN_COST ? GRID_MIN_COST : next;
          touched?.push(index);
        }
      }
    }
  };

  /** `PATHING.RegisterBuilding`: mark the footprint cells of a wall (`:121-138`). */
  const register = (building: EngineBuilding, id: number, touched?: number[]): void => {
    const originX = toCellAxis(building.cx, GRID_WIDTH);
    const originY = toCellAxis(building.cy, GRID_HEIGHT);
    const across = Math.ceil(building.w * 0.1);
    const down = Math.ceil(building.h * 0.1);
    for (let stepX = 0; stepX < across; stepX += 1) {
      for (let stepY = 0; stepY < down; stepY += 1) {
        const index = cellIndexOf(originX + stepX, originY + stepY);
        if (index < 0) continue;
        wall[index] = id;
        touched?.push(index);
      }
    }
  };

  for (const building of yard.buildings) {
    if (building.hp <= 0 && building.kind !== "mushroom") continue;
    stamp(building, 1);
    if (blocksPathing(building.type)) register(building, building.id);
  }

  /**
   * Take a fallen building off the grid, and with it every flood its cells
   * could have changed.
   *
   * A flood that never priced a changed cell — gave it no depth — never read
   * its old cost, so it stands exactly as a flood started afresh would at the
   * same point, and is kept. Any other is dropped, as is the fallen
   * building's own flood, which nothing will ask for again.
   */
  const removeBuilding = (building: EngineBuilding): void => {
    const touched: number[] = [];
    stamp(building, -1, touched);
    if (blocksPathing(building.type)) register(building, -1, touched);
    version += 1;
    const own = floodKey(building, false);
    for (const [key, flood] of floods) {
      const priced = touched.some((index) => (flood.depth[index] as number) >= 0);
      if (!priced && key !== own && key !== own + 1) continue;
      floods.delete(key);
      spare.push({ depth: flood.depth, settled: flood.settled });
    }
  };

  /** A flood's key: its target's origin cell, and whether it ignores walls. */
  const floodKey = (target: EngineBuilding, ignoreWalls: boolean): number =>
    (toCellAxis(target.cx, GRID_WIDTH) * GRID_HEIGHT + toCellAxis(target.cy, GRID_HEIGHT)) * 2 +
    (ignoreWalls ? 1 : 0);

  /** The cost of entering one cell, as the flood prices it. */
  const enterCost = (index: number, ignoreWalls: boolean): number =>
    ignoreWalls && (wall[index] as number) >= 0
      ? GRID_IGNORE_WALLS_COST
      : (cost[index] as number);

  /** The flood out of a target's footprint, created on first use. */
  const floodFor = (target: EngineBuilding, ignoreWalls: boolean): Flood => {
    const originX = toCellAxis(target.cx, GRID_WIDTH);
    const originY = toCellAxis(target.cy, GRID_HEIGHT);
    const key = floodKey(target, ignoreWalls);
    const held = floods.get(key);
    if (held) return held;

    const reused = spare.pop();
    const flood: Flood = {
      depth: reused ? reused.depth.fill(-1) : new Int32Array(CELL_COUNT).fill(-1),
      settled: reused ? reused.settled.fill(0) : new Uint8Array(CELL_COUNT),
      ignoreWalls,
      heapDepth: new Int32Array(1024),
      heapCell: new Int32Array(1024),
      size: 0,
      exhausted: false,
    };
    const across = Math.ceil(target.w * 0.1);
    const down = Math.ceil(target.h * 0.1);
    for (let stepX = 0; stepX < across; stepX += 1) {
      for (let stepY = 0; stepY < down; stepY += 1) {
        const index = cellIndexOf(originX + stepX, originY + stepY);
        if (index < 0) continue;
        flood.depth[index] = 0;
        push(flood, 0, index);
      }
    }
    floods.set(key, flood);
    floodsComputed += 1;
    return flood;
  };

  /** Expand a flood until the creep's cell is settled, or it runs out. */
  const expandTo = (flood: Flood, goal: number): void => {
    if (flood.exhausted || (flood.settled[goal] as number) === 1) return;
    while (flood.size > 0) {
      const depth = flood.heapDepth[0] as number;
      const index = flood.heapCell[0] as number;
      pop(flood);
      if ((flood.settled[index] as number) === 1) continue;
      flood.settled[index] = 1;
      const cellX = Math.floor(index / GRID_HEIGHT);
      const cellY = index % GRID_HEIGHT;
      for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
        for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
          if (offsetX === 0 && offsetY === 0) continue;
          const neighbour = cellIndexOf(cellX + offsetX, cellY + offsetY);
          if (neighbour < 0 || (flood.settled[neighbour] as number) === 1) continue;
          let step = enterCost(neighbour, flood.ignoreWalls);
          if (offsetX !== 0 && offsetY !== 0) {
            step = Math.trunc(step * GRID_DIAGONAL_MULTIPLIER);
          }
          const next = depth + step;
          const held = flood.depth[neighbour] as number;
          if (held >= 0 && held <= next) continue;
          flood.depth[neighbour] = next;
          push(flood, next, neighbour);
        }
      }
      // Only once the cell's neighbours are priced, so a flood resumed later
      // carries on exactly as one that never stopped would.
      if (index === goal) return;
    }
    flood.exhausted = true;
  };

  /** `PATHING.Jiggle` (`:495-497`), which is two draws off the battle's stream. */
  const jiggle = (value: number, rng: Rng): number =>
    value + (rng.float() - 0.5) * JIGGLE_SPREAD;

  /**
   * A cell corner as a waypoint. Flash's `PATHING.ToISO` also truncates it to a
   * whole screen pixel; the engine keeps the exact corner, under a pixel away.
   */
  const waypointOf = (cellX: number, cellY: number): Cart => ({
    x: toCartAxis(cellX, GRID_WIDTH),
    y: toCartAxis(cellY, GRID_HEIGHT),
  });

  const path = (request: PathRequest, rng: Rng): PathResult => {
    const ignoreWalls = request.ignoreWalls === true;
    // `GlobalLocal(FromISO(_tmpPoint))`: the creep's point truncates first.
    const start = cellOf(Math.trunc(request.fromX), Math.trunc(request.fromY));
    if (start < 0) return { waypoints: [], blockedBy: -1, reached: false };

    const flood = floodFor(request.target, ignoreWalls);
    expandTo(flood, start);
    const depth = flood.depth;
    if ((depth[start] as number) < 0) {
      return { waypoints: [], blockedBy: -1, reached: false };
    }

    const waypoints: Cart[] = [];
    let cellX = Math.floor(start / GRID_HEIGHT);
    let cellY = start % GRID_HEIGHT;
    let currentDepth = depth[start] as number;
    let currentX = cellX;
    let currentY = cellY;
    let found = false;
    waypoints.push(waypointOf(cellX, cellY));

    // `PATHING.Path` (`:412-493`): greedy descent, updating the depth inside the
    // neighbour scan, so the step taken is the last strictly cheaper neighbour
    // the fixed -1..1 scan order finds, not the cheapest.
    let walking = true;
    let guard = 0;
    while (walking && guard < CELL_COUNT) {
      guard += 1;
      walking = false;
      for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
        for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
          if (offsetX === 0 && offsetY === 0) continue;
          const neighbour = cellIndexOf(cellX + offsetX, cellY + offsetY);
          if (neighbour < 0) continue;
          const here = depth[neighbour] as number;
          if (here < 0 || here >= currentDepth || here <= 0) continue;
          currentX = cellX + offsetX;
          currentY = cellY + offsetY;
          found = true;
          currentDepth = here;
          walking = true;
          if (!ignoreWalls && waypoints.length > 1) {
            const blocker = wall[neighbour] as number;
            if (blocker >= 0) return { waypoints, blockedBy: blocker, reached: true };
          }
          if (!ignoreWalls && currentDepth < SCATTER_DEPTH && rng.float() < SCATTER_CHANCE) {
            const nearby: number[] = [];
            for (let scatterX = -SCATTER_SPREAD; scatterX <= SCATTER_SPREAD; scatterX += 1) {
              for (let scatterY = -SCATTER_SPREAD; scatterY <= SCATTER_SPREAD; scatterY += 1) {
                // The client skips the axes, so a creep only scatters diagonally.
                if (scatterX === 0 || scatterY === 0) continue;
                const candidate = cellIndexOf(currentX + scatterX, currentY + scatterY);
                if (candidate < 0) continue;
                const candidateDepth = depth[candidate] as number;
                if (candidateDepth > 0 && candidateDepth < SCATTER_DEPTH) nearby.push(candidate);
              }
            }
            if (nearby.length > 0) {
              const picked = nearby[rng.int(nearby.length)] as number;
              currentX = Math.floor(picked / GRID_HEIGHT);
              currentY = picked % GRID_HEIGHT;
            }
          }
        }
      }
      // `foundLowerDepth` is never cleared, so the pass that finds nothing still
      // pushes the final cell once more (fidelity note 4).
      if (found) {
        cellX = currentX;
        cellY = currentY;
        waypoints.push(waypointOf(jiggle(currentX, rng), jiggle(currentY, rng)));
      }
    }

    return { waypoints, blockedBy: -1, reached: true };
  };

  return {
    get version() {
      return version;
    },
    costAt: (index: number) => (index < 0 ? 0 : (cost[index] as number)),
    wallAt: (index: number) => (index < 0 ? -1 : (wall[index] as number)),
    removeBuilding,
    path,
    floodCount: () => floodsComputed,
  };
};
