import type { BufferImageSource, Renderer } from "pixi.js";

/**
 * Uploads only the changed part of the map's world-size data textures (map lag, 25 Nov 2026).
 *
 * The painted ground's data, the borders and the fog distances are each one 800 x 800 texture,
 * written a zone (11 x 11 cells) at a time as `getarea` answers land. Uploading the whole texture
 * for each answer (`source.update()`, 2.5 MB for the RGBA ones) cost a 10-60 ms hitch per zone on a
 * slow GPU path, and an owner-sized empire with alliance sight brings three times the zones. So
 * the writers note the cells they touched (`DirtyRect`) and `flushRegion` sends just that box with
 * `texSubImage2D`, falling back to the whole upload whenever it cannot (no WebGL2 renderer yet,
 * texture not on the GPU yet, or most of the world changed).
 */

/** A box of texels, `x0..x1` and `y0..y1` inclusive. */
export interface TexelBox {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** The union of the texel boxes written since the last upload. */
export class DirtyRect {
  private x0 = Infinity;
  private y0 = Infinity;
  private x1 = -Infinity;
  private y1 = -Infinity;
  /** Set when the whole texture must go (a reset), whatever was noted. */
  private whole = false;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {}

  /** Notes a box of texels (clamped to the texture). */
  add(x0: number, y0: number, x1: number, y1: number): void {
    this.x0 = Math.max(0, Math.min(this.x0, x0));
    this.y0 = Math.max(0, Math.min(this.y0, y0));
    this.x1 = Math.min(this.width - 1, Math.max(this.x1, x1));
    this.y1 = Math.min(this.height - 1, Math.max(this.y1, y1));
  }

  /** Notes the whole texture. */
  addAll(): void {
    this.whole = true;
  }

  get empty(): boolean {
    return !this.whole && (this.x1 < this.x0 || this.y1 < this.y0);
  }

  /** The box noted since the last `take`, or null for the whole texture, and forgets it. */
  take(): TexelBox | null {
    const box =
      this.whole || this.x1 < this.x0 || this.y1 < this.y0 ? null : { x0: this.x0, y0: this.y0, x1: this.x1, y1: this.y1 };
    this.clear();
    return box;
  }

  clear(): void {
    this.x0 = Infinity;
    this.y0 = Infinity;
    this.x1 = -Infinity;
    this.y1 = -Infinity;
    this.whole = false;
  }
}

/** A box larger than this share of the texture goes up whole (one call is then cheaper). */
const WHOLE_SHARE = 0.25;

/** What Pixi keeps per uploaded texture (`GlTexture`), the parts read here. */
interface GlTextureLike {
  texture: WebGLTexture;
  target: number;
  format: number;
  type: number;
  width: number;
  height: number;
}

let current: Renderer | null = null;

/** The map's renderer, set when the map attaches to it and cleared when it goes. */
export const setRegionRenderer = (renderer: Renderer | null): void => {
  current = renderer;
};

/**
 * Uploads `box` of `source` (or all of it for null, or when a part cannot be sent), whose
 * resource holds its texels row after row. Leaves the GL state as it found it:
 * the binding of the active unit and every unpack setting it changes.
 */
export const flushRegion = (source: BufferImageSource, box: TexelBox | null): void => {
  if (box === null || !uploadPart(source, box)) source.update();
};

const uploadPart = (source: BufferImageSource, box: TexelBox): boolean => {
  const renderer = current;
  const gl = (renderer as { gl?: WebGL2RenderingContext } | null)?.gl;
  if (!renderer || !gl || typeof WebGL2RenderingContext === "undefined" || !(gl instanceof WebGL2RenderingContext)) {
    return false;
  }
  const width = box.x1 - box.x0 + 1;
  const height = box.y1 - box.y0 + 1;
  if (width <= 0 || height <= 0) return true;
  if (width * height > source.width * source.height * WHOLE_SHARE) return false;
  // Not on the GPU yet (or dropped by Pixi's texture GC): Pixi uploads it whole when it is next used.
  const gpu = (source as unknown as { _gpuData?: Record<number, GlTextureLike | undefined> })._gpuData?.[renderer.uid];
  if (!gpu) return true;
  if (gpu.width !== source.width || gpu.height !== source.height) return false;
  const data = source.resource as ArrayBufferView | null;
  if (!data) return false;

  const bound = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null;
  const premultiply = gl.getParameter(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL) as boolean;
  const flipY = gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL) as boolean;
  const alignment = gl.getParameter(gl.UNPACK_ALIGNMENT) as number;
  gl.bindTexture(gl.TEXTURE_2D, gpu.texture);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.pixelStorei(gl.UNPACK_ROW_LENGTH, source.width);
  gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, box.x0);
  gl.pixelStorei(gl.UNPACK_SKIP_ROWS, box.y0);
  const view = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, box.x0, box.y0, width, height, gpu.format, gpu.type, view);
  gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
  gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
  gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, alignment);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, flipY);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, premultiply);
  gl.bindTexture(gl.TEXTURE_2D, bound);
  return true;
};
