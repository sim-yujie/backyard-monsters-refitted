/**
 * Monster and champion portraits (issue #34): the painted ones where they
 * exist, the game server's original art where they do not.
 *
 * The paintings were made with Gemini from the original Kixeye art and
 * approved by the owner (docs/art/portraits.md). They sit in
 * `web/public/portraits/`, written by `web/tools/gen-portraits.py`:
 *
 * - `<id>.webp`, a monster's card (360x240, its painted ground kept), and
 *   `<id>-icon.webp`, a 112 px square round the creature;
 * - `G<n>-L<l>.webp`, a champion at a level (176 px, the whole frame, so the
 *   creature grows with its level as it did in the original art), and
 *   `G<n>-L<l>-icon.webp`, 72 px trimmed to the creature. Krallen (G5) has
 *   one painting for every level: `G5.webp` and `G5-icon.webp`.
 *
 * Every portrait carries the original file as its fallback, shown if the
 * painted one fails to load ({@link showPortrait}). The folder is outside
 * `/assets` because the dev server proxies that prefix to the game server
 * (see `game/maproom/tribeAvatars.ts`).
 */

/** The monsters with a painting: C1-C17, C19 and the Inferno ones IC1-IC8. */
export const PAINTED_MONSTERS: ReadonlySet<string> = new Set([
  ...Array.from({ length: 17 }, (_, i) => `C${i + 1}`),
  "C19",
  ...Array.from({ length: 8 }, (_, i) => `IC${i + 1}`),
]);

/**
 * The champion levels with a painting, or "all" for one painting that serves
 * every level. To add one: run the generator, then add its level here.
 */
export const PAINTED_CHAMPION_LEVELS: Readonly<Record<string, readonly number[] | "all">> = {
  G1: [1, 2, 3, 4, 5, 6],
  G2: [1, 2, 3, 4, 5, 6],
  G3: [1, 2, 3, 4, 5, 6],
  // Level 6 is still being painted.
  G4: [1, 2, 3, 4, 5],
  G5: "all",
};

/** A picture to show, and the one to try if it does not load. */
export interface Portrait {
  readonly src: string;
  readonly fallback: string | null;
}

/** `card` for the big picture on a monster's card, `icon` for a row or a slot. */
export type PortraitSize = "card" | "icon";

const painted = (file: string): string => `${import.meta.env.BASE_URL}portraits/${file}.webp`;

const portrait = (paintedFile: string | null, original: string): Portrait =>
  paintedFile === null ? { src: original, fallback: null } : { src: painted(paintedFile), fallback: original };

/** A monster's portrait; the originals are `-portrait.jpg` (180x120) and `-small.png` (45x40). */
export const monsterPortrait = (id: string, size: PortraitSize): Portrait =>
  portrait(
    PAINTED_MONSTERS.has(id) ? (size === "card" ? id : `${id}-icon`) : null,
    `/assets/monsters/${id}-${size === "card" ? "portrait.jpg" : "small.png"}`,
  );

/** The painting's file name (no extension) for a champion at a level, or null. */
export const paintedChampionFile = (id: string, level: number): string | null => {
  const levels = PAINTED_CHAMPION_LEVELS[id];
  if (levels === undefined) return null;
  if (levels === "all") return id;
  return levels.includes(level) ? `${id}-L${level}` : null;
};

/**
 * A champion's portrait at a level (below 1, or not a number, counts as 1);
 * the originals are `G1_L3-150.png` and `G1_L3-small.png`. The caller clamps
 * the level to the champion's top one where it knows it.
 */
export const championPortrait = (id: string, level: number, size: PortraitSize): Portrait => {
  const at = Math.max(1, Math.trunc(level) || 1);
  const file = paintedChampionFile(id, at);
  return portrait(
    file === null ? null : size === "card" ? file : `${file}-icon`,
    `/assets/monsters/${id}_L${at}-${size === "card" ? "150" : "small"}.png`,
  );
};

/**
 * Points an image at a portrait. If the painted file fails, the image tries
 * the original once, and that error is kept from the image's other `error`
 * listeners; so add this before any listener of the caller's own, which then
 * hears only the last failure.
 */
export const showPortrait = (image: HTMLImageElement, picture: Portrait): void => {
  image.src = picture.src;
  const { fallback } = picture;
  if (fallback === null) return;
  image.addEventListener(
    "error",
    (event) => {
      event.stopImmediatePropagation();
      image.src = fallback;
    },
    { once: true },
  );
};
