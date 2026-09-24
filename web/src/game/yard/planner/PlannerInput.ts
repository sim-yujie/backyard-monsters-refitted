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
 *
 * ## Touch (F14)
 *
 * A finger is not a mouse in two ways that matter here, so a press whose
 * `pointerType` is not `"mouse"` takes a different route down.
 *
 * *The first finger belongs to the camera.* Claiming a building on the way
 * down, as a mouse does, would take the second finger away from the pinch —
 * the camera only pinches with two pointers it saw press — and would lift a
 * building the player meant to scroll past. So a touch on a building is left
 * to the camera and only *watched*: if it stays within the click slop for
 * `LONG_PRESS_MS` it becomes a carry, which is the same state a click gives a
 * mouse; if it travels, or a second finger lands, the watch is dropped and the
 * pan or pinch carries on untouched. `wouldClaim` is how the input asks what is
 * under the finger without anything being picked up.
 *
 * *A finger has no second button.* Putting a carried selection back is a chip
 * in the bar instead (`PlannerSession.putBack`).
 *
 * The box tool is the one press still claimed on the way down: it has nothing
 * to do with what is under the finger, and §4 asks for a one-finger box. A
 * second finger during that box — or during any drag — hands the gesture back
 * and lets the camera have both pointers.
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
  /**
   * What `claim` *would* answer, changing nothing (F14).
   *
   * A touch cannot claim on the way down — the camera needs the pointer for a
   * pan or a pinch — but the input still has to know whether there is anything
   * under the finger worth watching for a long press.
   */
  wouldClaim: (world: Point, shift: boolean) => Grab | null;
  /**
   * A touch that pressed and lifted without travelling or being held.
   *
   * It selects, and never picks anything up: on touch the pick-up is the long
   * press, so a tap that also carried would make scrolling past a building a
   * lottery.
   */
  tap: (world: Point, shift: boolean) => void;
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

/**
 * How long a finger has to sit still on a building to pick it up (F14).
 *
 * 400 ms is the figure the platform conventions land on — Android's long press
 * is 400 ms and iOS's is 500 ms — and it is the useful compromise either way:
 * short enough that holding something does not feel like waiting, long enough
 * that the start of a flick never trips it.
 */
const LONG_PRESS_MS = 400;

/**
 * A short buzz when a long press takes hold.
 *
 * Touch has no cursor to change and no button to depress, so without this the
 * only sign the building is now in hand is the bar redrawing at the far edge of
 * the screen. Absent on iOS and blockable everywhere, hence the guard: it is a
 * bonus on top of the "Put back" chip appearing, never the only feedback.
 */
