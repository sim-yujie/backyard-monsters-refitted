// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PAINTED, achievementBadge, badgeArtUrl } from "./badge";

/** The badge: the painted medal for every achievement, the CSS medal otherwise or when the picture fails (#298). */

const ALL = Array.from({ length: 27 }, (_, i) => i + 1);
const PUBLIC = resolve(dirname(fileURLToPath(import.meta.url)), "../../../public");

describe("achievementBadge", () => {
  it("shows the painted medal for each of the 27 achievements, hidden ones included", () => {
    for (const id of ALL) {
      const badge = achievementBadge(id, "silver", true);
      const art = badge.querySelector<HTMLImageElement>("img.ach-badge__art");
      expect(art?.getAttribute("src")).toBe(badgeArtUrl(id));
      expect(art?.alt).toBe("");
      expect(badge.classList.contains("ach-badge--art")).toBe(true);
      expect(badge.querySelector(".ach-badge__cup")).toBeNull();
    }
  });

  it("keeps the tier and greys a badge not yet earned", () => {
    const badge = achievementBadge(2, "silver", false);
    expect(badge.classList.contains("ach-badge--silver")).toBe(true);
    expect(badge.classList.contains("ach-badge--locked")).toBe(true);
    expect(badge.dataset["achievement"]).toBe("2");
  });

  it("falls back to the CSS medal when the picture fails to load", () => {
    const badge = achievementBadge(7, "silver", true);
    badge.querySelector("img")!.dispatchEvent(new Event("error"));
    expect(badge.querySelector("img")).toBeNull();
    expect(badge.querySelector(".ach-badge__cup")).not.toBeNull();
    expect(badge.classList.contains("ach-badge--art")).toBe(false);
    expect(badge.classList.contains("ach-badge--silver")).toBe(true);
  });

  it("has a WebP picture file for every painted badge", () => {
    for (const id of PAINTED) {
      const file = readFileSync(resolve(PUBLIC, `achievements/badge-${id}.webp`));
      expect(file.subarray(0, 4).toString("latin1")).toBe("RIFF");
      expect(file.subarray(8, 12).toString("latin1")).toBe("WEBP");
    }
  });

  it("draws the CSS medal for an achievement without a picture", () => {
    const badge = achievementBadge(99, "silver", true);
    expect(badge.querySelector("img")).toBeNull();
    expect(badge.querySelector(".ach-badge__cup")).not.toBeNull();
  });
});
