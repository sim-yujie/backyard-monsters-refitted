import { BUILDING_ART_ROWS } from "./buildingArtData";
import type { TierArt, TierImage, TierState } from "./buildingArtTiers";

/**
 * The Modern look of Flash's own decorations (owner, 10 Nov 2026: "when i say
 * assets, im referring to decorative assets that currently exist in flash as
 * well"). Each is the same object as Flash's picture, redrawn by Codex as a
 * clean 3D render like the Modern buildings (branch art/autumn-decor-modern,
 * `art-samples/autumn-decor/modern/pilot`, the game-art skill), at the Flash
 * picture's height, standing on the same spot (its bottom and centre measured
 * by the skill's `flash_anchor.py`), in the decoration's own folder as
 * `<name>.modern@2x.webp`.
 *
 * Read by `tierArtFor` (`buildingArtTiers.ts`) like a 3D building's look: with
 * the Modern look the yard draws these, with Classic the Flash rows; the build
 * menu's Modern picture is made from them by `web/tools/build-pictures/make.py`.
 *
 * A pilot first (the owner approves the style before the rest are made): one
 * of each kind and size. A decoration whose Flash picture has moving parts (a
 * flag's cloth, the Tiki Torch's flame) keeps Flash's strip over its new
 * still, and Flash's shadow, which is the moving part's too.
 */

/** One Modern look for every level; a still one keeps it when damaged or destroyed (a decoration has no wreck). */
export const modernLook = (top: TierImage, shadow: TierImage): readonly TierArt[] => {
  const still: TierState = { top, shadow };
  return [{ from: 1, top, shadow, lift: 0, damaged: still, destroyed: still }];
};

/** A Modern still under the Flash row's own moving strips (the flags' cloth, the torch's flame) and Flash's shadow. */
const modernUnderFlashAnim = (type: number, top: TierImage): readonly TierArt[] => {
  const level = BUILDING_ART_ROWS.find((row) => row[0] === type)?.[3][0];
  const anims = level?.[7] ?? [];
  const shadow = level?.[4];
  const [strip, ...more] = anims;
  if (!strip || !shadow) throw new Error(`type ${type} has no Flash strip or shadow to keep`);
  const flashShadow: TierImage = [shadow[0], shadow[1], shadow[2]];
  // Destroyed, Flash shows the still without its strip (a bare pole, an unlit torch): so does this.
  return [{ from: 1, top, shadow: flashShadow, lift: 0, anim: { strip, ...(more.length ? { more } : {}) }, destroyed: { top, shadow: flashShadow } }];
};

/** Every flag: one pole, each with its own Flash cloth. */
const FLAG_TYPES: readonly number[] = [28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50];
const FLAGPOLE: TierImage = ["flagpole.modern@2x.webp", 0, -41];

export const DECORATION_MODERN_ART: Readonly<Record<number, readonly TierArt[]>> = {
  73: modernLook(["tombstone.modern@2x.webp", -22, -13], ["tombstone.modern-shadow.jpg", -20, 18]),
  65: modernLook(["outhouse.modern@2x.webp", -14, -19], ["outhouse.modern-shadow.jpg", -9, 10]),
  87: modernLook(["bonsai-tree.modern@2x.webp", -38, -36], ["bonsai-tree.modern-shadow.jpg", -23, 7]),
  93: modernLook(["red-flowers.modern@2x.webp", -16, -21], ["red-flowers.modern-shadow.jpg", -8, 2]),
  98: modernLook(["soccer-trophy.modern@2x.webp", -20, -36], ["soccer-trophy.modern-shadow.jpg", -13, 10]),
  99: modernLook(["statue-liberty.modern@2x.webp", -35, -117], ["statue-liberty.modern-shadow.jpg", -27, 6]),
  110: modernLook(["dave-pumpkin.modern@2x.webp", -24, -32], ["dave-pumpkin.modern-shadow.jpg", -19, 13]),
  71: modernUnderFlashAnim(71, ["tiki-torch.modern@2x.webp", -10, -38]),
  ...Object.fromEntries(FLAG_TYPES.map((type) => [type, modernUnderFlashAnim(type, FLAGPOLE)])),
};
