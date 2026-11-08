import { EffectsPlayer, type Effect } from "./EffectsPlayer";
import { MusicPlayer } from "./MusicPlayer";
import { onSoundSwitches, soundSwitches, type SoundSwitches } from "./soundSwitches";
import { volumeGain } from "./soundVolume";
import type { Tune } from "./tunes";
import { installUiSounds, UI_SOUND_EFFECT, type UiSound } from "./uiSounds";

/**
 * The game's one music player, made on first use and driven by two things:
 * the screen's tune ({@link setScreenTune}, from `app/musicScene.ts`) and the
 * player's music switch (`soundSwitches.ts`). Beside it, the one effects
 * player ({@link playEffect}), driven by the sound effects switch. Each
 * plays at its slider's gain (`soundVolume.ts`).
 */

let player: MusicPlayer | null = null;
let effects: EffectsPlayer | null = null;

/**
 * The music as the switch and slider say: on with the switch, at the
 * slider's gain; at 0 it is off, so nothing is downloaded to be silent.
 */
const tuneMusic = (made: MusicPlayer, switches: SoundSwitches | null): void => {
  made.setVolume(volumeGain(switches?.musicVolume ?? 0));
  made.setEnabled(switches?.music === true && switches.musicVolume > 0);
};

const tuneEffects = (made: EffectsPlayer, switches: SoundSwitches | null): void => {
  made.setVolume(volumeGain(switches?.effectsVolume ?? 0));
  made.setEnabled(switches?.effects === true && switches.effectsVolume > 0);
};

const musicPlayer = (): MusicPlayer => {
  if (player) return player;
  const made = new MusicPlayer();
  tuneMusic(made, soundSwitches());
  onSoundSwitches((switches) => tuneMusic(made, switches));
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
  tuneEffects(made, soundSwitches());
  onSoundSwitches((switches) => tuneEffects(made, switches));
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

/**
 * Plays a sound effect, at `volume` or its own, unless the player has sound
 * effects off (or the switches are not known yet).
 */
export const playEffect = (effect: Effect, volume?: number): void => {
  const played = effectsPlayer().play(effect, volume);
  if (import.meta.env.DEV) {
    // `__effectsLog` for the browser checks: every effect asked for, and whether it sounded.
    const log = ((globalThis as Record<string, unknown>)["__effectsLog"] ??= []) as unknown[];
    if (log.length < 5_000) log.push({ at: Math.round(performance.now()), effect, volume, played });
  }
};

/** Fetches an attack's sounds as it opens (`attackSounds.ts`); nothing with sound effects off. */
export const preloadEffects = (list: readonly Effect[]): void => {
  effectsPlayer().preload(list);
};

/** Plays one of Flash's UI sounds now (`uiSounds.ts`), e.g. a refusal no button press carries. */
export const playUiSound = (sound: UiSound): void => {
  playEffect(UI_SOUND_EFFECT[sound]);
};

let uiSoundsInstalled = false;

/**
 * Flash's click and close on every button, tab and close button of the page
 * (`uiSounds.ts`), once, from `main.ts`.
 */
export const installGameUiSounds = (): void => {
  if (uiSoundsInstalled || typeof document === "undefined") return;
  uiSoundsInstalled = true;
  installUiSounds(document, { play: (effect) => playEffect(effect) });
};
