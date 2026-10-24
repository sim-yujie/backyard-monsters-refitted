import { get, postJson } from "./http";
import type { ApiEnvelope } from "./types";

/**
 * The music and effects switches (beta.5): `GET /player/sound` reads them,
 * `POST /player/sound { music?, effects? }` changes one or both. The server
 * keeps them with the main yard, so they follow the account to any browser,
 * and decides the defaults (music off on a brand-new yard, as Flash did).
 * JSON, because the schema wants real booleans.
 */
const SOUND_PATH = "/api/:apiVersion/player/sound";

export interface SoundSwitches {
  readonly music: boolean;
  readonly effects: boolean;
}

interface SoundAnswer extends ApiEnvelope {
  sound?: { music?: unknown; effects?: unknown };
}

/** The switches out of an answer; anything missing reads as on. */
export const switchesOf = (sound: SoundAnswer["sound"]): SoundSwitches => ({
  music: sound?.music !== false,
  effects: sound?.effects !== false,
});

export const fetchSoundSwitches = async (): Promise<SoundSwitches> =>
  switchesOf((await get<SoundAnswer>(SOUND_PATH)).sound);

/** Saves the switches given; resolves with the stored state. */
export const saveSoundSwitches = async (change: Partial<SoundSwitches>): Promise<SoundSwitches> => {
  const response = await postJson<SoundAnswer>(SOUND_PATH, {
    ...(change.music !== undefined && { music: change.music }),
    ...(change.effects !== undefined && { effects: change.effects }),
  });
  return switchesOf(response.sound);
};
