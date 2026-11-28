import { currentSeason } from "@/game/season";
import { GroundTexture } from "./groundKinds";

/**
 * The painted map's Christmas look, readability pass (neon, 28 Nov 2026, on
 * the winter map of commit a9c5f4644):
 *
 * - "Modern map snow is blown out to pure #FFFFFF while summer green forests &
 *   yellow sand remain": the snow texture is toned down to a cool off-white
 *   (never above about #DCE6F0), the forest canopy frosted (less saturated,
 *   a little lighter and cooler) and the beaches cooled to grey sand.
 * - "Hex borders wash out on snow": the hex lines turn a dark cool slate.
 * - "The cyan territory border loses contrast on white snow": the dark rim
 *   under every border is drawn almost solid.
 *
 * All of it through things the map already has (the textures cut from the
 * atlas, the line and rim uniforms), so no shader changes and nothing more is
 * fetched. Only while it is Christmas (`game/season.ts`).
 */

/** Whether the map wears its winter look now. */
export const winterMap = (): boolean => currentSeason() === "christmas";

/** The hex lines on snow: slate #4A6078 at 34% (the summer cream at 30% vanishes on white). */
export const WINTER_LINE_COLOUR = [0x4a / 255, 0x60 / 255, 0x78 / 255, 0.34] as const;

/** The border rim's opacity on snow (summer 0.55). */
export const WINTER_RIM_ALPHA = 0.9;

/** How each ground texture is frosted: desaturated by `grey` (0 to 1), then multiplied by `tint`. */
export interface Frost {
  readonly grey: number;
  readonly tint: string;
}

/** The frosted textures; the rest stay as painted (the water above all). */
export const WINTER_FROST: Readonly<Partial<Record<GroundTexture, Frost>>> = {
  // Cool off-white, so a snowfield next to a forest no longer glares (white x #D6E0EB = #D6E0EB).
  [GroundTexture.SNOW]: { grey: 0, tint: "#d6e0eb" },
  // Pine-dark and frosty rather than summer lime.
  [GroundTexture.CANOPY]: { grey: 0.45, tint: "#c9d6dc" },
  // Grey winter sand and wet shingle on the coast.
  [GroundTexture.SAND]: { grey: 0.65, tint: "#d7dce2" },
  [GroundTexture.WET_SAND]: { grey: 0.6, tint: "#cfd6de" },
};

/** The stand-in colour of a frosted texture until the atlas lands (its frosted average, roughly). */
export const WINTER_STAND_INS: Readonly<Partial<Record<GroundTexture, string>>> = {
  [GroundTexture.SNOW]: "#c6d0db",
  [GroundTexture.CANOPY]: "#4f6a55",
  [GroundTexture.SAND]: "#b9b8b2",
  [GroundTexture.WET_SAND]: "#a9aaa6",
};

/** Frosts a texture's canvas in place, as {@link WINTER_FROST} says; a no-op for the rest or with no 2D context. */
export const frostCanvas = (canvas: HTMLCanvasElement, texture: GroundTexture): void => {
  const frost = WINTER_FROST[texture];
  if (!frost) return;
  const context = canvas.getContext("2d");
  if (!context) return;
  const { width, height } = canvas;
  context.save();
  if (frost.grey > 0) {
    // Takes the saturation away by `grey`, keeping hue and lightness.
    context.globalCompositeOperation = "saturation";
    context.globalAlpha = frost.grey;
    context.fillStyle = "#808080";
    context.fillRect(0, 0, width, height);
  }
  context.globalCompositeOperation = "multiply";
  context.globalAlpha = 1;
  context.fillStyle = frost.tint;
  context.fillRect(0, 0, width, height);
  // (The ground textures are opaque, so the fills change colour only.)
  context.restore();
};
