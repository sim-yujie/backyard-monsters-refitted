// @vitest-environment jsdom
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setClassicLook } from "@/game/classicLook";
import {
  CLASSIC_GROUND_KEY,
  CLASSIC_GROUNDS,
  currentGround,
  GROUND_KEY,
  GROUNDS,
  groundUrls,
  MODERN_GROUNDS,
  onGroundChange,
  pickGround,
  resetGroundForTests,
  saveGround,
  savedGround,
} from "./groundChoice";

/** The yard ground the player picks (owner, 12 Nov 2026). */

const memory = (): Storage => {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, String(value)),
  };
};

const PUBLIC = path.resolve(__dirname, "../../../public");
const SERVER_PUBLIC = path.resolve(__dirname, "../../../../server/public");

afterEach(() => {
  setClassicLook(false);
  resetGroundForTests();
  localStorage.clear();
});

describe("the saved ground", () => {
  it("defaults to Meadow in Modern and Flash's grass in Classic", () => {
    const store = memory();
    expect(savedGround(false, store)).toBe("meadow");
    expect(savedGround(true, store)).toBe("original");
  });

  it("is saved and loaded per look", () => {
    const store = memory();
    expect(saveGround(false, "snow", store)).toBe(true);
    expect(saveGround(true, "crater", store)).toBe(true);
    expect(savedGround(false, store)).toBe("snow");
    expect(savedGround(true, store)).toBe("crater");
    expect(store.getItem(GROUND_KEY)).toBe("snow");
    expect(store.getItem(CLASSIC_GROUND_KEY)).toBe("crater");
  });

  it("forgets the key when the default is picked again", () => {
    const store = memory();
    saveGround(false, "swamp", store);
    saveGround(false, "meadow", store);
    expect(store.getItem(GROUND_KEY)).toBeNull();
  });

  it("falls back to the look's default for an unknown value, or one the look does not offer", () => {
    const store = memory();
    store.setItem(GROUND_KEY, "lava");
    expect(savedGround(false, store)).toBe("meadow");
    store.setItem(GROUND_KEY, "crater");
    expect(savedGround(false, store)).toBe("meadow");
    store.setItem(CLASSIC_GROUND_KEY, "snow");
    expect(savedGround(true, store)).toBe("original");
    expect(saveGround(true, "snow", store)).toBe(false);
  });

  it("stays on the default when site data is blocked", () => {
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    } as unknown as Storage;
    expect(savedGround(false, blocked)).toBe("meadow");
    expect(saveGround(false, "snow", blocked)).toBe(false);
    expect(saveGround(false, "snow", null)).toBe(false);
  });
});

describe("picking a ground", () => {
  it("reads the page's look once and tells the yard at once when the pick changes", () => {
    setClassicLook(true);
    expect(currentGround()).toBe("original");
    const heard = vi.fn();
    const stop = onGroundChange(heard);
    expect(pickGround("sand")).toBe(true);
    expect(currentGround()).toBe("sand");
    expect(localStorage.getItem(CLASSIC_GROUND_KEY)).toBe("sand");
    expect(heard).toHaveBeenCalledWith("sand");
    // The same pick again is no change; a Modern-only ground is refused in Classic.
    pickGround("sand");
    expect(pickGround("snow")).toBe(false);
    expect(heard).toHaveBeenCalledTimes(1);
    stop();
  });
});

describe("the art", () => {
  it("offers Flash's four in Classic (Flash's own subscriber choice) and the painted ones in Modern", () => {
    expect(CLASSIC_GROUNDS).toEqual(["original", "rock", "sand", "crater"]);
    for (const id of CLASSIC_GROUNDS) expect(GROUNDS[id].painted).toBe(false);
    expect(MODERN_GROUNDS[0]).toBe("meadow");
    expect(MODERN_GROUNDS).toContain("original");
  });

  it("picks the painted copy by Quality", () => {
    const snow = GROUNDS.snow;
    expect(groundUrls(snow, "high")).toEqual({ urls: [1, 2, 3, 4].map((n) => `/assets/yardbg/snow/layer${n}@2x.webp`), scale: 2 });
    expect(groundUrls(snow, "medium").urls[0]).toBe("/assets/yardbg/snow/layer1@1.5x.webp");
    expect(groundUrls(snow, "medium").scale).toBe(1.5);
    expect(groundUrls(snow, "low")).toEqual({ urls: [1, 2, 3, 4].map((n) => `/assets/yardbg/snow/layer${n}.webp`), scale: 1 });
    // Flash's tiles have one size.
    expect(groundUrls(GROUNDS.original, "low")).toEqual(groundUrls(GROUNDS.original, "high"));
  });

  it("ships every image at every size, light enough for slow internet, and a swatch for each", () => {
    for (const spec of Object.values(GROUNDS)) {
      for (const level of ["high", "medium", "low"] as const) {
        for (const url of groundUrls(spec, level).urls) {
          const file = path.join(SERVER_PUBLIC, url);
          expect(existsSync(file), file).toBe(true);
          if (spec.painted) expect(statSync(file).size, file).toBeLessThan(level === "high" ? 60_000 : 30_000);
        }
      }
      expect(existsSync(path.join(PUBLIC, "ui", "grounds", `${spec.id}.webp`)), spec.id).toBe(true);
    }
  });

  it("blends a painted ground's 400 x 200 images into an 800 x 400 block, Flash's 200 x 100 into 1000 x 500", () => {
    expect(GROUNDS.meadow.tile.map((side, i) => side * GROUNDS.meadow.repeat[i]!)).toEqual([800, 400]);
    expect(GROUNDS.original.tile.map((side, i) => side * GROUNDS.original.repeat[i]!)).toEqual([1000, 500]);
    for (const spec of Object.values(GROUNDS)) {
      expect(spec.ramps?.length ?? 0).toBeLessThan(spec.files.length);
    }
  });
});
