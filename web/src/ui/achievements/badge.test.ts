// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { achievementBadge, badgeArtUrl } from "./badge";

/** The badge: the painted medal for the seventeen shown, the CSS medal otherwise or when the picture fails (#298). */

const SHOWN = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 15, 16, 17, 22];

describe("achievementBadge", () => {
  it("shows the painted medal for each of the seventeen shown achievements", () => {
    for (const id of SHOWN) {
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

  it("draws the CSS medal for an achievement without a picture", () => {
    const badge = achievementBadge(14, "silver", true);
    expect(badge.querySelector("img")).toBeNull();
    expect(badge.querySelector(".ach-badge__cup")).not.toBeNull();
  });
});
