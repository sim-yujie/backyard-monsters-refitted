import { setScreenTune } from "@/game/sound/sound";
import { loadSoundSwitches } from "@/game/sound/soundSwitches";
import { MAP_ROOM_TUNE, type Tune } from "@/game/sound/tunes";
import { SceneName } from "./sceneName";
import type { SceneFactory } from "./SceneManager";

/**
 * Which tune each screen plays (beta.5, `game/sound/tunes.ts` for Flash's
 * choice): a tune, `null` for silence, or `undefined` to leave whatever is
 * playing (the map gate only decides where to go next).
 *
 * A Watch plays the attack tune here; `AttackScene` turns a defence replay
 * over to the "under attack" tune once it knows which replay it holds.
 */
export const tuneForScene = (scene: string): Tune | null | undefined => {
  switch (scene) {
    case SceneName.YARD:
      return "yard";
    case SceneName.MAP_ROOM_1:
    case SceneName.MAP_ROOM_2:
      return MAP_ROOM_TUNE;
    case SceneName.ATTACK:
    case SceneName.WATCH:
      return "attack";
    case SceneName.RAID:
    case SceneName.BAITER:
    case SceneName.BAITER_REPLAY:
      return "underAttack";
    case SceneName.MAP:
      return undefined;
    default:
      // Boot, sign-in and the idle disconnect: no music, as in Flash before the yard loaded.
      return null;
  }
};

export interface MusicSceneDeps {
  readonly setTune: (tune: Tune | null | undefined) => void;
  readonly loadSwitches: () => Promise<void>;
}

const defaultDeps: MusicSceneDeps = { setTune: setScreenTune, loadSwitches: loadSoundSwitches };

/**
 * A screen with its tune: the tune is asked for as the screen opens, before
 * its own `enter` loads anything, and the player's switches are read for
 * the signed-in account if they are not known yet (forgotten on sign-out).
 */
export const withMusic =
  (name: string, factory: SceneFactory, deps: MusicSceneDeps = defaultDeps): SceneFactory =>
  () => {
    const scene = factory();
    const enter = scene.enter?.bind(scene);
    scene.enter = (context) => {
      void deps.loadSwitches();
      deps.setTune(tuneForScene(name));
      return enter?.(context);
    };
    return scene;
  };
