import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { decodePng, encodePng, type RgbaImage } from "../../utils/png.js";

/**
 * The in-game check's picture (#273, `botChallenge.ts`): "how many of these
 * are in the picture?", drawn on the server, so the client gets pixels and
 * nothing else. No monster id, position or count leaves the server: a bot has
 * to see the picture to answer.
 *
 * The scene is {@link PICTURE_WIDTH} x {@link PICTURE_HEIGHT} of the yard's
 * own grass (`assets/yardbg/grass/`, laid on the grid the yard lays it on),
 * with `count` of the target monster and {@link DECOYS_MIN}-{@link DECOYS_MAX}
 * other monsters at random places, each scaled by up to
 * {@link SCALE_JITTER} either way, some flipped, their brightness nudged.
 * Monsters may overlap, but every target keeps at least
 * {@link TARGET_MIN_VISIBLE} of itself in view and lies wholly inside the
 * picture, so a person can always count them. The art is the original
 * Kixeye monster art (`assets/monsters/C<n>-150.png`); the reference picture
 * beside the question is the painted portrait (`assets/botcheck/`), a
 * different rendering, so it cannot simply be matched pixel for pixel.
 *
 * Everything comes from `random`, so one seed always draws one picture: the
 * check keeps the seed, not the picture. The source art is decoded once and
 * kept.
 */

export const PICTURE_WIDTH = 480;
export const PICTURE_HEIGHT = 300;
/** A monster's longer side before its jitter, in pixels. */
export const MONSTER_SIZE = 64;
/** Each monster's size varies by up to this much either way. */
export const SCALE_JITTER = 0.2;
export const DECOYS_MIN = 4;
export const DECOYS_MAX = 10;
/** The least of a target that may be hidden behind later monsters is 1 minus this. */
export const TARGET_MIN_VISIBLE = 0.7;
/** The monsters with original art to draw: C1-C15. */
export const SCENE_MONSTERS: readonly string[] = Array.from({ length: 15 }, (_, i) => `C${i + 1}`);

/** A pixel counts as part of a monster, for overlap, from this alpha up. */
const SOLID_ALPHA = 96;
const PLACE_TRIES = 80;
const SCENE_TRIES = 30;
const BRIGHTNESS_JITTER = 0.08;
/** The plain grasses of the yard's seven grounds (`web/src/game/yard/YardGround.ts`); one per picture. */
const GRASS_TILES = ["2174_isograss1_isograss1.png", "2175_isograss2_isograss2.png", "2173_isograss4_isograss4.png"];

const ASSETS = fileURLToPath(new URL("../../../public/assets/", import.meta.url));

const cache = new Map<string, RgbaImage>();

/** Decodes a PNG under `public/assets/` once, cropped to its visible pixels when `crop`. */
const art = (path: string, crop: boolean): RgbaImage => {
  const key = `${crop ? "crop:" : ""}${path}`;
  const kept = cache.get(key);
  if (kept) return kept;
  const image = decodePng(readFileSync(`${ASSETS}${path}`));
  const out = crop ? cropToAlpha(image) : image;
  cache.set(key, out);
  return out;
};

const cropToAlpha = (image: RgbaImage): RgbaImage => {
  const { width, height, data } = image;
  let [left, top, right, bottom] = [width, height, -1, -1];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3]! === 0) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  if (right < 0) return image;
  const w = right - left + 1;
  const h = bottom - top + 1;
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    out.set(data.subarray(((top + y) * width + left) * 4, ((top + y) * width + left + w) * 4), y * w * 4);
  }
  return { width: w, height: h, data: out };
};

const monsterArt = (monster: string): RgbaImage => art(`monsters/${monster}-150.png`, true);

/**
 * The art at a new size, each pixel the average of a few samples across the
 * source pixels it covers (alpha-weighted, so edges do not darken), mirrored
 * when `flip`, its colour scaled by `brightness`.
 */
const resample = (image: RgbaImage, width: number, height: number, flip: boolean, brightness: number): RgbaImage => {
  const out = new Uint8Array(width * height * 4);
  const sx = image.width / width;
  const sy = image.height / height;
  const nx = Math.max(1, Math.ceil(sx));
  const ny = Math.max(1, Math.ceil(sy));
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let [r, g, b, a] = [0, 0, 0, 0];
      for (let j = 0; j < ny; j += 1) {
        const v = Math.min(image.height - 1, Math.floor((y + (j + 0.5) / ny) * sy));
        for (let i = 0; i < nx; i += 1) {
          const u = Math.min(image.width - 1, Math.floor((x + (i + 0.5) / nx) * sx));
          const at = (v * image.width + u) * 4;
          const alpha = image.data[at + 3]!;
          r += image.data[at]! * alpha;
          g += image.data[at + 1]! * alpha;
          b += image.data[at + 2]! * alpha;
          a += alpha;
        }
      }
      const to = (y * width + (flip ? width - 1 - x : x)) * 4;
      if (a === 0) continue;
      out[to] = Math.min(255, (r / a) * brightness);
      out[to + 1] = Math.min(255, (g / a) * brightness);
      out[to + 2] = Math.min(255, (b / a) * brightness);
      out[to + 3] = a / (nx * ny);
    }
  }
  return { width, height, data: out };
};

