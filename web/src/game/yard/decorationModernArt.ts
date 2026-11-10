import { type ArtAnim, BUILDING_ART_ROWS } from "./buildingArtData";
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

/** One Modern look per level, `[top, shadow]` from level 1 up (the Victory Totem Poles' six). */
const modernLevels = (levels: readonly (readonly [TierImage, TierImage])[]): readonly TierArt[] =>
  levels.map(([top, shadow], i) => {
    const still: TierState = { top, shadow };
    return { from: i + 1, top, shadow, lift: 0, damaged: still, destroyed: still };
  });

/**
 * A Modern still under the Flash row's own moving strips (the flags' cloth, the torch's flame) and Flash's
 * shadow; `ownStrip` stands in for the row's when Flash's strip is the whole object (the Fountain: its water,
 * cut from Flash's frames by `art-samples/autumn-decor/modern/full/fountain.py`).
 */
const modernUnderFlashAnim = (type: number, top: TierImage, ownStrip?: ArtAnim): readonly TierArt[] => {
  const level = BUILDING_ART_ROWS.find((row) => row[0] === type)?.[3][0];
  const anims = ownStrip ? [ownStrip] : (level?.[7] ?? []);
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
  // The full set, batch f1: Heads on sticks (1/2).
  107: modernLook(["skull.modern@2x.webp", -7, -38], ["skull.modern-shadow.jpg", -1, -3]),
  74: modernLook(["pokey.modern@2x.webp", -7, -28], ["pokey.modern-shadow.jpg", -5, 2]),
  75: modernLook(["octo.modern@2x.webp", -4, -23], ["octo.modern-shadow.jpg", -3, 3]),
  76: modernLook(["bolt.modern@2x.webp", -9, -23], ["bolt.modern-shadow.jpg", -7, 5]),
  77: modernLook(["bandito.modern@2x.webp", -6, -26], ["bandito.modern-shadow.jpg", -5, 3]),
  78: modernLook(["brain.modern@2x.webp", -8, -28], ["brain.modern-shadow.jpg", -6, 2]),
  // The full set, batch f3: Small things.
  80: modernLook(["dave-head.modern@2x.webp", -12, -30], ["dave-head.modern-shadow.jpg", -9, 4]),
  111: modernLook(["mini-pumpkin.modern@2x.webp", -10, -4], ["mini-pumpkin.modern-shadow.jpg", -8, 9]),
  59: modernLook(["jax.modern@2x.webp", -10, -11], ["jax.modern-shadow.jpg", -8, 8]),
  67: modernLook(["rock.modern@2x.webp", -14, 0], ["rock.modern-shadow.jpg", -13, 13]),
  72: modernLook(["walnut.modern@2x.webp", -12, -2], ["walnut.modern-shadow.jpg", -10, 14]),
  55: modernLook(["acorn.modern@2x.webp", -10, -9], ["acorn.modern-shadow.jpg", -8, 11]),
  // The full set, batch f4: Plants.
  66: modernLook(["pinecone.modern@2x.webp", -14, -10], ["pinecone.modern-shadow.jpg", -11, 11]),
  69: modernLook(["scarecrow.modern@2x.webp", -27, -43], ["scarecrow.modern-shadow.jpg", -15, 8]),
  90: modernLook(["thorns.modern@2x.webp", -25, -18], ["thorns.modern-shadow.jpg", -22, 15]),
  86: modernLook(["blackberry-bush.modern@2x.webp", -25, -12], ["blackberry-bush.modern-shadow.jpg", -19, 19]),
  88: modernLook(["cactus.modern@2x.webp", -14, -30], ["cactus.modern-shadow.jpg", -8, 3]),
  56: modernLook(["beehive.modern@2x.webp", -20, -15], ["beehive.modern-shadow.jpg", -18, 16]),
  // The full set, batch f5: Flowers, Bird House, Sun Dial.
  91: modernLook(["pink-flowers.modern@2x.webp", -16, -21], ["pink-flowers.modern-shadow.jpg", -9, 2]),
  92: modernLook(["purple-flowers.modern@2x.webp", -16, -21], ["purple-flowers.modern-shadow.jpg", -9, 2]),
  94: modernLook(["white-flowers.modern@2x.webp", -16, -21], ["white-flowers.modern-shadow.jpg", -9, 2]),
  95: modernLook(["yellow-flowers.modern@2x.webp", -16, -21], ["yellow-flowers.modern-shadow.jpg", -9, 2]),
  57: modernLook(["bird-house.modern@2x.webp", -16, -45], ["bird-house.modern-shadow.jpg", -4, 1]),
  70: modernLook(["sundial.modern@2x.webp", -22, -6], ["sundial.modern-shadow.jpg", -18, 20]),
  // The full set, batch f6: Good: tent, hammock, chair, cubes, gnome.
  58: modernLook(["camping-tent.modern@2x.webp", -30, -12], ["camping-tent.modern-shadow.jpg", -24, 20]),
  63: modernLook(["hammock.modern@2x.webp", -22, -8], ["hammock.modern-shadow.jpg", -16, 18]),
  64: modernLook(["lawn-chair.modern@2x.webp", -22, -14], ["lawn-chair.modern-shadow.jpg", -19, 17]),
  108: modernLook(["cube-unsolved.modern@2x.webp", -18, -22], ["cube-unsolved.modern-shadow.jpg", -14, 7]),
  109: modernLook(["cube-solved.modern@2x.webp", -18, -22], ["cube-solved.modern-shadow.jpg", -14, 7]),
  60: modernLook(["gnome-red.modern@2x.webp", -10, -31], ["gnome-red.modern-shadow.jpg", -9, 1]),
};
