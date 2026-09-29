import { Graphics, type Container, type Renderer } from "pixi.js";
import type { Camera } from "@/game/Camera";
import type { PlannerVisuals } from "./planner/PlannerOverlay";
import type { Rect } from "./YardGrid";
import type { Yard } from "./yardModel";
import { YardRenderer, type YardView } from "./YardRenderer";

/**
 * The planner's compare view (issue #9, design F12): a saved layout drawn
 * beside the plan, the two panes sharing one canvas and one camera, so pan
 * and zoom are the same in both by construction rather than kept in step.
 *
 * The plan's own renderer is masked to the first pane and the camera's
 * viewport is that pane; the slot gets a second, read-only `YardRenderer`,
 * masked to the second pane and drawn with the camera's transform shifted by
 * the pane's offset. Both yards come from the same save at the same
 * expansion, so their world coordinates agree and the same spot of the yard
 * sits at the same place in each pane.
 *
 * Wide screens split side by side; narrow ones (a phone held upright) stack
 * the panes, plan on top, because two portrait slivers are too narrow to
 * read a yard in.
 */

/** Below this width the panes stack rather than sit side by side. */
export const STACK_BELOW = 700;

/** A pane, in CSS pixels of the canvas. */
export interface Pane {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** How to split a canvas of this size: the plan's pane first. */
export const splitPanes = (width: number, height: number): readonly [Pane, Pane] => {
  if (width < STACK_BELOW) {
    const top = Math.floor(height / 2);
    return [
      { x: 0, y: 0, width, height: top },
      { x: 0, y: top, width, height: height - top },
    ];
  }
  const left = Math.floor(width / 2);
  return [
    { x: 0, y: 0, width: left, height },
    { x: left, y: 0, width: width - left, height },
  ];
};

/**
 * A pointer anywhere on the canvas as a point in the plan's pane: one over
 * the slot's pane stands for the same spot of the yard in the plan's.
 */
export const pointerInPlanPane = (
  point: { readonly x: number; readonly y: number },
  panes: readonly [Pane, Pane],
): { x: number; y: number } => {
  const [, other] = panes;
  const inOther =
    point.x >= other.x && point.x < other.x + other.width && point.y >= other.y && point.y < other.y + other.height;
  return inOther ? { x: point.x - other.x, y: point.y - other.y } : { x: point.x, y: point.y };
};

export interface CompareViewOptions {
  readonly stage: Container;
  readonly pixi: Renderer;
  /** The plan's renderer, masked to the first pane while this lives. */
  readonly main: YardRenderer;
  /** The slot, as a yard of its own (`planner/compare.ts`, `slotView`). */
  readonly yard: Yard;
  readonly view: YardView;
}

export class CompareView {
  readonly renderer = new YardRenderer();

  private readonly options: CompareViewOptions;
  private readonly mainMask = new Graphics();
  private readonly otherMask = new Graphics();
  /** The seam between the panes. */
  private readonly divider = new Graphics();
  private panes: readonly [Pane, Pane] = splitPanes(1, 1);

  constructor(options: CompareViewOptions) {
    this.options = options;
    const renderer = this.renderer;
    renderer.attach(options.pixi);
    renderer.setView(options.view);
    renderer.show(options.yard);
    renderer.setLifeHidden(true);
    options.stage.addChild(renderer.root, this.mainMask, this.otherMask, this.divider);
    options.main.root.mask = this.mainMask;
    renderer.root.mask = this.otherMask;
  }

  /** The two panes, plan's first. */
  get layout(): readonly [Pane, Pane] {
    return this.panes;
  }

  /** Splits a canvas of this size; the caller sizes the camera to the first pane. */
  resize(width: number, height: number): readonly [Pane, Pane] {
    this.panes = splitPanes(width, height);
    const [plan, slot] = this.panes;
    this.mainMask.clear().rect(plan.x, plan.y, plan.width, plan.height).fill({ color: 0xffffff });
    this.otherMask.clear().rect(slot.x, slot.y, slot.width, slot.height).fill({ color: 0xffffff });
    const g = this.divider.clear();
    if (slot.x > 0) g.rect(slot.x - 1, 0, 2, height);
    else g.rect(0, slot.y - 1, width, 2);
    g.fill({ color: 0x0b1b22, alpha: 0.9 });
    return this.panes;
  }

  /** Draws the slot with the camera's transform, shifted into its pane. */
  place(camera: Camera): void {
    const [, slot] = this.panes;
    const root = this.renderer.root;
    root.scale.set(camera.zoom);
    root.position.set(-camera.position.x * camera.zoom + slot.x, -camera.position.y * camera.zoom + slot.y);
    this.renderer.setZoom(camera.zoom);
  }

  /** Once a frame, with the world rectangle the camera shows. */
  draw(visible: Rect, deltaSeconds: number): void {
    this.renderer.draw(visible, deltaSeconds);
  }

  setView(view: YardView): void {
    this.renderer.setView(view);
  }

  /** The highlights over the slot's pane. */
  setVisuals(visuals: Omit<PlannerVisuals, "plot">): void {
    this.renderer.setPlannerVisuals({ ...visuals, plot: this.renderer.plotCorners() });
  }

  destroy(): void {
    const { main } = this.options;
    main.root.mask = null;
    this.renderer.destroy();
    this.mainMask.destroy();
    this.otherMask.destroy();
    this.divider.destroy();
  }
}
