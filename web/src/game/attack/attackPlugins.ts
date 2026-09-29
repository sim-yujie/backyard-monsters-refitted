import type { Container } from "pixi.js";
import type { Resources } from "@/api/types";
import type { Camera } from "@/game/Camera";
import type { ResourceAmounts } from "@/game/combat/rules";
import type { BaiterRun } from "@/game/baiter/baiterSession";
import type { Yard } from "@/game/yard/yardModel";
import type { YardRenderer } from "@/game/yard/YardRenderer";
import type { Notices } from "@/ui/maproom/Notices";
import type { AttackPresentation } from "./attackPresentation";
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
  /**
   * Shows the attacker's own pool on the HUD. The drop package owns the pool
   * a bomb is bought from, and calls this every time it changes, so the HUD
   * and the Catapult panel read one number (issue #92).
   */
  readonly showResources: (resources: Resources) => void;
  /**
   * Adds what the final save banked of the loot (`lootcredited`) to the pool
   * the HUD shows, so the end panel and the HUD agree (#168).
   */
  readonly creditLoot: (credited: ResourceAmounts) => void;
  /**
   * Closes the enemy building's info panel, if one is open. The dock shows
   * one panel at a time (#59): the info replaces the Army panel or a picker
   * while it is open, and a picker opening closes the info.
   */
  readonly closeBuildingInfo: () => void;
  /**
   * What the screen still shows of a battle the engine has moved past: the
   * battle layer holds the end panel while a bomb is falling and hands the
   * HUD the damage it has visibly dealt (#148).
   */
  readonly presentation: AttackPresentation;
  /**
   * The Wild Monster Baiter's practice attack this scene is running (#126),
   * or absent on a real attack. Only the Baiter scene's own package reads it.
   */
  readonly practice?: BaiterRun;
  /** The Baiter scene: the same practice attack again, on a fresh scene. */
  readonly runAgain?: (run: BaiterRun) => void;
  /** The Baiter scene: back to the player's own yard. */
  readonly goToYard?: () => void;
}

/** A package mounted on the scene; may return its teardown. */
export type AttackPlugin = (mounts: AttackMounts) => (() => void) | void;

/**
 * What mounts on every attack, in mount order. Each package's stub under
 * `./plugins/` pushes its plugin here.
 */
export const ATTACK_PLUGINS: AttackPlugin[] = [];
