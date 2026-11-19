import { Graphics } from "pixi.js";
import { NEARBY_STROKE } from "../nearbyFootprints";
import type { Rect } from "../YardGrid";
import type { Corners } from "./marquee";
import type { LineCellState } from "../wallLine";

/**
 * The planner's chrome: selection, the marquee, the moved marks and the red
 * tint on an illegal drop (design §4.3).
 *
 * One `Graphics` redrawn when the state changes, not a sprite per building.
 * Even selecting a 400-wall run that is only a few hundred polygons, and it is
 * rebuilt on a pointer move at most — which is the same budget the read-only
 * yard's hover outline already runs in.
 *
 * Colour is never the only channel the design allows, so an invalid drop is
 * drawn as a heavier stroke as well as a red fill, and a moved building gets a
 * dashed outline rather than a tint. Anything in hand (carried, picked up or
 * dragged) is boxed the way the yard's placing box is instead: green where it
 * can go, red and crossed where it cannot (owner, 19 Nov 2026).
 *
 * The overlay does not know which view is showing: it is handed each
 * building's corners and draws whatever polygon that is.
 */

export interface PlannerVisuals {
  /** Buildings in the selection. */
  readonly selected: ReadonlySet<number>;
  /** Buildings no longer where the yard had them. */
  readonly moved: ReadonlySet<number>;
  /** Buildings the current drag or the checklist says are illegal. */
  readonly invalid: ReadonlySet<number>;
  /** The box-select rectangle in world pixels, while one is being dragged. */
  readonly marquee: Rect | null;
  /** The plot outline for the current expansion, in world pixels. */
  readonly plot: Corners | null;
  /**
   * While comparing with a saved layout (#9): buildings at another spot on
   * the other side, and buildings this side has and the other does not.
   */
  readonly diff?: CompareDiff | null;
  /**
   * Buildings standing near whatever is in hand (#231), outlined faintly so
   * it can be lined up against them. Empty or absent when nothing is.
   */
  readonly nearby?: ReadonlySet<number>;
  /**
   * The selection is in hand (owner, 19 Nov 2026): carried out of Stored,
   * picked up, or dragged. Each building is then boxed the way the yard's
   * placing box is, green where it can go and red and crossed where it
   * cannot ({@link heldCells}), in place of the orange selection outline.
   */
  readonly inHand?: boolean;
  /** The flat blueprint is showing, not the isometric yard: boxes get its look. */
  readonly flat?: boolean;
  /**
   * A wall line being drawn from the drawer (owner, 16 Nov 2026): every Block
   * green (placed), red (blocked) or grey (no wall left for it), and a dot on
   * every corner. Null or absent with no line.
   */
  readonly line?: {
    readonly cells: readonly LineCellVisual[];
    readonly anchors: readonly (readonly [number, number])[];
    /**
     * Drawn on the flat blueprint rather than the isometric yard: Blocks are
     * squares among category-coloured tiles, so they get the blueprint's own
     * look ({@link drawFlatLine}).
     */
    readonly flat?: boolean;
  } | null;
}

/** One Block of a wall line, as a polygon in the view that is showing. */
export interface LineCellVisual {
  readonly corners: Corners;
  readonly state: LineCellState;
}

/** The line's colours: the build bar's own (`BuildPlacement.ts`). */
export const LINE_PLACE = 0x5cc26a;
export const LINE_BLOCKED = 0xe05252;
/** astra round 1: lighter than build mode's grey, which was lost on silver towers. */
export const LINE_SHORT = 0xbbc3ca;
/** Under every Block's edge, so the outline holds on pale ground and on metal. */
const LINE_UNDER = 0x1d252d;

/** The compare highlights for one pane (#9). */
export interface CompareDiff {
  readonly moved: ReadonlySet<number>;
  readonly only: ReadonlySet<number>;
}

/**
 * Compare's two marks: moved in the moved blue, filled; on one side only in a
 * violet no other chrome uses, filled and with a heavier edge, so the two
 * differ in weight as well as hue.
 */
export const COMPARE_MOVED = 0x8fd0ff;
export const COMPARE_ONLY = 0xc07bff;

/**
 * Where a building is drawn right now — its footprint's corners in world
 * pixels, a diamond in the isometric view and a rectangle in the blueprint —
 * or null if the yard has no such id.
 */
export type ShapeLookup = (id: number) => Corners | null;

