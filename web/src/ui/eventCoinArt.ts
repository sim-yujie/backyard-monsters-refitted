/**
 * Which painted event coin the game shows (owner, 8 Nov 2026: "make the event
 * coins look more different compared to shiny"). Three options were painted
 * by Codex (`art-samples/event-coin/codex/b`, compared with Shiny in
 * `art-samples/coin-options.png`):
 *
 * - `a` (the default): a copper hexagon token with a monster paw print,
 *   files `ui/icons/eventcoin-<side>.webp`.
 * - `b`: a purple and teal gem, `eventcoinb-<side>.webp`.
 * - `c`: a red and gold ribbon medal, `eventcoinc-<side>.webp`.
 *
 * For the owner's review, `?coin=a|b|c` picks one and keeps it in this
 * browser (`?coin=auto` forgets it), like `?skin=` (`skin.ts`). Once the
 * owner picks, ship the pick as `eventcoin` and drop the others.
 */
export const COIN_ARTS = ["a", "b", "c"] as const;
export type CoinArt = (typeof COIN_ARTS)[number];

export const COIN_ART_KEY = "bymr.coinArt";

const isCoinArt = (value: string | null | undefined): value is CoinArt =>
  (COIN_ARTS as readonly string[]).includes(value ?? "");

/** The tester's `?coin=` first, then the one kept in this browser, else `a`. */
export const pickCoinArt = (asked: string | null, saved: string | null): CoinArt => {
  if (isCoinArt(asked)) return asked;
  if (asked !== "auto" && isCoinArt(saved)) return saved;
  return "a";
};

/** The icon file name (before `-<side>.webp`) of an option. */
export const coinArtFile = (art: CoinArt): string => (art === "a" ? "eventcoin" : `eventcoin${art}`);

const storage = (): Storage | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

let chosen: CoinArt | null = null;

/** Reads `?coin=` (and keeps or forgets it); the answer is fixed for the page's life. */
export const coinArt = (search: string = location.search, store: Storage | null = storage()): CoinArt => {
  if (chosen) return chosen;
  const asked = new URLSearchParams(search).get("coin");
  let saved: string | null = null;
  try {
    if (asked === "auto") store?.removeItem(COIN_ART_KEY);
    else if (isCoinArt(asked)) store?.setItem(COIN_ART_KEY, asked);
    saved = store?.getItem(COIN_ART_KEY) ?? null;
  } catch {
    saved = null;
  }
  chosen = pickCoinArt(asked, saved);
  return chosen;
};

/** Forgets the page's choice (tests). */
export const resetCoinArt = (): void => {
  chosen = null;
};
