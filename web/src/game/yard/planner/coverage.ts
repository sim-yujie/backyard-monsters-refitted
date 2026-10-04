import { BUNKER_TYPE } from "@/game/monsters/bunker";
import type { YardKind } from "../buildingCostData";
import type { PlanNode, PlotBounds } from "./placement";
import { towerRange } from "./RangeLayer";

/**
 * Defence coverage (issue #55, design `docs/design/yard-planner-redesign.md`
 * §3 F4): how much of the plot the towers reach, and where they do not.
 *
 * The plot is sampled on F4's 10-unit grid, the pathing system's (178 x 142
 * cells at the largest expansion). A cell is covered by a tower when the
 * cell's centre is within the tower's range of the middle of its footprint,
 * squared distance against squared range, as `BTOWER.targetInRange` measures
 * it (`client/scripts/BTOWER.as:234-249`). Land and air are separate layers,
 * each from the towers that can hit it (`RangeLayer.towerRange`).
 *
 * Decisions of 2026-09-29 (issue #55): the base is every in-bounds plot cell,
 * occupied or not; the towers are the ones the range discs are drawn for
 * (#4), measured at their planned level where there is a plan, less the
 * Monster Bunker, which deploys monsters rather than firing, and less any
 * tower still being built; a dead zone is a 4-connected run of uncovered
 * cells.
 *
 * Pure: the planner hands it the plan's buildings and the plot, and draws
 * what comes back (`DeadZoneLayer.ts`).
 */

/** Yard units per sample cell: the pathing grid's (F4). */
export const COVERAGE_STEP = 10;

/** One tower as coverage reads it: where its range is measured from, and how far. */
export interface CoverageTower {
  /** The middle of its footprint, in yard units. */
  readonly x: number;
  readonly y: number;
  readonly range: number;
  readonly land: boolean;
  readonly air: boolean;
}

/** A connected run of cells no tower reaches. */
export interface DeadZone {
  readonly cells: number;
  /** Its share of the plot, 0 to 1. */
  readonly share: number;
  /** A point inside it, in yard units: the cell nearest its middle, for "Show". */
  readonly at: { readonly x: number; readonly y: number };
}

/** One layer, land or air. */
export interface CoverageLayer {
  readonly covered: number;
  /** `covered` over every plot cell, 0 to 1. */
  readonly share: number;
  /** Largest first. */
  readonly deadZones: readonly DeadZone[];
  /** Per cell, row by row: 1 where a tower reaches. */
  readonly mask: Uint8Array;
}

export interface Coverage {
  readonly columns: number;
  readonly rows: number;
  /** The plot's top-left corner in yard units; cell (c, r) spans `[x + c·step, …)`. */
  readonly x: number;
  readonly y: number;
  /** How many towers count; 0 means "No towers placed". */
  readonly towers: number;
  readonly land: CoverageLayer;
  readonly air: CoverageLayer;
}

/**
 * The towers among `nodes` that count for coverage.
 *
 * `towerRange` decides what is a defence and which layers it reaches, as the
 * range discs do; the planned level where there is one, else the level the
 * yard has. A building still at level 0 is a foundation and fires nothing.
 * `kind` and `height` are the yard's own (issue #262): an outpost's coverage
 * is sampled at the range its cell's height actually gives it, the same
 * figure the rings and the engine use.
 */
export const coverageTowers = (
  nodes: Iterable<PlanNode>,
  kind: YardKind = "main",
  height = 0,
): CoverageTower[] => {
  const towers: CoverageTower[] = [];
  for (const node of nodes) {
    if (node.fixed || node.stored || node.type === BUNKER_TYPE || node.level <= 0) continue;
    const reach = towerRange(node.type, node.plan?.level ?? node.level, kind, height);
    if (!reach) continue;
    towers.push({
      x: node.x + node.width / 2,
      y: node.y + node.height / 2,
      range: reach.range,
      land: reach.land,
      air: reach.air,
    });
  }
  return towers;
};

/** Every plot cell, land and air, covered or not, and the dead zones in each. */
export const computeCoverage = (towers: readonly CoverageTower[], plot: PlotBounds): Coverage => {
  const columns = Math.round((plot.halfWidth * 2) / COVERAGE_STEP);
  const rows = Math.round((plot.halfHeight * 2) / COVERAGE_STEP);
  const x = -plot.halfWidth;
  const y = -plot.halfHeight;
  const layer = (reaches: (tower: CoverageTower) => boolean): CoverageLayer =>
    layerOf(
      towers.filter(reaches),
      columns,
      rows,
      x,
      y,
    );
  return {
    columns,
    rows,
    x,
    y,
    towers: towers.length,
    land: layer((tower) => tower.land),
    air: layer((tower) => tower.air),
  };
};

