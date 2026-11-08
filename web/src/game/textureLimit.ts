import { CanvasSource, Rectangle, Texture, type Renderer, type TextureSource } from "pixi.js";
import { deviceTextureLimit, setDeviceTextureLimit } from "@/game/quality";

/**
 * The graphics card's texture limit, and cutting pictures that pass it.
 *
 * WebGL refuses a picture wider or taller than the card's `MAX_TEXTURE_SIZE`.
 * Pixi still binds it, and an image WebGL refused samples as opaque black
 * (the WebGL spec's "incomplete texture" colour), so every cell framed over
 * it is drawn as a black box. Many phones and older PCs hold 4096 px a side;
 * the 3D towers' turret strips are 4224 to 6144 px wide.
 */

/** The GPU texture limit a Pixi renderer reports, or null when it does not say. */
export const gpuTextureLimit = (renderer: Renderer): number | null => {
  const gl = (renderer as { gl?: WebGLRenderingContext }).gl;
  let size: unknown = null;
  if (gl && typeof gl.getParameter === "function") size = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  if (typeof size !== "number" || size <= 0) {
    const device = (renderer as { device?: { limits?: { maxTextureDimension2D?: unknown } } })
      .device;
    size = device?.limits?.maxTextureDimension2D;
  }
  if (typeof size !== "number" || size <= 0) return null;
  // Remembered for every sheet cutter (the guide's walk-ins too, which have no
  // renderer of their own), for the yard's building pictures, and for picking a
  // copy the card can hold (`sheetUrl`).
  setDeviceTextureLimit(size);
  return size;
};

/** A rectangle in the picture's 1x units (Pixi's `frame` units). */
export interface CellRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * One cell of an oversized picture, copied through a canvas into a texture of
 * its own at the picture's resolution (`rect` is in 1x units, the picture `@4x`
 * or so). Null where there is no canvas to draw with, or nothing drawable
 * behind the source, in which case the caller falls back.
 */
export const copyCell = (source: TextureSource, rect: CellRect): Texture | null => {
  if (typeof document === "undefined") return null;
  const image = (source as { resource?: unknown }).resource;
  if (!image || typeof image !== "object") return null;
  const scale = source.resolution > 0 ? source.resolution : 1;
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(rect.width * scale);
  canvas.height = Math.ceil(rect.height * scale);
  const context = canvas.getContext("2d");
  if (!context) return null;
  try {
    context.drawImage(
      image as CanvasImageSource,
      rect.x * scale,
      rect.y * scale,
      rect.width * scale,
      rect.height * scale,
      0,
      0,
      rect.width * scale,
      rect.height * scale,
    );
  } catch {
    return null;
  }
  return new Texture({ source: new CanvasSource({ resource: canvas, resolution: scale }) });
};

/** Whether a picture is bigger than `limit` (null: not known yet, so not over). */
export const overLimit = (
  source: Pick<TextureSource, "pixelWidth" | "pixelHeight">,
  limit: number | null = deviceTextureLimit(),
): boolean => limit !== null && (source.pixelWidth > limit || source.pixelHeight > limit);

/**
 * A cell of a picture as a texture the card can draw: framed over the shared
 * source when the picture is within the limit, else copied out through a
 * canvas (`owned` true: the caller destroys it with its source). Where no copy
 * can be made it frames the source as before.
 */
export const cellTexture = (
  source: TextureSource,
  rect: CellRect,
  limit: number | null = deviceTextureLimit(),
): { texture: Texture; owned: boolean } => {
  if (overLimit(source, limit)) {
    const copy = copyCell(source, rect);
    if (copy) return { texture: copy, owned: true };
  }
  return {
    texture: new Texture({ source, frame: new Rectangle(rect.x, rect.y, rect.width, rect.height) }),
    owned: false,
  };
};
