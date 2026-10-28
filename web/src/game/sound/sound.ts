import { EffectsPlayer, type Effect } from "./EffectsPlayer";
import { MusicPlayer } from "./MusicPlayer";
import { onSoundSwitches, soundSwitches } from "./soundSwitches";
import type { Tune } from "./tunes";

/**
 * The game's one music player, made on first use and driven by two things:
 * the screen's tune ({@link setScreenTune}, from `app/musicScene.ts`) and the
 * player's music switch (`soundSwitches.ts`). Beside it, the one effects
 * player ({@link playEffect}), driven by the sound effects switch.
 */

let player: MusicPlayer | null = null;
let effects: EffectsPlayer | null = null;

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

const effectsPlayer = (): EffectsPlayer => {
  if (effects) return effects;
  const made = new EffectsPlayer();
  made.setEnabled(soundSwitches()?.effects === true);
  onSoundSwitches((switches) => made.setEnabled(switches?.effects === true));
  effects = made;
  if (import.meta.env.DEV) {
    // `__effects.blocked` for the browser checks.
    (globalThis as Record<string, unknown>)["__effects"] = made;
  }
  return made;
};

/**
 * The tune the screen on show plays: a tune, null for none, undefined to
 * leave whatever is playing.
 */
export const setScreenTune = (tune: Tune | null | undefined): void => {
  // Made with the first screen, so the player's first press can already let effects out.
  effectsPlayer();
  if (tune === undefined) return;
  if (tune === null && !player) return;
  musicPlayer().want(tune);
};

/** Plays a sound effect, unless the player has sound effects off (or the switches are not known yet). */
export const playEffect = (effect: Effect): void => {
  effectsPlayer().play(effect);
};
