/**
 * Window skins (trial): `?skin=flash` dresses every panel in painted game art
 * (skin-flash.css) instead of the slate glass. The choice is remembered on this
 * device; `?skin=off` goes back to the glass.
 */

const SKINS = ["flash"] as const;
const STORE_KEY = "bymr.skin";

export const applySkin = (root: HTMLElement = document.documentElement): void => {
  const asked = new URLSearchParams(location.search).get("skin");
  let skin: string | null = null;
  try {
    if (asked !== null) {
      if (asked === "off") localStorage.removeItem(STORE_KEY);
      else localStorage.setItem(STORE_KEY, asked);
    }
    skin = localStorage.getItem(STORE_KEY);
  } catch {
    skin = asked;
  }
  if (skin && (SKINS as readonly string[]).includes(skin)) root.dataset.skin = skin;
  else delete root.dataset.skin;
};
