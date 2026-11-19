import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Upgrade walls (owner, 19 Nov 2026): a pressed Affordable must look exactly
 * like the chosen Level button, in both looks. One rule covers both, so a
 * later edit cannot split them into two looks that drift apart.
 */

const here = dirname(fileURLToPath(import.meta.url));
const sheet = readFileSync(resolve(here, "planner.css"), "utf8").replace(/\r\n/g, "\n");
const both = ':is(.planner-walls__level, .planner-walls__tool)[aria-pressed="true"]';

describe("Upgrade walls: one selected look for a level and Affordable", () => {
  it("shares the plain selected rule", () => {
    expect(sheet).toContain(`\n${both} {`);
  });

  it("shares the skin's selected plate, and its keyboard focus glow", () => {
    expect(sheet).toContain(`:root[data-skin] .planner-walls.panel ${both} {`);
    expect(sheet).toContain(`:root[data-skin] .planner-walls.panel ${both}:focus-visible {`);
  });

  it("has no selected rule left for a level alone", () => {
    expect(sheet).not.toMatch(/\.planner-walls__level\[aria-pressed="true"\]/);
  });
});
