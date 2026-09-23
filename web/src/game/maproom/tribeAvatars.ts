import { Assets, Rectangle, Texture } from "pixi.js";

/**
 * The four wild monster tribes' portrait art.
 *
 * Loaded once and shared by every camp on the map: a chunk never creates a
 * texture, it points another `Sprite` at one of these four. That is the same
 * bargain mapAtlas.ts strikes for the vector shapes, and it is what keeps a
 * screen of several thousand cells down to a handful of draw calls.
 *
 * ## Why the art is trimmed on load
 *
 * The PNGs are generated at 256 square with whatever transparent margin the
 * image model happened to leave, and that margin is not the same for every
 * tribe: one creature fills 66% of its frame, another 80%. Sizing a sprite by
 * its frame would therefore make one nominal height read as four visibly
 * different sizes. So each texture is measured once, here, and replaced by a
 * sub-texture of its opaque bounds. The sub-texture shares the uploaded image
 * — nothing is copied and no extra memory is used — and "62% of the hex" then
 * means 62% of *creature* for all four.
 *
 * ## Why /tribes/ and not /assets/tribes/
 *
 * The dev server proxies the whole `/assets` prefix to the game server
 * (vite.config.ts), which does not have these files, so anything under
 * `web/public/assets/` is unreachable in development. The folder therefore
 * sits directly under `web/public/`.
 */

/** Tribe name as it arrives on the wire (`cell.n`) to its file. */
const AVATAR_FILES: Record<string, string> = {
  Legionnaire: "legionnaire-256.png",
  Kozu: "kozu-256.png",
  Abunakki: "abunakki-256.png",
  Dreadnaut: "dreadnaut-256.png",
};

/**
 * Alpha at or below this counts as background when measuring the art.
 *
 * Not zero: the generated PNGs have a soft edge, and a one-pixel halo of
 * alpha 1 would defeat the whole measurement.
 */
const ALPHA_FLOOR = 8;

const urlFor = (file: string): string => `${import.meta.env.BASE_URL}tribes/${file}`;

export class TribeAvatars {
  private readonly textures = new Map<string, Texture>();
  private pending: Promise<boolean> | null = null;

  /** True once at least one portrait is on the GPU and ready to draw. */
  get ready(): boolean {
    return this.textures.size > 0;
  }

  /** The portrait for a tribe, or null while it is still on its way. */
  textureFor(tribe: string): Texture | null {
    return this.textures.get(tribe) ?? null;
  }

  /**
   * Fetches the art. Idempotent, and resolves true when anything arrived.
   *
   * The caller decides what to do with that answer; nothing here touches the
   * map, so a failed load simply leaves the tent glyphs in place.
   */
  load(): Promise<boolean> {
    this.pending ??= this.loadOnce();
    return this.pending;
  }

  /**
   * Drops the sub-textures this made.
   *
   * The uploaded images stay in the `Assets` cache, so leaving the map and
   * coming back re-wraps them rather than re-downloading and re-decoding.
   */
  destroy(): void {
    for (const texture of this.textures.values()) texture.destroy(false);
    this.textures.clear();
    this.pending = null;
  }

  private async loadOnce(): Promise<boolean> {
    // One request per tribe rather than a single `Assets.load` of all four: a
    // missing file should cost that tribe its portrait, not cost all of them.
    await Promise.all(
      Object.entries(AVATAR_FILES).map(async ([tribe, file]) => {
        try {
          const texture = await Assets.load<Texture>(urlFor(file));
          this.textures.set(tribe, trim(texture));
        } catch (caught) {
          console.warn(`Tribe avatar ${file} did not load; keeping the tent glyph.`, caught);
        }
      }),
    );
    return this.textures.size > 0;
  }
}

/** A view of the same image cropped to the pixels that are actually drawn. */
const trim = (texture: Texture): Texture => {
  const source = texture.source;
  const bounds = opaqueBounds(texture);
  return new Texture({
    source,
    frame: bounds ?? new Rectangle(0, 0, source.pixelWidth, source.pixelHeight),
  });
};

/** The smallest rectangle containing every pixel that is not background. */
const opaqueBounds = (texture: Texture): Rectangle | null => {
  const width = texture.source.pixelWidth;
  const height = texture.source.pixelHeight;
  const pixels = readPixels(texture, width, height);
  if (!pixels) return null;

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    const rowStart = y * width * 4;
    for (let x = 0; x < width; x++) {
      if ((pixels[rowStart + x * 4 + 3] ?? 0) <= ALPHA_FLOOR) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      maxY = y;
    }
  }

  if (maxX < minX || maxY < minY) return null;
  return new Rectangle(minX, minY, maxX - minX + 1, maxY - minY + 1);
};

/**
 * Reads the decoded image back through a 2D canvas.
 *
 * Four 256 square reads at startup, once per session. Doing it here rather
 * than baking the crop into the PNGs means the art can be regenerated without
 * anyone having to remember a trimming step.
 */
const readPixels = (
  texture: Texture,
  width: number,
  height: number,
): Uint8ClampedArray | null => {
  const resource = texture.source.resource as CanvasImageSource | null | undefined;
  if (!resource || typeof document === "undefined") return null;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;

  try {
    context.drawImage(resource, 0, 0, width, height);
    return context.getImageData(0, 0, width, height).data;
  } catch (caught) {
    console.warn("Could not measure a tribe avatar; using its whole frame.", caught);
    return null;
  }
};
