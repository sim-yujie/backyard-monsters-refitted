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
  SMALL_DEVICE_1X_SHEETS,
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

  it("draws Fomor level 6 from its 1x copy on a phone or a 4096 card, where its @2x would fit (beta 9)", () => {
    const fomor6 = "monsters/fly_6-repaint@4x.png";
    const size = { width: 1984, height: 735 };
    // A phone (Medium at most): the 1x copy, never the @2x.
    expect(sheetForDevice(fomor6, size, 4096, "medium", true)).toBe("monsters/fly_6-repaint.png");
    expect(sheetForDevice(fomor6, size, 8192, "medium", true)).toBe("monsters/fly_6-repaint.png");
    expect(sheetForDevice(fomor6, size, null, "medium", true)).toBe("monsters/fly_6-repaint.png");
    // A desktop whose card holds 4096: High steps down past the @2x as well.
    expect(sheetForDevice(fomor6, size, 4096, "high", false)).toBe("monsters/fly_6-repaint.png");
    // A desktop with a bigger card keeps the copy its Quality asks for.
    expect(sheetForDevice(fomor6, size, 8192, "medium", false)).toBe("monsters/fly_6-repaint@2x.png");
    expect(sheetForDevice(fomor6, size, 8192, "high", false)).toBe(fomor6);
    // Other sheets keep their @2x on a phone.
    expect(sheetForDevice("monsters/fly_4-repaint@4x.png", { width: 1920, height: 644 }, 4096, "medium", true)).toBe(
      "monsters/fly_4-repaint@2x.png",
    );
  });

  it("draws Korath 3 and 2, Drull 3 and Gorgo 3 from their 1x copy on a phone or a 4096 card too (beta 9, merge-plus4)", () => {
    const sheets = [
      { name: "monsters/korath_3", size: { width: 2048, height: 1836 } },
      { name: "monsters/korath_2", size: { width: 1904, height: 1377 } },
      { name: "monsters/dragon_3", size: { width: 1824, height: 1275 } },
      { name: "monsters/ape_3", size: { width: 1648, height: 1320 } },
    ];
    for (const { name, size } of sheets) {
      const painted = `${name}-repaint@4x.png`;
      expect(SMALL_DEVICE_1X_SHEETS.has(painted)).toBe(true);
      // A phone (Medium at most): the 1x copy, never the @2x.
      expect(sheetForDevice(painted, size, 4096, "medium", true)).toBe(`${name}-repaint.png`);
      expect(sheetForDevice(painted, size, 8192, "medium", true)).toBe(`${name}-repaint.png`);
      expect(sheetForDevice(painted, size, null, "medium", true)).toBe(`${name}-repaint.png`);
      // Low on a phone stays the 1x.
      expect(sheetForDevice(painted, size, 4096, "low", true)).toBe(`${name}-repaint.png`);
      // A desktop whose card holds 4096: High steps down past the @2x as well.
      expect(sheetForDevice(painted, size, 4096, "high", false)).toBe(`${name}-repaint.png`);
      // A desktop with a bigger card keeps the copy its Quality asks for.
      expect(sheetForDevice(painted, size, 8192, "medium", false)).toBe(`${name}-repaint@2x.png`);
      expect(sheetForDevice(painted, size, 16384, "high", false)).toBe(painted);
    }
    // The other levels of the same monsters keep their @2x on a phone.
    expect(sheetForDevice("monsters/korath_1-repaint@4x.png", { width: 1152, height: 833 }, 4096, "medium", true)).toBe(
      "monsters/korath_1-repaint@2x.png",
    );
    expect(sheetForDevice("monsters/ape_2-repaint@4x.png", { width: 1424, height: 1095 }, 4096, "medium", true)).toBe(
      "monsters/ape_2-repaint@2x.png",
    );
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

  it("holds the music on a chosen Low always, on a chosen Medium until it was once turned on here", () => {
    const store = storage();
    setQuality("high", store);
    expect(musicHeld("high", store)).toBe(false);
    setQuality("low", store);
    expect(musicHeld("low", store)).toBe(true);
    noteMusicTurnedOn("low", store);
    setQuality("medium", store);
    expect(musicHeld("medium", store)).toBe(true);
    noteMusicTurnedOn("medium", store);
    expect(musicHeld("medium", store)).toBe(false);
    setQuality("low", store);
    expect(musicHeld("low", store)).toBe(true);
  });

  it("plays the music as normal on a Medium the device chose, never turned on before (owner, 17 Nov 2026)", () => {
    const store = storage();
    expect(qualityChoice(store)).toBeNull();
    expect(quality(store, () => "medium")).toBe("medium");
    expect(musicHeld("medium", store)).toBe(false);
    // Still the lighter copy of the tune.
    expect(lightMusic("medium")).toBe(true);
    // Choosing Medium in Settings then holds it, as before.
    setQuality("medium", store);
    expect(musicHeld("medium", store)).toBe(true);
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
