/**
 * Drops the `click` of a tap whose `pointerup` opened a window.
 *
 * The game's canvases answer a tap on `pointerup`. A finger's tap sends its
 * `click` after that, at the end of the touch, and aims it at whatever is
 * under the finger by then: the window that just opened, whose button there
 * is pressed too. A tap on the Champion Cage froze its champion that way, the
 * cage's Freeze tile having opened under the finger (30 Oct). Cancelling the
 * touch's end drops that click; a mouse aims its click at the canvas it was
 * pressed on, so it is left alone.
 *
 * A pen counts as a finger: the iPad's Pencil sends touch events and the same
 * late click. A pen whose browser sends no `touchend` (Windows) clicks like a
 * mouse, and the next press disarms the guard.
 */
export class TapClickGuard {
  private armed = false;

  /**
   * @param keep A tap's end the click is kept for, though the tap opened
   *   something: the map keeps a tap that ends on the canvas itself, whose
   *   click lands harmlessly and lets a double tap zoom.
   */
  constructor(
    private readonly element: HTMLElement,
    private readonly keep?: (event: TouchEvent) => boolean,
  ) {}

  attach(): void {
    this.element.addEventListener("touchend", this.onTouchEnd, { passive: false });
  }

  detach(): void {
    this.element.removeEventListener("touchend", this.onTouchEnd);
    this.armed = false;
  }

  /** A new press: nothing of the last tap is left to drop. */
  press(): void {
    this.armed = false;
  }

  /** The release `event` opened a window: a finger's or pen's click is dropped. */
  opened(event: { pointerType: string }): void {
    this.armed = event.pointerType !== "mouse";
  }

  private readonly onTouchEnd = (event: TouchEvent): void => {
    if (!this.armed) return;
    this.armed = false;
    if (this.keep?.(event)) return;
    if (event.cancelable) event.preventDefault();
  };
}

/**
 * Whether a touch ended over `element` itself, nothing having opened on top
 * of it. Unknown (no `elementFromPoint`, or no touch point) counts as no.
 */
export const touchEndsOn = (element: Element, event: TouchEvent): boolean => {
  const touch = event.changedTouches?.[0];
  if (!touch || typeof document.elementFromPoint !== "function") return false;
  return document.elementFromPoint(touch.clientX, touch.clientY) === element;
};
