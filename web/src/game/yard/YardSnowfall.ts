import { Container, Sprite, Texture } from "pixi.js";
import type { Quality } from "@/game/quality";
import type { Rect } from "./YardGrid";

/**
 * Falling snow over the yard while Christmas runs (owner, 27 Nov 2026: "FULL
 * snow look ... falling snow (OFF on Low quality, halved on Medium)";
 * `winterSkin.ts`).
 *
 * Built for old phones: one container of plain sprites sharing one small
 * texture drawn on a canvas at start (nothing downloaded), a fixed number of
 * flakes for the screen's size (no flakes made or freed while it falls), and
 * per frame only a position each. The flakes live in screen space: each has a
 * place in the view (0 to 1 across and down) and is drawn where that falls in
 * the world rectangle on screen, at a world size that keeps it the same size
 * on screen at any zoom. So panning or zooming never piles snow up or thins
 * it out, and flakes off screen cost nothing.
 *
 * How many: {@link flakeCount}: about one flake per 7,500 screen pixels on
 * High (about 140 on a 1366 x 768 window, 44 on a 390 x 844 phone), half on
 * Medium, none on Low; never more than {@link MAX_FLAKES}. With reduced motion
 * asked for (the system setting) there is none either.
 */

/** Screen pixels per flake on High; Medium has half as many flakes. */
const PIXELS_PER_FLAKE = 7_500;
/** The most flakes on any screen. */
export const MAX_FLAKES = 160;

/** How many flakes a `width` x `height` screen gets at `level`. */
export const flakeCount = (width: number, height: number, level: Quality): number => {
  if (level === "low" || width <= 0 || height <= 0) return 0;
  const high = Math.min(MAX_FLAKES, Math.round((width * height) / PIXELS_PER_FLAKE));
  return level === "medium" ? Math.round(high / 2) : high;
};

/** One flake: its place in the view (0 to 1), its fall speed and size in screen px, its sway. */
export interface Flake {
  u: number;
  v: number;
  /** Screen px a second, down. */
  readonly fall: number;
  /** Screen px, across. */
  readonly size: number;
  /** Sway: how far (screen px) and how fast (radians a second), and where in its swing. */
  readonly swayBy: number;
  readonly swayRate: number;
  phase: number;
}

/** A small seeded generator (mulberry32), so a test sees the same snow every time. */
export const seeded = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
};

/**
 * A new flake. Three depths: far flakes small, slow and bright enough to read
 * over snow; near ones bigger, quicker and softer, so they never blot out a
 * tower or salt a dark wall (neon rounds 1 and 2, 27 Nov 2026: near flakes at
 * most about 55% opaque; on a phone-wide screen 3 to 7 px, else 4 to 11).
 */
export const newFlake = (random: () => number, narrow: boolean): Flake & { readonly alpha: number } => {
  const depth = random();
  return {
    u: random(),
    v: random(),
    fall: 22 + depth * 46,
    size: narrow ? 3 + depth * depth * 4 : 4 + depth * depth * 7,
    alpha: 0.9 - depth * depth * 0.35,
    swayBy: 6 + random() * 14,
    swayRate: 0.6 + random() * 1.1,
    phase: random() * Math.PI * 2,
  };
};

/**
 * Moves a flake on by `step` seconds on a `screenWidth` x `screenHeight`
 * screen and gives its place across the view now (0 to 1, with its sway); a
 * flake that fell off the bottom starts again at the top, somewhere new.
 */
export const moveFlake = (flake: Flake, step: number, screenWidth: number, screenHeight: number, random: () => number): number => {
  flake.v += (flake.fall * step) / screenHeight;
  flake.phase += flake.swayRate * step;
  if (flake.v > 1.02) {
    flake.v -= 1.04;
    flake.u = random();
  }
  const swayU = (Math.sin(flake.phase) * flake.swayBy) / screenWidth;
  return (((flake.u + swayU) % 1) + 1) % 1;
};

/** The flake picture: a soft white dot, 16 px, drawn once. Null where there is no canvas (tests). */
const flakeTexture = (): Texture | null => {
  if (typeof document === "undefined") return null;
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
  return Texture.from(canvas);
};

export class YardSnowfall {
  /** Over the buildings and monsters, under the yard's badges and labels. */
  readonly root = new Container();
  private flakes: (Flake & { readonly sprite: Sprite })[] = [];
  private texture: Texture | null;
  private readonly random = seeded(1225);

  /** `texture` stands in for the drawn dot (tests, where there is no canvas). */
  constructor(texture: Texture | null = null) {
    this.texture = texture;
    this.root.eventMode = "none";
    this.root.interactiveChildren = false;
    this.root.visible = false;
  }

  /** How many flakes fall now. */
  get count(): number {
    return this.flakes.length;
  }

  /**
   * Snow on (`count` flakes) or off (0); `narrow` for a phone-wide screen. Keeps the flakes it has when the
   * count is the same, so calling it each time the yard redraws costs nothing.
   */
  setFlakes(count: number, narrow = false): void {
    if (count === this.flakes.length) {
      this.root.visible = count > 0;
      return;
    }
    this.clear();
    if (count <= 0) return;
    this.texture ??= flakeTexture();
    if (!this.texture) return;
    for (let index = 0; index < count; index++) {
      const flake = newFlake(this.random, narrow);
      const sprite = new Sprite(this.texture);
      sprite.anchor.set(0.5);
      sprite.alpha = flake.alpha;
      this.root.addChild(sprite);
      this.flakes.push({ ...flake, sprite });
    }
    this.root.visible = true;
  }

  /**
   * One frame: `visible` is the world rectangle on screen, `screenWidth` and
   * `screenHeight` its size in screen px, `deltaSeconds` the frame's length.
   */
  update(visible: Rect, screenWidth: number, screenHeight: number, deltaSeconds: number): void {
    if (this.flakes.length === 0 || visible.width <= 0 || screenWidth <= 0 || screenHeight <= 0) return;
    // World px per screen px, so a flake keeps its screen size at any zoom.
    const worldPerPixel = visible.width / screenWidth;
    // A long pause (a hidden tab) must not throw every flake to the bottom.
    const step = Math.min(deltaSeconds, 0.1);
    for (const flake of this.flakes) {
      const u = moveFlake(flake, step, screenWidth, screenHeight, this.random);
      flake.sprite.position.set(visible.x + u * visible.width, visible.y + flake.v * visible.height);
      flake.sprite.scale.set((flake.size / 16) * worldPerPixel);
    }
  }

  /** Takes every flake away (the texture stays for the next fall). */
  clear(): void {
    for (const flake of this.flakes) flake.sprite.destroy();
    this.flakes = [];
    this.root.visible = false;
  }

  destroy(): void {
    this.clear();
    if (this.texture !== Texture.WHITE) this.texture?.destroy(true);
    this.texture = null;
    this.root.destroy({ children: true });
  }
}
