import { Container, FillPattern, Graphics, Texture } from "pixi.js";
import type { Point } from "../YardGrid";
import { COVERAGE_STEP, type Coverage } from "./coverage";

/**
 * The dead zones (issue #55): every plot cell no tower reaches, hatched in the
 * fault red, land and air as their own layers.
 *
 * Colour is not the only channel (design §4.3, "dead zones also get
 * hatching"): land is hatched one way and air the other, so a cell dead to
 * both reads as a cross-hatch and a player can tell which kind of attacker
 * walks in unopposed.
 *
 * ## The cost
 *
 * The largest plot is 178 x 142 cells. Drawing each cell would be up to
 * 25,000 quads; instead each row's run of uncovered cells is one quadrilateral
 * (a diamond's slice in the isometric view, a rectangle in the blueprint),
 * which is a few hundred for a real yard. Like the range discs, it is redrawn
 * only when the plan, the view or a toggle changes.
 */

/** The fault red, as the checklist's outlines use it. */
const DEAD_RED = "rgba(224, 82, 82, ";

/** A hatch tile: a faint wash and one diagonal, `/` for land and `\` for air. */
const hatch = (rising: boolean): FillPattern => {
  const size = 24;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (context) {
    context.fillStyle = `${DEAD_RED}0.05)`;
    context.fillRect(0, 0, size, size);
    context.strokeStyle = `${DEAD_RED}0.6)`;
    context.lineWidth = 2;
    context.beginPath();
    // Three segments so the line runs on across the tile's seams.
    for (const offset of [-size, 0, size]) {
      if (rising) {
        context.moveTo(offset, size);
        context.lineTo(offset + size, 0);
      } else {
        context.moveTo(offset, 0);
        context.lineTo(offset + size, size);
      }
    }
    context.stroke();
  }
  return new FillPattern({ texture: Texture.from(canvas), repetition: "repeat" });
};

export interface DeadZoneDrawOptions {
  /** Null clears the layer. */
  readonly coverage: Coverage | null;
  readonly land: boolean;
  readonly air: boolean;
  /** Yard units to world pixels in the view that is showing. */
  readonly yardToWorld: (x: number, y: number) => Point;
}

export class DeadZoneLayer {
  readonly root = new Container();

  private readonly land = new Graphics();
  private readonly air = new Graphics();
  private patterns: { land: FillPattern; air: FillPattern } | null = null;

  constructor() {
    this.root.eventMode = "none";
    this.root.addChild(this.land, this.air);
  }

  draw(options: DeadZoneDrawOptions): void {
    const { coverage } = options;
    this.land.clear();
    this.air.clear();
    if (!coverage || (!options.land && !options.air)) return;

    this.patterns ??= { land: hatch(true), air: hatch(false) };
    if (options.land) paint(this.land, coverage, coverage.land.mask, options.yardToWorld, this.patterns.land);
    if (options.air) paint(this.air, coverage, coverage.air.mask, options.yardToWorld, this.patterns.air);
  }

  clear(): void {
    this.land.clear();
    this.air.clear();
  }

  destroy(): void {
    for (const pattern of Object.values(this.patterns ?? {})) pattern.texture.destroy(true);
    this.root.destroy({ children: true });
  }
}

/** One layer's uncovered cells, a quadrilateral per run along each row. */
const paint = (
  g: Graphics,
  coverage: Coverage,
  mask: Uint8Array,
  yardToWorld: (x: number, y: number) => Point,
  pattern: FillPattern,
): void => {
  let drew = false;
  for (const [row, first, last] of deadRuns(mask, coverage.columns, coverage.rows)) {
    const top = coverage.y + row * COVERAGE_STEP;
    const bottom = top + COVERAGE_STEP;
    const left = coverage.x + first * COVERAGE_STEP;
    const right = coverage.x + (last + 1) * COVERAGE_STEP;
    const corners = [
      yardToWorld(left, top),
      yardToWorld(right, top),
      yardToWorld(right, bottom),
      yardToWorld(left, bottom),
    ];
    g.poly(corners.flatMap((point) => [point.x, point.y]));
    drew = true;
  }
  if (drew) g.fill(pattern);
};

/**
 * The uncovered runs of a mask, as `[row, firstColumn, lastColumn]`: each row
 * split wherever a covered cell interrupts it.
 */
export const deadRuns = (
  mask: Uint8Array,
  columns: number,
  rows: number,
): [row: number, first: number, last: number][] => {
  const runs: [number, number, number][] = [];
  for (let row = 0; row < rows; row++) {
    let start = -1;
    for (let column = 0; column <= columns; column++) {
      const dead = column < columns && mask[row * columns + column] === 0;
      if (dead && start < 0) start = column;
      if (!dead && start >= 0) {
        runs.push([row, start, column - 1]);
        start = -1;
      }
    }
  }
  return runs;
};
