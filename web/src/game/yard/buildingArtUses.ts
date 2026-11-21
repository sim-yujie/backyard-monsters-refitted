import { setClassicLook, classicLook } from "@/game/classicLook";
import { artPath } from "@/artUrl";
import {
  artTypes,
  resolveArt,
  ArtState,
  type ResolvedImage,
  type ResolvedAnim,
} from "./buildingArt";
import { fortArtFor } from "./fortArt";

/**
 * Every Modern `@2x` building picture the yard can ask for, and how it is
 * cut (beta 9): for `web/tools/building-copies/` (which makes the Low and
 * Medium copies) and the test that checks every such picture has them. Not
 * used by the game itself.
 */
export interface BuildingArtUse {
  /** Drawn whole (a top, a shadow, a still, a fortification). */
  whole: boolean;
  /** Drawn by its first cell, at this size. */
  frames: { w: number; h: number }[];
  /** Cut into cells as a strip. */
  strips: { w: number; h: number; frames: number; columns: number | null }[];
}

/** By path under the server's `public/` (`assets/buildings/...@2x.webp`). */
export const modernBuildingArtUses = (): Map<string, BuildingArtUse> => {
  const uses = new Map<string, BuildingArtUse>();
  const useOf = (url: string): BuildingArtUse | null => {
    const path = artPath(url).replace(/^\//, "").replace(/\?.*$/, "");
    if (!path.startsWith("assets/buildings/") || !/@2x\.\w+$/.test(path)) return null;
    let use = uses.get(path);
    if (!use) uses.set(path, (use = { whole: false, frames: [], strips: [] }));
    return use;
  };
  const same = <T>(list: T[], item: T): boolean =>
    list.some((one) => JSON.stringify(one) === JSON.stringify(item));
  const image = (img: ResolvedImage | null | undefined): void => {
    const use = img ? useOf(img.url) : null;
    if (!img || !use) return;
    if (!img.frame) use.whole = true;
    else if (!same(use.frames, { w: img.frame.width, h: img.frame.height }))
      use.frames.push({ w: img.frame.width, h: img.frame.height });
  };
  const strip = (anim: ResolvedAnim): void => {
    const use = useOf(anim.url);
    const cut = {
      w: anim.width,
      h: anim.height,
      frames: anim.frames,
      columns: anim.columns ?? null,
    };
    if (use && !same(use.strips, cut)) use.strips.push(cut);
  };

  const wasClassic = classicLook();
  setClassicLook(false);
  try {
    for (const kind of ["main", "inferno"] as const) {
      for (const type of artTypes()) {
        for (let level = 0; level <= 12; level++) {
          for (const state of [ArtState.DEFAULT, ArtState.DAMAGED, ArtState.DESTROYED]) {
            const art = resolveArt(type, level, state, kind);
            if (!art) continue;
            image(art.top);
            image(art.shadow);
            image(art.still);
            for (const anim of art.anims) strip(anim);
          }
        }
        for (let fort = 1; fort <= 4; fort++) {
          const pair = fortArtFor(type, fort);
          image(pair?.front);
          image(pair?.back);
        }
      }
    }
  } finally {
    setClassicLook(wasClassic);
  }
  return new Map([...uses].sort(([a], [b]) => (a < b ? -1 : 1)));
};
