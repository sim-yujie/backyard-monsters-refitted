import { gridCost } from "./stats.js";
import { blocksPathing, fromIso, toIso } from "./yard.js";
import type { Cart, EngineBuilding, EngineYard } from "./yard.js";
import type { Rng } from "./rng.js";

/**
 * The pathing grid: what a yard costs to walk across, and the route through it.
 *
 * The Flash client keeps one 260 x 260 grid of cells, ten yard units to a cell,
 * over the cartesian projection of the yard
 * (`client/scripts/com/monsters/pathing/PATHING.as:34-36`, `:84`). Every cell
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
 * whenever the costs change.
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
 *    the same early exit `CheckStartReached` makes (`:394-410`). Routes through
 *    open ground are identical; a route through a dense cost field can be
 *    cheaper here than the one Flash drew.
 * 2. **One flood cache, invalidated wholesale.** A building's death makes the
 *    client call `ResetCosts`, which restamps the grid and drops every flood
 *    (`:140-168`, `:535-561`; `BFOUNDATION.as:2010-2011`). The engine does the
 *    same by version: {@link PathGrid.removeBuilding} subtracts that building's
 *    rectangles and bumps `version`, and every cached flood is discarded. The
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

/** Packing factor for the heap: cell index below, depth above. */
const HEAP_SCALE = 1 << 17;

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

/** The cell a cartesian point falls in, or -1 when it is off the grid. */
export const cellOf = (cartX: number, cartY: number): number =>
  cellIndexOf(toCellAxis(cartX, GRID_WIDTH), toCellAxis(cartY, GRID_HEIGHT));

/** The cell an isometric yard point falls in, or -1 when it is off the grid. */
export const cellOfIso = (x: number, y: number): number => {
  const cart = fromIso(x, y);
  return cellOf(cart.x, cart.y);
};

/** The cartesian corner of a cell, which is what the client's waypoints are. */
export const cellCorner = (index: number): Cart => ({
  x: toCartAxis(Math.floor(index / GRID_HEIGHT), GRID_WIDTH),
  y: toCartAxis(index % GRID_HEIGHT, GRID_HEIGHT),
});

/** A route through the grid. */
export interface PathResult {
  /**
   * Waypoints in isometric yard units, the space creeps move in.
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
  /** The creep, in isometric yard units. */
  readonly fromX: number;
  readonly fromY: number;
  /** The building being walked to. */
  readonly target: EngineBuilding;
  /** Behaviours that walk through walls rather than into them (`:1174-1177`). */
  readonly ignoreWalls?: boolean;
}

/** The grid of one battle. */
export interface PathGrid {
  /** Bumped whenever the costs change, which discards every cached flood. */
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
  heap: Float64Array;
  size: number;
  exhausted: boolean;
}

const push = (flood: Flood, value: number): void => {
  if (flood.size === flood.heap.length) {
    const grown = new Float64Array(flood.heap.length * 2);
    grown.set(flood.heap);
    flood.heap = grown;
  }
  const heap = flood.heap;
  let child = flood.size;
  flood.size += 1;
  heap[child] = value;
  while (child > 0) {
    const parent = (child - 1) >> 1;
    if ((heap[parent] as number) <= (heap[child] as number)) break;
    const swap = heap[parent] as number;
    heap[parent] = heap[child] as number;
    heap[child] = swap;
    child = parent;
  }
};

const pop = (flood: Flood): number => {
  const heap = flood.heap;
  const top = heap[0] as number;
  flood.size -= 1;
  heap[0] = heap[flood.size] as number;
  let parent = 0;
  for (;;) {
    const left = parent * 2 + 1;
    if (left >= flood.size) break;
    const right = left + 1;
    let smallest = left;
    if (right < flood.size && (heap[right] as number) < (heap[left] as number)) smallest = right;
    if ((heap[parent] as number) <= (heap[smallest] as number)) break;
    const swap = heap[parent] as number;
    heap[parent] = heap[smallest] as number;
    heap[smallest] = swap;
    parent = smallest;
  }
  return top;
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
  let floods = new Map<number, Flood>();
  let floodsComputed = 0;

  /** `PATHING.Cost`: add one rectangle's price to the cells it covers. */
  const stamp = (building: EngineBuilding, sign: number): void => {
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
        }
      }
    }
  };

  /** `PATHING.RegisterBuilding`: mark the footprint cells of a wall (`:121-138`). */
  const register = (building: EngineBuilding, id: number): void => {
    const originX = toCellAxis(building.cx, GRID_WIDTH);
    const originY = toCellAxis(building.cy, GRID_HEIGHT);
    const across = Math.ceil(building.w * 0.1);
    const down = Math.ceil(building.h * 0.1);
    for (let stepX = 0; stepX < across; stepX += 1) {
      for (let stepY = 0; stepY < down; stepY += 1) {
        const index = cellIndexOf(originX + stepX, originY + stepY);
        if (index >= 0) wall[index] = id;
      }
    }
  };

  for (const building of yard.buildings) {
    if (building.hp <= 0 && building.kind !== "mushroom") continue;
    stamp(building, 1);
    if (blocksPathing(building.type)) register(building, building.id);
  }

  const removeBuilding = (building: EngineBuilding): void => {
    stamp(building, -1);
    if (blocksPathing(building.type)) register(building, -1);
    version += 1;
    floods = new Map();
  };

  /** The cost of entering one cell, as the flood prices it. */
  const enterCost = (index: number, ignoreWalls: boolean): number =>
    ignoreWalls && (wall[index] as number) >= 0
      ? GRID_IGNORE_WALLS_COST
      : (cost[index] as number);

  /** The flood out of a target's footprint, created on first use. */
  const floodFor = (target: EngineBuilding, ignoreWalls: boolean): Flood => {
    const originX = toCellAxis(target.cx, GRID_WIDTH);
    const originY = toCellAxis(target.cy, GRID_HEIGHT);
    const key = (originX * GRID_HEIGHT + originY) * 2 + (ignoreWalls ? 1 : 0);
    const held = floods.get(key);
    if (held) return held;

    const flood: Flood = {
      depth: new Int32Array(CELL_COUNT).fill(-1),
      settled: new Uint8Array(CELL_COUNT),
      ignoreWalls,
      heap: new Float64Array(1024),
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
        push(flood, index);
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
      const packed = pop(flood);
      const index = packed % HEAP_SCALE;
      const depth = (packed - index) / HEAP_SCALE;
      if ((flood.settled[index] as number) === 1) continue;
      flood.settled[index] = 1;
      if (index === goal) return;
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
          push(flood, next * HEAP_SCALE + neighbour);
        }
      }
    }
    flood.exhausted = true;
  };

  /** `PATHING.Jiggle` (`:495-497`), which is two draws off the battle's stream. */
  const jiggle = (value: number, rng: Rng): number =>
    value + (rng.float() - 0.5) * JIGGLE_SPREAD;

  const waypointOf = (cellX: number, cellY: number): Cart => {
    const cart = toIso(toCartAxis(cellX, GRID_WIDTH), toCartAxis(cellY, GRID_HEIGHT));
    return cart;
  };

  const path = (request: PathRequest, rng: Rng): PathResult => {
    const ignoreWalls = request.ignoreWalls === true;
    const start = cellOfIso(Math.trunc(request.fromX), Math.trunc(request.fromY));
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
