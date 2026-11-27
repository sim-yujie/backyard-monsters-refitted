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
 * painted one fails to load ({@link showPortrait}), and the only picture with
 * the player's Classic look on (`game/classicLook.ts`). The folder is outside
 * `/assets` because the dev server proxies that prefix to the game server
 * (see `game/maproom/tribeAvatars.ts`).
 */

import { classicLook } from "./classicLook";
import { artUrl } from "../artUrl";
import { hasSkin, type MonsterSkin } from "./attack/monsterSkins";

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
  G4: [1, 2, 3, 4, 5, 6],
  G5: "all",
  // Krampus, the frost tribe's champion (beta 10): an enemy this Christmas.
  G6: [1, 2, 3, 4, 5, 6],
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
  paintedFile === null || classicLook() ? { src: original, fallback: null } : { src: painted(paintedFile), fallback: original };

/** A monster's portrait; the originals are `-portrait.jpg` (180x120) and `-small.png` (45x40). */
export const monsterPortrait = (id: string, size: PortraitSize, skin?: MonsterSkin): Portrait =>
  skin && hasSkin(id, skin)
    ? // A skin's portraits (`monsterSkins.ts`): the painted frost card, then the frost Flash portrait.
      portrait(
        `${skin}/${size === "card" ? id : `${id}-icon`}`,
        artUrl(`/assets/monsters/${skin}/${id}-${size === "card" ? "portrait.jpg" : "small.png"}`),
      )
    : portrait(
    PAINTED_MONSTERS.has(id) ? (size === "card" ? id : `${id}-icon`) : null,
    artUrl(`/assets/monsters/${id}-${size === "card" ? "portrait.jpg" : "small.png"}`),
  );

/** The painting's file name (no extension) for a champion at a level, or null. */
export const paintedChampionFile = (id: string, level: number): string | null => {
  const levels = PAINTED_CHAMPION_LEVELS[id];
  if (levels === undefined) return null;
  if (levels === "all") return id;
  return levels.includes(level) ? `${id}-L${level}` : null;
};

/**
 * The champions whose original art is one picture for every level, as the
 * only files the server has: Krallen's are `G5_L6-150.png` (the cage's
 * `_kothPreviewURL`, `client/scripts/CHAMPIONCAGEPOPUP.as:122`) and
 * `G5_L5-small.png`.
 */
export const ORIGINAL_CHAMPION_LEVEL: Readonly<Record<string, Readonly<Record<PortraitSize, number>>>> = {
  G5: { card: 6, icon: 5 },
};

/**
 * A champion's portrait at a level (below 1, or not a number, counts as 1);
 * the originals are `G1_L3-150.png` and `G1_L3-small.png`. The caller clamps
 * the level to the champion's top one where it knows it.
 */
export const championPortrait = (id: string, level: number, size: PortraitSize): Portrait => {
  const at = Math.max(1, Math.trunc(level) || 1);
  const file = paintedChampionFile(id, at);
  const original = ORIGINAL_CHAMPION_LEVEL[id]?.[size] ?? at;
  return portrait(
    file === null ? null : size === "card" ? file : `${file}-icon`,
    artUrl(`/assets/monsters/${id}_L${original}-${size === "card" ? "150" : "small"}.png`),
  );
};

type CreatureBox = readonly [left: number, top: number, right: number, bottom: number];

/**
 * Where the creature sits in a champion's whole-frame portrait at levels 1
 * to 6, as fractions of the frame (alpha bounds of `G<n>-L<l>.webp`). The
 * originals (`G<n>_L<l>-150.png`) share the layout, so one table serves
 * both looks. The Cage keeps the whole frame, so a champion grows with its
 * level; a small card that must show the creature at any level crops to
 * this instead ({@link championCrop}). Krallen (G5) is never cropped.
 */
export const CHAMPION_CREATURE_BOX: Readonly<Record<string, readonly CreatureBox[]>> = {
  G1: [[0.176, 0.278, 0.778, 0.761], [0.119, 0.188, 0.869, 0.818], [0.068, 0.114, 0.949, 0.858], [0.074, 0.068, 0.938, 0.955], [0.057, 0.017, 0.96, 0.966], [0.028, 0.017, 0.994, 1]],
  G2: [[0.165, 0.398, 0.801, 0.75], [0.085, 0.324, 0.949, 0.773], [0.062, 0.188, 1, 0.932], [0.006, 0.085, 0.943, 0.943], [0.045, 0.051, 1, 0.966], [0.006, 0.023, 1, 0.972]],
  G3: [[0.324, 0.409, 0.653, 0.648], [0.261, 0.358, 0.699, 0.693], [0.188, 0.278, 0.795, 0.75], [0.17, 0.159, 0.926, 0.812], [0.131, 0.165, 0.966, 0.949], [0.062, 0.023, 0.989, 0.932]],
  G4: [[0.165, 0.415, 0.705, 0.722], [0.08, 0.33, 0.852, 0.818], [0.057, 0.216, 0.835, 0.886], [0.034, 0.188, 0.807, 0.898], [0.011, 0.119, 0.858, 0.92], [0.011, 0.102, 0.875, 0.938]],
};

/** A square crop of a whole-frame portrait: the image's width and offsets in % of the square box. */
export interface PortraitCrop {
  readonly size: number;
  readonly x: number;
  readonly y: number;
}

/**
 * The square round a champion's creature at a level (clamped to 1..6), with
 * a little room, as the image's width and offsets in % of a square box; null
 * when the champion has no table (Krallen).
 */
export const championCrop = (id: string, level: number): PortraitCrop | null => {
  const boxes = CHAMPION_CREATURE_BOX[id];
  if (boxes === undefined || boxes.length === 0) return null;
  const at = Math.min(Math.max(Math.trunc(level) || 1, 1), boxes.length);
  const [left, top, right, bottom] = boxes[at - 1]!;
  const side = Math.min(1, Math.max(right - left, bottom - top) * 1.08);
  const startX = (left + right) / 2 - side / 2;
  const startY = (top + bottom) / 2 - side / 2;
  const round = (value: number): number => Math.round(value * 10) / 10;
  return { size: round(100 / side), x: round((-startX / side) * 100), y: round((-startY / side) * 100) };
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
