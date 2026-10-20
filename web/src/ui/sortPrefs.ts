/**
 * Remembers which way a list was last sorted, in this browser only: the
 * sort the player picked and whether it runs highest or lowest first. Each
 * list keeps its own key, so one list's choice never leaks into another.
 *
 * Reading `window.localStorage` throws in a browser with site data blocked,
 * and a stored value can be stale or hand-edited, so anything that cannot be
 * read or does not name a known sort falls back to the list's default.
 */

import type { SortDirection } from "@/game/maproom1/mr1Model";

export interface SortPref<K extends string> {
  readonly sort: K;
  readonly direction: SortDirection;
}

/** The storage the choice lives in, or null where there is none. */
const defaultStorage = (): Storage | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

/** The saved choice under `key`, or `fallback` when there is none worth trusting. */
export const loadSortPref = <K extends string>(
  key: string,
  sorts: readonly K[],
  fallback: SortPref<K>,
  storage: Storage | null = defaultStorage(),
): SortPref<K> => {
  try {
    const raw = storage?.getItem(key);
    if (!raw) return fallback;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return fallback;
    const { sort, direction } = parsed as Record<string, unknown>;
    if (!sorts.includes(sort as K)) return fallback;
    if (direction !== "asc" && direction !== "desc") return fallback;
    return { sort: sort as K, direction };
  } catch {
    return fallback;
  }
};

/** Saves the choice; a blocked or full storage is shrugged off. */
export const saveSortPref = <K extends string>(
  key: string,
  pref: SortPref<K>,
  storage: Storage | null = defaultStorage(),
): void => {
  try {
    storage?.setItem(key, JSON.stringify({ sort: pref.sort, direction: pref.direction }));
  } catch {
    // Nothing to do: the list still sorts, it just will not remember.
  }
};
