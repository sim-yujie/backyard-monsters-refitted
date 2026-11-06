// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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

describe("the medals' size", () => {
  // jsdom applies no stylesheet: the rules are read from the CSS text.
  const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "achievements.css"), "utf8").replace(/\r\n/g, "\n");
  const rule = (selector: string): string => css.split(`\n${selector} {`)[1]?.split("}")[0] ?? "";

  it("draws the stand-in medal the painted badge's size, so the words beside both line up", () => {
    const standIn = rule(".ach-badge");
    const painted = rule(".ach-badge--art");
    expect(standIn).toMatch(/box-sizing: border-box;/);
    expect(standIn).toMatch(/width: 60px;/);
    expect(standIn).toMatch(/height: 60px;/);
    expect(painted).toMatch(/width: 60px;/);
    expect(painted).toMatch(/height: 60px;/);
  });

  it("centres a hidden row's ??? on its medal", () => {
    expect(rule(".ach-row--hidden")).toMatch(/align-items: center;/);
  });

  it("puts an earned row's date under the description on a phone, so the name keeps the row's width", () => {
    // The phone rules sit indented inside "@media (width <= 620px) { ... }".
    const phone = css.split("\n@media (width <= 620px) {")[1]?.split("\n}\n")[0] ?? "";
    const phoneRule = (selector: string): string => phone.split(`\n  ${selector} {`)[1]?.split("}")[0] ?? "";
    const row = phoneRule('.ach-row[data-status="earned"]');
    expect(row).toMatch(/display: grid;/);
    expect(row).toMatch(/grid-template-columns: auto minmax\(0, 1fr\);/);
    expect(phoneRule('.ach-row[data-status="earned"] > .ach-badge')).toMatch(/grid-row: span 2;/);
    expect(phoneRule('.ach-row[data-status="earned"] > .ach-row__date')).toMatch(/grid-column: 2;/);
  });

  it("keeps an earned row's date beside the words on a wide screen", () => {
    expect(css).not.toMatch(/\n\.ach-row\[data-status="earned"\]/);
    expect(rule(".ach-row__date")).toMatch(/white-space: nowrap;/);
  });
});
