import { AnimatedSprite, Texture } from "pixi.js";
import type { ResolvedAnim, ResolvedArt } from "./buildingArt";
import { animPolicy, startFrame, YARD_TICK_HZ, type AnimPolicy } from "./yardAnim";
import type { YardBuilding } from "./yardModel";
import type { YardTextures } from "./YardTextures";

/**
 * The animation layers of one building: making them, feeding them art and
 * advancing them.
 *
 * Split out of `YardBuildings` because it is the one part of a building that
 * has state between frames. Everything else about a read-only yard is decided
 * when the save is parsed; which cell of a strip is showing is not.
 *
 * The rate and the starting cell come from `yardAnim.ts`, which is where the
 * Flash client's per-class tick conditions are written down. Nothing here
 * decides how fast anything runs.
 */

export interface AnimLayer {
  readonly anim: ResolvedAnim;
  readonly sprite: AnimatedSprite;
  readonly policy: AnimPolicy;
  /**
   * Frames advanced since the strip started, with the fraction of the way to
   * the next cell kept in the decimal part.
   *
   * One number rather than a counter plus an accumulator, so a long frame
   * advances by however many cells it should have instead of by one.
   */
  progress: number;
  /** True once the strip's cells are on the sprite. */
  resolved: boolean;
}

/**
 * A type with animation layers but no entry in the rate table holds its first
 * cell, which is what the Flash client's base `TickFast` does — nothing
 * (`client/scripts/BFOUNDATION.as:1486-1487`).
 */
const HOLD: AnimPolicy = { ticksPerFrame: null, randomStart: true, pauseWhileBusy: false };

/**
 * The layers for one building, as sprites ready to go into the scene.
 *
 * They come back in the order they stack — `anim`, then `anim2`, then `anim3` —
 * and the caller adds them straight after that building's top sprite, which is
 * what puts them above their own building and below the next one in depth
 * order. They start invisible, because a strip is a separate fetch from the top
 * and an empty sprite in the right place beats a flash of nothing.
 */
export const buildAnimLayers = (building: YardBuilding, art: ResolvedArt): AnimLayer[] => {
  const chosen = animPolicy(building.type) ?? HOLD;
  // A producer mid-build or mid-upgrade shows its animation layer but does not
  // run it, which is what the countdown guard in each class's `TickFast` does.
  const policy =
    chosen.pauseWhileBusy && building.countdown ? { ...chosen, ticksPerFrame: null } : chosen;

  return art.anims.map((anim) => {
    const sprite = new AnimatedSprite([Texture.EMPTY]);
    sprite.autoUpdate = false;
    sprite.anchor.set(0, 0);
    sprite.visible = false;
    sprite.position.set(building.worldX + anim.x, building.worldY + anim.y);
    return {
      anim,
      sprite,
      policy,
      progress: startFrame(policy, anim.frames, building.id),
      resolved: false,
    };
  });
};

/**
 * Swaps in whichever strips have arrived, and says whether any are still
 * outstanding.
 *
 * `textures.strip` starts the fetch on the first ask and returns null until it
 * lands, so this is safe to call every frame; the caller stops asking once it
 * returns false. A strip that failed is left unresolved for ever and its sprite
 * stays hidden, which for a tower means a base with no gun — the same thing
 * this client did before, and better than a hole where the building was.
 */
export const resolveAnimLayers = (
  layers: readonly AnimLayer[],
  textures: YardTextures,
): boolean => {
  let waiting = false;

  for (const layer of layers) {
    if (layer.resolved || textures.isStripMissing(layer.anim)) continue;

    const cells = textures.strip(layer.anim);
    if (!cells) {
      waiting = true;
      continue;
    }

    // The cut may hold fewer cells than the props table claimed — see
    // `stripCells` — so the starting cell is folded back into what exists
    // rather than clamped, which would pile every over-count strip on its last
    // frame.
    layer.sprite.textures = cells;
    layer.progress = layer.progress % cells.length;
    layer.sprite.currentFrame = Math.floor(layer.progress);
    layer.resolved = true;
  }

  return waiting;
};

/**
 * Moves every layer on by however much of a second has passed.
 *
 * A policy with no rate — every tower, and the handful of buildings whose strip
 * runs only while something is happening — is skipped, so it holds the cell it
 * started on. Setting `currentFrame` to what it already is costs nothing: Pixi
 * compares the index before it touches the texture.
 */
export const advanceAnimLayers = (layers: readonly AnimLayer[], seconds: number): void => {
  for (const layer of layers) {
    const ticksPerFrame = layer.policy.ticksPerFrame;
    if (ticksPerFrame === null || !layer.resolved) continue;

    // `totalFrames`, not the table's count: the strip was cut to fit its file.
    const frames = layer.sprite.totalFrames;
    layer.progress = (layer.progress + (seconds * YARD_TICK_HZ) / ticksPerFrame) % frames;
    layer.sprite.currentFrame = Math.floor(layer.progress);
  }
};
