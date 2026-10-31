import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { setClassicLook } from "@/game/classicLook";
import { ArtState, artFolder, resolveArt, restingLayers } from "./buildingArt";
import { BUILDING_ART_ROWS } from "./buildingArtData";
import { BUILDING_3D_ART, tierArtFor } from "./buildingArtTiers";

/** The game server's assets, which the 3D pictures are served from. */
const ASSETS = fileURLToPath(new URL("../../../../server/public/assets/", import.meta.url));

/** The eight 3D yard buildings (owner, 31 Oct 2026: "All approved"). */
const TYPES = [1, 2, 3, 4, 6, 13, 15, 16];
/** The ones whose parts move, as Flash's do; Housing and the Control Center stand still. */
const MOVING = [1, 2, 3, 4, 6, 13];

/**
 * The looks whose model reaches past Flash's picture, `[left, top, right, bottom]` in px each edge may differ: the
 * Putty Squisher's first vial stands 8 px further right and its last wheel 12 px higher, the third Hatchery's front
 * foot 9 px lower.
 */
const WIDER: Record<string, Box> = { "3:1": [6, 6, 8, 6], "3:10": [6, 12, 6, 6], "13:3": [6, 6, 6, 9] };

/** A WebP's size in pixels, from its `VP8X` header (every picture with alpha has one). */
const webpSize = (file: string): [number, number] => {
  const bytes = readFileSync(file);
  expect(bytes.toString("latin1", 12, 16), file).toBe("VP8X");
  return [bytes.readUIntLE(24, 3) + 1, bytes.readUIntLE(27, 3) + 1];
};

/** The Flash row's looks for a type: each look's first level, its strip's cells and its offset. */
const flashLooks = (type: number) => BUILDING_ART_ROWS.find((row) => row[0] === type)?.[3] ?? [];

/** `[left, top, right, bottom]` in 1x px from the building's origin. */
type Box = [number, number, number, number];

/** A PNG's alpha, `[width, height, alpha]`: 8 or 16 bit RGB(A), not interlaced, all Flash's buildings are. */
const pngAlpha = (file: string): [number, number, Uint8Array] => {
  const bytes = readFileSync(file);
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  const [depth, colour, , , interlace] = bytes.subarray(24, 29);
  expect([depth === 8 || depth === 16, colour === 2 || colour === 6, interlace], file).toEqual([true, true, 0]);
  const idat: Buffer[] = [];
  for (let at = 8; at < bytes.length; ) {
    const length = bytes.readUInt32BE(at);
    if (bytes.toString("latin1", at + 4, at + 8) === "IDAT") idat.push(bytes.subarray(at + 8, at + 8 + length));
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const pixel = ((colour === 6 ? 4 : 3) * (depth ?? 8)) / 8;
  const stride = width * pixel;
  const rows = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let i = 0; i < stride; i++) {
      const a = i >= pixel ? (rows[y * stride + i - pixel] ?? 0) : 0;
      const b = y > 0 ? (rows[(y - 1) * stride + i] ?? 0) : 0;
      const c = y > 0 && i >= pixel ? (rows[(y - 1) * stride + i - pixel] ?? 0) : 0;
      const p = a + b - c;
      const nearest = Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c;
      const add = [0, a, b, (a + b) >> 1, nearest][filter ?? 0] ?? 0;
      rows[y * stride + i] = ((raw[y * (stride + 1) + 1 + i] ?? 0) + add) & 255;
    }
  }
  // An RGB picture is opaque all over; a 16 bit alpha's high byte is enough.
  const alpha = new Uint8Array(width * height).fill(255);
  if (colour === 6) for (let i = 0; i < alpha.length; i++) alpha[i] = rows[i * pixel + pixel - (depth === 16 ? 2 : 1)] ?? 0;
  return [width, height, alpha];
};

