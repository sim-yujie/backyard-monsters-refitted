import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/*
 * The layout check (15 Nov 2026): a building's side panel ran off the bottom
 * of short screens (980x551, 1024x560, 844x390). The right dock has a
 * max-height, but a framed panel is `overflow: visible` (skin.css), so its
 * flex minimum was its whole content and it would not shrink to the dock.
 * jsdom lays nothing out, so this reads the CSS as text.
 */

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(here, "styles/maproom.css"), "utf8")
  .replace(/\r\n/g, "\n")
  .replace(/\/\*[\s\S]*?\*\//g, "");

/** The declarations of the first top-level rule whose selector is exactly `selector`. */
const rule = (selector: string): string => {
  const at = css.indexOf(`\n${selector} {`);
  expect(at, selector).toBeGreaterThanOrEqual(0);
  return css.slice(css.indexOf("{", at) + 1, css.indexOf("}", at));
};

describe("The right dock's panel on a short screen", () => {
  it("keeps the dock to the screen below the HUD", () => {
    expect(rule(".map-dock--right")).toMatch(/max-height: calc\(100d?vh - var\(--hud-height\) - var\(--space-6\)\);/);
  });

  it("lets the panel shrink to the dock at every size, its body scrolling", () => {
    expect(rule(".map-dock--right > .panel")).toMatch(/min-height: 0;/);
    const body = rule(".map-dock--right > .panel > .panel__body");
    expect(body).toMatch(/flex: 1 1 auto;/);
    expect(body).toMatch(/min-height: 0;/);
  });
});
