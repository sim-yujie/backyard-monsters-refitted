import type { Camera } from "@/game/Camera";
import {
  clipRect,
  cornersBounds,
  fitWorld,
  projectPoint,
  projectRect,
  unprojectPoint,
  type MinimapFit,
} from "@/game/yard/minimap";
import { isDecoration } from "@/game/yard/planner/placement";
import { TILE_COLOURS, tileCategory } from "@/game/yard/planner/blueprint";
import type { Point, Rect } from "@/game/yard/YardGrid";
import type { YardRenderer } from "@/game/yard/YardRenderer";

/**
 * The yard's locator (design §3, F15; §4.1 puts it in the canvas's bottom-right
 * corner).
 *
 * The whole yard at a fixed scale, every building a dot coloured by the same
 * category table the blueprint view uses, the plot outline, and the camera's
 * rectangle over the top. Click or drag it to go somewhere.
 *
 * ## Why it asks the renderer rather than the plan
 *
 * Positions come from `renderer.cornersOf`, which answers for whichever view is
 * showing and answers with where a building is drawn *now*. That is one source
 * for four cases — isometric and blueprint, read-only and mid-drag — and it is
 * what makes a planner drag show on the minimap without the plan, the session
 * or the renderer knowing this class exists. The two worlds have different
 * sizes and different projections; `renderer.worldSize` and the fit absorb both.
 *
 * ## Why it is not redrawn every frame
 *
 * 575 buildings is a real yard and this is a 176 pixel picture, so a redraw is
 * cheap but not free. It repaints only when something moved: the scene marks it
 * dirty on the frames the camera reports as changed and the planner marks it
 * after an edit. An idle yard costs one boolean test per frame.
 */

/** The box the world is fitted into, in CSS pixels. Wider than tall: both the
 * isometric yard and the blueprint are landscape. */
const BOX_WIDTH = 176;
const BOX_HEIGHT = 128;

/** Smallest a building may be drawn. Below this a wall vanishes at fit zoom. */
const MIN_DOT = 1.5;

/** Backing store multiplier. Past 2 the extra pixels are not visible. */
const MAX_PIXEL_RATIO = 2;

export interface YardMinimapOptions {
  renderer: YardRenderer;
  camera: Camera;
  /** A point on the minimap was picked: centre the camera there. */
  onJump: (world: Point) => void;
}

export class YardMinimap {
  readonly element: HTMLCanvasElement;

  private readonly context: CanvasRenderingContext2D;
  private readonly options: YardMinimapOptions;

  /** Building ids grouped by the colour they are drawn in, so a repaint sets
   * `fillStyle` seven times rather than once per building. */
  private readonly byColour = new Map<string, number[]>();

  private dirty = true;
  private pixelRatio = 1;

  constructor(options: YardMinimapOptions) {
    this.options = options;

    this.element = document.createElement("canvas");
    this.element.className = "yard-minimap";
    this.element.tabIndex = 0;
    this.element.title = "Click or drag to move the view";
    this.element.setAttribute("role", "button");
    this.element.setAttribute("aria-label", "Yard overview. Click to move the view.");

    const context = this.element.getContext("2d");
    if (!context) throw new Error("Could not get a 2D context for the yard minimap");
    this.context = context;

    this.resizeBacking();

    this.element.addEventListener("pointerdown", this.onPointerDown);
    this.element.addEventListener("pointermove", this.onPointerMove);
    this.element.addEventListener("pointerup", this.onPointerUp);
    this.element.addEventListener("pointercancel", this.onPointerUp);
  }

  mount(container: HTMLElement): this {
    container.append(this.element);
    return this;
  }

  /**
   * Re-reads which buildings exist and what colour each is.
   *
   * Call after a yard load or a rebuild. Positions are not cached — they are
   * read from the renderer on every repaint, because they move.
   */
  refreshBuildings(): void {
    this.byColour.clear();
    const yard = this.options.renderer.shown;
    if (!yard) return;

    for (const building of yard.buildings) {
      const category = tileCategory(building.type, isDecoration(building.type));
      const colour = cssColour(TILE_COLOURS[category].fill);
      const bucket = this.byColour.get(colour);
      if (bucket) bucket.push(building.id);
      else this.byColour.set(colour, [building.id]);
    }
    this.dirty = true;
  }

  /** Something the picture depends on changed: repaint on the next `draw`. */
  markDirty(): void {
    this.dirty = true;
  }

  /** Repaints if anything changed. Cheap enough to call every frame. */
  draw(): void {
    if (!this.dirty) return;
    this.dirty = false;
    this.resizeBacking();

    const context = this.context;
    const palette = this.palette();
    const fit = fitWorld(this.options.renderer.worldSize(), BOX_WIDTH, BOX_HEIGHT);
    const box = { x: 0, y: 0, width: BOX_WIDTH, height: BOX_HEIGHT };

    context.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    context.clearRect(0, 0, BOX_WIDTH, BOX_HEIGHT);
    context.fillStyle = palette.sunken;
    context.fillRect(0, 0, BOX_WIDTH, BOX_HEIGHT);

    this.drawPlot(fit, palette);
    this.drawBuildings(fit);
    this.drawViewport(fit, box, palette);

    context.strokeStyle = palette.border;
    context.lineWidth = 1;
    context.strokeRect(0.5, 0.5, BOX_WIDTH - 1, BOX_HEIGHT - 1);
  }

