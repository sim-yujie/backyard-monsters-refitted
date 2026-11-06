import type { HatcheryView, HatchYard } from "@/game/monsters/hatchPlan";
import { queuedCount } from "@/game/monsters/hatchPlan";
import type { YardKind } from "@/game/yard/buildingCosts";

/**
 * The Hatch tab's strip of hatcheries (owner, 28 Oct): one tab per
 * hatchery, so a yard with several shows one line at a time instead of
 * stacking them all above the monsters. A finished HCC runs one shared
 * queue and its hatcheries none of their own, so it has no tabs.
 *
 * The tab last chosen is remembered in this browser, per yard (the main
 * yard, each outpost, the Inferno), by its building id. Reading
 * `window.localStorage` throws where site data is blocked, and a stored id
 * can name a hatchery since recycled, so anything unreadable or gone falls
 * back to the first tab.
 */

/** A tab's small light: hatching, nothing to do, or held up. */
export type HatcheryTabLight = "busy" | "idle" | "held" | "broken";

/** One tab, as the strip draws it. */
export interface HatcheryTab {
  readonly id: number;
  /** The number the yard shows over it while the tab is open (oldest is 1). */
  readonly number: number;
  readonly level: number;
  readonly state: HatcheryView["state"];
  readonly light: HatcheryTabLight;
  /** The monster hatching now, or null. */
  readonly monster: string | null;
  /** When it is done, server clock, while it counts down; else null. */
  readonly endsAt: number | null;
  /** Monsters waiting in its own queue. */
  readonly waiting: number;
}

/** What each state shows as the tab's light. */
const LIGHT: Readonly<Record<HatcheryView["state"], HatcheryTabLight>> = {
  producing: "busy",
  idle: "idle",
  stalled: "held",
  upgrading: "held",
  building: "held",
  damaged: "broken",
};

/**
 * The tabs, numbered and ordered as the yard numbers the hatcheries; none
 * with an HCC (one shared queue) or fewer than two hatcheries (nothing to
 * swap between).
 */
export const hatcheryTabs = (
  yard: Pick<HatchYard, "hatcheries" | "hcc">,
  numbers: ReadonlyMap<number, number>,
): HatcheryTab[] => {
  if (yard.hcc || yard.hatcheries.length < 2) return [];
  return yard.hatcheries
    .map((hatchery) => ({
      id: hatchery.id,
      number: numbers.get(hatchery.id) ?? 0,
      level: hatchery.level,
      state: hatchery.state,
      light: LIGHT[hatchery.state],
      monster: hatchery.monster,
      endsAt: hatchery.state === "producing" ? hatchery.endsAt : null,
      waiting: queuedCount(hatchery.queue),
    }))
    .sort((a, b) => a.number - b.number);
};

/**
 * The tab an arrow key moves to from `current`: the next or previous one,
 * wrapping round, or the first or last for Home and End; null for any
 * other key.
 */
export const tabAfterKey = (
  ids: readonly number[],
  current: number,
  key: string,
): number | null => {
  if (ids.length === 0) return null;
  const at = Math.max(0, ids.indexOf(current));
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return ids[(at + 1) % ids.length]!;
    case "ArrowLeft":
    case "ArrowUp":
      return ids[(at - 1 + ids.length) % ids.length]!;
    case "Home":
      return ids[0]!;
    case "End":
      return ids[ids.length - 1]!;
    default:
      return null;
  }
};

/** Where one yard's last tab is kept: the main yard, the Inferno, or one outpost by its base id. */
export const hatchTabKey = (kind: YardKind, baseid?: string): string =>
  `bymr.hatchTab.${kind}${baseid ? `.${baseid}` : ""}`;

/** The storage the choice lives in, or null where there is none. */
const defaultStorage = (): Storage | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

/** The hatchery last chosen under `key`, or null when there is none worth trusting. */
export const loadHatchTab = (key: string, storage: Storage | null = defaultStorage()): number | null => {
  try {
    const raw = storage?.getItem(key);
    if (!raw) return null;
    const id = Number(raw);
    return Number.isSafeInteger(id) && id >= 0 ? id : null;
  } catch {
    return null;
  }
};

/** Saves the choice; a blocked or full storage is shrugged off. */
export const saveHatchTab = (key: string, id: number, storage: Storage | null = defaultStorage()): void => {
  try {
    storage?.setItem(key, String(id));
  } catch {
    // Nothing to do: the tabs still work, they just will not remember.
  }
};
