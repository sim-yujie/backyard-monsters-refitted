import { Assets, type Texture } from "pixi.js";

/**
 * A picture drawn beside the player's own outpost on the map, fetched once and
 * shared by every chunk. Until it arrives (or if it never does) nothing is drawn.
 *
 * - Modern's construction badge (owner, 29 Oct 2026): a painted sign shown while
 *   something is being built, upgraded or fortified there.
 * - Classic's idle helper: Flash's blue helper, redrawn sharp (owner, 5 Nov 2026),
 *   shown while a helper there is free, the opposite of the badge.
 * - The friend marker (beta 7): the painted two monster heads beside a friend's
 *   building, on anyone's cell.
 */
const BASE = `${import.meta.env.BASE_URL}maproom/`;
export const CONSTRUCTION_BADGE_URL = `${BASE}construction@2x.webp`;
export const IDLE_HELPER_URL = `${BASE}idle-helper@4x.webp`;
/** The painted friend marker (beta 7), beside a friend's building in both looks; the same picture as the HUD's `friends` icon. */
export const FRIEND_BADGE_URL = `${import.meta.env.BASE_URL}ui/icons/friends-64.webp`;

export class MapPicture {
  private loaded: Texture | null = null;
  private pending: Promise<boolean> | null = null;

  /** `mipmaps` keeps a picture clean when it is drawn much smaller than it is stored. */
  constructor(
    private readonly url: string,
    private readonly mipmaps = false,
  ) {}

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
      this.loaded = await Assets.load<Texture>({ src: this.url, data: { autoGenerateMipmaps: this.mipmaps } });
      return true;
    } catch (caught) {
      console.warn(`The map picture ${this.url} did not load; it is not shown.`, caught);
      return false;
    }
  }
}
