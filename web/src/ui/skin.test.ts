// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { setClassicLook } from "@/game/classicLook";
import { applySkin, pickSkin, SKIN_KEY } from "./skin";

const memoryStore = (): Storage => {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => void items.delete(key),
    setItem: (key, value) => void items.set(key, value),
  };
};

const visit = (search: string): void => history.replaceState(null, "", `/${search}`);

describe("pickSkin", () => {
  it("follows the Classic/Modern switch: steel for Modern, Flash parchment for Classic", () => {
    expect(pickSkin(null, null, false)).toBe("scrap");
    expect(pickSkin(null, null, true)).toBe("flash");
  });

  it("lets a tester's ?skin= or saved choice win, and ignores names it does not know", () => {
    expect(pickSkin("flash", null, false)).toBe("flash");
    expect(pickSkin(null, "glass", true)).toBe("glass");
    expect(pickSkin("scrap", "flash", true)).toBe("scrap");
    expect(pickSkin("wood", "cardboard", true)).toBe("flash");
  });

  it("goes back to the switch on ?skin=auto, whatever was saved", () => {
    expect(pickSkin("auto", "glass", false)).toBe("scrap");
  });
});

describe("applySkin", () => {
  afterEach(() => {
    setClassicLook(false);
    visit("");
  });

  it("dresses the page in the style the switch asks for", () => {
    const root = document.createElement("html");
    setClassicLook(true);
    expect(applySkin(root, memoryStore())).toBe("flash");
    expect(root.dataset.skin).toBe("flash");
    setClassicLook(false);
    expect(applySkin(root, memoryStore())).toBe("scrap");
    expect(root.dataset.skin).toBe("scrap");
  });

  it("remembers ?skin= on this device until ?skin=auto, and glass takes the skin off", () => {
    const root = document.createElement("html");
    const store = memoryStore();
    visit("?skin=glass");
    expect(applySkin(root, store)).toBe("glass");
    expect(root.dataset.skin).toBeUndefined();
    visit("");
    expect(applySkin(root, store)).toBe("glass");
    visit("?skin=auto");
    expect(applySkin(root, store)).toBe("scrap");
    expect(store.getItem(SKIN_KEY)).toBeNull();
    expect(root.dataset.skin).toBe("scrap");
  });

  it("still follows the switch when site data is blocked", () => {
    const root = document.createElement("html");
    expect(applySkin(root, null)).toBe("scrap");
  });
});

describe("skin.css", () => {
  // The title sign's line-height is calc(height - pad): with a bare `0` that is
  // "48px - 0", which is invalid, so the words rode at the top of the steel sign.
  it("writes every --skin- length with its unit, never a bare 0", () => {
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "styles/skin.css"), "utf8");
    expect(css.match(/--skin-[\w-]+:\s*0\s*;/g) ?? []).toEqual([]);
  });
});
