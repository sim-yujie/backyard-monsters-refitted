import { IdleState, type IdleWatch } from "@/game/presence/idleWatch";
import type { Scene, SceneFactory } from "./SceneManager";

export interface IdleSceneOptions {
  /**
   * An attack or a replay (#271): the disconnect waits until the screen is
   * left, then lands at once if the player is still idle.
   */
  readonly defer?: boolean;
}

/**
 * A game screen the idle disconnect watches (#271, `game/presence/idleWatch.ts`).
 *
 * Every screen past sign-in holds the watch, as every one holds the presence
 * ping (`presenceScene.ts`); the hold is taken before the scene's own `enter`
 * and given back after its `exit`, so it passes from one screen to the next.
 * An attack or replay screen also defers the disconnect, and gives the
 * deferral back before the hold: a player still idle as it closes is
 * disconnected then, while a screen holds the watch, and the scene manager
 * opens the disconnect screen in place of the one that was coming.
 *
 * A screen opened after the disconnect (its hold found the player ten minutes
 * idle) is never started, so it loads nothing.
 */
export const withIdle =
  (
    factory: SceneFactory,
    idle: Pick<IdleWatch, "hold" | "defer" | "state">,
    options: IdleSceneOptions = {},
  ): SceneFactory =>
  () => {
    const scene = factory();
    let release: (() => void) | null = null;
    let undefer: (() => void) | null = null;
    let entered = false;
    const wrapped: Scene = {
      enter: (context) => {
        release ??= idle.hold();
        if (options.defer) undefer ??= idle.defer();
        if (idle.state === IdleState.DISCONNECTED) return;
        entered = true;
        return scene.enter?.(context);
      },
      exit: () => {
        try {
          if (entered) scene.exit?.();
        } finally {
          undefer?.();
          undefer = null;
          release?.();
          release = null;
        }
      },
      update: (deltaSeconds) => {
        if (entered) scene.update?.(deltaSeconds);
      },
      resize: (width, height) => {
        if (entered) scene.resize?.(width, height);
      },
    };
    return wrapped;
  };
