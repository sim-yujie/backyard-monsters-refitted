import type { TargetRect } from "@/game/guide/targets";
import "@/ui/styles/guide.css";

/**
 * The guide's blocker (issue #227, `docs/design/tutorial.md` §2.1, decision
 * Q16): while Bob waits for a tap, the rest of the screen is dimmed and takes
 * no input; only the control he points at, cut out of the dim, and his bubble
 * (drawn above this) stay live. As Flash's `mcBlocker` did
 * (`client/scripts/TUTORIAL.as:1175-1180`).
 *
 * Four panes surround the hole and swallow every pointer event that lands on
 * them; the hole itself is empty, so a tap there reaches the real control
 * underneath. With no hole, the panes cover everything. Keyboard input is
 * not blocked.
 */

/** Room left around the target inside the hole, CSS px. */
export const HOLE_PADDING = 6;

/** The four panes around a hole in a `width` x `height` viewport. */
export const panesAround = (
  hole: TargetRect | null,
  width: number,
  height: number,
): TargetRect[] => {
  if (!hole) return [{ left: 0, top: 0, width, height }];
  const left = Math.max(0, hole.left - HOLE_PADDING);
  const top = Math.max(0, hole.top - HOLE_PADDING);
  const right = Math.min(width, hole.left + hole.width + HOLE_PADDING);
  const bottom = Math.min(height, hole.top + hole.height + HOLE_PADDING);
  return [
    { left: 0, top: 0, width, height: top },
    { left: 0, top: bottom, width, height: Math.max(0, height - bottom) },
    { left: 0, top, width: left, height: Math.max(0, bottom - top) },
    { left: right, top, width: Math.max(0, width - right), height: Math.max(0, bottom - top) },
  ];
};

const swallow = (event: Event): void => {
  event.preventDefault();
  event.stopPropagation();
};

export class Spotlight {
  readonly element: HTMLElement;
  private readonly panes: HTMLElement[];
  private readonly ring: HTMLElement;

  constructor() {
    this.element = document.createElement("div");
    this.element.className = "guide-spotlight";
    this.element.hidden = true;
    this.panes = Array.from({ length: 4 }, () => {
      const pane = document.createElement("div");
      pane.className = "guide-spotlight__pane";
      for (const type of ["pointerdown", "pointerup", "click", "wheel", "touchstart", "contextmenu"]) {
        pane.addEventListener(type, swallow, { passive: false });
      }
      return pane;
    });
    this.ring = document.createElement("div");
    this.ring.className = "guide-spotlight__ring";
    this.element.append(...this.panes, this.ring);
  }

  mount(parent: HTMLElement): this {
    parent.append(this.element);
    return this;
  }

  /**
   * Dims and blocks everything but `hole` (the target's rectangle), or
   * everything when `hole` is null.
   */
  show(hole: TargetRect | null): void {
    const rects = panesAround(hole, window.innerWidth, window.innerHeight);
    this.panes.forEach((pane, index) => {
      const rect = rects[index];
      pane.hidden = !rect || rect.width <= 0 || rect.height <= 0;
      if (!rect) return;
      pane.style.left = `${rect.left}px`;
      pane.style.top = `${rect.top}px`;
      pane.style.width = `${rect.width}px`;
      pane.style.height = `${rect.height}px`;
    });
    this.ring.hidden = !hole;
    if (hole) {
      this.ring.style.left = `${hole.left - HOLE_PADDING}px`;
      this.ring.style.top = `${hole.top - HOLE_PADDING}px`;
      this.ring.style.width = `${hole.width + HOLE_PADDING * 2}px`;
      this.ring.style.height = `${hole.height + HOLE_PADDING * 2}px`;
    }
    this.element.hidden = false;
  }

  hide(): void {
    this.element.hidden = true;
  }

  destroy(): void {
    this.element.remove();
  }
}