const ACCENT = 0xf0a12e;
const MOVED = 0x8fd0ff;
const INVALID = 0xe05252;

export class PlannerOverlay {
  readonly root = new Graphics();

  constructor() {
    this.root.eventMode = "none";
    this.root.visible = false;
  }

  /** Hides the chrome and forgets what it drew. */
  clear(): void {
    this.root.clear();
    this.root.visible = false;
  }

  draw(visuals: PlannerVisuals, shapeOf: ShapeLookup): void {
    const g = this.root;
    g.clear();
    g.visible = true;

    if (visuals.plot && visuals.plot.length > 0) {
      g.poly(path(visuals.plot)).stroke({
        width: 2,
        color: ACCENT,
        alpha: 0.35,
      });
    }

    // Each group is one path with one fill and one stroke rather than a pair
    // per building. Dragging a 400-wall run redraws this on every pointer move,
    // and 800 separate geometry batches was three quarters of the frame's cost;
    // four batches is a rounding error.
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    // First, so every other mark on a neighbour — moved, the red of the one
    // in the way — is drawn over its faint outline rather than under it.
    const nearby = visuals.nearby;
    if (nearby && nearby.size > 0) {
      let drewNearby = false;
      for (const id of nearby) {
        const shape = shapeOf(id);
        if (!shape) continue;
        g.poly(path(shape));
        drewNearby = true;
      }
      if (drewNearby) g.stroke(NEARBY_STROKE);
    }

    const diff = visuals.diff;
    if (diff) {
      let drewMoved = false;
      for (const id of diff.moved) {
        const shape = shapeOf(id);
        if (!shape) continue;
        g.poly(path(shape));
        drewMoved = true;
      }
      if (drewMoved) g.fill({ color: COMPARE_MOVED, alpha: 0.28 }).stroke({ width: 2, color: COMPARE_MOVED, alpha: 0.9 });

      let drewOnly = false;
      for (const id of diff.only) {
        const shape = shapeOf(id);
        if (!shape) continue;
        g.poly(path(shape));
        drewOnly = true;
      }
      if (drewOnly) g.fill({ color: COMPARE_ONLY, alpha: 0.35 }).stroke({ width: 3.5, color: COMPARE_ONLY, alpha: 0.95 });
    }

    // Moved but not selected, so a building that is both reads as selected
    // rather than as a stack of two outlines.
    let drew = false;
    for (const id of visuals.moved) {
      if (visuals.selected.has(id)) continue;
      const shape = shapeOf(id);
      if (!shape) continue;
      g.poly(path(shape));
      drew = true;
    }
    if (drew) g.stroke({ width: 2, color: MOVED, alpha: 0.6 });

    // In hand: the group's bounds here; the boxes are drawn after the blocker below.
    if (visuals.inHand) {
      for (const id of visuals.selected) {
        const shape = shapeOf(id);
        if (!shape) continue;
        for (const [x, y] of shape) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    let good = false;
    let bad = false;
    for (const id of visuals.inHand ? EMPTY_IDS : visuals.selected) {
      const shape = shapeOf(id);
      if (!shape) continue;
      for (const [x, y] of shape) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      if (visuals.invalid.has(id)) {
        bad = true;
        continue;
      }
      g.poly(path(shape));
      good = true;
    }
    if (good) {
      g.fill({ color: ACCENT, alpha: 0.18 }).stroke({ width: 2, color: ACCENT, alpha: 0.95 });
    }

    if (bad) {
      for (const id of visuals.selected) {
        if (!visuals.invalid.has(id)) continue;
        const shape = shapeOf(id);
        if (shape) g.poly(path(shape));
      }
      g.fill({ color: INVALID, alpha: 0.4 }).stroke({ width: 3, color: INVALID, alpha: 0.95 });
    }

    // Anything faulted that is not in the selection: the building the drag ran
    // into, or a checklist row the player has not clicked yet.
    let blocker = false;
    for (const id of visuals.invalid) {
      if (visuals.selected.has(id)) continue;
      const shape = shapeOf(id);
      if (!shape) continue;
      g.poly(path(shape));
      blocker = true;
    }
    if (blocker) g.stroke({ width: 3, color: INVALID, alpha: 0.9 });

    // The boxes in hand after the building in the way (astra round 1), so
    // its outline does not run across the box and its cross.
    if (visuals.inHand) {
      const cells = heldCells(visuals.selected, visuals.invalid, shapeOf);
      if (cells.length > 0) (visuals.flat ? drawFlatLine : drawLine)(g, { cells, anchors: [] });
    }

    // A dashed box around a multi-selection, so the group reads as one thing.
    if (visuals.selected.size > 1 && minX < maxX) {
      dashedRect(g, { x: minX, y: minY, width: maxX - minX, height: maxY - minY });
    }

    if (visuals.line) (visuals.line.flat ? drawFlatLine : drawLine)(g, visuals.line);

    const marquee = visuals.marquee;
    if (marquee && marquee.width > 0 && marquee.height > 0) {
      g.rect(marquee.x, marquee.y, marquee.width, marquee.height)
        .fill({ color: ACCENT, alpha: 0.1 })
        .stroke({ width: 1.5, color: ACCENT, alpha: 0.8 });
    }
  }

  destroy(): void {
    this.root.destroy();
  }
}

const path = (shape: Corners): number[] => shape.flatMap(([x, y]) => [x, y]);

const EMPTY_IDS: ReadonlySet<number> = new Set<number>();

/**
 * The boxes for a selection in hand: each building green ("build") where it
 * can go, red ("blocked") where the plan says it cannot. The same states, and
 * so the same drawing, as a wall line's Blocks, whose colours are the yard's
 * placing box's (`BuildPlacement.ts`).
 */
export const heldCells = (
  selected: ReadonlySet<number>,
  invalid: ReadonlySet<number>,
  shapeOf: ShapeLookup,
): LineCellVisual[] => {
  const cells: LineCellVisual[] = [];
  for (const id of selected) {
    const shape = shapeOf(id);
    if (!shape) continue;
    cells.push({ corners: shape, state: invalid.has(id) ? "blocked" : "build" });
  }
  return cells;
};

/**
 * A wall line's Blocks, one batch per colour, then its corners. A red Block
 * is crossed out as well as red, and a grey one is fainter: colour is never
 * the only channel.
 */
const drawLine = (g: Graphics, line: NonNullable<PlannerVisuals["line"]>): void => {
  const styles: readonly [LineCellState, number, number, number][] = [
    ["short", LINE_SHORT, 0.22, 2],
    ["build", LINE_PLACE, 0.3, 2],
    ["blocked", LINE_BLOCKED, 0.3, 3],
  ];
  for (const [state, colour, fill, width] of styles) {
    let drew = false;
    for (const cell of line.cells) {
      if (cell.state !== state || cell.corners.length === 0) continue;
      g.poly(path(cell.corners));
      drew = true;
    }
    if (!drew) continue;
    // A dark edge under the coloured one (astra round 1), then the colour.
    g.fill({ color: colour, alpha: fill }).stroke({ width: width + 2, color: LINE_UNDER, alpha: 0.55 });
    for (const cell of line.cells) {
      if (cell.state === state && cell.corners.length > 0) g.poly(path(cell.corners));
    }
    g.stroke({ width, color: colour, alpha: 0.95 });
  }
  let crossed = false;
  for (const cell of line.cells) {
    if (cell.state !== "blocked") continue;
    const [a, b, c, d] = cell.corners;
    if (!a || !b || !c || !d) continue;
    g.moveTo(a[0], a[1]).lineTo(c[0], c[1]).moveTo(b[0], b[1]).lineTo(d[0], d[1]);
    crossed = true;
  }
  if (crossed) g.stroke({ width: 3, color: LINE_BLOCKED, alpha: 0.95 });
  for (const [x, y] of line.anchors) {
    g.circle(x, y, 5).fill({ color: 0xffffff, alpha: 0.95 }).stroke({ width: 2, color: 0x1d252d, alpha: 0.9 });
  }
};

/** A Block's square on the blueprint, from its corners. */
const cellRect = (corners: Corners): Rect | null => {
  if (corners.length === 0) return null;
  const xs = corners.map(([x]) => x);
  const ys = corners.map(([, y]) => y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
};

/**
 * A Block's edges as three dashes each, one on either end and one in the
 * middle, so two grey Blocks side by side share the same dashes.
 */
const dashedCell = (g: Graphics, rect: Rect): void => {
  const { x, y, width, height } = rect;
  const edges: [number, number, number, number][] = [
    [x, y, x + width, y],
    [x + width, y, x + width, y + height],
    [x, y + height, x + width, y + height],
    [x, y, x, y + height],
  ];
  for (const [x1, y1, x2, y2] of edges) {
    for (const [from, to] of [[0, 0.2], [0.4, 0.6], [0.8, 1]] as const) {
      g.moveTo(x1 + (x2 - x1) * from, y1 + (y2 - y1) * from).lineTo(
        x1 + (x2 - x1) * to,
        y1 + (y2 - y1) * to,
      );
    }
  }
};

/**
 * The wall line on the blueprint (owner, 16 Nov 2026: "what about 2d
 * blueprint view?"). The flat view is drawn the Flash Yard Planner's way, a
 * square per building coloured by category, and three of those colours are
 * the line's own: walls are grey squares, resource tiles green and defence
 * tiles red. So here:
 *
 * - green Blocks keep the stack's grey wall tiles readable under a faint
 *   wash, with the green edge on a dark one so it holds on grass and on a
 *   resource tile;
 * - red Blocks are crossed on a dark under-stroke, which still reads on a
 *   red defence tile, where red alone vanished;
 * - grey Blocks are dashed and unfilled, an empty slot, never mistaken for
 *   the solid grey squares real walls are drawn as.
 */
const drawFlatLine = (g: Graphics, line: NonNullable<PlannerVisuals["line"]>): void => {
  const rects = (state: LineCellState): Rect[] =>
    line.cells.flatMap((cell) => {
      if (cell.state !== state) return [];
      const rect = cellRect(cell.corners);
      return rect ? [rect] : [];
    });

  const short = rects("short");
  if (short.length > 0) {
    for (const rect of short) dashedCell(g, rect);
    g.stroke({ width: 3.5, color: LINE_UNDER, alpha: 0.6 });
    for (const rect of short) dashedCell(g, rect);
    g.stroke({ width: 1.75, color: LINE_SHORT, alpha: 0.95 });
  }

  for (const [state, colour, fill] of [
    ["build", LINE_PLACE, 0.14],
    ["blocked", LINE_BLOCKED, 0.4],
  ] as const) {
    const cells = rects(state);
    if (cells.length === 0) continue;
    for (const rect of cells) g.rect(rect.x, rect.y, rect.width, rect.height);
    g.fill({ color: colour, alpha: fill }).stroke({ width: 4, color: LINE_UNDER, alpha: 0.75 });
    for (const rect of cells) g.rect(rect.x, rect.y, rect.width, rect.height);
    g.stroke({ width: 2, color: colour, alpha: 1 });
  }

  const blocked = rects("blocked");
  if (blocked.length > 0) {
    const cross = (): void => {
      for (const { x, y, width, height } of blocked) {
        const inset = Math.min(width, height) * 0.2;
        g.moveTo(x + inset, y + inset).lineTo(x + width - inset, y + height - inset);
        g.moveTo(x + width - inset, y + inset).lineTo(x + inset, y + height - inset);
      }
    };
    cross();
    g.stroke({ width: 5, color: LINE_UNDER, alpha: 0.85, cap: "round" });
    cross();
    g.stroke({ width: 2.5, color: LINE_BLOCKED, alpha: 1, cap: "round" });
  }

  // A smaller corner dot than the isometric one: a blueprint Block is half
  // the width of its diamond, and the dot must not hide a red Block's cross.
  for (const [x, y] of line.anchors) {
    g.circle(x, y, 3.5).fill({ color: 0xffffff, alpha: 0.95 }).stroke({ width: 1.5, color: 0x1d252d, alpha: 0.9 });
  }
};

/** A dashed rectangle, which `Graphics` has no primitive for. */
export const dashedRect = (
  g: Graphics,
  rect: Rect,
  style: { color: number; alpha: number; width: number } = {
    color: ACCENT,
    alpha: 0.55,
    width: 1.5,
  },
  dash = 12,
  gap = 8,
): void => {
  const { x, y, width, height } = rect;
  const edges: [number, number, number, number][] = [
    [x, y, x + width, y],
    [x + width, y, x + width, y + height],
    [x + width, y + height, x, y + height],
    [x, y + height, x, y],
  ];

  for (const [x1, y1, x2, y2] of edges) {
    const length = Math.hypot(x2 - x1, y2 - y1);
    if (length === 0) continue;
    const ux = (x2 - x1) / length;
    const uy = (y2 - y1) / length;
    for (let at = 0; at < length; at += dash + gap) {
      const end = Math.min(at + dash, length);
      g.moveTo(x1 + ux * at, y1 + uy * at).lineTo(x1 + ux * end, y1 + uy * end);
    }
  }
  g.stroke(style);
};
