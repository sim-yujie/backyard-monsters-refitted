import { setQuality, type Quality } from "@/game/quality";

/**
 * `?quality=low`, `?quality=medium` or `?quality=high` in the address (patch
 * 7.11): the way out for a player whose game closes before they can reach
 * Settings. Read at page boot, before anything asks for the Quality. It is
 * kept as the player's choice (`setQuality`, which also ends safe mode), and
 * taken out of the address bar so a reload or a shared link does not carry
 * it; other parameters and the hash stay. Anything else after `quality=` is
 * ignored and left alone.
 */
export const takeQualityParam = (
  place: Pick<Location, "href"> | undefined = typeof window === "undefined" ? undefined : window.location,
  past: Pick<History, "replaceState" | "state"> | undefined = typeof window === "undefined" ? undefined : window.history,
  store?: Storage | null,
): Quality | null => {
  try {
    if (!place) return null;
    const url = new URL(place.href);
    const asked = url.searchParams.get("quality")?.toLowerCase();
    if (asked !== "low" && asked !== "medium" && asked !== "high") return null;
    if (store === undefined) setQuality(asked);
    else setQuality(asked, store);
    url.searchParams.delete("quality");
    try {
      past?.replaceState(past.state, "", `${url.pathname}${url.search}${url.hash}`);
    } catch {
      // The address stays as it is; the choice is kept all the same.
    }
    return asked;
  } catch {
    return null;
  }
};
