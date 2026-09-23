import { DEFAULT_ZOOM, MAX_ZOOM, MIN_ZOOM } from "@/config";
import type { Point } from "./HexGrid";

export interface CameraBounds {
  width: number;
  height: number;
}

export interface CameraOptions {
  minZoom?: number;
  maxZoom?: number;
  zoom?: number;
  /** World extent the camera is kept inside. Unbounded when omitted. */
  bounds?: CameraBounds;
}

interface ActivePointer {
  x: number;
  y: number;
}

/**
 * A 2D pan and zoom camera over world space.
 *
 * The transform is `screen = (world - position) * zoom`, so `position` is the
 * world point drawn at the top-left of the viewport. Keeping it that way makes
 * zooming about a cursor a one-liner: hold `screenToWorld(cursor)` fixed and
 * solve for the new position.
 *
 * Input is handled with pointer events so mouse, pen and touch all arrive on
 * the same three handlers: one pointer drags, two pointers pinch. The element
 * the camera attaches to needs `touch-action: none`, otherwise the browser
 * swallows the drag as a scroll.
 */
export class Camera {
  /** World coordinate rendered at the viewport's top-left corner. */
  position: Point = { x: 0, y: 0 };
  zoom: number;

  readonly minZoom: number;
  readonly maxZoom: number;

  private viewportWidth = 0;
  private viewportHeight = 0;
  private bounds: CameraBounds | null;

  private element: HTMLElement | null = null;
  private readonly pointers = new Map<number, ActivePointer>();
  /** Distance between the two pinch pointers on the previous move event. */
  private pinchDistance = 0;
  private dragging = false;

  /** Set by the scene so it can redraw only when something moved. */
  dirty = true;

  constructor(options: CameraOptions = {}) {
    this.minZoom = options.minZoom ?? MIN_ZOOM;
    this.maxZoom = options.maxZoom ?? MAX_ZOOM;
    this.zoom = clamp(options.zoom ?? DEFAULT_ZOOM, this.minZoom, this.maxZoom);
    this.bounds = options.bounds ?? null;
  }

  /* ── Transforms ─────────────────────────────────────────────────────── */

  worldToScreen(world: Point): Point {
    return {
      x: (world.x - this.position.x) * this.zoom,
      y: (world.y - this.position.y) * this.zoom,
    };
  }

  screenToWorld(screen: Point): Point {
    return {
      x: screen.x / this.zoom + this.position.x,
      y: screen.y / this.zoom + this.position.y,
    };
  }

  /** The world rectangle currently on screen, for culling. */
  visibleWorldRect(): { left: number; top: number; right: number; bottom: number } {
    const topLeft = this.screenToWorld({ x: 0, y: 0 });
    const bottomRight = this.screenToWorld({
      x: this.viewportWidth,
      y: this.viewportHeight,
    });
    return {
      left: topLeft.x,
      top: topLeft.y,
      right: bottomRight.x,
      bottom: bottomRight.y,
    };
  }

  /* ── Movement ───────────────────────────────────────────────────────── */

  /** Moves the camera by a screen-space delta. */
  panByScreen(dx: number, dy: number): void {
    this.setPosition(this.position.x - dx / this.zoom, this.position.y - dy / this.zoom);
  }

  setPosition(x: number, y: number): void {
    this.position = this.clampPosition(x, y);
    this.dirty = true;
  }

  /** Centres the viewport on a world point. */
  centreOn(world: Point): void {
    this.setPosition(
      world.x - this.viewportWidth / 2 / this.zoom,
      world.y - this.viewportHeight / 2 / this.zoom,
    );
  }

  /** Sets the zoom while keeping the world point under `anchor` in place. */
  zoomAt(nextZoom: number, anchor: Point): void {
    const clamped = clamp(nextZoom, this.minZoom, this.maxZoom);
    if (clamped === this.zoom) return;

    const worldUnderAnchor = this.screenToWorld(anchor);
    this.zoom = clamped;
    this.setPosition(
      worldUnderAnchor.x - anchor.x / clamped,
      worldUnderAnchor.y - anchor.y / clamped,
    );
  }

  /** Multiplies the zoom about an anchor, the natural form for wheel and pinch. */
  zoomBy(factor: number, anchor: Point): void {
    this.zoomAt(this.zoom * factor, anchor);
  }

  resize(width: number, height: number): void {
    this.viewportWidth = width;
    this.viewportHeight = height;
    // A larger viewport can push the camera outside the clamp; re-apply it.
    this.setPosition(this.position.x, this.position.y);
  }

  setBounds(bounds: CameraBounds | null): void {
    this.bounds = bounds;
    this.setPosition(this.position.x, this.position.y);
  }

