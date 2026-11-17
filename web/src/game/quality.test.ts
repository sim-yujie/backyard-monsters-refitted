import { afterEach, describe, expect, it } from "vitest";
import {
  defaultQuality,
  deviceDefaultQuality,
  deviceMemoryGb,
  deviceTextureLimit,
  probeTextureLimit,
  setDeviceDefaultQuality,
  setDeviceTextureLimit,
  lightMusic,
  mapRefreshSeconds,
  musicHeld,
  noteMusicTurnedOn,
  onQualityChange,
  quality,
  qualityChoice,
  setQuality,
  sheetAtQuality,
  sheetForDevice,
} from "./quality";

/** A stand-in for the browser's storage. */
const storage = (entries: Record<string, string> = {}): Storage => {
  const kept = new Map(Object.entries(entries));
  return {
    getItem: (key: string) => kept.get(key) ?? null,
    setItem: (key: string, value: string) => void kept.set(key, value),
  } as Storage;
};

describe("quality", () => {
  it("is High until the player picks one, and ignores anything else kept", () => {
    expect(quality(storage())).toBe("high");
    expect(qualityChoice(storage())).toBeNull();
    expect(quality(storage({ "bymr.quality": "ultra" }))).toBe("high");
    expect(quality(storage({ "bymr.quality": "low" }))).toBe("low");
    expect(quality(null)).toBe("high");
  });

  it("keeps the pick and tells whoever listens", () => {
    const store = storage();
    const heard: string[] = [];
    const stop = onQualityChange((level) => heard.push(level));
    setQuality("medium", store);
    stop();
    setQuality("low", store);
    expect(quality(store)).toBe("low");
    expect(heard).toEqual(["medium"]);
  });
});

describe("sheetAtQuality", () => {
  it("asks for the painted sheet on High, the @2x copy on Medium and the 1x copy on Low", () => {
    expect(sheetAtQuality("monsters/pokey-anim@4x.png", "high")).toBe("monsters/pokey-anim@4x.png");
    expect(sheetAtQuality("monsters/pokey-anim@4x.png", "medium")).toBe("monsters/pokey-anim@2x.png");
    expect(sheetAtQuality("monsters/pokey-anim@4x.png", "low")).toBe("monsters/pokey-anim.png");
    expect(sheetAtQuality("monsters/korath@3x.png", "medium")).toBe("monsters/korath@2x.png");
  });

  it("asks for the @1.5x copy on Medium of a sheet painted at 2x (Korath 5 and 6)", () => {
    expect(sheetAtQuality("monsters/korath_5-repaint@2x.png", "high")).toBe("monsters/korath_5-repaint@2x.png");
    expect(sheetAtQuality("monsters/korath_5-repaint@2x.png", "medium")).toBe("monsters/korath_5-repaint@1.5x.png");
    expect(sheetAtQuality("monsters/korath_5-repaint@2x.png", "low")).toBe("monsters/korath_5-repaint.png");
  });

  it("steps down to a copy the graphics card can hold", () => {
    // Gorgo 5's painting: 2560 x 2192 at 1x, so 10240 px wide at 4x.
    const gorgo = { width: 2560, height: 2192 };
    const file = "monsters/ape_5-repaint@4x.png";
    expect(sheetForDevice(file, gorgo, 16384, "high")).toBe(file);
    expect(sheetForDevice(file, gorgo, 8192, "high")).toBe("monsters/ape_5-repaint@2x.png");
    expect(sheetForDevice(file, gorgo, 4096, "high")).toBe("monsters/ape_5-repaint.png");
    // Never up: Low stays Low however big the card.
    expect(sheetForDevice(file, gorgo, 16384, "low")).toBe("monsters/ape_5-repaint.png");
    // Too big even at 1x, or the card not known yet: the copy asked for (the sheet cutter copes).
    expect(sheetForDevice(file, gorgo, 2048, "high")).toBe("monsters/ape_5-repaint.png");
    expect(sheetForDevice(file, gorgo, null, "high")).toBe(file);
    // Korath 5, packed (4000 x 3888 at 1x): its 2x High fits 8192, not 4096.
    const korath = { width: 4000, height: 3888 };
    expect(sheetForDevice("monsters/korath_5-repaint@2x.png", korath, 8192, "high")).toBe("monsters/korath_5-repaint@2x.png");
    expect(sheetForDevice("monsters/korath_5-repaint@2x.png", korath, 4096, "high")).toBe("monsters/korath_5-repaint.png");
  });

  it("leaves a sheet that is not a big painting alone", () => {
    expect(sheetAtQuality("monsters/spurtz.png", "low")).toBe("monsters/spurtz.png");
    expect(sheetAtQuality("monsters/small@1x.png", "low")).toBe("monsters/small@1x.png");
  });
});

