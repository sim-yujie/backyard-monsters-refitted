import { presence, type PresencePing } from "@/game/presence/presencePing";
import type { Scene, SceneFactory } from "./SceneManager";

/**
 * A game screen that keeps the player "online" while it is up (#242).
 *
 * The owner's rule is that a revenge attack lands only while the player is
 * away, so every screen of the game counts as being there: the yards, own or
 * visited, the maps, an attack, the Baiter and a Watch. Only the boot and
 * sign-in screens are left out. The wrapped scene takes a hold on the
 * presence ping before its own `enter` and gives it back after its `exit`,
 * so the hold passes from one screen to the next with no extra ping.
 */
export const withPresence = (factory: SceneFactory, ping: Pick<PresencePing, "hold"> = presence): SceneFactory =>
  withHold(factory, ping);

/**
 * A game screen that holds something for as long as it is up: the presence
 * ping, or the "Stay protected?" watch (#275). The hold is taken before the
 * scene's own `enter` and given back after its `exit`.
 */
export const withHold =
  (factory: SceneFactory, holder: { hold(): () => void }): SceneFactory =>
  () => {
    const scene = factory();
    let release: (() => void) | null = null;
    const wrapped: Scene = {
      enter: (context) => {
        release ??= holder.hold();
        return scene.enter?.(context);
      },
      exit: () => {
        try {
          scene.exit?.();
        } finally {
          release?.();
          release = null;
        }
      },
      update: (deltaSeconds) => scene.update?.(deltaSeconds),
      resize: (width, height) => scene.resize?.(width, height),
    };
    return wrapped;
  };
