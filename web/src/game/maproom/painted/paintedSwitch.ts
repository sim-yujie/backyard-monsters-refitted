import { classicLook } from "@/game/classicLook";

/**
 * Whether Map Room 2 wears the painted look (plan step 2, switch `MR2_PAINTED_MAP`).
 *
 * The server decides per account (`off | staff | on`) and sends `flags.mr2painted` with the base
 * load. Classic always keeps the tile map. For development a browser can override it with
 * `?mr2look=on|off` on the page address or `bymr.mr2Look` in local storage; turning it ON that way
 * works only in a development build, so players cannot open an unfinished look by hand.
 */
export const MR2_LOOK_KEY = "bymr.mr2Look";

export interface PaintedSwitchFacts {
  /** The base load's `flags.mr2painted`. */
  serverFlag: unknown;
  classic?: boolean;
  search?: string;
  store?: Pick<Storage, "getItem"> | null;
  dev?: boolean;
}

const choiceOf = (raw: string | null | undefined): boolean | null => {
  const value = raw?.trim().toLowerCase();
  if (value === "on" || value === "1" || value === "true") return true;
  if (value === "off" || value === "0" || value === "false") return false;
  return null;
};

const browserStore = (): Pick<Storage, "getItem"> | null => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
};

export const paintedMapOn = ({
  serverFlag,
  classic = classicLook(),
  search = typeof location === "undefined" ? "" : location.search,
  store = browserStore(),
  dev = import.meta.env.DEV,
}: PaintedSwitchFacts): boolean => {
  if (classic) return false;
  let kept: string | null = null;
  try {
    kept = store?.getItem(MR2_LOOK_KEY) ?? null;
  } catch {
    kept = null;
  }
  const local = choiceOf(new URLSearchParams(search).get("mr2look")) ?? choiceOf(kept);
  if (local === false) return false;
  if (local === true && dev) return true;
  return Number(serverFlag) > 0;
};
