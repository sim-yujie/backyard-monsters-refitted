/**
 * The Font choice in Account Settings (owner, 4 Nov 2026: players found the
 * font hard to read). Three choices, all self-hosted under public/fonts/ and
 * declared in tokens.css:
 *
 * - `game` (the default): Titan One everywhere, the look the game always had.
 * - `clear`: Titan One for headings and amounts (`--font-display`), Nunito
 *   for all other text (`--font-body`). Nunito is rounded like Titan One, so
 *   the game keeps its friendly look, but its letters are open and evenly
 *   spaced and read well small.
 * - `readable`: Atkinson Hyperlegible for everything, a face the Braille
 *   Institute made for low vision (letters that are easy to tell apart:
 *   I l 1, O 0, b d).
 *
 * The choice sets `data-font` on <html>; tokens.css swaps the two font
 * variables under it, so every panel changes at once, without a reload, in
 * both the Modern and the Classic window style. Text drawn on the game canvas
 * (timers over buildings, map labels, damage numbers) stays in Titan One.
 *
 * Kept in this browser, like the other display settings.
 */
export type FontChoice = "game" | "clear" | "readable";

export const FONT_CHOICES: readonly FontChoice[] = ["game", "clear", "readable"];

/** Where this browser keeps the choice: "clear" or "readable"; unset is the game font. */
export const FONT_KEY = "bymr.font";

const storage = (): Storage | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

const isFontChoice = (value: unknown): value is FontChoice =>
  value === "game" || value === "clear" || value === "readable";

/** The saved choice; the game font when nothing (or something unknown) is saved, or site data is blocked. */
export const savedFontChoice = (store: Storage | null = storage()): FontChoice => {
  try {
    const value = store?.getItem(FONT_KEY);
    return isFontChoice(value) ? value : "game";
  } catch {
    return "game";
  }
};

/** Shows `choice` on the page: `data-font` on <html>, none for the game font. */
export const showFontChoice = (choice: FontChoice, root: HTMLElement = document.documentElement): void => {
  if (choice === "game") delete root.dataset.font;
  else root.dataset.font = choice;
};

/** Saves the choice and shows it at once. True if it was saved for the next visit. */
export const setFontChoice = (
  choice: FontChoice,
  store: Storage | null = storage(),
  root: HTMLElement = document.documentElement,
): boolean => {
  showFontChoice(choice, root);
  try {
    if (choice === "game") store?.removeItem(FONT_KEY);
    else store?.setItem(FONT_KEY, choice);
    return store !== null;
  } catch {
    return false;
  }
};

/** Shows the saved choice; called once when the game loads, before anything is drawn. */
export const applyFontChoice = (
  root: HTMLElement = document.documentElement,
  store: Storage | null = storage(),
): FontChoice => {
  const choice = savedFontChoice(store);
  showFontChoice(choice, root);
  return choice;
};
