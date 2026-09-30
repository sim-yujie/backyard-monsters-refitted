/**
 * Two small pieces of touch arithmetic for the planner's input (#45, F14),
 * kept apart from `PlannerInput` so they can be tested without a canvas.
 */

/** How far a finger may drift and still be tapping, in CSS pixels. */
export const TAP_SLOP = 12;
/** How long a two-finger tap may take, first finger down to last finger up. */
export const TWO_FINGER_TAP_MS = 350;

/**
 * Recognises a two-finger tap, which is undo (F14; the owner's yes, #45).
 *
 * Exactly two fingers, both down and both up within {@link TWO_FINGER_TAP_MS},
 * neither travelling past {@link TAP_SLOP}. Anything else — a pinch, a pan, a
 * third finger, a cancel — spoils the gesture until every finger is up again,
 * so a pinch that happens to be quick is never read as an undo.
 */
export class TwoFingerTap {
  private readonly fingers = new Map<number, { x: number; y: number }>();
  private began = 0;
  private landed = 0;
  private spoiled = false;

  down(id: number, x: number, y: number, time: number): void {
    if (this.fingers.size === 0) {
      this.began = time;
      this.landed = 0;
      this.spoiled = false;
    }
    this.landed++;
    if (this.landed > 2) this.spoiled = true;
    this.fingers.set(id, { x, y });
  }

  move(id: number, x: number, y: number): void {
    const at = this.fingers.get(id);
    if (!at) return;
    if (Math.hypot(x - at.x, y - at.y) > TAP_SLOP) this.spoiled = true;
  }

  /** True when this lift completes a two-finger tap. */
  up(id: number, time: number): boolean {
    if (!this.fingers.delete(id)) return false;
    if (this.fingers.size > 0) return false;
    return !this.spoiled && this.landed === 2 && time - this.began <= TWO_FINGER_TAP_MS;
  }

  /** The browser took the finger away: whatever this was, it was not a tap. */
  cancel(id: number): void {
    if (!this.fingers.delete(id)) return;
    this.spoiled = true;
  }
}

/** The part of the screen the yard shows, in client pixels. */
export interface ScreenArea {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** How wide the band along each edge is that scrolls the yard. */
export const EDGE_BAND = 48;
/** The fastest the yard scrolls, in screen pixels per frame, at the very edge. */
export const EDGE_SPEED = 14;

/**
 * How fast to scroll the yard while a held building nears an edge (#45, the
 * owner's "edge-scroll while dragging").
 *
 * The answer is the direction the *view* travels, in screen pixels per frame:
 * a finger near the right edge gives a positive `dx`, meaning "show more of
 * what is to the right". It grows from nothing at the inner side of the band to
 * {@link EDGE_SPEED} at the edge, so easing a finger outward speeds up smoothly
 * rather than lurching. Zero on both axes when the finger is clear of every
 * band, which is how the caller knows to stop, and zero along a side too short
 * to hold two bands.
 */
export const edgeScroll = (
  point: { readonly x: number; readonly y: number },
  area: ScreenArea,
  band = EDGE_BAND,
  speed = EDGE_SPEED,
): { dx: number; dy: number } => {
  const along = (value: number, low: number, high: number): number => {
    // Too short a side for two bands has no middle to rest in: leave it still.
    if (high - low < 2 * band) return 0;
    if (value < low + band) return -speed * Math.min(1, (low + band - value) / band);
    if (value > high - band) return speed * Math.min(1, (value - (high - band)) / band);
    return 0;
  };
  return { dx: along(point.x, area.left, area.right), dy: along(point.y, area.top, area.bottom) };
};