describe("music and the map on each level", () => {
  it("streams the lighter yard tune on Medium and Low", () => {
    expect([lightMusic("high"), lightMusic("medium"), lightMusic("low")]).toEqual([false, true, true]);
  });

  it("holds the music on Low always, on Medium until it was once turned on here", () => {
    const store = storage();
    expect(musicHeld("high", store)).toBe(false);
    expect(musicHeld("low", store)).toBe(true);
    expect(musicHeld("medium", store)).toBe(true);
    noteMusicTurnedOn("low", store);
    expect(musicHeld("medium", store)).toBe(true);
    noteMusicTurnedOn("medium", store);
    expect(musicHeld("medium", store)).toBe(false);
    expect(musicHeld("low", store)).toBe(true);
  });

  it("asks the map a third as often on Low", () => {
    expect(mapRefreshSeconds(60, "high")).toBe(60);
    expect(mapRefreshSeconds(60, "medium")).toBe(60);
    expect(mapRefreshSeconds(60, "low")).toBe(180);
  });
});

describe("the default Quality (old phones, owner 17 Nov 2026)", () => {
  afterEach(() => {
    setDeviceDefaultQuality(null);
    setDeviceTextureLimit(null);
  });

  const MEMORIES = [2, 4, 8, null] as const;
  const LIMITS = [4096, 8192, 16384] as const;

  for (const memoryGb of MEMORIES) {
    for (const textureLimit of LIMITS) {
      const low = (memoryGb !== null && memoryGb <= 4) || textureLimit <= 4096;
      const expected = low ? "medium" : "high";
      it(`is ${expected} with ${memoryGb ?? "unreported"} GB and a ${textureLimit} px limit, and a stored choice always wins`, () => {
        const fallback = (): ReturnType<typeof defaultQuality> => defaultQuality({ memoryGb, textureLimit });
        expect(fallback()).toBe(expected);
        expect(quality(storage(), fallback)).toBe(expected);
        for (const chosen of ["high", "medium", "low"] as const) {
          expect(quality(storage({ "bymr.quality": chosen }), fallback)).toBe(chosen);
        }
      });
    }
  }

  it("is High where the device says nothing", () => {
    expect(defaultQuality({ memoryGb: null, textureLimit: null })).toBe("high");
    expect(defaultQuality({ memoryGb: 0.5, textureLimit: null })).toBe("medium");
    expect(defaultQuality({ memoryGb: null, textureLimit: 2048 })).toBe("medium");
  });

  it("never writes the default down", () => {
    const store = storage();
    expect(quality(store, () => "medium")).toBe("medium");
    expect(qualityChoice(store)).toBeNull();
    expect(store.getItem("bymr.quality")).toBeNull();
  });

  it("reads navigator.deviceMemory, and nothing from a browser that does not say", () => {
    expect(deviceMemoryGb({ deviceMemory: 2 })).toBe(2);
    expect(deviceMemoryGb({ deviceMemory: 0.5 })).toBe(0.5);
    expect(deviceMemoryGb({})).toBeNull();
    expect(deviceMemoryGb({ deviceMemory: "8" })).toBeNull();
    expect(deviceMemoryGb(undefined)).toBeNull();
  });

  it("asks a throwaway WebGL context for the texture limit and lets it go", () => {
    let lost = 0;
    const asked: string[] = [];
    const gl = {
      MAX_TEXTURE_SIZE: 0x0d33,
      getParameter: (name: number) => (name === 0x0d33 ? 4096 : null),
      getExtension: (name: string) => (name === "WEBGL_lose_context" ? { loseContext: () => void (lost += 1) } : null),
    };
    const canvas = {
      getContext: (kind: string) => {
        asked.push(kind);
        return kind === "webgl" ? gl : null;
      },
    } as unknown as HTMLCanvasElement;
    expect(probeTextureLimit(() => canvas)).toBe(4096);
    expect(asked).toEqual(["webgl2", "webgl"]);
    expect(lost).toBe(1);
    expect(probeTextureLimit(() => null)).toBeNull();
    expect(
      probeTextureLimit(() => ({ getContext: () => { throw new Error("blocked"); } }) as unknown as HTMLCanvasElement),
    ).toBeNull();
  });

  it("decides the device's default once a page load, from the renderer's limit when it is known", () => {
    setDeviceTextureLimit(4096);
    expect(deviceDefaultQuality()).toBe("medium");
    // Decided: a later limit does not flip it mid-visit.
    setDeviceTextureLimit(16384);
    expect(deviceDefaultQuality()).toBe("medium");
    setDeviceDefaultQuality(null);
    expect(deviceDefaultQuality()).toBe("high");
    expect(deviceTextureLimit()).toBe(16384);
  });
});
