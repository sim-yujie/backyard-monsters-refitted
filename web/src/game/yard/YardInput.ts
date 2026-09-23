import type { Camera } from "@/game/Camera";
import type { YardBuilding } from "./yardModel";

/**
 * Pointer and keyboard input for the yard, on top of what Camera already does.
 *
 * Camera owns drag, wheel and pinch; this adds the parts that are about
 * buildings rather than about the view. It is deliberately the same shape as
 * `maproom/MapInput.ts`, including the click test: a drag that ends over a
 * building still fires a `click`, so a press counts as a selection only if the
 * pointer barely moved.
 *
 * Hover runs the picker on every move. That is a walk over the draw list, but
 * it stops at the first hit and rejects on a cheap box test first, so a full
 * yard costs a few microseconds — far less than the event itself.
 */

/** Pointer travel, in CSS pixels, above which a press counts as a drag. */
const DRAG_SLOP = 6;

export interface YardInputOptions {
  camera: Camera;
  canvas: HTMLCanvasElement;
  /** The building at a world point, or null. */
  pick: (worldX: number, worldY: number) => YardBuilding | null;
  onHover: (building: YardBuilding | null) => void;
  onSelect: (building: YardBuilding | null) => void;
  /** Keyboard `+` and `-`; the argument is +1 or -1. */
  onZoomStep: (direction: number) => void;
  /** Keyboard `0`. */
  onZoomReset: () => void;
  /** Escape. */
  onCancel: () => void;
}

export class YardInput {
  private readonly options: YardInputOptions;
  private pressX = 0;
  private pressY = 0;
  private pressed = false;

  constructor(options: YardInputOptions) {
    this.options = options;
  }

  attach(): void {
    const canvas = this.options.canvas;
    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerleave", this.onPointerLeave);
    window.addEventListener("keydown", this.onKeyDown);
  }

  detach(): void {
    const canvas = this.options.canvas;
    canvas.removeEventListener("pointerdown", this.onPointerDown);
    canvas.removeEventListener("pointerup", this.onPointerUp);
    canvas.removeEventListener("pointermove", this.onPointerMove);
    canvas.removeEventListener("pointerleave", this.onPointerLeave);
    window.removeEventListener("keydown", this.onKeyDown);
  }

  /** The building under a pointer event, or null. */
  buildingAt(event: { clientX: number; clientY: number }): YardBuilding | null {
    const rect = this.options.canvas.getBoundingClientRect();
    const world = this.options.camera.screenToWorld({
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    });
    return this.options.pick(world.x, world.y);
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    this.pressed = true;
    this.pressX = event.clientX;
    this.pressY = event.clientY;
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (!this.pressed) return;
    this.pressed = false;

    const travelled = Math.hypot(event.clientX - this.pressX, event.clientY - this.pressY);
    if (travelled > DRAG_SLOP) return;

    // A click on bare ground clears the selection, which is how the panel is
    // dismissed without reaching for its close button.
    this.options.onSelect(this.buildingAt(event));
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    this.options.onHover(this.buildingAt(event));
  };

  private readonly onPointerLeave = (): void => {
    this.pressed = false;
    this.options.onHover(null);
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (isTextEntry(event.target)) return;

    switch (event.key) {
      case "+":
      case "=":
        event.preventDefault();
        this.options.onZoomStep(1);
        break;
      case "-":
      case "_":
        event.preventDefault();
        this.options.onZoomStep(-1);
        break;
      case "0":
        event.preventDefault();
        this.options.onZoomReset();
        break;
      case "Escape":
        this.options.onCancel();
        break;
      default:
        break;
    }
  };
}

const isTextEntry = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target.isContentEditable
  );
};
