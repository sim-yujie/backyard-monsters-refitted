import type { Camera } from "@/game/Camera";
import type { Point } from "../YardGrid";

/**
 * Pointer and keyboard for the planner.
 *
 * ## Taking precedence over the camera
 *
 * `Camera.attach` and `YardInput.attach` both listen for `pointerdown` on the
 * canvas, and a press on a building has to become a drag of that building
 * rather than a pan of the view. Listeners on the same element fire in the
 * order they were added, so registering later would be too late; this listens
 * on `window` in the **capture** phase instead, which runs before the event
 * reaches the canvas at all, and calls `stopPropagation` on the presses it
 * claims. Everything it does not claim — a press on bare ground with the select
 * tool — reaches the camera untouched and pans as usual.
 *
 * Nothing here decides what a press means. `claim` asks the session, which owns
 * the selection and the tools, and the answer is only "I am taking this" or
 * "let it through".
 */

/** What the session decided a press is. */
export const Grab = {
  /** Move the selection. */
  DRAG: "drag",
  /** Draw a box-select rectangle. */
  MARQUEE: "marquee",
} as const;
export type Grab = (typeof Grab)[keyof typeof Grab];

export interface PlannerInputHandlers {
  /** Whether this press belongs to the planner, and what it starts. */
  claim: (world: Point, shift: boolean) => Grab | null;
  /** The pointer moved during a claimed gesture. */
  move: (world: Point, grab: Grab) => void;
  /** The gesture ended. */
  release: (world: Point, grab: Grab) => void;
  /** A press the planner did not claim ended without travelling: a click. */
  clickEmpty: (shift: boolean) => void;
  /** Returns true when the planner consumed the key. */
  key: (event: KeyboardEvent) => boolean;
}

/** Pointer travel in CSS pixels below which a press counts as a click. */
const CLICK_SLOP = 5;

export class PlannerInput {
  private readonly camera: Camera;
  private readonly canvas: HTMLCanvasElement;
  private readonly handlers: PlannerInputHandlers;

  private grab: Grab | null = null;
  private pointerId: number | null = null;
  private pressX = 0;
  private pressY = 0;
  /** Set when a press the planner let through is still a candidate click. */
  private watchingClick = false;

  constructor(options: {
    camera: Camera;
    canvas: HTMLCanvasElement;
    handlers: PlannerInputHandlers;
  }) {
    this.camera = options.camera;
    this.canvas = options.canvas;
    this.handlers = options.handlers;
  }

  attach(): void {
    window.addEventListener("pointerdown", this.onPointerDown, true);
    window.addEventListener("pointermove", this.onPointerMove, true);
    window.addEventListener("pointerup", this.onPointerUp, true);
    window.addEventListener("pointercancel", this.onPointerUp, true);
    window.addEventListener("keydown", this.onKeyDown, true);
  }

  detach(): void {
    window.removeEventListener("pointerdown", this.onPointerDown, true);
    window.removeEventListener("pointermove", this.onPointerMove, true);
    window.removeEventListener("pointerup", this.onPointerUp, true);
    window.removeEventListener("pointercancel", this.onPointerUp, true);
    window.removeEventListener("keydown", this.onKeyDown, true);
    this.grab = null;
    this.pointerId = null;
    this.watchingClick = false;
  }

  /** True while the planner is moving something or drawing a marquee. */
  get isGrabbing(): boolean {
    return this.grab !== null;
  }

  /** Abandons a gesture without a release; Escape uses it. */
  cancel(): void {
    this.grab = null;
    this.pointerId = null;
    this.watchingClick = false;
  }

  /** World point under a pointer event. */
  worldAt(event: { clientX: number; clientY: number }): Point {
    const rect = this.canvas.getBoundingClientRect();
    return this.camera.screenToWorld({
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    });
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.target !== this.canvas) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;

    this.pressX = event.clientX;
    this.pressY = event.clientY;

    const grab = this.handlers.claim(this.worldAt(event), event.shiftKey);
    if (!grab) {
      // Left for the camera. Still watched, so a press that does not travel
      // can clear the selection on the way up.
      this.watchingClick = true;
      this.grab = null;
      this.pointerId = event.pointerId;
      return;
    }

    this.grab = grab;
    this.pointerId = event.pointerId;
    this.watchingClick = false;
    event.stopPropagation();
    event.preventDefault();
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (this.pointerId !== event.pointerId) return;
    const grab = this.grab;
    if (!grab) return;
    event.stopPropagation();
    this.handlers.move(this.worldAt(event), grab);
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (this.pointerId !== event.pointerId) return;
    this.pointerId = null;

    const grab = this.grab;
    this.grab = null;

    if (grab) {
      event.stopPropagation();
      this.handlers.release(this.worldAt(event), grab);
      return;
    }

    if (!this.watchingClick) return;
    this.watchingClick = false;
    const travelled = Math.hypot(event.clientX - this.pressX, event.clientY - this.pressY);
    if (travelled <= CLICK_SLOP) this.handlers.clickEmpty(event.shiftKey);
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (isTextEntry(event.target)) return;
    // Consumed keys are stopped so the read-only yard's own handler does not
    // also act on Escape, and so the browser does not treat Ctrl+S as "save
    // page".
    if (this.handlers.key(event)) {
      event.preventDefault();
      event.stopPropagation();
    }
  };
}

const isTextEntry = (target: EventTarget | null): boolean =>
  target instanceof HTMLInputElement ||
  target instanceof HTMLTextAreaElement ||
  target instanceof HTMLSelectElement ||
  (target instanceof HTMLElement && target.isContentEditable);
