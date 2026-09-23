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

/** Placeholder colour: enough to tell a wrecked building from a healthy one. */
export const placeholderTint = (building: YardBuilding): number =>
  building.condition === BuildingCondition.DESTROYED
    ? 0x8a4a4a
    : building.condition === BuildingCondition.DAMAGED
      ? 0xb08a4a
      : 0x6f8fb0;
