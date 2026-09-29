import { CellType } from "@/api/types";
import { WORLD_HEIGHT, WORLD_WIDTH } from "@/config";
import { HexGrid, type OffsetCell } from "@/game/HexGrid";
import { cellDistance, cellReach, type OwnCell } from "@/game/attack/attackEntry";
import { mainYardRange, withDeclareWar } from "@/game/maproom/rules/range";

/**
 * The player's attack range as the map shows it (issue #177): which cells the
 * range overlay covers, where its line runs, and how far any one cell is from
 * the nearest flinger that reaches it.
 *
 * Every distance here is the shared rule's (`game/maproom/rules/range.ts`,
 * through `attackEntry.ts`), the one the Attack button and the server use, so
 * the line on the map and the button under it agree by construction.
 *
 * Pure: own cells and a Declare War flag in, cells and numbers out.
 */

/** One of the player's cells whose flinger reaches anything. */
export interface RangeSource {
  readonly col: number;
  readonly row: number;
  readonly kind: "main" | "outpost";
  /** The flinger's level. */
  readonly flinger: number;
  /** Cells it reaches, Declare War included while it runs. */
  readonly reach: number;
}

/**
 * The flingers the overlay draws from: every own cell in the loaded zones
 * whose flinger reaches anything.
 *
 * `home` stands in for the main yard until its zone arrives, from the own-yard
 * load's `homebase` and `flinger` — Flash drew the home range at once from
 * local data for the same reason (`MapRoomPopup.as:914-930`).
 */
export const rangeSources = (
  ownCells: readonly OwnCell[],
  declareWar: boolean,
  home?: { cell: OffsetCell; flinger: number | undefined } | null,
): RangeSource[] => {
  const sources: RangeSource[] = [];
  let homeSeen = false;
  for (const own of ownCells) {
    const kind = own.cell.b === CellType.OUTPOST ? "outpost" : "main";
    if (kind === "main") homeSeen = true;
    const reach = cellReach(own.cell, declareWar);
    if (reach > 0) sources.push({ col: own.col, row: own.row, kind, flinger: own.cell.f, reach });
  }
  if (!homeSeen && home && typeof home.flinger === "number") {
    const reach = withDeclareWar(mainYardRange(home.flinger), declareWar);
    if (reach > 0) {
      sources.push({ ...home.cell, kind: "main", flinger: home.flinger, reach });
    }
  }
  return sources.sort((a, b) =>
    a.kind === b.kind ? a.col - b.col || a.row - b.row : a.kind === "main" ? -1 : 1,
  );
};

/** A cell as a number, for sets: wrapped into the world first. */
export const cellKey = (col: number, row: number): number =>
  wrap(col, WORLD_WIDTH) * WORLD_HEIGHT + wrap(row, WORLD_HEIGHT);

const wrap = (value: number, size: number): number => ((value % size) + size) % size;

/**
 * Every cell some source reaches, as {@link cellKey}s.
 *
 * Walks each source's hex disc in axial space, as Flash's
 * `ApplyRangeHighlighting` does (`MapRoomPopup.as:975-1016`), wrapping each
 * cell into the world. The source's own cell is included.
 */
export const reachableCells = (sources: readonly RangeSource[]): Set<number> => {
  const cells = new Set<number>();
  for (const source of sources) {
    const { q, r } = HexGrid.toAxial(source.col, source.row);
    const n = source.reach;
    for (let dq = -n; dq <= n; dq++) {
      const from = Math.max(-n, -dq - n);
      const to = Math.min(n, -dq + n);
      for (let dr = from; dr <= to; dr++) {
        const cell = HexGrid.toOffset(q + dq, r + dr);
        cells.add(cellKey(cell.col, cell.row));
      }
    }
  }
  return cells;
};

/**
 * Which pair of a flat-top cell's corners (`HexGrid.writeCellCorners`: west,
 * upper left, upper right, east, lower right, lower left) borders each
 * neighbour, in `HexGrid.neighbours` order: east (lower right in odd-q),
 * north-east (upper right), north, west (upper left), south-west (lower
 * left), south.
 */
export const NEIGHBOUR_EDGES: readonly (readonly [number, number])[] = [
  [3, 4],
  [2, 3],
  [1, 2],
  [0, 1],
  [5, 0],
  [4, 5],
];

/** One side of a hex on the overlay's line: the cell inside and which side. */
export interface RangeEdge {
  readonly col: number;
  readonly row: number;
  /** Index into {@link NEIGHBOUR_EDGES}. */
  readonly side: number;
}

/**
 * The line round the reachable cells: every side of a reachable cell whose
 * neighbour is not reachable. Neighbours across a seam of the world are
 * wrapped, so a range that crosses the edge is not drawn cut off there.
 */
export const rangeEdges = (cells: ReadonlySet<number>): RangeEdge[] => {
  const edges: RangeEdge[] = [];
  for (const key of cells) {
    const col = Math.floor(key / WORLD_HEIGHT);
    const row = key % WORLD_HEIGHT;
    HexGrid.neighbours(col, row).forEach((neighbour, side) => {
      if (!cells.has(cellKey(neighbour.col, neighbour.row))) edges.push({ col, row, side });
    });
  }
  return edges;
};

/** How a cell stands against the player's range. */
export interface ReachAnswer {
  /** Whether any flinger reaches it. */
  readonly inRange: boolean;
  /**
   * In range: steps from the nearest flinger that reaches it. Out of range:
   * how many steps short the closest miss falls (at least 1).
   */
  readonly steps: number;
  /** The flinger that decided `steps`, or null when there is none at all. */
  readonly source: RangeSource | null;
}

/**
 * How far `target` is from the player's reach, for the hover card and the
 * cell panel ("In range · 3 cells away", "Out of range · 2 cells too far").
 */
export const reachTo = (target: OffsetCell, sources: readonly RangeSource[]): ReachAnswer => {
  let best: ReachAnswer = { inRange: false, steps: Number.POSITIVE_INFINITY, source: null };
  for (const source of sources) {
    const steps = cellDistance(source, target);
    if (steps <= source.reach) {
      if (!best.inRange || steps < best.steps || (steps === best.steps && isMain(source))) {
        best = { inRange: true, steps, source };
      }
    } else if (!best.inRange && steps - source.reach < best.steps) {
      best = { inRange: false, steps: steps - source.reach, source };
    }
  }
  return best;
};

const isMain = (source: RangeSource): boolean => source.kind === "main";

/**
 * The words for a cell's reach, or null for the player's own cells and when
 * nothing of theirs has a flinger.
 *
 * "In range · 4 cells from your yard", "In range · next to your outpost",
 * "Out of range · 2 cells too far".
 */
export const reachText = (answer: ReachAnswer): string | null => {
  if (!answer.source) return null;
  if (!answer.inRange) {
    return `Out of range · ${cellsText(answer.steps)} too far`;
  }
  const from = answer.source.kind === "main" ? "your yard" : "your outpost";
  if (answer.steps === 0) return null;
  return answer.steps === 1
    ? `In range · next to ${from}`
    : `In range · ${cellsText(answer.steps)} from ${from}`;
};

/** "1 cell", "3 cells". */
export const cellsText = (count: number): string => (count === 1 ? "1 cell" : `${count} cells`);