const layerOf = (
  towers: readonly CoverageTower[],
  columns: number,
  rows: number,
  left: number,
  top: number,
): CoverageLayer => {
  const mask = new Uint8Array(columns * rows);
  for (const tower of towers) {
    const reach = tower.range * tower.range;
    // Only the cells whose centres can be in reach: the circle's bounding box.
    const firstColumn = Math.max(0, Math.floor((tower.x - tower.range - left) / COVERAGE_STEP));
    const lastColumn = Math.min(columns - 1, Math.floor((tower.x + tower.range - left) / COVERAGE_STEP));
    const firstRow = Math.max(0, Math.floor((tower.y - tower.range - top) / COVERAGE_STEP));
    const lastRow = Math.min(rows - 1, Math.floor((tower.y + tower.range - top) / COVERAGE_STEP));
    for (let row = firstRow; row <= lastRow; row++) {
      const dy = top + (row + 0.5) * COVERAGE_STEP - tower.y;
      const dy2 = dy * dy;
      if (dy2 > reach) continue;
      for (let column = firstColumn; column <= lastColumn; column++) {
        const dx = left + (column + 0.5) * COVERAGE_STEP - tower.x;
        if (dx * dx + dy2 <= reach) mask[row * columns + column] = 1;
      }
    }
  }

  let covered = 0;
  for (const cell of mask) covered += cell;
  const total = columns * rows;
  return {
    covered,
    share: total > 0 ? covered / total : 0,
    deadZones: deadZonesOf(mask, columns, rows, left, top),
    mask,
  };
};

/** The uncovered cells, grouped into 4-connected runs, largest first. */
const deadZonesOf = (
  mask: Uint8Array,
  columns: number,
  rows: number,
  left: number,
  top: number,
): DeadZone[] => {
  const total = columns * rows;
  const seen = new Uint8Array(total);
  const stack = new Int32Array(total);
  const zones: DeadZone[] = [];

  for (let start = 0; start < total; start++) {
    if (mask[start] || seen[start]) continue;
    const cells: number[] = [];
    let depth = 0;
    stack[depth++] = start;
    seen[start] = 1;
    let sumColumn = 0;
    let sumRow = 0;
    while (depth > 0) {
      const cell = stack[--depth]!;
      cells.push(cell);
      const column = cell % columns;
      const row = (cell - column) / columns;
      sumColumn += column;
      sumRow += row;
      const next = [
        column > 0 ? cell - 1 : -1,
        column < columns - 1 ? cell + 1 : -1,
        row > 0 ? cell - columns : -1,
        row < rows - 1 ? cell + columns : -1,
      ];
      for (const other of next) {
        if (other < 0 || mask[other] || seen[other]) continue;
        seen[other] = 1;
        stack[depth++] = other;
      }
    }

    // The cell nearest the zone's middle: an L-shaped zone's centroid can fall
    // outside it, and "Show" should land on uncovered ground.
    const midColumn = sumColumn / cells.length;
    const midRow = sumRow / cells.length;
    let best = cells[0]!;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const cell of cells) {
      const column = cell % columns;
      const row = (cell - column) / columns;
      const distance = (column - midColumn) ** 2 + (row - midRow) ** 2;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = cell;
      }
    }
    const bestColumn = best % columns;
    const bestRow = (best - bestColumn) / columns;
    zones.push({
      cells: cells.length,
      share: cells.length / total,
      at: {
        x: left + (bestColumn + 0.5) * COVERAGE_STEP,
        y: top + (bestRow + 0.5) * COVERAGE_STEP,
      },
    });
  }

  return zones.sort((a, b) => b.cells - a.cells);
};

/** The headline numbers alone, which is what the bar shows. */
export interface CoverageFigures {
  readonly towers: number;
  /** Shares, 0 to 1. */
  readonly land: number;
  readonly air: number;
}

export const figuresOf = (coverage: Coverage): CoverageFigures => ({
  towers: coverage.towers,
  land: coverage.land.share,
  air: coverage.air.share,
});

/**
 * "87%": a share as the bar and the inspector print it. Rounded down, so a
 * plot with one cell open never reads 100%.
 */
export const percentText = (share: number): string => `${Math.floor(share * 100)}%`;
