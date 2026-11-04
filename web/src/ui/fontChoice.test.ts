// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FONT_KEY, applyFontChoice, savedFontChoice, setFontChoice, showFontChoice } from "./fontChoice";

/** A Storage whose every call throws, like a browser with site data blocked. */
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

afterEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.font;
});

describe("fontChoice", () => {
  it("is the game font until the player picks another, and ignores anything unknown", () => {
    expect(savedFontChoice()).toBe("game");
    localStorage.setItem(FONT_KEY, "comic-sans");
    expect(savedFontChoice()).toBe("game");
    localStorage.setItem(FONT_KEY, "clear");
    expect(savedFontChoice()).toBe("clear");
  });

  it("shows a choice at once on <html> and remembers it; the game font leaves no trace", () => {
    expect(setFontChoice("clear")).toBe(true);
    expect(document.documentElement.dataset.font).toBe("clear");
    expect(localStorage.getItem(FONT_KEY)).toBe("clear");
    expect(setFontChoice("readable")).toBe(true);
    expect(document.documentElement.dataset.font).toBe("readable");
    expect(setFontChoice("game")).toBe(true);
    expect(document.documentElement.dataset.font).toBeUndefined();
    expect(localStorage.getItem(FONT_KEY)).toBeNull();
  });

  it("applies the saved choice when the game loads", () => {
    localStorage.setItem(FONT_KEY, "readable");
    const root = document.createElement("html");
    expect(applyFontChoice(root)).toBe("readable");
    expect(root.dataset.font).toBe("readable");
  });

  it("still shows the choice for this visit when site data is blocked, and says it was not saved", () => {
    expect(savedFontChoice(blocked)).toBe("game");
    expect(setFontChoice("clear", blocked)).toBe(false);
    expect(document.documentElement.dataset.font).toBe("clear");
    expect(setFontChoice("clear", null)).toBe(false);
    showFontChoice("game");
    expect(document.documentElement.dataset.font).toBeUndefined();
  });

  it("has a self-hosted face for each choice, and the tokens swap the fonts under data-font", () => {
    const tokens = readFileSync(resolve(__dirname, "styles/tokens.css"), "utf8");
    for (const file of [
      "/fonts/nunito/nunito-latin.woff2",
      "/fonts/atkinson-hyperlegible/atkinson-hyperlegible-400-latin.woff2",
      "/fonts/atkinson-hyperlegible/atkinson-hyperlegible-700-latin.woff2",
    ]) {
      expect(tokens).toContain(`url("${file}")`);
      expect(readFileSync(resolve(__dirname, "../../public", `.${file}`)).subarray(0, 4).toString()).toBe("wOF2");
    }
    expect(tokens).not.toContain("fonts.googleapis");
    expect(tokens).toMatch(/:root\[data-font="clear"\]\s*\{[^}]*--font-body:\s*"Nunito"/);
    expect(tokens).toMatch(/:root\[data-font="readable"\]\s*\{[^}]*--font-display:\s*"Atkinson Hyperlegible"/);
    expect(tokens).toMatch(/:root\[data-font="readable"\]\s*\{[^}]*--font-body:\s*"Atkinson Hyperlegible"/);
  });
});
