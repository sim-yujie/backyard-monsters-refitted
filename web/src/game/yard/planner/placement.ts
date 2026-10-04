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
 * - Decorations are held to the plot too (owner decision 2026-09-29, #128).
 *   The Flash planner let them anywhere in its larger `MAX_YARD_DIMENSIONS`
 *   of 3240 x 2600 (`BASE.as:4635-4640`, `PlannerDesignView.as:104`), so a
 *   save can hold one outside the plot: it may stay exactly at that spot
 *   ({@link PlanNode.home}), and nothing moves it on its own.
 * - Mushrooms are not obstacles (#263, owner decision 2026-10-04). The
 *   Flash planner skipped them (`BASE.as:5097-5109`); here they never block
 *   either, and Apply moves any mushroom a building lands on.
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
 * The area the occupancy grid and the blueprint cover: the Flash planner's
 * decoration bounds, `MAX_YARD_DIMENSIONS`
 * (`client/scripts/com/monsters/baseplanner/PlannerDesignView.as:104`).
 *
 * Nothing new may be put outside the plot any more (#128), but a decoration
 * a Flash save left out here still stands on cells, so the grid keeps the
 * whole area.
 */
export const DECORATION_WIDTH = 3240;
export const DECORATION_HEIGHT = 2600;

const GRID_COLUMNS = DECORATION_WIDTH / GRID_STEP;
const GRID_ROWS = DECORATION_HEIGHT / GRID_STEP;
const GRID_ORIGIN_X = DECORATION_WIDTH / 2;
const GRID_ORIGIN_Y = DECORATION_HEIGHT / 2;

/**
 * Cells per side of the blocks {@link Occupancy.occupantsIn} marks off before
 * it reads anything, so overlapping areas are read once between them.
 */
const BLOCK = 4;
const BLOCK_COLUMNS = Math.ceil(GRID_COLUMNS / BLOCK);
const BLOCK_ROWS = Math.ceil(GRID_ROWS / BLOCK);

/**
 * A planned upgrade on one node (`docs/design/planner-upgrades.md` §2.1).
 *
 * Immutable, so the undo stack can hold the value that was there before an
 * edit rather than a copy of it. `level` is the target the player wants and
 * `order` their place in the queue: Apply walks plans in ascending `order`,
 * ties broken by id, so the order they planned in is the order they get.
 */
export interface NodePlan {
  readonly level: number;
  readonly order: number;
}

/**
 * One building in the plan.
 *
 * Positions, level, fortification and the planned upgrade are mutable;
 * identity and footprint are not. The level moves because a batch action can
 * change it under the plan — `Plan.absorb` takes the server's word for it
 * after a wall upgrade rather than rebuilding the plan and losing every drag
 * the player has made.
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
  /** Decorations are not required to be placed: Apply puts one left in the drawer into storage. */
  readonly decoration: boolean;
  /**
   * A decoration's spot as the save has it. One outside the plot may stay
   * exactly here (owner decision 2026-09-29, #128); any other spot is held
   * to the plot. Absent for everything else.
   */
  home?: Position;
  /**
   * A decoration still in storage (#128), handed to the planner as a stored
   * node (`decorStorage.ts`, `withStoredDecorations`). Put down, Apply takes
   * it out of storage (`fromStorage`); left in the drawer, it stays there.
   */
  fromStorage?: true;
  /** An obstacle the planner may not move. Mushrooms were, until #263; nothing is now. */
  readonly fixed: boolean;
  /**
   * The building has been lifted off the plot and into the planner's drawer.
   *
   * A stored node holds no cells, is drawn nowhere, and is not written into a
   * layout. It is still in the plan — it keeps its id, its level and its
   * planned upgrade — because storing has to be undoable and because the
   * checklist names it by type when it blocks Apply
   * (`docs/design/yard-planner-redesign.md` §8, Q4).
   *
   * `x` and `y` are left as they were, so undoing a store puts the building
   * back on the exact cells it came off.
   */
  stored: boolean;
  /**
   * The upgrade the player has planned for this building, or null.
   *
   * Carried on the node rather than in a side table because every path that
   * reads a plan — the save, the load, the badge, the bar's totals, the Apply
   * preview — already has the node in hand.
   */
  plan: NodePlan | null;
  /**
   * A build, upgrade or fortify countdown is running on this building.
   *
   * One of the two facts about the yard the placement layer carries, because
   * F1 rule 3 refuses to plan an upgrade on a busy building and the Apply walk
   * skips one (`docs/design/planner-upgrades.md` §3.4). A rebuild does not
   * count: it holds no worker (spec `docs/specs/base-building.md:784-786`).
   */
  busy: boolean;
  /**
   * The save carries a health reading for this building.
   *
   * Any reading at all, not only one under half maximum: the server refuses to
   * upgrade a building whose save row has `hp`, or which appears in
   * `buildinghealthdata` (`server/src/services/yardplanner/startUpgrades.ts`,
   * `isDamaged`), so the planner reads damage the same way rather than the way
   * the art does.
   */
  damaged: boolean;
}

/** An absolute spot in yard units. What a group operation answers with. */
export interface Position {
  readonly x: number;
  readonly y: number;
}

/** A rectangle in yard units, covering `[x, x + width) x [y, y + height)`. */
export interface YardArea {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
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

/**
 * Whether a node placed at `(x, y)` lies wholly inside the plot, or is a
 * decoration at its {@link PlanNode.home}.
 *
 * The far edge is inclusive because a footprint ending exactly at `w / 2`
 * occupies its last cell at `w / 2 - 5`, which is the last cell inside the
 * plot. Both are multiples of 5 in every yard, so the two readings never differ.
 */
export const inBounds = (node: PlanNode, x: number, y: number, plot: PlotBounds): boolean => {
  if (node.home && node.home.x === x && node.home.y === y) return true;
  const { halfWidth, halfHeight } = plot;
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
 * Its answers are ids or `null`, never "0 for none": a save can hold a
 * building 0 — the owner's Town Hall is one — and an answer of 0 read as
 * "nothing there" let anything be dropped onto it (#212). The Flash grid kept a
 * bare blocked bit per cell (`GRID.as:25-49`), so it never had the question.
 *
 * Cells are addressed from the decoration area's top-left corner rather than
 * the plot's, so the same array serves a building and a decoration that has
 * wandered outside the fence, and expanding the yard does not reallocate it.
 */
export class Occupancy {
  private readonly cells = new Int32Array(GRID_COLUMNS * GRID_ROWS);
  /** Scratch for `occupantsIn`, all zero between calls. Made on first use. */
  private marks: Uint8Array | null = null;

  /** Empties every cell. */
  clear(): void {
    this.cells.fill(0);
  }

  /** Writes a node's footprint in. Returns an id already there, or null. */
  stamp(node: PlanNode, x = node.x, y = node.y): number | null {
    return this.walk(node, x, y, node.id + 1);
  }

  /** Removes a node's footprint. */
  erase(node: PlanNode, x = node.x, y = node.y): void {
    this.walk(node, x, y, 0);
  }

  /** The id of the first node blocking this placement, or null for none. */
  blockedBy(node: PlanNode, x: number, y: number): number | null {
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
    return null;
  }

  /**
   * Every id standing on any cell of any of the areas (#231).
   *
   * The areas are rounded out to 4 x 4-cell blocks and each block is read
   * once however many areas cover it, so the nearby outlines around a
   * 400-wall run cost the cells the run's surroundings cover, not 400 times
   * a square around each wall. A footprint is found if any one of its cells
   * is in a block, so a building half inside an area counts.
   */
  occupantsIn(areas: readonly YardArea[], into = new Set<number>()): Set<number> {
    const marks = (this.marks ??= new Uint8Array(BLOCK_COLUMNS * BLOCK_ROWS));
    const touched: number[] = [];

    for (const area of areas) {
      if (area.width <= 0 || area.height <= 0) continue;
      const first = this.firstCell(area.x, area.y);
      // The cell holding the area's last unit, one short of its far edge.
      const last = this.firstCell(area.x + area.width - 1, area.y + area.height - 1);
      const fromX = Math.max(0, Math.floor(first.cx / BLOCK));
      const fromY = Math.max(0, Math.floor(first.cy / BLOCK));
      const toX = Math.min(BLOCK_COLUMNS - 1, Math.floor(last.cx / BLOCK));
      const toY = Math.min(BLOCK_ROWS - 1, Math.floor(last.cy / BLOCK));
      for (let by = fromY; by <= toY; by++) {
        for (let bx = fromX; bx <= toX; bx++) {
          const block = by * BLOCK_COLUMNS + bx;
          if (marks[block]) continue;
          marks[block] = 1;
          touched.push(block);
        }
      }
    }

    for (const block of touched) {
      marks[block] = 0;
      const bx = block % BLOCK_COLUMNS;
      const by = (block - bx) / BLOCK_COLUMNS;
      const endY = Math.min(GRID_ROWS, (by + 1) * BLOCK);
      const endX = Math.min(GRID_COLUMNS, (bx + 1) * BLOCK);
      for (let cy = by * BLOCK; cy < endY; cy++) {
        const base = cy * GRID_COLUMNS;
        for (let cx = bx * BLOCK; cx < endX; cx++) {
          const occupant = this.cells[base + cx];
          if (occupant) into.add(occupant - 1);
        }
      }
    }
    return into;
  }

  /** Writes `value` over a footprint; returns the first occupant displaced. */
  private walk(node: PlanNode, x: number, y: number, value: number): number | null {
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
    return displaced === 0 ? null : displaced - 1;
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
    if (other !== null) issues.push({ id: node.id, reason: InvalidReason.OVERLAP, otherId: other });
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
    if (other !== null) {
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
    if (other !== null) issues.push({ id: node.id, reason: InvalidReason.OVERLAP, otherId: other });
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
