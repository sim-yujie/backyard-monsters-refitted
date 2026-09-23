import { yardSize } from "../YardGrid";

/**
 * Placement rules for the planner, as arithmetic and nothing else.
 *
 * Every rule here is from docs/specs/base-building.md §2:
 *
 * - The occupancy grid is **5 yard units per cell** and a footprint blocks
 *   every cell it covers (`client/scripts/GRID.as:25-49`).
 * - A footprint starts at the building's origin and extends positively on both
 *   axes, so a node at `(x, y)` covers `[x, x + width) x [y, y + height)`
 *   (`GRID.as:86-98`).
 * - The plot spans `[-w/2, w/2) x [-h/2, h/2)` for the current expansion.
 * - **Decorations may sit outside the plot**, inside the planner's own larger
 *   `MAX_YARD_DIMENSIONS` of 3240 x 2600
 *   (`BASE.as:4635-4640`, `PlannerDesignView.as:104`).
 * - Mushrooms are 30 x 30 obstacles the planner cannot move
 *   (`BUILDING7.as:9-10`, `BASE.as:5097-5109`).
 *
 * ## Why a bitmap and not a loop over buildings
 *
 * Dragging a wall run of 400 blocks over a 575-building yard has to answer
 * "does any of these overlap anything" on every pointer move, inside 2 ms. A
 * pairwise test is 230,000 rectangle comparisons. Stamping the static buildings
 * into a cell array once, then reading one `Int32Array` slot per 5-unit cell of
 * the moving set, is a few thousand reads instead — and it is the same
 * structure the original game used, so it agrees with the server by
 * construction rather than by coincidence.
 *
 * Nothing in this file imports Pixi or touches the DOM, so all of it is unit
 * testable against the spec.
 */

/** Yard units per occupancy cell (`client/scripts/GRID.as:8-12`). */
export const GRID_STEP = 5;

/**
 * The planner's decoration bounds, `MAX_YARD_DIMENSIONS`
 * (`client/scripts/com/monsters/baseplanner/PlannerDesignView.as:104`).
 *
 * Wider than any plot and wider than the live game's own 2600 x 2600 grid on
 * the X axis; the two disagree in the original and this follows the planner,
 * because this is the planner.
 */
export const DECORATION_WIDTH = 3240;
export const DECORATION_HEIGHT = 2600;

const GRID_COLUMNS = DECORATION_WIDTH / GRID_STEP;
const GRID_ROWS = DECORATION_HEIGHT / GRID_STEP;
const GRID_ORIGIN_X = DECORATION_WIDTH / 2;
const GRID_ORIGIN_Y = DECORATION_HEIGHT / 2;

/**
 * One building in the plan.
 *
 * Positions, level and fortification are mutable; identity and footprint are
 * not. The level moves because a batch action can change it under the plan —
 * `Plan.absorb` takes the server's word for it after a wall upgrade rather than
 * rebuilding the plan and losing every drag the player has made.
 */
export interface PlanNode {
  readonly id: number;
  readonly type: number;
  /** Yard units, origin at the plot centre. The footprint's top corner. */
  x: number;
  y: number;
  readonly width: number;
  readonly height: number;
  level: number;
  fort: number;
  /** Decorations get the larger bounds and are not required to be placed. */
  readonly decoration: boolean;
  /** Mushrooms: obstacles the planner may not move. */
  readonly fixed: boolean;
}

/** An absolute spot in yard units. What a group operation answers with. */
export interface Position {
  readonly x: number;
  readonly y: number;
}

/** Half-extents of the area a node of a given kind may occupy. */
export interface PlotBounds {
  readonly halfWidth: number;
  readonly halfHeight: number;
}

/** Plot half-extents for an expansion level. */
export const plotBounds = (expansionLevel: number): PlotBounds => {
  const [width, height] = yardSize(expansionLevel);
  return { halfWidth: width / 2, halfHeight: height / 2 };
};

/** The decoration area's half-extents, which never change. */
export const DECORATION_BOUNDS: PlotBounds = {
  halfWidth: GRID_ORIGIN_X,
  halfHeight: GRID_ORIGIN_Y,
};

/** Rounds a yard coordinate onto the 5-unit grid. */
export const snap = (value: number): number => Math.round(value / GRID_STEP) * GRID_STEP;

/**
 * Decoration type ids: 28–50, 55–111, 120, 121, 131 and 135, which is every
 * type with `group == 4` (docs/specs/base-building.md §2, "Decorations").
 */
