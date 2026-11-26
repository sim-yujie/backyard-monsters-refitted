import { classicLook } from "@/game/classicLook";
import { BlurFilter, ColorMatrixFilter, Container, Rectangle, Sprite, type ColorMatrix, type Renderer, type Texture } from "pixi.js";

/**
 * The look of a building a visitor can speed up (owner's pick F, 26 Nov
 * 2026): the building drawn a gentle warm amber, with a soft amber glow round
 * it, so it still reads as one to help behind a wall (`YardBuildings.setHelpLit`).
 *
 * Both are cheap on a phone. The amber is the sprites' own `tint`, which
 * costs nothing and keeps the buildings in one batch; no filter runs per
 * frame. The glow is a blurred white outline of the building, baked once into
 * a small texture (`bakeHelpGlow`) and drawn behind it as one more sprite,
 * tinted amber.
 */

/** How a lit building looks, in each look; one shape so a check can try values (`window.__helpLook`, dev only). */
export interface HelpLook {
  /** The warm tint at full light, multiplied into the art: red kept, green and blue taken down a little. */
  tint: number;
  /** The glow behind the building: its amber and how strong it stands at full light. */
  glowColor: number;
  glowAlpha: number;
  /** The same glow laid over the building, adding a little light (0 for none). */
  liftColor: number;
  liftAlpha: number;
  /** Help all's pop: how strong the glow and the lift flare at the peak. */
  flareGlowAlpha: number;
  flareLiftAlpha: number;
  /** How far the glow spreads past the building, world pixels, the blur that softens it, and the outline's swell. */
  pad: number;
  blur: number;
  swell: number;
  /** Dev only: nothing lit, to measure what the light costs. */
  off: boolean;
}

/**
 * The light, after neon's two reviews (26 Nov 2026): a crisp amber rim glow
 * that matches the wrench and reads on dark, gold and small buildings alike,
 * and only a breath of added light, so dark towers keep their blacks. Round 2
 * found Classic's gentler light too faint to tell a building apart, so both
 * looks now share it; round 3 gave Classic's pale wood and cream a little
 * more glow.
 */
const MODERN_LOOK: HelpLook = {
  tint: 0xffe2b4,
  glowColor: 0xffad29,
  glowAlpha: 0.54,
  liftColor: 0xffb347,
  liftAlpha: 0.085,
  flareGlowAlpha: 0.9,
  flareLiftAlpha: 0.3,
  pad: 14,
  blur: 5.5,
  swell: 1.06,
  off: false,
};

const CLASSIC_LOOK: HelpLook = {
  ...MODERN_LOOK,
  glowAlpha: 0.57,
  liftAlpha: 0.08,
};

/** Dev only: values a check sets over both looks. */
const devLook: Partial<HelpLook> = {};
if (import.meta.env.DEV && typeof window !== "undefined") {
  const w = window as unknown as { __helpLook?: Partial<HelpLook> };
  Object.assign(devLook, w.__helpLook ?? {});
  w.__helpLook = devLook;
}

/** The light for the look in use now. */
export const helpLook = (): HelpLook => {
  const look = classicLook() ? CLASSIC_LOOK : MODERN_LOOK;
  return import.meta.env.DEV ? { ...look, ...devLook } : look;
};

/** Help all's pop takes a building's light up to this, then down to nothing (`YardHelpMarks`). */
export const HELP_FLARE = 2;

/** The glow is soft: half the pixels are plenty. */
const GLOW_RESOLUTION = 0.5;

/** Two colours mixed: `t` 0 is `a`, 1 is `b`. */
export const mixColor = (a: number, b: number, t: number): number => {
  const k = Math.max(0, Math.min(1, t));
  const channel = (shift: number): number => {
    const x = (a >> shift) & 0xff;
    const y = (b >> shift) & 0xff;
    return Math.round(x + (y - x) * k) << shift;
  };
  return channel(16) | channel(8) | channel(0);
};

