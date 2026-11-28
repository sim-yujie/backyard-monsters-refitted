import { flakeCount, moveFlake, newFlake, seeded, type Flake } from "@/game/yard/YardSnowfall";
import { onQualityChange, quality } from "@/game/quality";

/**
 * Falling snow over the world map while Christmas runs (owner, 28 Nov 2026:
 * "possible for falling snow on map?"), in both looks, by the same rules as
 * the yard's (`yard/YardSnowfall.ts`): none on Low, half on Medium, none with
 * reduced motion asked for or `?snow=0` on the address; the same flakes,
 * sizes and drift.
 *
 * Not on the map's Pixi stage: the map draws its stage only when something
 * changed (`MapRoom2Scene` `renderGate`, one draw a second on a still map),
 * and snow there would redraw the whole painted map every frame. Instead a
 * plain 2D canvas over the game's canvas and under the HUD, `pointer-events:
 * none`, redraws only its few dozen dots, on its own animation frames (which
 * stop by themselves in a hidden tab). Its pixels are capped at 1.5 per CSS
 * pixel: soft dots need no more, and a full 3x phone canvas would cost about
 * 12 MB.
 */

/** The canvas's pixels per CSS pixel, at most. */
export const MAX_SNOW_RESOLUTION = 1.5;

/** `?snow=0` (or `off`) on the page's address: no falling snow (frame-time checks). */
const switchedOff = (): boolean => {
  if (typeof location === "undefined") return false;
  const asked = new URLSearchParams(location.search).get("snow");
  return asked === "0" || asked === "off";
};

const reducedMotion = (): boolean =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Whether the map snows now (the season aside): not on Low, not with reduced motion, not switched off. */
export const mapSnowAllowed = (): boolean => quality() !== "low" && !reducedMotion() && !switchedOff();

/** The flake picture: the yard's soft white dot, 16 px, drawn once. */
const flakePicture = (): HTMLCanvasElement | null => {
  const canvas = document.createElement("canvas");
  canvas.width = 16;
  canvas.height = 16;
  const context = canvas.getContext("2d");
  if (!context) return null;
  const glow = context.createRadialGradient(8, 8, 0, 8, 8, 8);
  glow.addColorStop(0, "rgba(255,255,255,1)");
  glow.addColorStop(0.45, "rgba(255,255,255,0.85)");
  glow.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = glow;
  context.fillRect(0, 0, 16, 16);
  return canvas;
};

export class MapSnowfall {
  private canvas: HTMLCanvasElement | null = null;
  private context: CanvasRenderingContext2D | null = null;
  private dot: HTMLCanvasElement | null = null;
  private flakes: (Flake & { readonly alpha: number })[] = [];
  private readonly random = seeded(1226);
  private frame = 0;
  private last = 0;
  private sizeKey = "";
  private unwatchQuality: (() => void) | null = null;
  private resizeObserver: ResizeObserver | null = null;

  /** How many flakes fall now. */
  get count(): number {
    return this.flakes.length;
  }

  /** The canvas, while snowing (tests, screenshots). */
  get element(): HTMLCanvasElement | null {
    return this.canvas;
  }

  /**
   * Starts the snow over `parent` (the overlay's content layer: it goes in
   * first, under every panel and button). A second call is a no-op.
   */
  start(parent: HTMLElement): void {
    if (this.canvas || typeof document === "undefined") return;
    this.dot ??= flakePicture();
    if (!this.dot) return;
    const canvas = document.createElement("canvas");
    canvas.className = "map-snowfall";
    canvas.setAttribute("aria-hidden", "true");
    // Inline, so it needs no stylesheet: over the game, under the HUD, never in the way of a tap.
    canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;";
    const context = canvas.getContext("2d");
    if (!context) return;
    parent.prepend(canvas);
    this.canvas = canvas;
    this.context = context;
    this.unwatchQuality = onQualityChange(() => {
      // Low stops it, Medium halves it, at once (as the yard's).
      this.sizeKey = "";
    });
    if (typeof ResizeObserver === "function") {
      this.resizeObserver = new ResizeObserver(() => (this.sizeKey = ""));
      this.resizeObserver.observe(canvas);
    }
    this.last = 0;
    this.frame = requestAnimationFrame(this.tick);
  }

  /** Stops the snow and takes its canvas away. */
  stop(): void {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.unwatchQuality?.();
    this.unwatchQuality = null;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.canvas?.remove();
    this.canvas = null;
    this.context = null;
    this.flakes = [];
    this.sizeKey = "";
  }

  private readonly tick = (now: number): void => {
    this.frame = requestAnimationFrame(this.tick);
    const canvas = this.canvas;
    const context = this.context;
    if (!canvas || !context || !this.dot) return;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const allowed = mapSnowAllowed();
    const key = allowed ? `${width}x${height}:${quality()}` : "off";
    if (key !== this.sizeKey) {
      this.sizeKey = key;
      const resolution = Math.min(MAX_SNOW_RESOLUTION, globalThis.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.round(width * resolution));
      canvas.height = Math.max(1, Math.round(height * resolution));
      context.setTransform(resolution, 0, 0, resolution, 0, 0);
      const count = allowed ? flakeCount(width, height, quality()) : 0;
      const narrow = width < 600;
      this.flakes = [];
      for (let index = 0; index < count; index++) this.flakes.push(newFlake(this.random, narrow));
      context.clearRect(0, 0, width, height);
    }
    // A long pause (a hidden tab) must not throw every flake to the bottom.
    const step = this.last === 0 ? 0 : Math.min((now - this.last) / 1000, 0.1);
    this.last = now;
    if (this.flakes.length === 0) return;
    context.clearRect(0, 0, width, height);
    for (const flake of this.flakes) {
      const u = moveFlake(flake, step, width, height, this.random);
      const size = flake.size;
      context.globalAlpha = flake.alpha;
      context.drawImage(this.dot, u * width - size / 2, flake.v * height - size / 2, size, size);
    }
    context.globalAlpha = 1;
  };
}