export const isDecoration = (type: number): boolean =>
  (type >= 28 && type <= 50) ||
  (type >= 55 && type <= 111) ||
  type === 120 ||
  type === 121 ||
  type === 131 ||
  type === 135;

export const InvalidReason = {
  OVERLAP: "overlap",
  BOUNDS: "bounds",
} as const;
export type InvalidReason = (typeof InvalidReason)[keyof typeof InvalidReason];

export interface PlacementIssue {
  readonly id: number;
  readonly reason: InvalidReason;
  /** For an overlap, the node already occupying the cells. */
  readonly otherId?: number;
}

export interface PlacementResult {
  readonly valid: boolean;
  readonly issues: readonly PlacementIssue[];
}

const VALID: PlacementResult = { valid: true, issues: [] };

/** The bounds a node is measured against: its plot, or the decoration area. */
export const boundsFor = (node: PlanNode, plot: PlotBounds): PlotBounds =>
  node.decoration ? DECORATION_BOUNDS : plot;

/**
 * Whether a node placed at `(x, y)` lies wholly inside its bounds.
 *
 * The far edge is inclusive because a footprint ending exactly at `w / 2`
 * occupies its last cell at `w / 2 - 5`, which is the last cell inside the
 * plot. Both are multiples of 5 in every yard, so the two readings never differ.
 */
export const inBounds = (node: PlanNode, x: number, y: number, plot: PlotBounds): boolean => {
  const { halfWidth, halfHeight } = boundsFor(node, plot);
  return (
    x >= -halfWidth &&
    x + node.width <= halfWidth &&
    y >= -halfHeight &&
    y + node.height <= halfHeight
  );
};

/**
 * The 5-unit occupancy bitmap, holding `id + 1` per cell so 0 reads as empty.
 *
 * Cells are addressed from the decoration area's top-left corner rather than
 * the plot's, so the same array serves a building and a decoration that has
 * wandered outside the fence, and expanding the yard does not reallocate it.
 */
export class Occupancy {
  private readonly cells = new Int32Array(GRID_COLUMNS * GRID_ROWS);

  /** Empties every cell. */
  clear(): void {
    this.cells.fill(0);
  }

  /** Writes a node's footprint in. Returns an id already there, or 0. */
  stamp(node: PlanNode, x = node.x, y = node.y): number {
    return this.walk(node, x, y, node.id + 1);
  }

  /** Removes a node's footprint. */
  erase(node: PlanNode, x = node.x, y = node.y): void {
    this.walk(node, x, y, 0);
  }

  /** The id of the first node blocking this placement, or 0 for none. */
  blockedBy(node: PlanNode, x: number, y: number): number {
    const first = this.firstCell(x, y);
    const columns = Math.ceil(node.width / GRID_STEP);
    const rows = Math.ceil(node.height / GRID_STEP);
    const startX = first.cx;
    const startY = first.cy;

    for (let row = 0; row < rows; row++) {
      const cy = startY + row;
      if (cy < 0 || cy >= GRID_ROWS) continue;
      const base = cy * GRID_COLUMNS;
      for (let column = 0; column < columns; column++) {
        const cx = startX + column;
        if (cx < 0 || cx >= GRID_COLUMNS) continue;
        const occupant = this.cells[base + cx];
        if (occupant) return occupant - 1;
      }
    }
    return 0;
  }

  /** Writes `value` over a footprint; returns the first occupant displaced. */
  private walk(node: PlanNode, x: number, y: number, value: number): number {
    const first = this.firstCell(x, y);
    const columns = Math.ceil(node.width / GRID_STEP);
    const rows = Math.ceil(node.height / GRID_STEP);
    let displaced = 0;

    for (let row = 0; row < rows; row++) {
      const cy = first.cy + row;
      if (cy < 0 || cy >= GRID_ROWS) continue;
      const base = cy * GRID_COLUMNS;
      for (let column = 0; column < columns; column++) {
        const cx = first.cx + column;
        if (cx < 0 || cx >= GRID_COLUMNS) continue;
        const slot = base + cx;
        const occupant = this.cells[slot];
        if (value !== 0 && occupant && !displaced) displaced = occupant;
        this.cells[slot] = value;
      }
    }
    return displaced === 0 ? 0 : displaced - 1;
  }

  private firstCell(x: number, y: number): { cx: number; cy: number } {
    return {
      cx: Math.floor((x + GRID_ORIGIN_X) / GRID_STEP),
      cy: Math.floor((y + GRID_ORIGIN_Y) / GRID_STEP),
    };
  }
}

