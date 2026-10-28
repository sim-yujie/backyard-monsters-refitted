/**
 * The player's "Classic art" choice in Account Settings (owner, 28 Oct 2026:
 * the original Flash art, for nostalgia): one switch for every picture the
 * revamp repainted. With it on, the game draws the Flash art instead:
 *
 * - the buildings: the Town Hall and the tower tiers, painted or 3D
 *   (`tierArtFor` in `yard/buildingArtTiers.ts`);
 * - the monsters and champions, in battle, in the yard and in the guide: the
 *   Flash sheet with the Flash table row's layout, anchor and headings
 *   (`sheetUrl`, `spriteFor` and `sheetColumn` in `attack/monsterSprites.ts`);
 * - the monster and champion portraits (`game/portraits.ts`).
 *
 * Not the battle effects (the towers' painted shots, the screen shake): they
 * have their own settings. Nor new pictures with no Flash one to go back to
 * (Bob, the eggs, the badges, the status stickers).
 *
 * Remembered in this browser like the other display settings and read once
 * when the game loads, so a page never mixes the two looks.
 */

/** Where this browser keeps the choice ("1" is on). */
export const CLASSIC_ART_KEY = "bymr.classicArt";

/**
 * The key the choice had while it covered only the buildings ("Classic
 * building art", beta 4); still read, so a player who turned it on keeps it.
 */
export const OLD_CLASSIC_ART_KEY = "bymr.classicBuildingArt";

const storage = (): Storage | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

/** Saves the choice for the next time the game loads. True if it was saved. */
export const saveClassicArt = (on: boolean, store: Storage | null = storage()): boolean => {
  try {
    if (on) store?.setItem(CLASSIC_ART_KEY, "1");
    else store?.removeItem(CLASSIC_ART_KEY);
    store?.removeItem(OLD_CLASSIC_ART_KEY);
    return store !== null;
  } catch {
    return false;
  }
};

/** The saved choice, as the dialog shows it and the game reads it at load; false when site data is blocked. */
export const savedClassicArt = (store: Storage | null = storage()): boolean => {
  try {
    return store?.getItem(CLASSIC_ART_KEY) === "1" || store?.getItem(OLD_CLASSIC_ART_KEY) === "1";
  } catch {
    return false;
  }
};

let classicArtOn = savedClassicArt();

/** Whether the Flash art is on, read once when the game loads. */
export const classicArt = (): boolean => classicArtOn;

/** Turns the Flash art on or off for this page, without saving it; for tests. */
export const setClassicArt = (on: boolean): void => {
  classicArtOn = on;
};
