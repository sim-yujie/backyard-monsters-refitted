import type { Container } from "pixi.js";
import type { Camera } from "@/game/Camera";
import type { Yard } from "@/game/yard/yardModel";
import type { YardRenderer } from "@/game/yard/YardRenderer";
import type { Notices } from "@/ui/maproom/Notices";
import type { AttackSession } from "./AttackSession";
import type { AttackTarget } from "./attackTarget";

/**
 * The registry the attack scene mounts packages from (issue #32, WP3–WP6).
 *
 * Kept apart from `AttackScene.ts` on purpose: each package's stub under
 * `./plugins/` pushes onto {@link ATTACK_PLUGINS} at module load, and the scene
 * imports `./plugins` so those stubs run. If the registry lived in the scene
 * file, a stub would be reading a `const` of a module that is still evaluating
 * — the cycle would throw before the first frame. Here the registry is a leaf
 * module, fully initialised before any stub or the scene runs, and the scene
 * re-exports these names so `@/app/scenes/AttackScene` remains a valid place
 * to import them from.
 */

/** Everything a package mounted on the attack scene can reach. */
export interface AttackMounts {
  readonly session: AttackSession;
  readonly target: AttackTarget;
  readonly yard: Yard;
  readonly renderer: YardRenderer;
  readonly camera: Camera;
  readonly canvas: HTMLCanvasElement;
  /**
   * The docked panel slot: right column on desktop, bottom sheet on a phone.
   * The army panel, the catapult and siege pickers mount here (`Panel.mount`).
   */
  readonly dock: HTMLElement;
  /** A spare slot on the HUD strip, between the readouts and Retreat. */
  readonly hudSlot: HTMLElement;
  /** The overlay's modal layer, for the end-of-attack panel. */
  readonly modal: HTMLElement;
  /**
   * World-space container above the enemy yard's buildings, under the same
   * camera transform.
   *
   * Positions: `renderer.yardToWorld(x, y)` takes the same numbers as
   * `buildingdata.X/Y`, which is the space the engine's fling `x`/`y` and its
   * creeps' `ix`/`iy` are in. Do not pass the engine's cartesian `cx`/`cy`.
   */
  readonly battleLayer: Container;
  readonly notices: Notices;
  /** Leaves for the map. */
  readonly goToMap: () => void;
  /**
   * How much of the canvas, in CSS px from the bottom edge, the dock covers.
   * The bottom sheet reports through this so the fit zoom stays honest.
   */
  readonly setBottomInset: (px: number) => void;
}

/** A package mounted on the scene; may return its teardown. */
export type AttackPlugin = (mounts: AttackMounts) => (() => void) | void;

/**
 * What mounts on every attack, in mount order. Each package's stub under
 * `./plugins/` pushes its plugin here.
 */
export const ATTACK_PLUGINS: AttackPlugin[] = [];