/**
 * Tests a whole selection shifted by `(dx, dy)` against everything else.
 *
 * The caller must have erased the moving nodes from `occupancy` first, which is
 * what `Plan.beginMove` does. That keeps the hot loop free of any "is this one
 * of mine" test: a non-zero cell is always a real collision. Members of the
 * moving set cannot collide with each other, because a translation preserves
 * their relative offsets and the set was valid before it was picked up.
 */
export const validateOffset = (
  moving: readonly PlanNode[],
  dx: number,
  dy: number,
  occupancy: Occupancy,
  plot: PlotBounds,
): PlacementResult => {
  const issues: PlacementIssue[] = [];

  for (const node of moving) {
    const x = node.x + dx;
    const y = node.y + dy;

    if (!inBounds(node, x, y, plot)) {
      issues.push({ id: node.id, reason: InvalidReason.BOUNDS });
      continue;
    }
    const other = occupancy.blockedBy(node, x, y);
    if (other) issues.push({ id: node.id, reason: InvalidReason.OVERLAP, otherId: other });
  }

  return issues.length === 0 ? VALID : { valid: false, issues };
};

/**
 * Tests a selection moved to per-building positions: mirror, align, distribute.
 *
 * Unlike `validateOffset` this cannot assume the movers stay clear of each
 * other. A translation preserves the gaps inside the selection, so a set that
 * was valid before the drag is valid after it; an align does the opposite on
 * purpose, and two towers told to share a left edge can end up on the same
 * cells. So the movers are stamped in as they are cleared, and a later one that
 * lands on an earlier one is reported exactly like a collision with a wall that
 * never moved.
 *
 * The grid is left as it was found. The caller must have erased the movers
 * first (`Plan.beginMove`), and everything this stamps it takes back out, so a
 * refused operation changes nothing — which is the whole point: F7 is
 * all-or-nothing, never a partial application.
 */
export const validateTargets = (
  moving: readonly PlanNode[],
  targets: ReadonlyMap<number, Position>,
  occupancy: Occupancy,
  plot: PlotBounds,
): PlacementResult => {
  const issues: PlacementIssue[] = [];
  const placed: [PlanNode, Position][] = [];

  for (const node of moving) {
    // A building the operation does not name stays put, and still has to be
    // tested: an align can move its neighbour on top of it.
    const to = targets.get(node.id) ?? { x: node.x, y: node.y };

    if (!inBounds(node, to.x, to.y, plot)) {
      issues.push({ id: node.id, reason: InvalidReason.BOUNDS });
      continue;
    }
    const other = occupancy.blockedBy(node, to.x, to.y);
    if (other) {
      issues.push({ id: node.id, reason: InvalidReason.OVERLAP, otherId: other });
      continue;
    }
    occupancy.stamp(node, to.x, to.y);
    placed.push([node, to]);
  }

  for (const [node, to] of placed) occupancy.erase(node, to.x, to.y);

  return issues.length === 0 ? VALID : { valid: false, issues };
};

/**
 * Checks a whole plan from scratch: the pre-Apply checklist and the load path.
 *
 * Stamping in order and reporting whoever was already in a cell finds every
 * overlapping pair in one pass over the footprints rather than over the pairs.
 */
export const validatePlan = (
  nodes: Iterable<PlanNode>,
  plot: PlotBounds,
  into = new Occupancy(),
): PlacementResult => {
  into.clear();
  const issues: PlacementIssue[] = [];

  for (const node of nodes) {
    if (!inBounds(node, node.x, node.y, plot)) {
      issues.push({ id: node.id, reason: InvalidReason.BOUNDS });
      // Still stamped: a node that is out of bounds can also be sitting on top
      // of one that is not, and the player needs to see both problems.
    }
    const other = into.stamp(node);
    if (other) issues.push({ id: node.id, reason: InvalidReason.OVERLAP, otherId: other });
  }

  return issues.length === 0 ? VALID : { valid: false, issues };
};

/**
 * A world-pixel drag converted to yard units, snapped to the grid.
 *
 * `fromIso` rounds with `ceil` because it has to round-trip an absolute
 * position exactly (`YardGrid.ts`); a *delta* has no round trip to preserve and
 * rounding it that way would bias every drag up-left by half a unit, so this
 * uses the underlying linear map and lets `snap` do the rounding.
 */
export const dragToYard = (worldDx: number, worldDy: number): { dx: number; dy: number } => ({
  dx: snap(worldDx * 0.5 + worldDy),
  dy: snap(worldDy - worldDx * 0.5),
});
