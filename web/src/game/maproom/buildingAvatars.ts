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
 * The outpost core is always drawn at level 1. A main yard wears the Town Hall
 * picture for its owner's real Town Hall level (1-10, the server's `th`;
 * owner decision 2026-10-10), and the level-3 picture when that is unknown -
 * the Flash map never varied it. Every level is drawn at the same on-map
 * height by `MapChunk`, so the dome, star and name plate fit as before.
 * `buildingArt.ts`'s `resolveArt` is reused rather than hand-written paths, so
 * this reads the same `top.N.png` the yard screen itself would for those levels.
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

/** The Town Hall picture drawn when a cell's level is not known. */
export const YARD_FALLBACK_LEVEL = 3;
/** The highest Town Hall level there is art for. */
export const YARD_MAX_LEVEL = 10;
const OUTPOST_ART_LEVEL = 1;

/** The Town Hall picture level for a cell's `th`: itself within 1-10, else the fallback. */
export const yardArtLevel = (hallLevel: number | undefined): number => {
  const level = Math.floor(Number(hallLevel));
  if (!Number.isFinite(level) || level < 1) return YARD_FALLBACK_LEVEL;
  return Math.min(level, YARD_MAX_LEVEL);
};

/** The key a picture is kept under: one per Town Hall level, one for the outpost core. */
const keyOf = (kind: BuildingKind, hallLevel?: number): string =>
  kind === BuildingKind.OUTPOST ? kind : `${kind}:${yardArtLevel(hallLevel)}`;

const ART_TYPE: Record<BuildingKind, number> = {
  [BuildingKind.YARD]: hallTypeOf("main"),
  [BuildingKind.OUTPOST]: OUTPOST_CORE_TYPE,
};

export class BuildingAvatars {
  private readonly textures = new Map<string, Texture>();
  private pending: Promise<boolean> | null = null;

  /** True once at least one picture is on the GPU and ready to draw. */
  get ready(): boolean {
    return this.textures.size > 0;
  }

  /**
   * The picture for a kind, or null while it is still on its way. A main yard
   * takes its Town Hall level; a level whose picture failed to load falls back
   * to the level-3 one.
   */
  textureFor(kind: BuildingKind, hallLevel?: number): Texture | null {
    return (
      this.textures.get(keyOf(kind, hallLevel)) ??
      (kind === BuildingKind.YARD ? this.textures.get(keyOf(kind, YARD_FALLBACK_LEVEL)) : undefined) ??
      null
    );
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
    const wanted: { key: string; type: number; level: number }[] = [
      { key: keyOf(BuildingKind.OUTPOST), type: ART_TYPE[BuildingKind.OUTPOST], level: OUTPOST_ART_LEVEL },
    ];
    for (let level = 1; level <= YARD_MAX_LEVEL; level++) {
      wanted.push({ key: keyOf(BuildingKind.YARD, level), type: ART_TYPE[BuildingKind.YARD], level });
    }
    await Promise.all(
      wanted.map(async ({ key, type, level }) => {
        const art = resolveArt(type, level, "");
        if (!art) return;
        try {
          const texture = await Assets.load<Texture>(art.top.url);
          this.textures.set(key, trim(texture));
        } catch (caught) {
          console.warn(`Building picture ${art.top.url} did not load; its markers stay plain.`, caught);
        }
      }),
    );
    return this.textures.size > 0;
  }
}
