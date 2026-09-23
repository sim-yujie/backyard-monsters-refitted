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
 * ## Two ways to move
 *
 * Press-and-drag moves a selection while the button is held. A *click* — a
 * press that does not travel — can instead pick the selection up, after which
 * it follows the pointer with no button held and the next press drops it. That
 * is how the original planner moved everything
 * (`PlannerDesignView.dragBuilding`, `dragBuildingTick`), and for many small
 * moves it is far less tiring than holding a button. While something is
 * carried every press on the canvas is a drop attempt, so the camera cannot pan
 * — again as the original did.
 *
 * Nothing here decides what a press means. `claim` asks the session, which owns
 * the selection and the tools, and the answer is only "I am taking this" or
 * "let it through". Likewise a release asks the session whether the gesture
 * turns into a carry.
 */

/** What the session decided a press is. */
export const Grab = {
  /** Move the selection while the button is held. */
  DRAG: "drag",
  /** Draw a box-select rectangle. */
  MARQUEE: "marquee",
  /** The selection is in hand, following the pointer until the next press. */
  CARRY: "carry",
} as const;
export type Grab = (typeof Grab)[keyof typeof Grab];

export interface PlannerInputHandlers {
  /** Whether this press belongs to the planner, and what it starts. */
  claim: (world: Point, shift: boolean) => Grab | null;
  /** The pointer moved during a claimed gesture. */
  move: (world: Point, grab: Grab) => void;
  /**
   * The gesture ended: the button came up, or, for a carry, went down again.
   * `travelled` is false when the press never left the click slop. Returning
   * `"carry"` keeps (or puts) the selection in hand.
   */
  release: (world: Point, grab: Grab, travelled: boolean) => "carry" | void;
  /** A press the planner did not claim ended without travelling: a click. */
  clickEmpty: (shift: boolean) => void;
  /** The secondary button while carrying: put it back. */
  cancel: () => void;
  /**
   * The grab state changed.
   *
   * A release is answered before the new grab is recorded, so anything that
   * reads `isCarrying` — the summary line says "in hand" from it — would be a
   * gesture behind if it only refreshed from `release`. This fires once the
   * grab is settled, which is the moment that reading is true.
   */
  grabChanged: () => void;
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
  /**
   * Set when the secondary button has just cancelled a carry.
   *
   * `contextmenu` arrives after the `pointerdown` that provoked it, by which
   * time the cancel has already cleared the grab — so the press latches this
   * and the menu handler reads the latch rather than the grab.
   */
  private suppressContextMenu = false;

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
    this.canvas.addEventListener("contextmenu", this.onContextMenu);
  }

  detach(): void {
    window.removeEventListener("pointerdown", this.onPointerDown, true);
    window.removeEventListener("pointermove", this.onPointerMove, true);
    window.removeEventListener("pointerup", this.onPointerUp, true);
    window.removeEventListener("pointercancel", this.onPointerUp, true);
    window.removeEventListener("keydown", this.onKeyDown, true);
    this.canvas.removeEventListener("contextmenu", this.onContextMenu);
    this.cancel();
  }

  /** True while the planner is moving something or drawing a marquee. */
  get isGrabbing(): boolean {
    return this.grab !== null;
  }

  /** True while a selection follows the pointer with no button held. */
  get isCarrying(): boolean {
    return this.grab === Grab.CARRY;
  }

  /** Abandons a gesture without a release; Escape uses it. */
  cancel(): void {
    const had = this.grab !== null;
    this.grab = null;
    this.pointerId = null;
    this.watchingClick = false;
    this.setCursor(false);
    if (had) this.handlers.grabChanged();
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
    this.suppressContextMenu = false;

    if (this.grab === Grab.CARRY) {
      // Every press is a drop attempt; the secondary button puts it back.
      event.stopPropagation();
      event.preventDefault();
      if (event.pointerType === "mouse" && event.button !== 0) {
        this.suppressContextMenu = true;
        this.handlers.cancel();
        return;
      }
      this.finish(this.handlers.release(this.worldAt(event), Grab.CARRY, true));
      return;
    }

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
    const grab = this.grab;
    if (!grab) return;
    // A carry follows any pointer; a drag follows the one that pressed.
    if (grab !== Grab.CARRY && this.pointerId !== event.pointerId) return;
    if (grab === Grab.CARRY && event.target !== this.canvas) return;
    event.stopPropagation();
    this.handlers.move(this.worldAt(event), grab);
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (this.grab === Grab.CARRY) return;
    if (this.pointerId !== event.pointerId) return;
    this.pointerId = null;

    const grab = this.grab;
    this.grab = null;

    const travelled =
      Math.hypot(event.clientX - this.pressX, event.clientY - this.pressY) > CLICK_SLOP;

    if (grab) {
      event.stopPropagation();
      this.finish(this.handlers.release(this.worldAt(event), grab, travelled));
      return;
    }

    if (!this.watchingClick) return;
    this.watchingClick = false;
    if (!travelled) this.handlers.clickEmpty(event.shiftKey);
  };

  /** Applies the session's answer to a release. */
  private finish(outcome: "carry" | void): void {
    const before = this.grab;
    this.grab = outcome === "carry" ? Grab.CARRY : null;
    this.pointerId = null;
    this.setCursor(this.grab === Grab.CARRY);
    if (this.grab !== before) this.handlers.grabChanged();
  }

  private readonly onContextMenu = (event: Event): void => {
    // The secondary button is a cancel while carrying, never a browser menu.
    const suppress = this.suppressContextMenu || this.grab === Grab.CARRY;
    this.suppressContextMenu = false;
    if (suppress) event.preventDefault();
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (isTextEntry(event.target)) return;
    // Consumed keys are stopped so the read-only yard's own handler does not
    // also act on Escape, and so the browser does not treat Ctrl+S as "save
    // page" or Tab as "move focus".
    if (this.handlers.key(event)) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  private setCursor(carrying: boolean): void {
    this.canvas.style.cursor = carrying ? "grabbing" : "";
  }
}

const isTextEntry = (target: EventTarget | null): boolean =>
  target instanceof HTMLInputElement ||
  target instanceof HTMLTextAreaElement ||
  target instanceof HTMLSelectElement ||
  (target instanceof HTMLElement && target.isContentEditable);