/** One monster in the scene. */
export interface Placed {
  readonly sprite: RgbaImage;
  readonly x: number;
  readonly y: number;
  readonly monster: string;
  readonly target: boolean;
  /** Its solid pixels, as indexes into the picture. */
  readonly solid: Int32Array;
}

/** A sprite's solid pixels as offsets into the picture from its top-left corner. */
const solidOffsets = (sprite: RgbaImage): Int32Array => {
  const out: number[] = [];
  for (let j = 0; j < sprite.height; j += 1) {
    for (let i = 0; i < sprite.width; i += 1) {
      if (sprite.data[(j * sprite.width + i) * 4 + 3]! >= SOLID_ALPHA) out.push(j * PICTURE_WIDTH + i);
    }
  }
  return Int32Array.from(out);
};

/**
 * Places the monsters, in drawing order, so that no target ends up less than
 * {@link TARGET_MIN_VISIBLE} in view. Null when the targets will not fit.
 */
const layout = (
  sprites: readonly { sprite: RgbaImage; monster: string; target: boolean }[],
  random: () => number
): Placed[] | null => {
  /** Which placed monster is on top at each pixel; -1 for grass. */
  const top = new Int16Array(PICTURE_WIDTH * PICTURE_HEIGHT).fill(-1);
  const visible: number[] = [];
  const placed: Placed[] = [];
  /** Per placed monster, the pixels a candidate would cover. */
  const lost = new Int32Array(sprites.length);
  for (const { sprite, monster, target } of sprites) {
    const offsets = solidOffsets(sprite);
    let done = false;
    for (let attempt = 0; attempt < PLACE_TRIES && !done; attempt += 1) {
      const x = Math.floor(random() * (PICTURE_WIDTH - sprite.width + 1));
      const y = Math.floor(random() * (PICTURE_HEIGHT - sprite.height + 1));
      const base = y * PICTURE_WIDTH + x;
      lost.fill(0);
      for (const offset of offsets) {
        const under = top[base + offset]!;
        if (under >= 0) lost[under] = lost[under]! + 1;
      }
      let fits = true;
      for (let under = 0; under < placed.length && fits; under += 1) {
        const it = placed[under]!;
        if (it.target && visible[under]! - lost[under]! < TARGET_MIN_VISIBLE * it.solid.length) fits = false;
      }
      if (!fits) continue;
      for (let under = 0; under < placed.length; under += 1) visible[under] = visible[under]! - lost[under]!;
      const index = placed.length;
      const solid = offsets.map((offset) => base + offset);
      for (const pixel of solid) top[pixel] = index;
      placed.push({ sprite, monster, x, y, target, solid });
      visible.push(solid.length);
      done = true;
    }
    if (!done && target) return null;
  }
  return placed;
};

/** Lays one grass on the yard's plain 200 x 100 grid, shifted at random. */
const grass = (random: () => number): Uint8Array => {
  const out = new Uint8Array(PICTURE_WIDTH * PICTURE_HEIGHT * 4);
  const tile = art(`yardbg/grass/${GRASS_TILES[Math.floor(random() * GRASS_TILES.length)]}`, false);
  const ox = Math.floor(random() * tile.width);
  const oy = Math.floor(random() * tile.height);
  for (let ty = -oy; ty < PICTURE_HEIGHT; ty += tile.height) {
    for (let tx = -ox; tx < PICTURE_WIDTH; tx += tile.width) {
      for (let y = Math.max(0, ty); y < Math.min(PICTURE_HEIGHT, ty + tile.height); y += 1) {
        for (let x = Math.max(0, tx); x < Math.min(PICTURE_WIDTH, tx + tile.width); x += 1) {
          const from = ((y - ty) * tile.width + (x - tx)) * 4;
          const to = (y * PICTURE_WIDTH + x) * 4;
          out[to] = tile.data[from]!;
          out[to + 1] = tile.data[from + 1]!;
          out[to + 2] = tile.data[from + 2]!;
          out[to + 3] = 255;
        }
      }
    }
  }
  return out;
};