  destroy(): void {
    this.element.removeEventListener("pointerdown", this.onPointerDown);
    this.element.removeEventListener("pointermove", this.onPointerMove);
    this.element.removeEventListener("pointerup", this.onPointerUp);
    this.element.removeEventListener("pointercancel", this.onPointerUp);
    this.element.remove();
    this.byColour.clear();
  }

  /* ── Painting ───────────────────────────────────────────────────────── */

  /** The plot the player owns, as the active view draws it. */
  private drawPlot(fit: MinimapFit, palette: Palette): void {
    const corners = this.options.renderer.plotCorners();
    if (corners.length < 3) return;

    const context = this.context;
    context.beginPath();
    for (const [index, [x, y]] of corners.entries()) {
      const point = projectPoint(fit, x, y);
      if (index === 0) context.moveTo(point.x, point.y);
      else context.lineTo(point.x, point.y);
    }
    context.closePath();
    context.fillStyle = palette.plot;
    context.fill();
    context.strokeStyle = palette.border;
    context.lineWidth = 1;
    context.stroke();
  }

  private drawBuildings(fit: MinimapFit): void {
    const renderer = this.options.renderer;
    const context = this.context;

    for (const [colour, ids] of this.byColour) {
      context.fillStyle = colour;
      for (const id of ids) {
        const corners = renderer.cornersOf(id);
        if (!corners) continue;
        const bounds = cornersBounds(corners);
        if (!bounds) continue;
        const rect = projectRect(fit, bounds);
        context.fillRect(
          rect.x,
          rect.y,
          Math.max(rect.width, MIN_DOT),
          Math.max(rect.height, MIN_DOT),
        );
      }
    }
  }

  /** What is on screen, clipped to the frame. */
  private drawViewport(fit: MinimapFit, box: Rect, palette: Palette): void {
    const view = this.options.camera.visibleWorldRect();
    const projected = projectRect(fit, {
      x: view.left,
      y: view.top,
      width: view.right - view.left,
      height: view.bottom - view.top,
    });
    const visible = clipRect(projected, box);
    if (!visible) return;

    const context = this.context;
    context.strokeStyle = palette.accent;
    context.lineWidth = 1.5;
    context.strokeRect(
      visible.x + 0.75,
      visible.y + 0.75,
      Math.max(visible.width - 1.5, 1),
      Math.max(visible.height - 1.5, 1),
    );
  }

  /**
   * Keeps the backing store at the display's pixel density.
   *
   * The test is against the backing store's size rather than against the ratio
   * we last used: a fresh canvas is 300 by 150 whatever we think the ratio is,
   * so trusting the remembered ratio leaves the element at the browser's
   * default and the picture drawn into the corner of it.
   */
  private resizeBacking(): void {
    const ratio = Math.min(globalThis.devicePixelRatio || 1, MAX_PIXEL_RATIO);
    const width = Math.round(BOX_WIDTH * ratio);
    const height = Math.round(BOX_HEIGHT * ratio);
    if (this.element.width === width && this.element.height === height) return;

    this.pixelRatio = ratio;
    this.element.width = width;
    this.element.height = height;
    this.element.style.width = `${BOX_WIDTH}px`;
    this.element.style.height = `${BOX_HEIGHT}px`;
  }

  /* ── Pointer ────────────────────────────────────────────────────────── */

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    try {
      this.element.setPointerCapture(event.pointerId);
    } catch {
      // The pointer was released before the handler ran; the click still counts.
    }
    this.jumpTo(event);
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (!this.element.hasPointerCapture(event.pointerId)) return;
    this.jumpTo(event);
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    try {
      if (this.element.hasPointerCapture(event.pointerId)) {
        this.element.releasePointerCapture(event.pointerId);
      }
    } catch {
      // Already released, or the element is detached.
    }
  };

  private jumpTo(event: PointerEvent): void {
    const rect = this.element.getBoundingClientRect();
    const fit = fitWorld(this.options.renderer.worldSize(), BOX_WIDTH, BOX_HEIGHT);
    // The element is sized in CSS pixels but a zoomed browser scales it, so the
    // measured box is what the click has to be read against, not BOX_WIDTH.
    const x = ((event.clientX - rect.left) / (rect.width || BOX_WIDTH)) * BOX_WIDTH;
    const y = ((event.clientY - rect.top) / (rect.height || BOX_HEIGHT)) * BOX_HEIGHT;
    this.options.onJump(unprojectPoint(fit, x, y));
  }

  /** Current token values, so a theme switch is picked up on the next repaint. */
  private palette(): Palette {
    const style = getComputedStyle(document.documentElement);
    const token = (name: string, fallback: string): string =>
      style.getPropertyValue(name).trim() || fallback;

    return {
      sunken: token("--colour-surface-sunken", "#11141a"),
      border: token("--colour-border-strong", "#4d5875"),
      accent: token("--colour-accent", "#f0a12e"),
      // A border token rather than a surface one: the surface levels are only
      // a shade apart from the sunken background, and at this size the plot
      // has to read as ground at a glance or the dots have nothing to sit on.
      plot: token("--colour-border", "#3a4256"),
    };
  }
}

interface Palette {
  sunken: string;
  border: string;
  accent: string;
  plot: string;
}

/** A blueprint palette entry (0xRRGGBB) as a CSS colour. */
const cssColour = (value: number): string => `#${value.toString(16).padStart(6, "0")}`;
