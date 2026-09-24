import { Graphics } from "pixi.js";
import type { Rect } from "../YardGrid";
import type { Corners } from "./marquee";

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
 * dashed outline rather than a tint.
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
  /**
   * Buildings with a planned upgrade, by target level
   * (`docs/design/planner-upgrades.md` §5.4).
   *
   * The level comes along for the blueprint's tile label, which prints "3→5";
   * the canvas badge is a chevron and draws no text, because text in a
   * `Graphics` batch is a different cost class from a polygon in it.
   */
  readonly planned: ReadonlyMap<number, number> | null;
  /** The box-select rectangle in world pixels, while one is being dragged. */
  readonly marquee: Rect | null;
  /** The plot outline for the current expansion, in world pixels. */
  readonly plot: Corners | null;
}

/**
 * Where a building is drawn right now — its footprint's corners in world
 * pixels, a diamond in the isometric view and a rectangle in the blueprint —
 * or null if the yard has no such id.
 */
export type ShapeLookup = (id: number) => Corners | null;

const ACCENT = 0xf0a12e;
const MOVED = 0x8fd0ff;
const INVALID = 0xe05252;
/** The planned-upgrade badge: green, with a dark edge so it reads on any tile. */
const PLANNED = 0x5cc26a;
const PLANNED_EDGE = 0x1b3d22;

/** Half the badge's width, in world pixels. */
const BADGE_HALF = 7;
/** How far above the footprint's top corner the badge floats. */
const BADGE_LIFT = 11;

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

    let good = false;
    let bad = false;
    for (const id of visuals.selected) {
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

    // The planned-upgrade badges (§5.4): one chevron per planned building, all
    // in a single fill and stroke like every other group above.
    const planned = visuals.planned;
    if (planned && planned.size > 0) {
      let badged = false;
      for (const id of planned.keys()) {
        const shape = shapeOf(id);
        if (!shape) continue;
        g.poly(chevron(shape));
        badged = true;
      }
      if (badged) {
        g.fill({ color: PLANNED, alpha: 0.95 }).stroke({
          width: 1.5,
          color: PLANNED_EDGE,
          alpha: 0.9,
        });
      }
    }

    // A dashed box around a multi-selection, so the group reads as one thing.
    if (visuals.selected.size > 1 && minX < maxX) {
      dashedRect(g, { x: minX, y: minY, width: maxX - minX, height: maxY - minY });
    }

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

/**
 * The upward chevron that marks a planned upgrade, floating just above a
 * footprint's topmost corner.
 *
 * Anchored on the top of the shape rather than on a stored position because
 * the overlay is handed corners and never learns which view it is drawing: an
 * isometric diamond's top vertex and a blueprint tile's top edge are both
 * "the top", and averaging the corners that share the smallest `y` gives the
 * middle of either one.
 *
 * A shape, not a tint: §4.3 forbids colour as the only channel, so the badge
 * is readable as a mark even where the green is not.
 */
const chevron = (shape: Corners): number[] => {
  let top = Infinity;
  for (const [, y] of shape) if (y < top) top = y;

  let sum = 0;
  let count = 0;
  for (const [x, y] of shape) {
    if (y > top) continue;
    sum += x;
    count++;
  }
  if (count === 0) return [];

  const cx = sum / count;
  const cy = top - BADGE_LIFT;
  const half = BADGE_HALF;
  return [
    cx - half,
    cy + half * 0.6,
    cx,
    cy - half * 0.6,
    cx + half,
    cy + half * 0.6,
    cx + half,
    cy + half * 1.3,
    cx,
    cy + half * 0.1,
    cx - half,
    cy + half * 1.3,
  ];
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
