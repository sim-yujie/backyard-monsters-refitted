import { describe, expect, it, vi } from "vitest";
import { quality, qualityChoice } from "./quality";
import { takeQualityParam } from "./qualityParam";
import { SAFE_MODE_KEY, safeModeCap } from "./safeMode";

/** Patch 7.11: `?quality=low` in the address, the way out when the game closes before Settings can be reached. */

const storage = (entries: Record<string, string> = {}): Storage => {
  const kept = new Map(Object.entries(entries));
  return {
    getItem: (key: string) => kept.get(key) ?? null,
    setItem: (key: string, value: string) => void kept.set(key, value),
    removeItem: (key: string) => void kept.delete(key),
  } as Storage;
};

const past = () => ({ state: { kept: 1 }, replaceState: vi.fn() });

describe("?quality= in the address", () => {
  it("is saved as the player's choice and taken out of the address, other parameters and the hash kept", () => {
    const store = storage();
    const history = past();
    const taken = takeQualityParam({ href: "https://play.example/game/?skin=flash&quality=low&x=1#yard" }, history, store);
    expect(taken).toBe("low");
    expect(qualityChoice(store)).toBe("low");
    expect(history.replaceState).toHaveBeenCalledTimes(1);
    expect(history.replaceState).toHaveBeenCalledWith({ kept: 1 }, "", "/game/?skin=flash&x=1#yard");
  });

  it("takes each level, in any case, and leaves a bare address behind", () => {
    for (const [asked, level] of [
      ["high", "high"],
      ["medium", "medium"],
      ["LOW", "low"],
    ] as const) {
      const store = storage();
      const history = past();
      expect(takeQualityParam({ href: `https://play.example/?quality=${asked}` }, history, store)).toBe(level);
      expect(qualityChoice(store)).toBe(level);
      expect(history.replaceState).toHaveBeenCalledWith({ kept: 1 }, "", "/");
    }
  });

  it("clears safe mode's cap", () => {
    const store = storage({ [SAFE_MODE_KEY]: JSON.stringify({ cap: "low", loads: { a: "medium" } }) });
    expect(quality(store, () => "high")).toBe("low");
    takeQualityParam({ href: "https://play.example/?quality=high" }, past(), store);
    expect(safeModeCap(store)).toBeNull();
    expect(store.getItem(SAFE_MODE_KEY)).toBeNull();
    expect(quality(store, () => "medium")).toBe("high");
  });

  it("ignores anything that is not a level, and an address without it", () => {
    for (const href of [
      "https://play.example/?quality=ultra",
      "https://play.example/?quality=",
      "https://play.example/?qualityx=low",
      "https://play.example/#quality=low",
      "https://play.example/",
    ]) {
      const store = storage({ "bymr.quality": "medium", [SAFE_MODE_KEY]: JSON.stringify({ cap: "low", loads: {} }) });
      const history = past();
      expect(takeQualityParam({ href }, history, store)).toBeNull();
      expect(qualityChoice(store)).toBe("medium");
      expect(safeModeCap(store)).toBe("low");
      expect(history.replaceState).not.toHaveBeenCalled();
    }
  });

  it("with site data blocked, holds for this page load and does not throw", () => {
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
    const history = past();
    expect(takeQualityParam({ href: "https://play.example/?quality=low" }, history, blocked)).toBe("low");
    expect(quality(blocked, () => "high")).toBe("low");
    expect(history.replaceState).toHaveBeenCalledWith({ kept: 1 }, "", "/");
    // A choice that can be written again replaces it.
    const store = storage();
    takeQualityParam({ href: "https://play.example/?quality=high" }, past(), store);
    expect(qualityChoice(storage())).toBeNull();
  });

  it("does not throw when the address bar cannot be changed, or there is no browser", () => {
    const store = storage();
    const history = {
      state: null,
      replaceState: () => {
        throw new Error("no");
      },
    };
    expect(takeQualityParam({ href: "https://play.example/?quality=medium" }, history, store)).toBe("medium");
    expect(qualityChoice(store)).toBe("medium");
    expect(takeQualityParam(undefined, undefined, store)).toBeNull();
    expect(takeQualityParam({ href: "not an address" }, past(), store)).toBeNull();
  });
});
