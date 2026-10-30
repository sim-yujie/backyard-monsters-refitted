import type { Camera } from "@/game/Camera";
import type { OffsetCell } from "@/game/HexGrid";
import { TapClickGuard, touchEndsOn } from "@/game/TapClickGuard";
import { pickCell } from "./ground";
import { inWorld } from "./zones";

/**
 * Pointer and keyboard input for the map, on top of what Camera already does.
 *
 * Camera owns drag, wheel and pinch. This adds the things that are about cells
 * rather than about the view: hover, click-to-select, double-click-to-zoom, and
 * the keyboard zoom shortcuts.
 *
 * Click detection is by distance, not by the browser's `click` event: a drag
 * that ends over a cell still fires `click`, and the original game had the same
 * problem and solved it the same way — more than a few pixels of movement means
 * it was a pan, not a selection (MapRoomPopup.as:733-736).
 */

/** Pointer travel, in CSS pixels, above which a press counts as a drag. */
const DRAG_SLOP = 6;

export interface MapInputOptions {
  camera: Camera;
  canvas: HTMLCanvasElement;
  onHover: (cell: OffsetCell | null) => void;
  onSelect: (cell: OffsetCell) => void;
  /** Double click: zoom in centred on that cell. */
  onZoomToCell: (cell: OffsetCell) => void;
  /** Keyboard `+` and `-`; the argument is +1 or -1. */
  onZoomStep: (direction: number) => void;
  /** Escape. */
  onCancel: () => void;
  /**
   * How far each cell is drawn from its spot (`ground.ts`), so a click lands
   * on the raised or sunken face it hits. Flat when absent.
   */
  liftOf?: (col: number, row: number) => number;
}

export class MapInput {
  private readonly options: MapInputOptions;
  private pressX = 0;
  private pressY = 0;
  private pressed = false;
  /**
   * A tap that opens a cell's panel must not click the panel too: its Attack
   * may be under the finger. One that ends on the canvas keeps its click, for
   * the double tap.
   */
  private readonly tapClick: TapClickGuard;

  constructor(options: MapInputOptions) {
    this.options = options;
    const canvas = options.canvas;
    this.tapClick = new TapClickGuard(canvas, (event) => touchEndsOn(canvas, event));
  }

  attach(): void {
    const canvas = this.options.canvas;
    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerleave", this.onPointerLeave);
    canvas.addEventListener("dblclick", this.onDoubleClick);
    this.tapClick.attach();
    window.addEventListener("keydown", this.onKeyDown);
  }

  detach(): void {
    const canvas = this.options.canvas;
    canvas.removeEventListener("pointerdown", this.onPointerDown);
    canvas.removeEventListener("pointerup", this.onPointerUp);
    canvas.removeEventListener("pointermove", this.onPointerMove);
    canvas.removeEventListener("pointerleave", this.onPointerLeave);
    canvas.removeEventListener("dblclick", this.onDoubleClick);
    this.tapClick.detach();
    window.removeEventListener("keydown", this.onKeyDown);
  }

  /** The cell under a pointer event, or null when it is off the world. */
  cellAt(event: { clientX: number; clientY: number }): OffsetCell | null {
    const rect = this.options.canvas.getBoundingClientRect();
    const world = this.options.camera.screenToWorld({
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    });
    const cell = pickCell(world.x, world.y, this.options.liftOf ?? flat);
    return inWorld(cell.col, cell.row) ? cell : null;
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    this.pressed = true;
    this.tapClick.press();
    this.pressX = event.clientX;
    this.pressY = event.clientY;
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (!this.pressed) return;
    this.pressed = false;

    const travelled = Math.hypot(event.clientX - this.pressX, event.clientY - this.pressY);
    if (travelled > DRAG_SLOP) return;

    const cell = this.cellAt(event);
    if (!cell) return;
    this.tapClick.opened(event);
    this.options.onSelect(cell);
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    this.options.onHover(this.cellAt(event));
  };

  private readonly onPointerLeave = (): void => {
    this.pressed = false;
    this.options.onHover(null);
  };

  private readonly onDoubleClick = (event: MouseEvent): void => {
    const cell = this.cellAt(event);
    if (cell) this.options.onZoomToCell(cell);
  };

  /**
   * Keyboard zoom.
   *
   * Ignored while a text field has focus — the bookmark name input is still
   * one of those, and the guard is generally useful for `+`/`-`/Escape too.
   * `=` is accepted alongside `+` because that is the unshifted key on most
   * layouts.
   */
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

const flat = (): number => 0;
