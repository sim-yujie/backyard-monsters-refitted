import type { TargetRect } from "@/game/guide/targets";
import { BOB_HAND } from "./guideArt";
import "@/ui/styles/guide.css";

/**
 * Bob's pointing hand, bouncing at the thing to tap (issue #227,
 * `docs/design/tutorial.md` §2.1, §3): Flash's green tutorial hand
 * (`TUTORIALARROWMC_CLIP`), repainted as Bob's own.
 *
 * It sits on one side of the target and points at it. By default it comes
 * from above, pointing down, and flips to come from below when the target is
 * too near the top of the screen; a caller may name the side. Purely visual:
 * it never takes the pointer, so a tap goes through to whatever is under it.
 */

/** Which side of the target the hand is on. */
export type ArrowSide = "above" | "below" | "left" | "right";

/** The hand as drawn: 100x47 CSS px, the fingertip at the right-hand end. */
export const HAND_WIDTH = 100;
export const HAND_HEIGHT = 47;
/** Space between the fingertip and the target's edge. */
const GAP = 6;
/** How near the top a target may be before the hand comes from below instead. */
const TOP_ROOM = HAND_WIDTH + GAP + 8;

/** Where the hand goes: its centre, and its turn (the art points right). */
export interface ArrowPlacement {
  side: ArrowSide;
  /** Centre of the hand, viewport CSS px. */
  x: number;
  y: number;
  /** Degrees of rotation; a hand on the right is mirrored instead. */
  rotate: number;
  mirror: boolean;
}

/** The side the hand takes for `rect` when the caller leaves it to us. */
export const autoSide = (rect: TargetRect): ArrowSide => (rect.top < TOP_ROOM ? "below" : "above");

/**
 * Places the hand beside `rect` so its fingertip is `GAP` from the edge on
 * `side`. Pure, so the geometry is tested without a browser.
 */
export const placeArrow = (rect: TargetRect, side: ArrowSide = autoSide(rect)): ArrowPlacement => {
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const reach = HAND_WIDTH / 2 + GAP;
  switch (side) {
    case "above":
      return { side, x: cx, y: rect.top - reach, rotate: 90, mirror: false };
    case "below":
      return { side, x: cx, y: rect.top + rect.height + reach, rotate: -90, mirror: false };
    case "left":
      return { side, x: rect.left - reach, y: cy, rotate: 0, mirror: false };
    case "right":
      return { side, x: rect.left + rect.width + reach, y: cy, rotate: 0, mirror: true };
  }
};

/** The screen box the hand covers at a placement (turned a quarter, it is tall rather than wide). */
export const handBox = (place: ArrowPlacement): TargetRect => {
  const upright = place.rotate === 90 || place.rotate === -90;
  const width = upright ? HAND_HEIGHT : HAND_WIDTH;
  const height = upright ? HAND_WIDTH : HAND_HEIGHT;
  return { left: place.x - width / 2, top: place.y - height / 2, width, height };
};

export class GuideArrow {
  readonly element: HTMLElement;

  constructor() {
    this.element = document.createElement("div");
    this.element.className = "guide-arrow";
    this.element.setAttribute("aria-hidden", "true");
    this.element.hidden = true;
    const hand = document.createElement("img");
    hand.className = "guide-arrow__hand";
    hand.src = BOB_HAND;
    hand.alt = "";
    hand.width = HAND_WIDTH;
    hand.height = HAND_HEIGHT;
    this.element.append(hand);
  }

  mount(parent: HTMLElement): this {
    parent.append(this.element);
    return this;
  }

  /** Points at `rect` and says where the hand went; null hides the hand. */
  pointAt(rect: TargetRect | null, side?: ArrowSide): ArrowPlacement | null {
    if (!rect) {
      this.element.hidden = true;
      return null;
    }
    const place = placeArrow(rect, side);
    const style = this.element.style;
    style.left = `${Math.round(place.x - HAND_WIDTH / 2)}px`;
    style.top = `${Math.round(place.y - HAND_HEIGHT / 2)}px`;
    style.transform = place.mirror ? "scaleX(-1)" : `rotate(${place.rotate}deg)`;
    this.element.dataset.side = place.side;
    this.element.hidden = false;
    return place;
  }

  hide(): void {
    this.element.hidden = true;
  }

  destroy(): void {
    this.element.remove();
  }
}
