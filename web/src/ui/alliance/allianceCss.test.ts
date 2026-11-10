import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * jsdom never applies a stylesheet, so the Quick Join layout is checked in the
 * CSS text itself: the type chips must fit inside the window at any width,
 * never run off the right edge and never scroll sideways (owner, 10 Nov 2026).
 */

/** alliance.css with its comments taken out. */
const css = readFileSync(new URL("./alliance.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** The bodies of every rule whose selector list names exactly `selector`. */
const rulesFor = (selector: string): string[] => {
  const out: string[] = [];
  const rule = /([^{}]+)\{([^{}]*)\}/g;
  for (let match = rule.exec(css); match; match = rule.exec(css)) {
    const selectors = match[1]!.split(",").map((part) => part.trim());
    if (selectors.includes(selector)) out.push(match[2]!);
  }
  return out;
};

describe("alliance.css: Quick Join chips fit the window", () => {
  it("lays the four chips out in a two-column grid that shares the width", () => {
    const types = rulesFor(".alliance__quick-types").join("\n");
    expect(types).toMatch(/display:\s*grid/);
    expect(types).toMatch(/grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  });

  it("never scrolls the chips sideways", () => {
    for (const body of rulesFor(".alliance__quick-types")) {
      expect(body).not.toMatch(/overflow(-x)?:\s*(auto|scroll)/);
      expect(body).not.toMatch(/flex-wrap:\s*nowrap/);
    }
  });

  it("lets a chip shrink to its cell, its name breaking onto a second line", () => {
    const chip = rulesFor(".alliance__chip").join("\n");
    expect(chip).toMatch(/min-width:\s*0/);
    expect(chip).not.toMatch(/flex:\s*none/);
    expect(chip).toMatch(/flex-wrap:\s*wrap/);
    expect(rulesFor(".alliance__chip-word").join("\n")).toMatch(/overflow-wrap:\s*anywhere/);
  });

  it("puts Join beside the Quick Join heading, so the chips get the full width", () => {
    const quick = rulesFor(".alliance__quick").find((body) => body.includes("grid-template-areas"));
    expect(quick).toBeDefined();
    expect(quick).toMatch(/"label join"\s*"types types"/);
    expect(rulesFor(".alliance__quick-join").join("\n")).toMatch(/grid-area:\s*join/);
  });
});
