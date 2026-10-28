import { getSession } from "@/api/auth";
import { fetchSoundSwitches, saveSoundSwitches, type SoundSwitches } from "@/api/sound";
import { musicHeld, noteMusicTurnedOn, onQualityChange } from "@/game/quality";

/**
 * The signed-in player's music and effects switches (beta.5), as the server
 * keeps them with their main yard (`api/sound.ts`).
 *
 * Read once per signed-in account, on the first game screen; until then
 * they are unknown (null) and nothing plays, so a brand-new player, whose
 * music the server starts off, never hears a note before the answer comes.
 * A change shows at once and is saved behind it; if the save fails, the
 * switch goes back to what the server holds and the caller is told.
 *
 * On the Medium and Low Quality settings (`game/quality.ts`) the music shows
 * as off, and so is neither played nor downloaded, until the player turns it
 * on; the server's switch is left as it is, so another device is not touched.
 */

export type { SoundSwitches };

type Listener = (switches: SoundSwitches | null) => void;

/** The api calls, swappable for tests. */
export interface SoundSwitchesApi {
  readonly fetch: () => Promise<SoundSwitches>;
  readonly save: (change: Partial<SoundSwitches>) => Promise<SoundSwitches>;
  readonly account: () => number | null;
}

const defaultApi: SoundSwitchesApi = {
  fetch: fetchSoundSwitches,
  save: saveSoundSwitches,
  account: () => getSession()?.userId ?? null,
};

let api: SoundSwitchesApi = defaultApi;
let state: SoundSwitches | null = null;
/** The account `state` belongs to. */
let owner: number | null = null;
let loading: Promise<void> | null = null;
/** Moves on every change and every account switch, so a late answer cannot undo a newer one. */
let version = 0;
const listeners = new Set<Listener>();
/** Whether the Quality setting holds the music off on this page; decided on first use. */
let held: boolean | null = null;

const holding = (): boolean => (held ??= musicHeld());

/** The switches as the game plays them: the music off while held. */
const shown = (switches: SoundSwitches | null): SoundSwitches | null =>
  switches?.music && holding() ? { ...switches, music: false } : switches;

const publish = (next: SoundSwitches | null): void => {
  state = next;
  const view = shown(next);
  for (const listener of listeners) listener(view);
};

// Picking Low stops the music now; picking High lets it play again.
onQualityChange(() => {
  held = musicHeld();
  publish(state);
});

/** The switches, or null while not known yet. */
export const soundSwitches = (): SoundSwitches | null => shown(state);

/** Calls `listener` on every change; returns the unsubscribe. */
export const onSoundSwitches = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Forgets the switches: signed out, or another account signed in. */
export const forgetSoundSwitches = (): void => {
  version += 1;
  owner = null;
  loading = null;
  if (state !== null) publish(null);
};

/**
 * Reads the switches for the signed-in account, once: a second call for the
 * same account is the first call's promise. A failed read leaves them
 * unknown and is tried again on the next screen.
 */
export const loadSoundSwitches = (): Promise<void> => {
  const account = api.account();
  if (account === null) {
    forgetSoundSwitches();
    return Promise.resolve();
  }
  if (account !== owner) forgetSoundSwitches();
  if (state !== null) return Promise.resolve();
  if (loading) return loading;
  owner = account;
  const asked = version;
  loading = api.fetch().then(
    (switches) => {
      loading = null;
      if (asked === version) publish(switches);
    },
    () => {
      if (asked === version) loading = null;
    },
  );
  return loading;
};

/**
 * Turns one switch on or off: shown at once, then saved. Resolves with the
 * stored switches; rejects, with the switch put back, when the save fails.
 */
export const setSoundSwitch = async (which: keyof SoundSwitches, on: boolean): Promise<SoundSwitches> => {
  const before = state;
  if (which === "music" && on) {
    held = false;
    noteMusicTurnedOn();
  }
  version += 1;
  const mine = version;
  loading = null;
  owner = api.account();
  publish({ ...(before ?? { music: true, effects: true }), [which]: on });
  try {
    const stored = await api.save({ [which]: on });
    if (mine === version) publish(stored);
    return stored;
  } catch (error) {
    if (mine === version) publish(before);
    throw error;
  }
};

/** Test hook: swaps the api calls and clears everything. */
export const resetSoundSwitchesForTest = (next: SoundSwitchesApi = defaultApi): void => {
  api = next;
  state = null;
  owner = null;
  loading = null;
  version = 0;
  held = null;
  listeners.clear();
};
