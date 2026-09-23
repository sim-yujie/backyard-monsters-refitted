import { Assets, Rectangle, Texture } from "pixi.js";
import type { ResolvedAnim, ResolvedImage } from "./buildingArt";
import { stripCells } from "./yardAnim";

/**
 * Textures for the yard, fetched once per URL and shared by every building that
 * wants them.
 *
 * A full yard is under a hundred distinct images even at 575 buildings, because
 * four hundred of those are walls sharing one picture. So the cache is a plain
 * map with no eviction: it is bounded by the art table, not by the yard.
 *
 * `get` never blocks and never throws. It returns a texture if one is ready,
 * starts the fetch if it has not begun, and returns null meanwhile — the
 * renderer draws a placeholder until `onReady` says otherwise. A URL that fails
 * is remembered as failed so a broken file is requested once, not every frame,
 * which matters because `draw` runs sixty times a second.
 *
 * `strip` is the same bargain for animation layers: one base texture per file,
 * cut into one sub-texture per cell, cached under the strip's own key. Every
 * sniper tower in the yard therefore shares one array of thirty textures rather
 * than cutting its own.
 */
export class YardTextures {
  private readonly ready = new Map<string, Texture>();
  private readonly strips = new Map<string, Texture[]>();
  private readonly pending = new Map<string, Promise<void>>();
  private readonly failed = new Set<string>();

  /** Called once per texture that arrives, so the renderer knows to redraw. */
  constructor(private readonly onReady: (key: string) => void) {}

  /**
   * The texture for an image, requesting it if this is the first ask.
   *
   * An image with a frame is an animation strip, and only its first cell is
   * wanted; the sub-texture shares the uploaded image, so the strip is
   * downloaded and decoded once however many buildings use it.
   */
  get(image: ResolvedImage): Texture | null {
    const key = keyFor(image);

    const cached = this.ready.get(key);
    if (cached) return cached;
    if (this.failed.has(key) || this.pending.has(key)) return null;

    const frame = image.frame;
    this.pending.set(
      key,
      Assets.load<Texture>(image.url)
        .then((texture) => {
          this.ready.set(
            key,
            frame
              ? new Texture({
                  source: texture.source,
                  frame: new Rectangle(0, 0, frame.width, frame.height),
                })
              : texture,
          );
          this.onReady(key);
        })
        .catch((caught: unknown) => {
          console.warn(`Building art ${image.url} did not load; drawing a placeholder.`, caught);
          this.failed.add(key);
        })
        .finally(() => {
          this.pending.delete(key);
        }),
    );

    return null;
  }

  /**
   * The cells of an animation strip, or null until the file has arrived.
   *
   * Cut once per strip and shared: `Texture` objects over one `TextureSource`
   * cost a frame rectangle each and no GPU memory of their own, so thirty of
   * them is cheaper than the alternative of thirty base textures.
   */
  strip(anim: ResolvedAnim): Texture[] | null {
    const key = `${anim.url}#${anim.width}x${anim.height}x${anim.frames}`;

    const cached = this.strips.get(key);
    if (cached) return cached;
    if (this.failed.has(key) || this.pending.has(key)) return null;

    this.pending.set(
      key,
      Assets.load<Texture>(anim.url)
        .then((texture) => {
          // Fitted to the file rather than trusted: nine strips in the props
          // table describe an image the server does not have. See `stripCells`.
          const cut = stripCells(anim, texture.source.width, texture.source.height);
          const cells: Texture[] = [];
          for (let i = 0; i < cut.frames; i++) {
            cells.push(
              new Texture({
                source: texture.source,
                frame: new Rectangle(i * cut.width, 0, cut.width, cut.height),
              }),
            );
          }
          this.strips.set(key, cells);
          this.onReady(key);
        })
        .catch((caught: unknown) => {
          console.warn(`Building animation ${anim.url} did not load; skipping the layer.`, caught);
          this.failed.add(key);
        })
        .finally(() => {
          this.pending.delete(key);
        }),
    );

    return null;
  }

  /** True once this strip is known not to be coming. */
  isStripMissing(anim: ResolvedAnim): boolean {
    return this.failed.has(`${anim.url}#${anim.width}x${anim.height}x${anim.frames}`);
  }

  /** True once this image is known not to be coming. */
  isMissing(image: ResolvedImage): boolean {
    return this.failed.has(keyFor(image));
  }

  /** How many distinct images failed. The scene reports it. */
  get missingCount(): number {
    return this.failed.size;
  }

  /**
   * Drops the sub-textures this made and forgets the failures.
   *
   * Whole images stay in the `Assets` cache, so leaving the yard and coming
   * back re-uses them instead of re-downloading.
   */
  destroy(): void {
    for (const [key, texture] of this.ready) {
      // Only the strip sub-textures are ours to destroy; a whole image belongs
      // to the Assets cache and may still be wanted by another screen.
      if (key.includes("#")) texture.destroy(false);
    }
    for (const cells of this.strips.values()) {
      for (const cell of cells) cell.destroy(false);
    }
    this.strips.clear();
    this.ready.clear();
    this.failed.clear();
    this.pending.clear();
  }
}

const keyFor = (image: ResolvedImage): string =>
  image.frame ? `${image.url}#${image.frame.width}x${image.frame.height}` : image.url;
