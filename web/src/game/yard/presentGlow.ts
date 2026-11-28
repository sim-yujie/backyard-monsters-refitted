import { Container, Sprite, Texture } from "pixi.js";

/**
 * The warm gold glow on the snow under each hunt present while Christmas runs
 * (neon, 28 Nov 2026: "hunt presents don't pop at full-yard zoom ... add a
 * soft pulsing warm-gold ground glow"). One soft gold oval per present, on
 * the ground under the buildings (so a building in front still covers it),
 * breathing slowly; still with reduced motion asked for.
 *
 * Built for old phones as the snowfall is: one small texture drawn on a
 * canvas once (nothing downloaded), at most a find cap's worth of sprites
 * (10), and per frame one alpha for all of them.
 */

/** The glow's width on the ground, world px (a present stands about 40 wide; wide enough to show beside a building, neon round 1). */
export const GLOW_WIDTH = 92;
/** Its height as a share of its width: an oval lying on the isometric ground. */
const GLOW_FLAT = 0.52;
/** One breath, seconds. */
export const GLOW_PERIOD = 1.8;
/** The glow's opacity at the bottom and top of a breath. */
export const GLOW_LOW = 0.6;
export const GLOW_HIGH = 1;
/** Texture size, px. */
const SIZE = 64;

/** The glow's opacity `seconds` into its breathing; `still` holds it at the top. */
export const glowAlpha = (seconds: number, still = false): number => {
  if (still) return GLOW_HIGH;
  const wave = (1 - Math.cos((seconds / GLOW_PERIOD) * Math.PI * 2)) / 2;
  return GLOW_LOW + (GLOW_HIGH - GLOW_LOW) * wave;
};

/** The soft gold oval, drawn once. Null where there is no canvas (tests). */
const glowTexture = (): Texture | null => {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const context = canvas.getContext("2d");
  if (!context) return null;
  const half = SIZE / 2;
  const glow = context.createRadialGradient(half, half, 0, half, half, half);
  // A deep warm gold, so it reads on white snow as well as on grey (white or yellow-white would vanish).
  glow.addColorStop(0, "rgba(255,190,40,0.95)");
  glow.addColorStop(0.35, "rgba(250,170,30,0.7)");
  glow.addColorStop(0.7, "rgba(240,150,20,0.28)");
  glow.addColorStop(1, "rgba(240,150,20,0)");
  context.fillStyle = glow;
  context.fillRect(0, 0, SIZE, SIZE);
  return Texture.from(canvas);
};

export class PresentGlows {
  /** On the ground: add to the scene under the buildings' pictures. */
  readonly root = new Container();
  private readonly glows = new Map<string, Sprite>();
  private texture: Texture | null;
  private seconds = 0;

  /** `texture` stands in for the drawn oval (tests, where there is no canvas). */
  constructor(texture: Texture | null = null) {
    this.texture = texture;
    this.root.eventMode = "none";
    this.root.interactiveChildren = false;
  }

  get count(): number {
    return this.glows.size;
  }

  /** A glow under the present `key`, standing at world `x`, `y`. */
  add(key: string, x: number, y: number): void {
    this.texture ??= glowTexture();
    if (!this.texture || this.glows.has(key)) return;
    const sprite = new Sprite(this.texture);
    sprite.anchor.set(0.5);
    sprite.position.set(x, y);
    this.size(sprite, 1);
    this.root.addChild(sprite);
    this.glows.set(key, sprite);
  }

  /** Grows the glow with its present as it pops out of the ground (0 to 1, or a little over at the bounce). */
  scale(key: string, share: number): void {
    const sprite = this.glows.get(key);
    if (sprite) this.size(sprite, share);
  }

  /** One frame of the breathing; `still` (reduced motion) holds it bright. */
  update(deltaSeconds: number, still = false): void {
    if (this.glows.size === 0) return;
    this.seconds = (this.seconds + Math.min(deltaSeconds, 0.1)) % GLOW_PERIOD;
    this.root.alpha = glowAlpha(this.seconds, still);
  }

  clear(): void {
    for (const sprite of this.glows.values()) sprite.destroy();
    this.glows.clear();
  }

  destroy(): void {
    this.clear();
    if (this.texture !== Texture.WHITE) this.texture?.destroy(true);
    this.texture = null;
    this.root.destroy({ children: true });
  }

  private size(sprite: Sprite, share: number): void {
    const scale = (GLOW_WIDTH / SIZE) * Math.max(0, share);
    sprite.scale.set(scale, scale * GLOW_FLAT);
  }
}
