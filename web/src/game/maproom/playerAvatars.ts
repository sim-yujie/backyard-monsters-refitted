import { Texture } from "pixi.js";
import { AVATARS, avatarUrl, type AvatarId } from "@/game/avatars";

/**
 * The players' critters (#175) as round textures for the map's markers
 * (#176, R-MR2-Map-A: a round picture ringed in white, cyan for the player's
 * own).
 *
 * The art is square with its own background, so each picture is drawn once
 * into a canvas through a circular clip and that canvas becomes the texture:
 * twelve small textures shared by every marker, and no per-sprite mask. The
 * 64 px copies are used; a marker is never drawn larger than that.
 *
 * Like the tribe portraits (`tribeAvatars.ts`), this is a network fetch that
 * arrives whenever it arrives: the markers show their ring and fill without a
 * picture until then, and the renderer rebuilds once it lands.
 */

/** Texels across a baked picture. */
const SIZE = 64;

export class PlayerAvatars {
  private readonly textures = new Map<AvatarId, Texture>();
  private pending: Promise<boolean> | null = null;

  get ready(): boolean {
    return this.textures.size > 0;
  }

  /** The round picture for a critter, or null while it is on its way. */
  textureFor(id: AvatarId | null): Texture | null {
    return id ? (this.textures.get(id) ?? null) : null;
  }

  /** Fetches the art. Idempotent; resolves true when anything arrived. */
  load(): Promise<boolean> {
    this.pending ??= this.loadOnce();
    return this.pending;
  }

  destroy(): void {
    for (const texture of this.textures.values()) texture.destroy(true);
    this.textures.clear();
    this.pending = null;
  }

  private async loadOnce(): Promise<boolean> {
    if (typeof document === "undefined") return false;
    await Promise.all(
      AVATARS.map(async ({ id }) => {
        try {
          const canvas = roundPicture(await loadImage(avatarUrl(id, "small")));
          if (canvas) this.textures.set(id, Texture.from(canvas));
        } catch (caught) {
          console.warn(`Player avatar ${id} did not load; its markers stay plain.`, caught);
        }
      }),
    );
    return this.textures.size > 0;
  }
}

const loadImage = (url: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`could not load ${url}`));
    image.src = url;
  });

/** The picture cut to a circle, as a canvas. */
const roundPicture = (image: HTMLImageElement): HTMLCanvasElement | null => {
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.beginPath();
  context.arc(SIZE / 2, SIZE / 2, SIZE / 2, 0, Math.PI * 2);
  context.clip();
  context.drawImage(image, 0, 0, SIZE, SIZE);
  return canvas;
};