/** Two tints laid one over the other, as the graphics card multiplies them. */
export const multiplyColor = (a: number, b: number): number => {
  const channel = (shift: number): number =>
    Math.round((((a >> shift) & 0xff) * ((b >> shift) & 0xff)) / 255) << shift;
  return channel(16) | channel(8) | channel(0);
};

/** A building's tint lit by `amount` (0 to 1 and over), over the tint it already has (a damage step). */
export const litTint = (base: number, amount: number): number =>
  amount <= 0 ? base : multiplyColor(base, mixColor(0xffffff, helpLook().tint, amount));

/** An alpha at `amount`: `rest` times it up to 1, then on to `flare` at {@link HELP_FLARE}. */
const lightAlpha = (amount: number, rest: number, flare: number): number => {
  const alpha = amount <= 1 ? rest * amount : rest + ((flare - rest) * (amount - 1)) / (HELP_FLARE - 1);
  return Math.max(0, Math.min(1, alpha));
};

/** The lift's alpha at `amount`. */
export const liftAlpha = (amount: number): number => {
  const look = helpLook();
  return lightAlpha(amount, look.liftAlpha, look.flareLiftAlpha);
};

/** The glow's alpha at `amount`. */
export const glowAlpha = (amount: number): number => {
  const look = helpLook();
  return lightAlpha(amount, look.glowAlpha, look.flareGlowAlpha);
};

/** What the glow is baked from: the sprites of one building as they stand. */
export interface GlowSource {
  readonly texture: Texture;
  readonly x: number;
  readonly y: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly anchorX: number;
  readonly anchorY: number;
}

/** A baked glow and where it stands, world pixels. */
export interface BakedGlow {
  readonly texture: Texture;
  readonly x: number;
  readonly y: number;
}

/** White, keeping the alpha: the building's outline. */
// prettier-ignore
const SILHOUETTE: ColorMatrix = [
  0, 0, 0, 0, 1,
  0, 0, 0, 0, 1,
  0, 0, 0, 0, 1,
  0, 0, 0, 1, 0,
];

let filters: [ColorMatrixFilter, BlurFilter] | null = null;

/**
 * Bakes the glow of one building: its sprites, white and blurred, in a
 * small texture with room round them for the blur. Null when there is
 * nothing to bake.
 */
export const bakeHelpGlow = (renderer: Renderer, sources: readonly GlowSource[]): BakedGlow | null => {
  if (sources.length === 0) return null;
  const look = helpLook();
  if (!filters) {
    const white = new ColorMatrixFilter();
    white.matrix = SILHOUETTE;
    filters = [white, new BlurFilter({ strength: look.blur, quality: 3 })];
  }
  filters[1].strength = look.blur;
  const holder = new Container();
  const inner = new Container();
  holder.addChild(inner);
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const source of sources) {
    const sprite = new Sprite(source.texture);
    sprite.anchor.set(source.anchorX, source.anchorY);
    sprite.scale.set(source.scaleX, source.scaleY);
    sprite.position.set(source.x, source.y);
    inner.addChild(sprite);
    const bounds = sprite.getBounds();
    left = Math.min(left, bounds.x);
    top = Math.min(top, bounds.y);
    right = Math.max(right, bounds.x + bounds.width);
    bottom = Math.max(bottom, bounds.y + bounds.height);
  }
  if (!(right > left && bottom > top)) {
    holder.destroy({ children: true });
    return null;
  }
  // Swollen a little about the building's middle, so the blur reaches past its edge.
  const midX = (left + right) / 2;
  const midY = (top + bottom) / 2;
  inner.pivot.set(midX, midY);
  inner.position.set(midX, midY);
  inner.scale.set(look.swell);
  inner.filters = filters;
  const padX = look.pad + ((right - left) * (look.swell - 1)) / 2;
  const padY = look.pad + ((bottom - top) * (look.swell - 1)) / 2;
  const frame = new Rectangle(left - padX, top - padY, right - left + 2 * padX, bottom - top + 2 * padY);
  const texture = renderer.generateTexture({ target: holder, frame, resolution: GLOW_RESOLUTION, antialias: false });
  inner.filters = null;
  holder.destroy({ children: true });
  return { texture, x: frame.x, y: frame.y };
};