/** What a Flash picture (or a strip's first cell) at `x`, `y` draws: its pixels over 2/255 alpha. */
const drawn = (file: string, x: number, y: number, cellWidth?: number, cellHeight?: number): Box => {
  const [width, height, alpha] = pngAlpha(file);
  const [w, h] = [cellWidth ?? width, cellHeight ?? height];
  const box: Box = [Infinity, Infinity, -Infinity, -Infinity];
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      if ((alpha[j * width + i] ?? 0) <= 2) continue;
      box[0] = Math.min(box[0], i);
      box[1] = Math.min(box[1], j);
      box[2] = Math.max(box[2], i + 1);
      box[3] = Math.max(box[3], j + 1);
    }
  }
  return [x + box[0], y + box[1], x + box[2], y + box[3]];
};

const union = (boxes: Box[]): Box => [
  Math.min(...boxes.map((box) => box[0])),
  Math.min(...boxes.map((box) => box[1])),
  Math.max(...boxes.map((box) => box[2])),
  Math.max(...boxes.map((box) => box[3])),
];

afterEach(() => setClassicLook(false));

describe("the 3D yard buildings", () => {
  it("are the eight approved, one look for each of Flash's", () => {
    expect(Object.keys(BUILDING_3D_ART).map(Number)).toEqual(TYPES);
    for (const type of TYPES) {
      expect(BUILDING_3D_ART[type]?.map((look) => look.from), `type ${type}`).toEqual(
        flashLooks(type).map((look) => look[0]),
      );
    }
  });

  it("show with the Modern look at every level, the right look for each", () => {
    for (const type of TYPES) {
      const looks = BUILDING_3D_ART[type] ?? [];
      for (let level = 0; level <= 10; level++) {
        const want = [...looks].reverse().find((look) => look.from <= Math.max(level, 1)) ?? looks[0];
        const art = resolveArt(type, level, ArtState.DEFAULT);
        expect(art?.level, `type ${type} level ${level}`).toBe(want?.from);
        expect(art?.still?.url ?? art?.top.url).toBe(`/assets/${artFolder(type) ?? ""}${want?.top[0] ?? ""}`);
      }
    }
  });

  it("give the Flash buildings back with the Classic look", () => {
    setClassicLook(true);
    for (const type of TYPES) {
      expect(tierArtFor(type, 5)).toBeNull();
      expect(resolveArt(type, 5, ArtState.DEFAULT)?.top.url).not.toContain("3d");
    }
    expect(resolveArt(1, 6, ArtState.DEFAULT)?.top.url).toBe("/assets/buildings/twigsnapper.v2/top.6.png");
  });

  it("move as Flash's do: the same cells, the moving parts over a body without them", () => {
    for (const type of MOVING) {
      for (const look of BUILDING_3D_ART[type] ?? []) {
        const flash = flashLooks(type).find((one) => one[0] === look.from);
        const art = resolveArt(type, look.from, ArtState.DEFAULT);
        expect(art?.anims, `type ${type} look ${look.from}`).toHaveLength(1);
        expect(art?.anims[0]?.frames).toBe(flash?.[7]?.[0]?.[5]);
        // The body under the cells, the whole building at rest for the icons.
        expect(art?.top.url).toContain("/body.3d");
        expect(art?.still?.url).toContain("/top.3d");
        expect(art?.topIsAnim).toBe(false);
        expect(restingLayers(art!).map((layer) => layer.url)).toEqual([art?.top.url, art?.anims[0]?.url]);
      }
    }
    for (const type of [15, 16]) {
      const art = resolveArt(type, 4, ArtState.DEFAULT);
      expect(art?.anims).toEqual([]);
      expect(art?.still).toBeUndefined();
      expect(art?.top.url).toContain("/top.3d1@2x.webp");
    }
  });

  it("ship every picture, strip and shadow they name, each strip as big as its cells", () => {
    const missing: string[] = [];
    for (const type of TYPES) {
      const folder = `${ASSETS}${artFolder(type) ?? ""}`;
      for (const look of BUILDING_3D_ART[type] ?? []) {
        const files = [look.top[0], look.shadow[0], ...(look.anim ? [look.anim.strip[0], look.anim.body?.[0] ?? ""] : [])];
        for (const file of files) if (!existsSync(folder + file)) missing.push(`${type}: ${file}`);
        if (!look.anim || !existsSync(folder + look.anim.strip[0])) continue;
        const [file, , , width, height, cells] = look.anim.strip;
        const columns = look.anim.columns ?? cells;
        expect(webpSize(folder + file), file).toEqual([2 * width * columns, 2 * height * Math.ceil(cells / columns)]);
      }
    }
    expect(missing).toEqual([]);
  });

  it("stand where Flash's do: what each draws at rest within a few pixels of Flash's", () => {
    const off: string[] = [];
    for (const type of TYPES) {
      const flashFolder = `${ASSETS}${BUILDING_ART_ROWS.find((row) => row[0] === type)?.[2] ?? ""}`;
      for (const look of BUILDING_3D_ART[type] ?? []) {
        const flash = flashLooks(type).find((one) => one[0] === look.from);
        // Flash's building at rest is its top and its strips' first cells (the Hatchery's roof is all strip).
        const boxes: Box[] = [];
        const top = flash?.[1];
        if (top) boxes.push(drawn(flashFolder + top[0], top[1], top[2], top[3], top[4]));
        for (const [file, x, y, width, height] of flash?.[7] ?? []) {
          boxes.push(drawn(flashFolder + file, x, y, width, height));
        }
        const want = union(boxes);
        // The 3D top is cut to what it draws, to the whole 1x px, so its file's box is its building.
        const [file, x, y] = look.top;
        const [width, height] = webpSize(`${ASSETS}${artFolder(type) ?? ""}${file}`);
        const got: Box = [x, y, x + width / 2, y + height / 2];
        const name = `type ${type} look ${look.from}`;
        // Fitted to Flash's outline: every edge within a few pixels, but for the few where the model itself is
        // bigger than Flash's picture (its foot and body still where Flash's are).
        const slack = WIDER[`${type}:${look.from}`] ?? [6, 6, 6, 6];
        if ([0, 1, 2, 3].some((side) => Math.abs((got[side] ?? 0) - (want[side] ?? 0)) > (slack[side] ?? 6))) {
          off.push(`${name}: 3D ${got.join(",")} vs Flash ${want.join(",")}`);
        }
        expect(look.lift, name).toBe(0);
      }
    }
    expect(off).toEqual([]);
  });

  it("keep the picture when damaged and fall to the Flash rubble when destroyed", () => {
    const healthy = resolveArt(4, 10, ArtState.DEFAULT);
    expect(resolveArt(4, 10, ArtState.DAMAGED)?.top.url).toBe(healthy?.top.url);
    const ruin = resolveArt(4, 10, ArtState.DESTROYED);
    expect(ruin?.top.url).toBe("/assets/buildings/goofactory.v2/top.destroyed.png");
    expect(ruin?.anims).toEqual([]);
  });

  it("never show in an Inferno yard: the Inferno's own art there, even where it shares Flash's folder", () => {
    for (const type of TYPES) {
      for (const level of [1, 3, 6, 10]) {
        expect(tierArtFor(type, level, "inferno"), `type ${type} level ${level}`).toBeNull();
        const art = resolveArt(type, level, ArtState.DEFAULT, "inferno");
        if (!art) continue;
        expect(art.top.url, `type ${type} level ${level}`).not.toContain("3d");
        expect(art.still?.url ?? "", `type ${type} level ${level}`).not.toContain("3d");
      }
    }
    // The Compound is the Monster Housing's folder: Flash's housing picture there.
    expect(resolveArt(15, 1, ArtState.DEFAULT, "inferno")?.top.url).toBe(
      `/assets/${artFolder(15) ?? ""}${flashLooks(15)[0]?.[1]?.[0] ?? ""}`,
    );
    // Outposts are overworld yards: the 3D look there too.
    expect(resolveArt(15, 1, ArtState.DEFAULT, "outpost")?.top.url).toContain("/top.3d1@2x.webp");
  });
});
