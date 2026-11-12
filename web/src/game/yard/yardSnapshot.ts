import { isTrapType } from "@/game/attack/trapReveal";
import type { Rect } from "./YardGrid";

/**
 * The yard picture a player shares (owner, 2026-11-11, beta 7): the whole
 * yard, centred, every building in frame and no trap anywhere in it, for the
 * Discord yard-showcase channel. A player shows off a layout without giving
 * away where the traps are.
 *
 * This file is the arithmetic and the words: which buildings stay out, where
 * the camera looks, the caption and the file name. The drawing is
 * `YardRenderer.snapshot`; the window is `ui/yard/YardSnapshotPanel.ts`.
 */

/** The picture's size: 1920 x 1080, which Discord shows whole, without a crop. */
export const SNAPSHOT_SIZE = { width: 1920, height: 1080 } as const;
export type SnapshotSize = { readonly width: number; readonly height: number };

/** Grass left round the buildings, as a share of their own width and height on each side. */
export const SNAPSHOT_PADDING = 0.05;

/**
 * The most a world pixel is enlarged. A small yard is drawn bigger to fill
 * the picture, but the art is made at twice its world size, so past 1.5 it
 * starts to blur; a yard that small gets more grass round it instead.
 */
export const SNAPSHOT_MAX_SCALE = 1.5;

/** Outside the ground: the game page's own dark. */
export const SNAPSHOT_BACKGROUND = "#11141a";

/** The parts of a building the picture asks about. */
export interface SnapshotBuilding {
  readonly id: number;
  readonly type: number;
}

/**
 * The buildings the picture leaves out: every trap, the Booby Trap (24) and
 * the Heavy Trap (117), on any yard (main, outpost and Inferno use the same
 * two ids; `yardSnapshot.test.ts` checks the cost tables have no other).
 *
 * Left out means drawn nowhere: no sprite, no shadow, no tile, and no say in
 * the framing, so a trap at the edge cannot widen the picture towards itself.
 */
export const snapshotHiddenIds = (buildings: Iterable<SnapshotBuilding>): number[] => {
  const ids: number[] = [];
  for (const building of buildings) if (isTrapType(building.type)) ids.push(building.id);
  return ids;
};

/** The smallest rectangle holding every one given, or null for none. */
export const unionRect = (rects: Iterable<Rect | null>): Rect | null => {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const rect of rects) {
    if (!rect || !(rect.width >= 0) || !(rect.height >= 0)) continue;
    if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)) continue;
    left = Math.min(left, rect.x);
    top = Math.min(top, rect.y);
    right = Math.max(right, rect.x + rect.width);
    bottom = Math.max(bottom, rect.y + rect.height);
  }
  if (left === Infinity) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
};

/** The parts of a Pixi sprite its drawn box is worked out from. */
export interface SpriteLike {
  readonly visible: boolean;
  readonly x: number;
  readonly y: number;
  readonly anchor: { readonly x: number; readonly y: number };
  readonly scale: { readonly x: number; readonly y: number };
  readonly texture: { readonly orig: { readonly width: number; readonly height: number } };
}

/**
 * Where a sprite is drawn in its parent's space: its picture, moved by its
 * anchor and stretched by its scale (a flipped sprite's negative scale
 * included). Null for a hidden sprite or an empty picture. The yard's sprites
 * are never turned, so rotation is not asked about.
 */
export const spriteBox = (sprite: SpriteLike): Rect | null => {
  if (!sprite.visible) return null;
  const { width, height } = sprite.texture.orig;
  if (!(width > 0) || !(height > 0)) return null;
  const x1 = sprite.x - sprite.anchor.x * width * sprite.scale.x;
  const x2 = sprite.x + (1 - sprite.anchor.x) * width * sprite.scale.x;
  const y1 = sprite.y - sprite.anchor.y * height * sprite.scale.y;
  const y2 = sprite.y + (1 - sprite.anchor.y) * height * sprite.scale.y;
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
};

/** Where the picture looks: a world rectangle, and world pixels to picture pixels. */
export interface SnapshotFrame {
  readonly frame: Rect;
  readonly scale: number;
}

/**
 * Frames `content` (the buildings as drawn) in a picture of `size`: centred
 * on it, with {@link SNAPSHOT_PADDING} of grass on every side, as large as
 * the picture allows but never past `maxScale`. The frame always has the
 * picture's own shape, so nothing is squashed; the spare room is grass.
 *
 * An empty yard (`content` null or flat) frames `fallback`, the whole plot.
 */
export const snapshotFrame = (
  content: Rect | null,
  fallback: Rect,
  size: SnapshotSize = SNAPSHOT_SIZE,
  maxScale = SNAPSHOT_MAX_SCALE,
): SnapshotFrame => {
  const subject = content && content.width > 0 && content.height > 0 ? content : fallback;
  const paddedWidth = Math.max(1, subject.width * (1 + SNAPSHOT_PADDING * 2));
  const paddedHeight = Math.max(1, subject.height * (1 + SNAPSHOT_PADDING * 2));
  const scale = Math.min(size.width / paddedWidth, size.height / paddedHeight, maxScale);
  const width = size.width / scale;
  const height = size.height / scale;
  const centreX = subject.x + subject.width / 2;
  const centreY = subject.y + subject.height / 2;
  return { frame: { x: centreX - width / 2, y: centreY - height / 2, width, height }, scale };
};

/** Who the yard is: the caption's first line. */
export interface SnapshotCaption {
  readonly name?: string | null | undefined;
  readonly level?: number | null | undefined;
}

export const SNAPSHOT_GAME_NAME = "Backyard Monsters Revamped";

/**
 * The caption in the picture's corner, top line first: the player's name and
 * level (either may be missing), then the game's name. No web address
 * (owner, 2026-11-11).
 */
export const captionLines = (caption: SnapshotCaption): string[] => {
  const name = caption.name?.trim() ?? "";
  const level = caption.level !== null && caption.level !== undefined && caption.level > 0 ? `Level ${caption.level}` : "";
  const who = [name, level].filter((part) => part.length > 0).join(" · ");
  return who ? [who, SNAPSHOT_GAME_NAME] : [SNAPSHOT_GAME_NAME];
};

/**
 * The saved file's name: `bymr-yard-<name>-<date>.png`, the name cut to
 * letters, digits and dashes so every system takes it. The date is the
 * player's own day.
 */
export const snapshotFileName = (name: string | null | undefined, when: Date = new Date()): string => {
  const safe = (name ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    .toLowerCase();
  const pad = (value: number): string => String(value).padStart(2, "0");
  const day = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`;
  return safe ? `bymr-yard-${safe}-${day}.png` : `bymr-yard-${day}.png`;
};
