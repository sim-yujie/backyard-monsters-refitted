import { describe, expect, it } from "vitest";
import {
  lightMusic,
  mapRefreshSeconds,
  musicHeld,
  noteMusicTurnedOn,
  onQualityChange,
  quality,
  qualityChoice,
  setQuality,
  sheetAtQuality,
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
