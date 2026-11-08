// @vitest-environment jsdom
import { existsSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { COIN_ART_KEY, COIN_ARTS, coinArt, coinArtFile, pickCoinArt, resetCoinArt } from "./eventCoinArt";
import { GAME_ICON_SIDES, gameIconUrl } from "./gameIcon";

/** The event coin's three painted options, switched with `?coin=` (owner, 8 Nov). */

const PUBLIC_ICONS = path.resolve(__dirname, "../../public/ui/icons");

const memoryStore = (): Storage => {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, value),
  };
};

afterEach(() => resetCoinArt());

describe("event coin art", () => {
  it("defaults to option A, the copper paw token", () => {
    expect(pickCoinArt(null, null)).toBe("a");
    expect(coinArt("", memoryStore())).toBe("a");
    expect(coinArtFile("a")).toBe("eventcoin");
  });

  it("?coin= picks an option and keeps it; ?coin=auto forgets it", () => {
    const store = memoryStore();
    expect(coinArt("?coin=b", store)).toBe("b");
    expect(store.getItem(COIN_ART_KEY)).toBe("b");
    resetCoinArt();
    expect(coinArt("", store)).toBe("b");
    resetCoinArt();
    expect(coinArt("?coin=auto", store)).toBe("a");
    expect(store.getItem(COIN_ART_KEY)).toBeNull();
  });

  it("ignores an unknown option", () => {
    expect(pickCoinArt("z", null)).toBe("a");
    expect(pickCoinArt("z", "c")).toBe("c");
  });

  it("serves the chosen option's files under the eventcoin icon", () => {
    coinArt("?coin=c", memoryStore());
    expect(gameIconUrl("eventcoin", 24)).toMatch(/ui\/icons\/eventcoinc-24\.webp$/);
    expect(gameIconUrl("health", 24)).toMatch(/ui\/icons\/health-24\.webp$/);
  });

  it("ships every option at every side", () => {
    for (const art of COIN_ARTS) {
      for (const side of GAME_ICON_SIDES) {
        expect(existsSync(path.join(PUBLIC_ICONS, `${coinArtFile(art)}-${side}.webp`))).toBe(true);
      }
    }
  });
});
