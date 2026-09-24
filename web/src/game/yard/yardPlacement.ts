import type { Sprite, Texture } from "pixi.js";
import type { ResolvedImage } from "./buildingArt";
import type { Rect } from "./YardGrid";
import { BuildingCondition, type YardBuilding } from "./yardModel";

/**
 * Turning a building's geometry into screen positions.
 *
 * Four small rules that `YardBuildings` uses and nothing else needs: where a
 * placeholder goes, where a real picture goes, whether a click landed on a
 * building, and what colour a building with no picture yet should be. They live
 * apart because none of them touches the draw list, the texture cache or the
 * culling — they are arithmetic on one building at a time.
 */

/** A placeholder fills its footprint box, whatever the picture would do. */
export const fillBox = (sprite: Sprite, box: Rect): void => {
  sprite.anchor.set(0, 0);
  sprite.position.set(box.x, box.y);
  sprite.width = box.width;
  sprite.height = box.height;
};

/**
 * Puts a real picture on a sprite.
 *
 * The offset in the art table is the bitmap's top-left corner relative to the
 * building's isometric origin, which is exactly what the Flash client set on
 * its Bitmap (`client/scripts/BFOUNDATION.as:1109-1111`, `:1250-1252`). So the
 * anchor goes back to the top-left and the size back to native.
 */
export const applyArt = (
  sprite: Sprite,
  texture: Texture,
  building: YardBuilding,
  image: ResolvedImage,
): void => {
  sprite.texture = texture;
  sprite.anchor.set(0, 0);
  sprite.scale.set(1);
  sprite.position.set(building.worldX + image.x, building.worldY + image.y);
};

/**
 * Whether a world point is inside a building's footprint diamond.
 *
 * The footprint rectangle starts at the building's origin and extends
 * positively on both axes (`client/scripts/BUILDING14.as:18`), so undoing the
 * isometric projection relative to that corner gives the two distances
 * directly.
 */
export const inDiamond = (building: YardBuilding, worldX: number, worldY: number): boolean => {
  const [width, height] = building.footprint;
  const dx = worldX - building.worldX;
  const dy = worldY - building.worldY;
  const alongWidth = dy + dx / 2;
  const alongHeight = dy - dx / 2;
  return alongWidth >= 0 && alongWidth <= width && alongHeight >= 0 && alongHeight <= height;
};

/** Whether a world point lies inside an axis-aligned box, edges included. */
export const inBox = (worldX: number, worldY: number, box: Rect): boolean =>
  worldX >= box.x && worldX <= box.x + box.width && worldY >= box.y && worldY <= box.y + box.height;

/** One resolved building's sprite box, for the picker's fallback pass below. */
export interface SpriteBoxCandidate {
  readonly building: YardBuilding;
  /** The top sprite's current world bounds: position (offset included) and size. */
  readonly box: Rect;
  /** Where this building's footprint currently sits: `box.y + offsetY`. */
  readonly footprintTop: number;
}

/**
 * Falls back to a building's sprite box when the footprint diamond test in
 * `YardBuildings.pick` finds nothing.
 *
 * Tall art — a Hatchery, a Monster Lab, a Storage Silo — reaches well above its
 * footprint, so a click on the upper body lands outside every diamond and
 * would otherwise read as grass (issue #41). Callers pass only resolved
 * buildings, topmost first (the draw list walked backwards): a placeholder's
 * sprite box is exactly its footprint (`fillBox`), so testing it here too
 * would turn a diamond miss on open ground into a false hit.
 *
 * A candidate only counts when its sprite rises above its own footprint
 * (`box.y < footprintTop`) and the point falls inside it — a building whose
 * art never reaches past its footprint has nothing this pass can add over the
 * diamond test that already missed it. Among what is left, the one whose
 * footprint sits closest below the click wins: when a tower stands behind a
 * tall building and both their sprite boxes cover the point, that is the
 * building whose body was most likely clicked, not whichever happens to be
 * nearer the camera. Ties, and the case where no footprint is below the click
 * at all, keep draw order — the first candidate (topmost) seeds the result and
 * only a strictly closer footprint replaces it.
 */
export const pickBySpriteBox = (
  worldX: number,
  worldY: number,
  candidates: readonly SpriteBoxCandidate[],
): YardBuilding | null => {
  let best: YardBuilding | null = null;
  let bestBelow = Infinity;

  for (const { building, box, footprintTop } of candidates) {
    if (box.y >= footprintTop || !inBox(worldX, worldY, box)) continue;

    const below = footprintTop - worldY;
    if (best === null || (below >= 0 && (bestBelow < 0 || below < bestBelow))) {
      best = building;
      bestBelow = below;
    }
  }

  return best;
};

/** Placeholder colour: enough to tell a wrecked building from a healthy one. */
export const placeholderTint = (building: YardBuilding): number =>
  building.condition === BuildingCondition.DESTROYED
    ? 0x8a4a4a
    : building.condition === BuildingCondition.DAMAGED
      ? 0xb08a4a
      : 0x6f8fb0;
