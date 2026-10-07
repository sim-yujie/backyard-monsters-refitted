import { Assets, type Texture } from "pixi.js";
import { hallTypeOf, OUTPOST_CORE_TYPE } from "@/game/yard/buildingCosts";
import { resolveArt } from "@/game/yard/buildingArt";
import { trim } from "./tribeAvatars";

/**
 * The two building pictures a player's hex wears on Map Room 2 (issue #334,
 * owner decision 2026-10-07: "building art per hex" rather than a round
 * critter marker): the Town Hall for a main yard, the outpost core for an
 * outpost.
 *
 * Both are drawn at one fixed level - 3 for the Town Hall, 1 for the outpost
 * core - regardless of the owner's real building level, exactly as the Flash
 * map always showed the same picture whatever a player's town hall level.
 * `buildingArt.ts`'s `resolveArt` is reused rather than hand-written paths, so
 * this reads the same `top.3.png` / `top.1.png` the yard screen itself would
 * for those levels.
 *
 * Loaded and trimmed the same way as the tribe portraits (`tribeAvatars.ts`):
 * fetched once, shared by every marker, and cut to a sub-texture of their
 * opaque pixels so the PNG's transparent margin does not throw off the size a
 * sprite is drawn at.
 */

export const BuildingKind = {
  YARD: "yard",
  OUTPOST: "outpost",
} as const;
export type BuildingKind = (typeof BuildingKind)[keyof typeof BuildingKind];

/** The fixed `resolveArt` level each kind is always drawn at - not the owner's real level. */
const ART_LEVEL: Record<BuildingKind, number> = {
  [BuildingKind.YARD]: 3,
  [BuildingKind.OUTPOST]: 1,
};

const ART_TYPE: Record<BuildingKind, number> = {
  [BuildingKind.YARD]: hallTypeOf("main"),
  [BuildingKind.OUTPOST]: OUTPOST_CORE_TYPE,
};

export class BuildingAvatars {
  private readonly textures = new Map<BuildingKind, Texture>();
  private pending: Promise<boolean> | null = null;

  /** True once at least one picture is on the GPU and ready to draw. */
  get ready(): boolean {
    return this.textures.size > 0;
  }

  /** The picture for a kind, or null while it is still on its way. */
  textureFor(kind: BuildingKind): Texture | null {
    return this.textures.get(kind) ?? null;
  }

  /** Fetches the art. Idempotent, and resolves true when anything arrived. */
  load(): Promise<boolean> {
    this.pending ??= this.loadOnce();
    return this.pending;
  }

  /** Drops the sub-textures this made; the uploaded images stay in `Assets`' cache. */
  destroy(): void {
    for (const texture of this.textures.values()) texture.destroy(false);
    this.textures.clear();
    this.pending = null;
  }

  private async loadOnce(): Promise<boolean> {
    await Promise.all(
      (Object.values(BuildingKind) as BuildingKind[]).map(async (kind) => {
        const art = resolveArt(ART_TYPE[kind], ART_LEVEL[kind], "");
        if (!art) return;
        try {
          const texture = await Assets.load<Texture>(art.top.url);
          this.textures.set(kind, trim(texture));
        } catch (caught) {
          console.warn(`Building picture ${art.top.url} did not load; its markers stay plain.`, caught);
        }
      }),
    );
    return this.textures.size > 0;
  }
}