/** A soft shadow under a monster's feet, as the yard's monsters have. */
const shadow = (picture: Uint8Array, { sprite, x, y }: Placed): void => {
  const cx = x + sprite.width / 2;
  const cy = y + sprite.height * 0.92;
  const rx = sprite.width * 0.38;
  const ry = Math.max(3, sprite.height * 0.1);
  for (let py = Math.floor(cy - ry); py <= Math.ceil(cy + ry); py += 1) {
    for (let px = Math.floor(cx - rx); px <= Math.ceil(cx + rx); px += 1) {
      if (px < 0 || py < 0 || px >= PICTURE_WIDTH || py >= PICTURE_HEIGHT) continue;
      const d = ((px - cx) / rx) ** 2 + ((py - cy) / ry) ** 2;
      if (d >= 1) continue;
      const dark = 1 - 0.3 * (1 - d);
      const at = (py * PICTURE_WIDTH + px) * 4;
      picture[at] = picture[at]! * dark;
      picture[at + 1] = picture[at + 1]! * dark;
      picture[at + 2] = picture[at + 2]! * dark;
    }
  }
};

const draw = (picture: Uint8Array, { sprite, x, y }: Placed): void => {
  for (let j = 0; j < sprite.height; j += 1) {
    for (let i = 0; i < sprite.width; i += 1) {
      const from = (j * sprite.width + i) * 4;
      const alpha = sprite.data[from + 3]! / 255;
      if (alpha === 0) continue;
      const to = ((y + j) * PICTURE_WIDTH + x + i) * 4;
      for (let c = 0; c < 3; c += 1) picture[to + c] = picture[to + c]! * (1 - alpha) + sprite.data[from + c]! * alpha;
    }
  }
};

const shuffle = <T>(items: T[], random: () => number): T[] => {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [items[i], items[j]] = [items[j]!, items[i]!];
  }
  return items;
};

/** One monster's art, sized, flipped and lit at random. */
const instance = (monster: string, random: () => number): RgbaImage => {
  const source = monsterArt(monster);
  const scale = (MONSTER_SIZE * (1 - SCALE_JITTER + random() * 2 * SCALE_JITTER)) / Math.max(source.width, source.height);
  return resample(
    source,
    Math.max(1, Math.round(source.width * scale)),
    Math.max(1, Math.round(source.height * scale)),
    random() < 0.5,
    1 - BRIGHTNESS_JITTER + random() * 2 * BRIGHTNESS_JITTER
  );
};

/**
 * Places a check's monsters: `count` of `target` and the decoys, in drawing
 * order. Exported for the tests, which hold every target to the rules.
 */
export const layoutScene = (target: string, count: number, random: () => number): Placed[] => {
  const others = SCENE_MONSTERS.filter((monster) => monster !== target);
  for (let attempt = 0; attempt < SCENE_TRIES; attempt += 1) {
    const decoys = DECOYS_MIN + Math.floor(random() * (DECOYS_MAX - DECOYS_MIN + 1));
    const sprites = shuffle(
      [
        ...Array.from({ length: count }, () => ({ sprite: instance(target, random), monster: target, target: true })),
        ...Array.from({ length: decoys }, () => {
          const monster = others[Math.floor(random() * others.length)]!;
          return { sprite: instance(monster, random), monster, target: false };
        }),
      ],
      random
    );
    const placed = layout(sprites, random);
    if (placed !== null) return placed;
  }
  throw new Error(`bot check: ${count} of ${target} would not fit in the picture`);
};

/**
 * Draws a check's picture: `count` of `target` among other monsters.
 *
 * @param random - Numbers in [0, 1); a seeded generator, so a seed always gives the same picture.
 * @returns The picture as an opaque PNG.
 */
export const renderPicture = (target: string, count: number, random: () => number): Buffer => {
  const placed = layoutScene(target, count, random);
  const picture = grass(random);
  for (const monster of placed) {
    shadow(picture, monster);
    draw(picture, monster);
  }
  return encodePng({ width: PICTURE_WIDTH, height: PICTURE_HEIGHT, data: picture });
};

const referenceCache = new Map<string, Buffer>();

/** The painted portrait shown beside the question (`assets/botcheck/<id>-icon.webp`), as the file's bytes. */
export const referencePicture = (target: string): Buffer => {
  const kept = referenceCache.get(target);
  if (kept) return kept;
  const bytes = readFileSync(`${ASSETS}botcheck/${target}-icon.webp`);
  referenceCache.set(target, bytes);
  return bytes;
};
