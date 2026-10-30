/**
 * Window style (owner, 28 Oct 2026): every panel and pop-up is dressed in
 * painted game art (skin.css) that follows the Classic/Modern switch
 * (`game/classicLook.ts`):
 *
 * - **Modern**: "scrap", blue-grey riveted steel with a mustard tin title sign
 *   and orange plate buttons.
 * - **Classic**: "flash", the Flash pop-ups refreshed: cream parchment with a
 *   red ribbon title.
 *
 * For testing, `?skin=scrap`, `?skin=flash` or `?skin=glass` (the plain slate
 * glass from before) picks one on this device and remembers it; `?skin=auto`
 * goes back to following the switch.
 */

import { classicLook } from "@/game/classicLook";

export const SKINS = ["scrap", "flash", "glass"] as const;
export type Skin = (typeof SKINS)[number];

/** Where this browser keeps a tester's `?skin=` choice. */
export const SKIN_KEY = "bymr.skin";

const isSkin = (value: string | null): value is Skin => (SKINS as readonly (string | null)[]).includes(value);

/** The style for this page: a tester's choice if there is one, else the one the Classic/Modern switch asks for. */
export const pickSkin = (asked: string | null, saved: string | null, classic: boolean): Skin => {
  if (asked === "auto") return classic ? "flash" : "scrap";
  if (isSkin(asked)) return asked;
  if (isSkin(saved)) return saved;
  return classic ? "flash" : "scrap";
};

const storage = (): Storage | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

/** Sets `data-skin` on <html>; read once when the game loads, like the Classic/Modern switch. */
export const applySkin = (root: HTMLElement = document.documentElement, store: Storage | null = storage()): Skin => {
  const asked = new URLSearchParams(location.search).get("skin");
  let saved: string | null = null;
  try {
    if (asked === "auto") store?.removeItem(SKIN_KEY);
    else if (isSkin(asked)) store?.setItem(SKIN_KEY, asked);
    saved = store?.getItem(SKIN_KEY) ?? null;
  } catch {
    saved = null;
  }
  const skin = pickSkin(asked, saved, classicLook());
  if (skin === "glass") delete root.dataset.skin;
  else root.dataset.skin = skin;
  return skin;
};
