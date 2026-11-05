import { getSession } from "@/api/auth";
import {
  DEFAULT_EFFECTS_VOLUME,
  DEFAULT_MUSIC_VOLUME,
  fetchSoundSwitches,
  saveSoundSwitches,
  type SoundSwitches,
} from "@/api/sound";
import { musicHeld, noteMusicTurnedOn, onQualityChange } from "@/game/quality";

/**
 * The signed-in player's music and effects switches (beta.5) and volume
 * sliders (owner, 4 Nov 2026), as the server keeps them with their main
 * yard (`api/sound.ts`).
 *
 * Read once per signed-in account, on the first game screen; until then
 * they are unknown (null) and nothing plays, so a brand-new player, whose
 * music the server starts off, never hears a note before the answer comes.
 * A change shows at once and is saved behind it; if the save fails, the
 * switch goes back to what the server holds and the caller is told. A
 * slider is saved once it has rested for {@link VOLUME_SAVE_DELAY_MS}, so a
 * drag is one request, not fifty.
 *
 * On the Medium and Low Quality settings (`game/quality.ts`) the music shows
 * as off, and so is neither played nor downloaded, until the player turns it
 * on; the server's switch is left as it is, so another device is not touched.
 */

export type { SoundSwitches };

/** A volume slider's name. */
export type SoundVolume = "musicVolume" | "effectsVolume";

/** How long a slider rests before its place is saved. */
export const VOLUME_SAVE_DELAY_MS = 400;

/** What a switch or slider starts from before the server has answered. */
const FALLBACK: SoundSwitches = {
  music: true,
  effects: true,
  musicVolume: DEFAULT_MUSIC_VOLUME,
  effectsVolume: DEFAULT_EFFECTS_VOLUME,
};

type Listener = (switches: SoundSwitches | null) => void;

/** The api calls, swappable for tests. */
export interface SoundSwitchesApi {
  readonly fetch: () => Promise<SoundSwitches>;
  readonly save: (change: Partial<SoundSwitches>) => Promise<SoundSwitches>;
  readonly account: () => number | null;
  /** Runs `run` after `ms`; returns the cancel. */
  readonly later?: (run: () => void, ms: number) => () => void;
}

const defaultLater = (run: () => void, ms: number): (() => void) => {
  const handle = setTimeout(run, ms);
  return () => clearTimeout(handle);
};

const defaultApi: SoundSwitchesApi = {
  fetch: fetchSoundSwitches,
  save: saveSoundSwitches,
  account: () => getSession()?.userId ?? null,
  later: defaultLater,
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

interface VolumeSave {
  readonly change: Partial<Record<SoundVolume, number>>;
  /** What to put back if the save fails: the state before the first move. */
  readonly before: SoundSwitches | null;
  readonly cancel: () => void;
  readonly waiters: { resolve: (stored: SoundSwitches) => void; reject: (error: unknown) => void }[];
}

let volumeSave: VolumeSave | null = null;

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
  volumeSave?.cancel();
  volumeSave = null;
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
  publish({ ...(before ?? FALLBACK), [which]: on });
  try {
    const stored = await api.save({ [which]: on });
    // A slider still waiting to be saved keeps its place over the answer.
    if (mine === version) publish({ ...stored, ...volumeSave?.change });
    return stored;
  } catch (error) {
    if (mine === version) publish(before);
    throw error;
  }
};

/**
 * Moves one slider (0-100): heard at once, saved once it rests. Resolves
 * with the stored state; rejects, with the slider put back, when the save
 * fails.
 */
export const setSoundVolume = (which: SoundVolume, value: number): Promise<SoundSwitches> => {
  const level = Math.round(Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0)));
  const pending = volumeSave;
  pending?.cancel();
  version += 1;
  loading = null;
  owner = api.account();
  const before = pending ? pending.before : state;
  publish({ ...(state ?? FALLBACK), [which]: level });
  const later = api.later ?? defaultLater;
  return new Promise<SoundSwitches>((resolve, reject) => {
    const waiters = [...(pending?.waiters ?? []), { resolve, reject }];
    const change = { ...pending?.change, [which]: level };
    // Compared by entry, not by cancel: a `later` that runs at once (tests)
    // calls back before it has returned the cancel, so the save waits for it.
    let due = false;
    let entry: VolumeSave | null = null;
    const run = (): void => {
      due = true;
      if (entry === null || volumeSave !== entry) return;
      volumeSave = null;
      const mine = version;
      api.save(change).then(
        (stored) => {
          if (mine === version) publish(stored);
          for (const waiter of waiters) waiter.resolve(stored);
        },
        (error: unknown) => {
          if (mine === version) publish(before);
          for (const waiter of waiters) waiter.reject(error);
        },
      );
    };
    const cancel = later(() => run(), VOLUME_SAVE_DELAY_MS);
    entry = { change, before, cancel, waiters };
    volumeSave = entry;
    if (due) run();
  });
};

/** Test hook: swaps the api calls and clears everything. */
export const resetSoundSwitchesForTest = (next: SoundSwitchesApi = defaultApi): void => {
  api = next;
  state = null;
  owner = null;
  loading = null;
  version = 0;
  held = null;
  volumeSave?.cancel();
  volumeSave = null;
  listeners.clear();
};
