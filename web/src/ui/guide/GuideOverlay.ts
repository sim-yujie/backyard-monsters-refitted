import { findTarget, type TargetRect } from "@/game/guide/targets";
import { BobBubble, type BobLine } from "./BobBubble";
import { GuideArrow, handBox, type ArrowSide } from "./GuideArrow";
import { Spotlight } from "./Spotlight";

/**
 * The Bob kit put together (issue #227, `docs/design/tutorial.md` §2.1, §7.1):
 * the bubble, the pointing hand and the blocker, on the overlay's `guide`
 * layer, following a named target as the screen and the camera move.
 *
 * The guided start and the tip runner each make one and call {@link show} per
 * step. While a step is up, the overlay re-finds its target on every frame
 * (`findTarget`): the hand and the hole follow it, and while it is missing
 * the hand hides and, when the step blocks, the whole screen is blocked but
 * the bubble. Nothing here knows what a step means.
 */

/** One step on screen. */
export interface GuideStep extends BobLine {
  /** The target name to point at (`targets.ts`); absent or null for none. */
  target?: string | null;
  /** Which side the hand comes from; chosen from the target's place when absent. */
  side?: ArrowSide;
  /**
   * Dim and block everything but the target and the bubble (Q16). Default:
   * true. The tips leave it off; placement leaves it off so the yard can pan.
   */
  block?: boolean;
  /** Called on the first frame the target is found, and again each time it comes back. */
  onTargetFound?: (rect: TargetRect) => void;
}

/** Whether two rectangles overlap. */
const overlaps = (a: TargetRect, b: DOMRect): boolean =>
  a.left < b.right && a.left + a.width > b.left && a.top < b.bottom && a.top + a.height > b.top;

/** What drives the per-frame follow; replaced in tests. */
export interface FrameClock {
  request(callback: () => void): number;
  cancel(handle: number): void;
}

const browserClock: FrameClock = {
  request: (callback) => requestAnimationFrame(callback),
  cancel: (handle) => cancelAnimationFrame(handle),
};

export class GuideOverlay {
  private readonly spotlight = new Spotlight();
  private readonly arrow = new GuideArrow();
  private readonly bubble = new BobBubble();
  private readonly clock: FrameClock;
  private step: GuideStep | null = null;
  private frame: number | null = null;
  private found = false;
  /** The bubble moved up for this step; it stays up until the next one, so it never flickers. */
  private alternate = false;

  /**
   * @param layer - The overlay's `guide` layer (`overlay.ts`), above the modals.
   */
  constructor(layer: HTMLElement, clock: FrameClock = browserClock) {
    this.clock = clock;
    // Bottom to top: the blocker, the bubble, the hand (which never takes the pointer).
    this.spotlight.mount(layer);
    this.bubble.mount(layer);
    this.arrow.mount(layer);
  }

  /** The step on screen, or null. */
  get current(): GuideStep | null {
    return this.step;
  }

  /** Shows a step, replacing the last. */
  show(step: GuideStep): void {
    this.step = step;
    this.found = false;
    this.alternate = false;
    this.bubble.setAlternate(false);
    this.bubble.show(step);
    this.follow();
    if (this.frame === null) this.loop();
  }

  /** Takes everything down; `show` brings it back. */
  hide(): void {
    this.step = null;
    this.stop();
    this.spotlight.hide();
    this.arrow.hide();
    this.bubble.hide();
  }

  destroy(): void {
    this.hide();
    this.spotlight.destroy();
    this.arrow.destroy();
    this.bubble.destroy();
  }

  /** One frame's work: find the target, and put the hand, the hole and the bubble round it. */
  follow(): void {
    const step = this.step;
    if (!step) return;
    const found = step.target ? findTarget(step.target) : null;
    const rect = found?.rect ?? null;

    const place = this.arrow.pointAt(rect, step.side);
    if (step.block === false) this.spotlight.hide();
    else this.spotlight.show(rect);

    // The bubble moves up out of the way when it would sit on the target or the hand.
    const box = rect ? this.bubble.element.getBoundingClientRect() : null;
    if (
      rect &&
      box &&
      !this.alternate &&
      (overlaps(rect, box) || (place !== null && overlaps(handBox(place), box)))
    ) {
      this.alternate = true;
      this.bubble.setAlternate(true);
    }

    if (rect && !this.found) step.onTargetFound?.(rect);
    this.found = rect !== null;
  }

  private loop(): void {
    this.frame = this.clock.request(() => {
      this.frame = null;
      if (!this.step) return;
      this.follow();
      this.loop();
    });
  }

  private stop(): void {
    if (this.frame !== null) this.clock.cancel(this.frame);
    this.frame = null;
  }
}
