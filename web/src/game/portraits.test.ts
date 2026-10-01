import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  PAINTED_CHAMPION_LEVELS,
  PAINTED_MONSTERS,
  championPortrait,
  monsterPortrait,
  paintedChampionFile,
  showPortrait,
} from "./portraits";

const publicFile = (src: string): string => fileURLToPath(new URL(`../../public${src}`, import.meta.url));

describe("monsterPortrait", () => {
  it("shows the painting, with the server's original behind it", () => {
    expect(monsterPortrait("C1", "card")).toEqual({
      src: "/portraits/C1.webp",
      fallback: "/assets/monsters/C1-portrait.jpg",
    });
    expect(monsterPortrait("IC8", "icon")).toEqual({
      src: "/portraits/IC8-icon.webp",
      fallback: "/assets/monsters/IC8-small.png",
    });
  });

  it("shows the original alone for a monster with no painting", () => {
    expect(monsterPortrait("C18", "icon")).toEqual({ src: "/assets/monsters/C18-small.png", fallback: null });
  });

  it("covers the 26 approved monsters", () => {
    expect(PAINTED_MONSTERS.size).toBe(26);
    expect(PAINTED_MONSTERS.has("C17")).toBe(true);
    expect(PAINTED_MONSTERS.has("C18")).toBe(false);
    expect(PAINTED_MONSTERS.has("C19")).toBe(true);
  });
});

describe("championPortrait", () => {
  it("shows the painting for the champion's current level", () => {
    expect(championPortrait("G1", 3, "card")).toEqual({
      src: "/portraits/G1-L3.webp",
      fallback: "/assets/monsters/G1_L3-150.png",
    });
    expect(championPortrait("G3", 1, "icon")).toEqual({
      src: "/portraits/G3-L1-icon.webp",
      fallback: "/assets/monsters/G3_L1-small.png",
    });
  });

  it("shows Korath's level 6 painting, with the original behind it", () => {
    expect(championPortrait("G4", 6, "card")).toEqual({
      src: "/portraits/G4-L6.webp",
      fallback: "/assets/monsters/G4_L6-150.png",
    });
    expect(championPortrait("G4", 6, "icon")).toEqual({
      src: "/portraits/G4-L6-icon.webp",
      fallback: "/assets/monsters/G4_L6-small.png",
    });
  });

  it("gives Krallen her one painting at every level", () => {
    for (const level of [1, 3, 5]) {
      expect(championPortrait("G5", level, "card").src).toBe("/portraits/G5.webp");
      expect(championPortrait("G5", level, "icon").src).toBe("/portraits/G5-icon.webp");
    }
    expect(championPortrait("G5", 5, "card").fallback).toBe("/assets/monsters/G5_L5-150.png");
  });

  it("reads a level below 1 or not a number as level 1", () => {
    expect(championPortrait("G2", 0, "card").src).toBe("/portraits/G2-L1.webp");
    expect(championPortrait("G2", Number.NaN, "icon").src).toBe("/portraits/G2-L1-icon.webp");
    expect(championPortrait("G2", 2.7, "card").src).toBe("/portraits/G2-L2.webp");
  });

  it("knows no painting for a champion it does not list", () => {
    expect(paintedChampionFile("G9", 1)).toBeNull();
    expect(championPortrait("G9", 1, "card")).toEqual({ src: "/assets/monsters/G9_L1-150.png", fallback: null });
  });
});

describe("the painted files", () => {
  it("are all in web/public/portraits, card and icon", () => {
    const files: string[] = [];
    for (const id of PAINTED_MONSTERS) files.push(`${id}`, `${id}-icon`);
    for (const [id, levels] of Object.entries(PAINTED_CHAMPION_LEVELS)) {
      const names = levels === "all" ? [id] : levels.map((level) => `${id}-L${level}`);
      for (const name of names) files.push(name, `${name}-icon`);
    }
    expect(files).toHaveLength(102);
    const missing = files.filter((name) => !existsSync(publicFile(`/portraits/${name}.webp`)));
    expect(missing).toEqual([]);
  });
});

/** Just enough of an image for `showPortrait`: a `src` and its events. */
const fakeImage = (): HTMLImageElement => Object.assign(new EventTarget(), { src: "" }) as unknown as HTMLImageElement;

describe("showPortrait", () => {
  it("tries the original once when the painting fails, hiding that first failure", () => {
    const image = fakeImage();
    showPortrait(image, { src: "/portraits/C1-icon.webp", fallback: "/assets/monsters/C1-small.png" });
    const later = vi.fn();
    image.addEventListener("error", later);
    expect(image.src).toBe("/portraits/C1-icon.webp");

    image.dispatchEvent(new Event("error"));
    expect(image.src).toBe("/assets/monsters/C1-small.png");
    expect(later).not.toHaveBeenCalled();

    // The original failing too reaches the caller's own handling.
    image.dispatchEvent(new Event("error"));
    expect(image.src).toBe("/assets/monsters/C1-small.png");
    expect(later).toHaveBeenCalledTimes(1);
  });

  it("leaves a picture without a fallback to the caller", () => {
    const image = fakeImage();
    showPortrait(image, { src: "/assets/monsters/C18-small.png", fallback: null });
    const later = vi.fn();
    image.addEventListener("error", later);
    image.dispatchEvent(new Event("error"));
    expect(later).toHaveBeenCalledTimes(1);
  });
});
