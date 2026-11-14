import { existsSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Assets, Texture } from "pixi.js";
import { setClassicLook } from "@/game/classicLook";
import {
  CLASSIC_MUSHROOMS,
  loadMushroomArt,
  MODERN_MUSHROOMS,
  MUSHROOM_ART_ROOT,
  MUSHROOM_VARIANTS,
  type MushroomPicture,
  mushroomAnchor,
  mushroomArtIndex,
  mushroomPictureFor,
  mushroomPictures,
} from "./mushroomArt";
import { MUSHROOM_HIT } from "./mushroomPick";
import { RETRY_DELAYS_MS, versionedArt } from "./retryLoad";

const ASSETS = new URL("../../../../server/public/assets/", import.meta.url);
const onDisk = (file: string): URL => new URL(MUSHROOM_ART_ROOT.slice("/assets/".length) + file, ASSETS);

/** A PNG's width and height, from its `IHDR`. */
const pngSize = (url: URL): [number, number] => {
  const bytes = readFileSync(url);
  expect(bytes.toString("latin1", 12, 16), url.pathname).toBe("IHDR");
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
};

/** A WebP with alpha's width and height, from its `VP8X` header. */
const webpSize = (url: URL): [number, number] => {
  const bytes = readFileSync(url);
  expect(bytes.toString("latin1", 12, 16), url.pathname).toBe("VP8X");
  return [bytes.readUIntLE(24, 3) + 1, bytes.readUIntLE(27, 3) + 1];
};

/** A picture's size in world px: an `@2x` file counts half. */
const worldSize = ([file]: MushroomPicture): [number, number] => {
  if (!file.includes("@2x")) return pngSize(onDisk(file));
  const [w, h] = webpSize(onDisk(file));
  expect(w % 2, file).toBe(0);
  expect(h % 2, file).toBe(0);
  return [w / 2, h / 2];
};

describe("the yard mushrooms' pictures (owner, 12 Nov 2026)", () => {
  afterEach(() => {
    setClassicLook(false);
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("has Flash's five in Classic and five Modern ones, one per art variant", () => {
    expect(CLASSIC_MUSHROOMS).toHaveLength(MUSHROOM_VARIANTS);
    expect(MODERN_MUSHROOMS).toHaveLength(MUSHROOM_VARIANTS);
    for (const [file] of CLASSIC_MUSHROOMS) expect(file).toMatch(/^classic-[1-5]\.png$/);
    for (const [file] of MODERN_MUSHROOMS) expect(file).toMatch(/^modern-[1-5]@2x\.webp$/);
  });

  it("follows the Classic/Modern switch", () => {
    setClassicLook(true);
    expect(mushroomPictures()).toBe(CLASSIC_MUSHROOMS);
    setClassicLook(false);
    expect(mushroomPictures()).toBe(MODERN_MUSHROOMS);
  });

  it.each([...CLASSIC_MUSHROOMS, ...MODERN_MUSHROOMS])("%s is on disk, stands on its spot, inside the tap box's top", (...picture) => {
    const [file, x, y] = picture as unknown as MushroomPicture;
    expect(existsSync(onDisk(file)), file).toBe(true);
    const [w, h] = worldSize([file, x, y]);
    // The spot is inside the picture (its shadow reaches further right and down), near its bottom.
    expect(x).toBeLessThan(-MUSHROOM_HIT.left / 2);
    expect(x + w).toBeGreaterThan(MUSHROOM_HIT.right / 2);
    expect(y + h, file).toBeGreaterThan(0);
    expect(y + h, file).toBeLessThanOrEqual(24);
    // A tap on the cap's top still lands on it.
    expect(y, file).toBeGreaterThanOrEqual(-MUSHROOM_HIT.top);
  });

  it("picks each mushroom's picture from its save's variant, the first for anything else", () => {
    expect([1, 2, 3, 4, 5].map(mushroomArtIndex)).toEqual([0, 1, 2, 3, 4]);
    for (const odd of [0, 6, -1, 2.5, Number.NaN]) expect(mushroomArtIndex(odd)).toBe(0);
    expect(mushroomPictureFor(3, CLASSIC_MUSHROOMS)).toBe(CLASSIC_MUSHROOMS[2]);
  });

  it("anchors a sprite on the mushroom's spot", () => {
    expect(mushroomAnchor(["x.png", -30, -40], 60, 50)).toEqual({ x: 0.5, y: 0.8 });
  });

  it("loads this look's five, and leaves a missing one out", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    setClassicLook(true);
    const broken = versionedArt(MUSHROOM_ART_ROOT + "classic-4.png");
    const load = vi
      .spyOn(Assets, "load")
      .mockImplementation(((url: string) =>
        url === broken ? Promise.reject(new Error("gone")) : Promise.resolve(Texture.WHITE)) as typeof Assets.load);

    const loading = loadMushroomArt(() => false);
    for (const delay of RETRY_DELAYS_MS) await vi.advanceTimersByTimeAsync(delay);
    const textures = await loading;

    expect(textures).toEqual([Texture.WHITE, Texture.WHITE, Texture.WHITE, null, Texture.WHITE]);
    for (const [file] of CLASSIC_MUSHROOMS) expect(load).toHaveBeenCalledWith(versionedArt(MUSHROOM_ART_ROOT + file));
  });
});
