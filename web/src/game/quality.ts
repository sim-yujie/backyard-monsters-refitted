/**
 * The Quality setting (owner, 28 Oct 2026): how much the game downloads, for
 * slow internet and older phones. Kept in this browser only, apart from the
 * Classic look and the effects settings.
 *
 * - `high` (the default): the game as painted. Monster and champion sheets at
 *   their painted size (`@4x`, Korath's biggest `@3x`), the yard tune at full
 *   quality, ready as soon as the yard opens.
 * - `medium`: the sheets' `@2x` copies (half size, about a quarter of the
 *   bytes), the lighter yard tune, and music off until the player turns it on
 *   once in this browser: nothing is downloaded for it until then.
 * - `low`: the sheets' 1x copies (the size Flash drew them, about a tenth of the
 *   bytes), the lighter yard tune, music off at the start of every visit until
 *   the player turns it on, and the map rooms asking the server again a third
 *   as often (Map Room 2 every 3 minutes, not every minute).
 *
 * The copies are made by `web/tools/sheet_copies.py`, and Pixi reads their
 * size from the `@2x` in the name, so a cell is framed the same at every level.
 */
export type Quality = "high" | "medium" | "low";

export const QUALITIES: readonly Quality[] = ["high", "medium", "low"];

/** Where the choice is kept: "high", "medium" or "low"; unset is High. */
export const QUALITY_KEY = "bymr.quality";
/** Set once the player turned music on while on Medium: it is not held off again. */
export const MEDIUM_MUSIC_KEY = "bymr.quality.mediumMusic";

/** How much longer the map rooms wait between asks on Low. */
export const LOW_MAP_REFRESH_FACTOR = 3;

const storage = (): Storage | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

const isQuality = (value: unknown): value is Quality => value === "high" || value === "medium" || value === "low";

/** The Quality the player chose, or null while they never have. */
export const qualityChoice = (store: Storage | null = storage()): Quality | null => {
  try {
    const value = store?.getItem(QUALITY_KEY);
    return isQuality(value) ? value : null;
  } catch {
    return null;
  }
};

/** The Quality in use: the player's choice, else High. */
export const quality = (store: Storage | null = storage()): Quality => qualityChoice(store) ?? "high";

const listeners = new Set<(level: Quality) => void>();

/** Calls `listener` whenever the player picks a level; returns the unsubscribe. */
export const onQualityChange = (listener: (level: Quality) => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const setQuality = (level: Quality, store: Storage | null = storage()): void => {
  try {
    store?.setItem(QUALITY_KEY, level);
  } catch {
    // Site data blocked: nothing to remember it by, so the game stays on High.
  }
  for (const listener of listeners) listener(level);
};

/**
 * The copy of a painted sheet to download: `monsters/pokey-anim@4x.png` as it
 * is on High, `monsters/pokey-anim@2x.png` on Medium, `monsters/pokey-anim.png`
 * on Low. A sheet that is not a big painting (no `@3x` or more) is left alone.
 */
export const sheetAtQuality = (file: string, level: Quality = quality()): string => {
  const painted = /@(\d+)x(\.\w+)$/.exec(file);
  if (!painted || Number(painted[1]) < 3 || level === "high") return file;
  const ext = painted[2] ?? "";
  return `${file.slice(0, painted.index)}${level === "medium" ? `@2x${ext}` : ext}`;
};

/** Whether the yard tune is the lighter copy (Medium and Low). */
export const lightMusic = (level: Quality = quality()): boolean => level !== "high";

/**
 * Whether the music waits, off, until the player turns it on: every visit on
 * Low; on Medium until they have once turned it on in this browser.
 */
export const musicHeld = (level: Quality = quality(), store: Storage | null = storage()): boolean => {
  if (level === "low") return true;
  if (level !== "medium") return false;
  try {
    return store?.getItem(MEDIUM_MUSIC_KEY) !== "1";
  } catch {
    return true;
  }
};

/** The player turned music on: on Medium, it is not held off again in this browser. */
export const noteMusicTurnedOn = (level: Quality = quality(), store: Storage | null = storage()): void => {
  if (level !== "medium") return;
  try {
    store?.setItem(MEDIUM_MUSIC_KEY, "1");
  } catch {
    // Site data blocked: the music waits again next visit.
  }
};

/** How long a map room waits before asking the server again: `normal`, or three times it on Low. */
export const mapRefreshSeconds = (normal: number, level: Quality = quality()): number =>
  level === "low" ? normal * LOW_MAP_REFRESH_FACTOR : normal;