const buzz = (): void => {
  try {
    navigator.vibrate?.(10);
  } catch {
    // Some browsers throw rather than return false when vibration is blocked.
  }
};

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
  /** Set while the press being watched came from a finger or a pen. */
  private touchPress = false;
  /** The pending long-press timer, or null when nothing is being held. */
  private longPress: ReturnType<typeof setTimeout> | null = null;

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
    window.addEventListener("pointerrawupdate", this.onRawUpdate as EventListener, true);
    window.addEventListener("pointerup", this.onPointerUp, true);
    window.addEventListener("pointercancel", this.onPointerUp, true);
    window.addEventListener("keydown", this.onKeyDown, true);
    this.canvas.addEventListener("contextmenu", this.onContextMenu);
  }

  detach(): void {
    window.removeEventListener("pointerdown", this.onPointerDown, true);
    window.removeEventListener("pointermove", this.onPointerMove, true);
    window.removeEventListener("pointerrawupdate", this.onRawUpdate as EventListener, true);
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

  /** True while a finger is being held on a building, waiting to pick it up. */
  get isLongPressing(): boolean {
    return this.longPress !== null;
  }

  /** Abandons a gesture without a release; Escape uses it. */
  cancel(): void {
    const had = this.grab !== null;
    this.cancelLongPress();
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
      // Touch sends no move before a press, so the carried selection is still
      // wherever the last drag left it: walk it under this press before
      // dropping, or the finger would put it down somewhere else. A mouse is
      // already there, and `move` returns at its own no-op test.
      const world = this.worldAt(event);
      this.handlers.move(world, Grab.CARRY);
      this.finish(this.handlers.release(world, Grab.CARRY, true));
      return;
    }

    // A second pointer is a pinch starting (F14). Whatever the planner had
    // begun is handed back — a half-drawn box would otherwise follow the
    // zoom — and the press is left for the camera, which needs both pointers.
    if (this.pointerId !== null && event.pointerId !== this.pointerId) {
      this.cancelLongPress();
      this.watchingClick = false;
      if (this.grab !== null) this.handlers.cancel();
      this.pointerId = null;
      return;
    }

    if (event.pointerType === "mouse" && event.button !== 0) return;

    this.cancelLongPress();
    this.pressX = event.clientX;
    this.pressY = event.clientY;
    this.touchPress = event.pointerType !== "mouse";

    const world = this.worldAt(event);

    // Touch: everything but a box goes to the camera, watched for a tap on the
    // way up and for a long press while it is down. See "Touch" above.
    if (this.touchPress) {
      const would = this.handlers.wouldClaim(world, event.shiftKey);
      if (would !== Grab.MARQUEE) {
        this.watchingClick = true;
        this.grab = null;
        this.pointerId = event.pointerId;
        if (would === Grab.DRAG) this.startLongPress(event.pointerId, world);
        return;
      }
    }

    const grab = this.handlers.claim(world, event.shiftKey);
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
    // A finger that has started travelling is panning, not pressing.
    if (this.longPress !== null && event.pointerId === this.pointerId && this.travelled(event)) {
      this.cancelLongPress();
    }

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
    this.cancelLongPress();

    const grab = this.grab;
    this.grab = null;

    const travelled = this.travelled(event);

    if (grab) {
      event.stopPropagation();
      this.finish(this.handlers.release(this.worldAt(event), grab, travelled));
      return;
    }

    if (!this.watchingClick) return;
    this.watchingClick = false;
    if (travelled) return;
    // A finger that was never held is a tap: it selects and nothing else.
    if (this.touchPress) this.handlers.tap(this.worldAt(event), event.shiftKey);
    else this.handlers.clickEmpty(event.shiftKey);
  };

  /**
   * Chromium's early sibling of `pointermove`.
   *
   * The camera pans from it, so a gesture the planner has taken over has to be
   * stopped here as well — otherwise a carry begun by a long press would drag
   * the building and the view at once, since the camera saw that finger press.
   */
  private readonly onRawUpdate = (event: PointerEvent): void => {
    const grab = this.grab;
    if (!grab) return;
    if (grab !== Grab.CARRY && this.pointerId !== event.pointerId) return;
    event.stopPropagation();
  };

  /** Whether a press has left the click slop. */
  private travelled(event: PointerEvent): boolean {
    return Math.hypot(event.clientX - this.pressX, event.clientY - this.pressY) > CLICK_SLOP;
  }

  /**
   * Watches a finger on a building for `LONG_PRESS_MS` (F14).
   *
   * When it fires, the press takes the click-to-carry path a mouse takes —
   * `claim` then a release that never travelled — so a long press and a click
   * leave the planner in exactly the same state, and everything downstream
   * (the drop, the chip, Escape, the summary line) works without knowing which
   * of the two happened.
   */
  private startLongPress(pointerId: number, world: Point): void {
    this.longPress = setTimeout(() => {
      this.longPress = null;
      if (this.pointerId !== pointerId || this.grab !== null) return;

      const grab = this.handlers.claim(world, false);
      if (!grab) return;
      this.grab = grab;
      this.watchingClick = false;
      this.finish(this.handlers.release(world, grab, false));
      if (this.grab === Grab.CARRY) buzz();
    }, LONG_PRESS_MS);
  }

  private cancelLongPress(): void {
    if (this.longPress === null) return;
    clearTimeout(this.longPress);
    this.longPress = null;
  }

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
