import { fetchMapTilt, setTiltedMap, type MapTiltSettings } from "@/api/account";
import { getSession } from "@/api/auth";
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
): Promise<TiltChoice> => remember(keep(await fetch(), store));

/** Stores the player's choice on the account, and keeps what the server now has. */
export const saveTiltChoice = async (
  tilted: boolean,
  save: (tilted: boolean) => Promise<MapTiltSettings> = setTiltedMap,
  store: Store | null = storage(),
): Promise<TiltChoice> => remember(keep(await save(tilted), store));

/* ── This page's answer ─────────────────────────────────────────────────── */

/**
 * The account's answer as this page last heard it, for whichever account was
 * signed in then. The player's choice only changes through this page's own
 * "Tilted map" button (which keeps the new answer here) and the server's
 * switch only with a server restart, so later map opens reuse it instead of
 * asking the account again on every open (MR2 open speed, 7 Nov 2026).
 */
let pageAnswer: { userId: number | null; choice: TiltChoice } | null = null;

const signedIn = (): number | null => getSession()?.userId ?? null;

const remember = (choice: TiltChoice): TiltChoice => {
  pageAnswer = { userId: signedIn(), choice };
  return choice;
};

/** Keeps an answer that came with another account call (the hex shape's, `hexShapeSetting.ts`). */
export const noteTiltAnswer = (answer: MapTiltSettings, store: Store | null = storage()): void => {
  remember(keep(answer, store));
};

/** This page's answer for the signed-in account, or null when it has none yet. */
export const knownTiltChoice = (): TiltChoice | null =>
  pageAnswer && pageAnswer.userId === signedIn() ? pageAnswer.choice : null;

/** The page's answer when it has one, else asks the account (once). */
export const loadTiltChoiceOnce = async (
  fetch: () => Promise<MapTiltSettings> = fetchMapTilt,
  store: Store | null = storage(),
): Promise<TiltChoice> => knownTiltChoice() ?? loadTiltChoice(fetch, store);

/** Forgets this page's answer (tests). */
export const forgetTiltAnswer = (): void => {
  pageAnswer = null;
};
