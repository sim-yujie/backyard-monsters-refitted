import { fetchMapTilt, setTiltedMap, type MapTiltSettings } from "@/api/account";
import type { TiltChoice } from "./tilt";

/**
 * The player's "Tilted map" choice (MR2 look plan step 4, owner 3 Nov 2026:
 * the tilt is on by default in Modern and each player can switch it off,
 * remembered for the account).
 *
 * The account on the server is the one that counts (`user.map_flat`, sent as
 * `tiltedMap` in the settings block next to the server's `mapTiltAllowed`
 * switch). This browser keeps the last answer too, only so the map opens in
 * the right shape at once instead of flipping when the answer lands; a new
 * browser opens flat and turns tilted when the account says so.
 */

/** Where this browser keeps the account's last answer. */
export const TILT_CHOICE_KEY = "bymr.mr2TiltChoice";

/** Before the account has ever answered: tilted by choice, but not allowed yet. */
export const UNKNOWN_CHOICE: TiltChoice = { allowed: false, tilted: true };

type Store = Pick<Storage, "getItem" | "setItem">;

const storage = (): Store | null => {
  try {
    return typeof window === "object" ? window.localStorage : null;
  } catch {
    return null;
  }
};

/** The account's last answer as this browser kept it. */
export const cachedTiltChoice = (store: Store | null = storage()): TiltChoice => {
  try {
    const kept = JSON.parse(store?.getItem(TILT_CHOICE_KEY) ?? "null") as Partial<TiltChoice> | null;
    if (!kept || typeof kept !== "object") return UNKNOWN_CHOICE;
    return { allowed: kept.allowed === true, tilted: kept.tilted !== false };
  } catch {
    return UNKNOWN_CHOICE;
  }
};

export const rememberTiltChoice = (choice: TiltChoice, store: Store | null = storage()): void => {
  try {
    store?.setItem(TILT_CHOICE_KEY, JSON.stringify({ allowed: choice.allowed, tilted: choice.tilted }));
  } catch {
    // Private mode or a full store: the account still has it.
  }
};

const keep = (answer: MapTiltSettings, store: Store | null): TiltChoice => {
  const choice = { allowed: answer.allowed, tilted: answer.tilted };
  rememberTiltChoice(choice, store);
  return choice;
};

/** Asks the account for the switch and the choice, and keeps the answer. */
export const loadTiltChoice = async (
  fetch: () => Promise<MapTiltSettings> = fetchMapTilt,
  store: Store | null = storage(),
): Promise<TiltChoice> => keep(await fetch(), store);

/** Stores the player's choice on the account, and keeps what the server now has. */
export const saveTiltChoice = async (
  tilted: boolean,
  save: (tilted: boolean) => Promise<MapTiltSettings> = setTiltedMap,
  store: Store | null = storage(),
): Promise<TiltChoice> => keep(await save(tilted), store);
