/**
 * The panel palette proposal (palettes.css): `?palette=toolshed|sticker|charcoal`
 * puts `data-palette` on <html> and remembers it; `?palette=default` goes back
 * to the slate glass. Only a way to show the options side by side, not a
 * player setting.
 */

export const PALETTES = ["toolshed", "sticker", "charcoal"] as const;
export type Palette = (typeof PALETTES)[number];

const STORAGE_KEY = "bymr.palette";

function isPalette(value: string | null): value is Palette {
  return value !== null && (PALETTES as readonly string[]).includes(value);
}

/** The palette asked for in the address, else the one remembered, else none. */
export function pickPalette(search: string, stored: string | null): Palette | null {
  const asked = new URLSearchParams(search).get("palette");
  if (asked !== null) return isPalette(asked) ? asked : null;
  return isPalette(stored) ? stored : null;
}

export function applyPalette(root: HTMLElement = document.documentElement): Palette | null {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
  } catch {
    // Storage blocked: the address alone decides.
  }
  const palette = pickPalette(location.search, stored);
  try {
    if (palette) localStorage.setItem(STORAGE_KEY, palette);
    else if (new URLSearchParams(location.search).has("palette")) localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Not remembered; it still applies now.
  }
  if (palette) root.dataset["palette"] = palette;
  else delete root.dataset["palette"];
  return palette;
}
