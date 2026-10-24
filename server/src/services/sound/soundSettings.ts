import type { Stats } from "../events/wmi/invasionUtils.js";
import { guideOpen, readOnboarding, type OnboardingSave } from "../onboarding/state.js";

/**
 * The player's two sound switches, music and effects (beta.5, owner's
 * answers S1-S3 of 2026-10-24): on or off, no volume.
 *
 * They are saved with the main yard, as Flash saved them: in
 * `stats.other`, under Flash's own keys, `mute` (effects) and `mutemusic`
 * (music), 1 for off (`client/scripts/SOUNDS.as:291-325`, through
 * `GLOBAL.StatSet`, which `BASE.as:1019-1021` reads back from
 * `stats.other`). So they follow the account to any browser.
 *
 * Unlike Flash, which deleted a key set to 0 (`GLOBAL.as:1730`), "on" is
 * written as 0 and kept: an absent key means the player has never chosen,
 * which is what the brand-new yard's default needs. Flash reads a 0 the same
 * as a missing key, so its own client still agrees.
 *
 * Defaults, as Flash's: both on, except music on a brand-new yard. Flash
 * muted the music, without saving it, when the main yard loaded with no
 * buildings at all (`BASE.as:1605,1705` → `SOUNDS.TutorialStopMusic`,
 * `SOUNDS.as:281-285`): the first session of a new player, the one the
 * tutorial runs in. Here that is the guided start still to run or running
 * (`guideOpen`); once it is done or skipped, the music comes on.
 */
export interface SoundSettings {
  readonly music: boolean;
  readonly effects: boolean;
}

/** The slice of a save these helpers read. */
export type SoundSave = OnboardingSave & { stats?: Stats | null };

/** Flash's `stats.other` keys (`SOUNDS.as:301,319`). */
export const MUTE_EFFECTS_KEY = "mute";
export const MUTE_MUSIC_KEY = "mutemusic";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The stored choice: true for on, false for off, null when never made. */
const storedSwitch = (other: Record<string, unknown> | null, key: string): boolean | null => {
  const raw = other?.[key];
  if (raw === 1 || raw === "1" || raw === true) return false;
  if (raw === 0 || raw === "0" || raw === false) return true;
  return null;
};

/** Whether the yard is still brand new: its guided start not yet over. */
export const brandNewYard = (save: SoundSave): boolean => guideOpen(readOnboarding(save));

/** The switches as they stand on a main save, the defaults filled in. */
export const soundSettingsOf = (save: SoundSave): SoundSettings => {
  const other = isRecord(save.stats) && isRecord(save.stats.other) ? save.stats.other : null;
  return {
    music: storedSwitch(other, MUTE_MUSIC_KEY) ?? !brandNewYard(save),
    effects: storedSwitch(other, MUTE_EFFECTS_KEY) ?? true,
  };
};

/**
 * The save's `stats` with the switches the player changed written in, a new
 * object so the ORM sees the change. A switch left undefined stays as it is,
 * and every other stat is kept.
 */
export const withSoundSettings = (
  stats: Stats | null | undefined,
  change: { readonly music?: boolean | undefined; readonly effects?: boolean | undefined }
): Stats => {
  const base: Stats = isRecord(stats) ? { ...stats } : {};
  const other: Record<string, unknown> = isRecord(base.other) ? { ...base.other } : {};
  if (change.music !== undefined) other[MUTE_MUSIC_KEY] = change.music ? 0 : 1;
  if (change.effects !== undefined) other[MUTE_EFFECTS_KEY] = change.effects ? 0 : 1;
  return { ...base, other };
};
