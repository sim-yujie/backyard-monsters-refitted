import { get, postJson } from "./http";
import type { ApiEnvelope } from "./types";

/**
 * The music and effects switches (beta.5) and their volume sliders (owner,
 * 4 Nov 2026): `GET /player/sound` reads them, `POST /player/sound
 * { music?, effects?, musicVolume?, effectsVolume? }` changes any of them. The server
 * keeps them with the main yard, so they follow the account to any browser,
 * and decides the defaults (music off on a brand-new yard, as Flash did).
 * JSON, because the schema wants real booleans.
 */
const SOUND_PATH = "/api/:apiVersion/player/sound";

export interface SoundSwitches {
  readonly music: boolean;
  readonly effects: boolean;
  /** The music slider, 0-100. */
  readonly musicVolume: number;
  /** The sound effects slider, 0-100. */
  readonly effectsVolume: number;
}

/** The sliders' places for an account that never moved them (the server's `DEFAULT_*_VOLUME`). */
export const DEFAULT_MUSIC_VOLUME = 70;
export const DEFAULT_EFFECTS_VOLUME = 100;

interface SoundAnswer extends ApiEnvelope {
  sound?: { music?: unknown; effects?: unknown; musicVolume?: unknown; effectsVolume?: unknown };
}

/** A volume out of an answer: 0-100 whole, or the default when missing or unreadable. */
const volumeOf = (raw: unknown, fallback: number): number =>
  typeof raw === "number" && Number.isFinite(raw) ? Math.round(Math.min(100, Math.max(0, raw))) : fallback;

/** The switches out of an answer; a missing switch reads as on, a missing volume as its default. */
export const switchesOf = (sound: SoundAnswer["sound"]): SoundSwitches => ({
  music: sound?.music !== false,
  effects: sound?.effects !== false,
  musicVolume: volumeOf(sound?.musicVolume, DEFAULT_MUSIC_VOLUME),
  effectsVolume: volumeOf(sound?.effectsVolume, DEFAULT_EFFECTS_VOLUME),
});

export const fetchSoundSwitches = async (): Promise<SoundSwitches> =>
  switchesOf((await get<SoundAnswer>(SOUND_PATH)).sound);

/** Saves the switches and volumes given; resolves with the stored state. */
export const saveSoundSwitches = async (change: Partial<SoundSwitches>): Promise<SoundSwitches> => {
  const response = await postJson<SoundAnswer>(SOUND_PATH, {
    ...(change.music !== undefined && { music: change.music }),
    ...(change.effects !== undefined && { effects: change.effects }),
    ...(change.musicVolume !== undefined && { musicVolume: Math.round(change.musicVolume) }),
    ...(change.effectsVolume !== undefined && { effectsVolume: Math.round(change.effectsVolume) }),
  });
  return switchesOf(response.sound);
};
