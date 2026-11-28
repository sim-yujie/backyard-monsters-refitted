import { Sprite, Texture } from "pixi.js";
import type { YardBuilding } from "./yardModel";

/**
 * Christmas: a soft dark patch on the snow under each building's footprint
 * (neon, 28 Nov 2026: "cool-toned traps, housing fences and silver building
 * caps camouflage into the snow ... add a tighter dark contact ring under
 * ground traps and light-toned buildings"). On grass the art's own shadow is
 * enough; on bright snow a pale trap or a silver dome loses its edge, so in
 * season every building but a wall block stands on one of these.
 *
 * Each patch belongs to its building's view (`YardBuildings.ts`): it hides,
 * fades and moves with the building, so a concealed trap shows no patch
 * either. Drawn as the art's shadows are (multiply, in the shadows layer),
 * from one small texture made on a canvas once: white outside, so a multiply
 * leaves the ground untouched there, darker towards the footprint's edge.
 */

/** Wall blocks (and the legacy wall) get none: a wall line already reads, and there are hundreds. */
const NO_PATCH: ReadonlySet<number> = new Set([17, 18]);

/**
 * The patch's size as a share of the footprint's box: a little past the
 * diamond's inscribed oval (about 0.71), so it hugs the base rather than
 * spreading a dark cloud between neighbours.
 */
export const CONTACT_REACH = 0.86;

/** Texture size, px. */
const SIZE = 64;

/** Whether a building stands on a snow contact patch. */
export const hasSnowContact = (building: Pick<YardBuilding, "type">): boolean => !NO_PATCH.has(building.type);

let shared: Texture | null = null;

/** The patch picture, drawn once and shared. Null where there is no canvas (tests). */
const contactTexture = (): Texture | null => {
  if (shared) return shared;
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const context = canvas.getContext("2d");
  if (!context) return null;
  const half = SIZE / 2;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, SIZE, SIZE);
  const patch = context.createRadialGradient(half, half, 0, half, half, half);
  // A cool slate, darkest just inside the footprint's edge, where the art meets the snow.
  patch.addColorStop(0, "#a3acb8");
  patch.addColorStop(0.7, "#9aa4b1");
  patch.addColorStop(0.85, "#c9d0d8");
  patch.addColorStop(1, "#ffffff");
  context.fillStyle = patch;
  context.fillRect(0, 0, SIZE, SIZE);
  shared = Texture.from(canvas);
  return shared;
};

/** The patch for `building`, laid on its footprint, or null for a wall or with no canvas. */
export const snowContactSprite = (building: YardBuilding): Sprite | null => {
  if (!hasSnowContact(building)) return null;
  const texture = contactTexture();
  if (!texture) return null;
  const sprite = new Sprite(texture);
  sprite.anchor.set(0.5);
  sprite.blendMode = "multiply";
  sprite.position.set(building.centreX, building.centreY);
  sprite.scale.set((building.box.width * CONTACT_REACH) / SIZE, (building.box.height * CONTACT_REACH) / SIZE);
  return sprite;
};
