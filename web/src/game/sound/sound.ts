import { MusicPlayer } from "./MusicPlayer";
import { onSoundSwitches, soundSwitches } from "./soundSwitches";
import type { Tune } from "./tunes";

/**
 * The game's one music player, made on first use and driven by two things:
 * the screen's tune ({@link setScreenTune}, from `app/musicScene.ts`) and the
 * player's music switch (`soundSwitches.ts`). Sound effects come in a later
 * slice; their switch is already saved.
 */

let player: MusicPlayer | null = null;

const musicPlayer = (): MusicPlayer => {
  if (player) return player;
  const made = new MusicPlayer();
  made.setEnabled(soundSwitches()?.music === true);
  onSoundSwitches((switches) => made.setEnabled(switches?.music === true));
  player = made;
  if (import.meta.env.DEV) {
    // `__sound.playing` / `__sound.blocked` for the browser checks.
    (globalThis as Record<string, unknown>)["__sound"] = made;
  }
  return made;
};

/**
 * The tune the screen on show plays: a tune, null for none, undefined to
 * leave whatever is playing.
 */
export const setScreenTune = (tune: Tune | null | undefined): void => {
  if (tune === undefined) return;
  if (tune === null && !player) return;
  musicPlayer().want(tune);
};
