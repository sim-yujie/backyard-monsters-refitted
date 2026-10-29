import { Assets, type Texture } from "pixi.js";

/**
 * Modern's construction badge (owner, 29 Oct 2026): a painted sign beside
 * the player's own outpost while something is being built, upgraded or
 * fortified there. It replaces Flash's idle-worker blob, which meant the
 * opposite (the worker is free); Classic keeps the blob.
 *
 * One @2x picture, fetched once and shared by every chunk. Until it arrives
 * (or if it never does) no badge is drawn.
 */
const BADGE_URL = `${import.meta.env.BASE_URL}maproom/construction@2x.webp`;

export class ConstructionBadge {
  private loaded: Texture | null = null;
  private pending: Promise<boolean> | null = null;

  /** The picture, or null while it is still on its way. */
  get texture(): Texture | null {
    return this.loaded;
  }

  /** Fetches the picture. Idempotent, and resolves true once it arrived. */
  load(): Promise<boolean> {
    this.pending ??= this.loadOnce();
    return this.pending;
  }

  /** Forgets the picture; the uploaded image stays in `Assets`' cache. */
  destroy(): void {
    this.loaded = null;
    this.pending = null;
  }

  private async loadOnce(): Promise<boolean> {
    try {
      this.loaded = await Assets.load<Texture>(BADGE_URL);
      return true;
    } catch (caught) {
      console.warn(`The map's construction badge (${BADGE_URL}) did not load; none is shown.`, caught);
      return false;
    }
  }
}
