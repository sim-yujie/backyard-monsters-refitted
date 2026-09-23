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

  private _minZoom: number;
  readonly maxZoom: number;

  private viewportWidth = 0;
  private viewportHeight = 0;
  private bounds: CameraBounds | null;

  private element: HTMLElement | null = null;
  private readonly pointers = new Map<number, ActivePointer>();
  /** Distance between the two pinch pointers on the previous move event. */
  private pinchDistance = 0;
  private dragging = false;

  /**
   * Drag state. The world point under the cursor at pointerdown is pinned, and
   * every animation frame the camera is moved so that point sits under the
   * latest pointer position, smoothed over DRAG_SMOOTHING_SECONDS.
   *
   * Why not pan inside the pointermove handler: browsers deliver at most one
   * pointermove per frame and only on frames where the mouse reported new
   * movement, so on a 144 Hz display with a 125 Hz mouse roughly one frame in
   * six gets no event. Panning per event therefore moved the world in uneven
   * steps while rendering ran at a perfect 7 ms, which read as lag. Measured
   * with a real-input drag: 121 of 352 frames moved before this change.
   */
  private anchorWorld: Point | null = null;
  private dragTarget: Point | null = null;
  private frameHandle = 0;
  private lastFrameTime = 0;
  /** Diagnostics for the perf overlay: frames seen and frames that moved. */
  readonly dragStats = { frames: 0, moved: 0 };

  /** Set by the scene so it can redraw only when something moved. */
  dirty = true;

  constructor(options: CameraOptions = {}) {
    this._minZoom = options.minZoom ?? MIN_ZOOM;
    this.maxZoom = options.maxZoom ?? MAX_ZOOM;
    this.zoom = clamp(options.zoom ?? DEFAULT_ZOOM, this._minZoom, this.maxZoom);
    this.bounds = options.bounds ?? null;
  }

  /** The current zoom floor. Raised or lowered after construction via `setMinZoom`. */
  get minZoom(): number {
    return this._minZoom;
  }

  /**
   * Moves the zoom floor, e.g. when a scene recomputes how far a view can be
   * zoomed out to still fit its content.
   *
   * Raising the floor above the current zoom pulls the camera in to meet it,
   * clamped about the viewport centre so wheel, pinch and keyboard zoom all
   * end up respecting the same limit rather than each clamping separately.
   * Lowering the floor never forces a zoom change — it just permits zooming
   * out further on the next interaction.
   */
  setMinZoom(zoom: number): void {
    if (zoom === this._minZoom) return;
    this._minZoom = zoom;
    if (this.zoom < zoom) {
      this.zoomAt(zoom, { x: this.viewportWidth / 2, y: this.viewportHeight / 2 });
    }
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
    // A wheel zoom mid-drag changes what is under the cursor; re-pin it so the
    // next frame does not yank the world back to the old anchor.
    if (this.dragging && this.dragTarget) this.anchorWorld = this.screenToWorld(this.dragTarget);
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
    // Lets the perf overlay read drag diagnostics without a dependency.
    (globalThis as { __bymrCamera?: Camera }).__bymrCamera = this;
    element.addEventListener("pointerdown", this.onPointerDown);
    element.addEventListener("pointermove", this.onPointerMove);
    // pointerrawupdate fires as soon as the OS reports movement rather than
    // waiting for the next frame, which trims a few milliseconds of latency.
    // It is Chromium-only today; other browsers just use pointermove.
    element.addEventListener("pointerrawupdate", this.onPointerRawUpdate as EventListener);
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
    element.removeEventListener("pointerrawupdate", this.onPointerRawUpdate as EventListener);
    element.removeEventListener("pointerup", this.onPointerUp);
    element.removeEventListener("pointercancel", this.onPointerUp);
    element.removeEventListener("pointerleave", this.onPointerUp);
    element.removeEventListener("wheel", this.onWheel);
    this.element = null;
    this.pointers.clear();
    this.stopDrag();
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

    if (this.pointers.size === 1) this.startDrag(local);
    if (this.pointers.size === 2) {
      this.stopDrag();
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
      // The frame loop applies the movement; see anchorWorld.
      this.dragTarget = local;
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
    if (this.pointers.size === 0) this.finishDrag();
  };

  private readonly onPointerRawUpdate = (event: PointerEvent): void => {
    if (!this.dragging || this.pointers.size !== 1 || !this.pointers.has(event.pointerId)) return;
    this.dragTarget = this.localPoint(event);
  };

  /* ── Drag frame loop ────────────────────────────────────────────────── */

  private startDrag(local: Point): void {
    this.dragging = true;
    this.dragTarget = local;
    this.anchorWorld = this.screenToWorld(local);
    this.dragStats.frames = 0;
    this.dragStats.moved = 0;
    this.lastFrameTime = performance.now();
    if (!this.frameHandle) this.frameHandle = requestAnimationFrame(this.onFrame);
  }

  /** The pointer went up: let the smoothing settle, then stop the loop. */
  private finishDrag(): void {
    this.dragging = false;
  }

  /** Hard stop, for pinch start and detach: no settling. */
  private stopDrag(): void {
    this.dragging = false;
    this.anchorWorld = null;
    this.dragTarget = null;
    if (this.frameHandle) {
      cancelAnimationFrame(this.frameHandle);
      this.frameHandle = 0;
    }
  }

  private readonly onFrame = (now: number): void => {
    this.frameHandle = 0;
    const anchor = this.anchorWorld;
    const target = this.dragTarget;
    if (!anchor || !target) return;

    const dt = Math.min((now - this.lastFrameTime) / 1000, 0.1);
    this.lastFrameTime = now;

    // Where the camera must be for the pinned world point to sit under the
    // pointer, then ease toward it. The time constant is short enough that the
    // world never visibly trails the cursor, long enough to bridge the frames
    // that got no pointer event.
    const desired = { x: anchor.x - target.x / this.zoom, y: anchor.y - target.y / this.zoom };
    const blend = 1 - Math.exp(-dt / DRAG_SMOOTHING_SECONDS);
    let dx = desired.x - this.position.x;
    let dy = desired.y - this.position.y;
    const settled = Math.abs(dx) < DRAG_SETTLE_WORLD_PX && Math.abs(dy) < DRAG_SETTLE_WORLD_PX;
    if (!settled) {
      dx *= blend;
      dy *= blend;
    }

    const before = this.position;
    this.setPosition(before.x + dx, before.y + dy);
    this.dragStats.frames += 1;
    if (this.position.x !== before.x || this.position.y !== before.y) this.dragStats.moved += 1;

    if (this.dragging || !settled) {
      this.frameHandle = requestAnimationFrame(this.onFrame);
    } else {
      this.anchorWorld = null;
      this.dragTarget = null;
    }
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

/**
 * Exponential smoothing time constant for drags. 35 ms is about five frames
 * at 144 Hz and two at 60 Hz: enough to fill event-less frames with motion,
 * short enough that the grabbed point stays within a few pixels of the cursor.
 */
const DRAG_SMOOTHING_SECONDS = 0.035;
/** Below this remaining distance the camera snaps to the target and stops. */
const DRAG_SETTLE_WORLD_PX = 0.05;