  /**
   * Keeps the visible rectangle inside the world.
   *
   * When the world is smaller than the viewport on an axis the camera is
   * centred on that axis instead, which avoids a clamp that fights itself.
   */
  private clampPosition(x: number, y: number): Point {
    if (!this.bounds) return { x, y };

    const viewWorldWidth = this.viewportWidth / this.zoom;
    const viewWorldHeight = this.viewportHeight / this.zoom;

    const maxX = this.bounds.width - viewWorldWidth;
    const maxY = this.bounds.height - viewWorldHeight;

    return {
      x: maxX <= 0 ? maxX / 2 : clamp(x, 0, maxX),
      y: maxY <= 0 ? maxY / 2 : clamp(y, 0, maxY),
    };
  }

  /* ── Input ──────────────────────────────────────────────────────────── */

  /** Starts listening for drag, wheel and pinch on an element. */
  attach(element: HTMLElement): void {
    this.detach();
    this.element = element;
    element.addEventListener("pointerdown", this.onPointerDown);
    element.addEventListener("pointermove", this.onPointerMove);
    element.addEventListener("pointerup", this.onPointerUp);
    element.addEventListener("pointercancel", this.onPointerUp);
    element.addEventListener("pointerleave", this.onPointerUp);
    element.addEventListener("wheel", this.onWheel, { passive: false });
  }

  detach(): void {
    const element = this.element;
    if (!element) return;
    element.removeEventListener("pointerdown", this.onPointerDown);
    element.removeEventListener("pointermove", this.onPointerMove);
    element.removeEventListener("pointerup", this.onPointerUp);
    element.removeEventListener("pointercancel", this.onPointerUp);
    element.removeEventListener("pointerleave", this.onPointerUp);
    element.removeEventListener("wheel", this.onWheel);
    this.element = null;
    this.pointers.clear();
    this.dragging = false;
  }

  /** True while a drag or pinch is in progress, so a scene can suppress clicks. */
  get isInteracting(): boolean {
    return this.dragging || this.pointers.size > 1;
  }

  /** Pointer position relative to the attached element, in CSS pixels. */
  private localPoint(event: PointerEvent | WheelEvent): Point {
    const rect = this.element?.getBoundingClientRect();
    return {
      x: event.clientX - (rect?.left ?? 0),
      y: event.clientY - (rect?.top ?? 0),
    };
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    // Ignore the secondary and middle buttons; they belong to context menus.
    if (event.pointerType === "mouse" && event.button !== 0) return;

    const local = this.localPoint(event);
    this.pointers.set(event.pointerId, local);

    if (this.pointers.size === 1) this.dragging = true;
    if (this.pointers.size === 2) {
      this.dragging = false;
      this.pinchDistance = this.currentPinchDistance();
    }

    // Capture keeps a drag alive when the cursor leaves the canvas, but it
    // throws if the pointer is already gone. Losing capture only costs us the
    // off-canvas part of the drag, so it must not abort the drag setup above.
    this.capturePointer(event.pointerId);
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    const previous = this.pointers.get(event.pointerId);
    if (!previous) return;

    const local = this.localPoint(event);

    if (this.pointers.size === 1 && this.dragging) {
      this.panByScreen(local.x - previous.x, local.y - previous.y);
      this.pointers.set(event.pointerId, local);
      return;
    }

    this.pointers.set(event.pointerId, local);

    if (this.pointers.size === 2) {
      const distance = this.currentPinchDistance();
      if (this.pinchDistance > 0 && distance > 0) {
        this.zoomBy(distance / this.pinchDistance, this.pinchMidpoint());
      }
      this.pinchDistance = distance;
    }
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (!this.pointers.delete(event.pointerId)) return;
    this.releasePointer(event.pointerId);
    if (this.pointers.size < 2) this.pinchDistance = 0;
    if (this.pointers.size === 0) this.dragging = false;
  };

  private capturePointer(pointerId: number): void {
    try {
      this.element?.setPointerCapture(pointerId);
    } catch {
      // The pointer was released before the handler ran.
    }
  }

  private releasePointer(pointerId: number): void {
    try {
      if (this.element?.hasPointerCapture(pointerId)) {
        this.element.releasePointerCapture(pointerId);
      }
    } catch {
      // Already released, or the element is detached.
    }
  }

  private readonly onWheel = (event: WheelEvent): void => {
    event.preventDefault();

    // deltaMode 1 is lines and 2 is pages; normalise both to something close to
    // pixels so a trackpad and a notched wheel feel comparable.
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 100 : 1;
    const delta = event.deltaY * unit;

    this.zoomBy(Math.exp(-delta * 0.0015), this.localPoint(event));
  };

  private currentPinchDistance(): number {
    const [a, b] = [...this.pointers.values()];
    if (!a || !b) return 0;
    return Math.hypot(b.x - a.x, b.y - a.y);
  }

  private pinchMidpoint(): Point {
    const [a, b] = [...this.pointers.values()];
    if (!a || !b) return { x: 0, y: 0 };
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);
