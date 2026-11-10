import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The building panel on a phone (owner, 10 Nov): while an upgrade ran with
 * free speed-ups held, "-1 h Free (5 left)" and "-2 h Free (3 left)" shared a
 * `1fr 1fr` row. A plain 1fr column never gets narrower than its button's
 * words, so the row, Finish now and the "Upgrading to 3" block ran past the
 * panel's right edge and the panel scrolled sideways. These rules keep every
 * row inside the panel at any dock width, in both looks (skin.css only
 * restyles the plates and frame; the layout is this sheet's).
 */

const here = dirname(fileURLToPath(import.meta.url));
const sheet = readFileSync(resolve(here, "building-panel.css"), "utf8").replace(/\r\n/g, "\n");
const skin = readFileSync(resolve(here, "skin.css"), "utf8").replace(/\r\n/g, "\n");

const rule = (css: string, selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|\\n)${escaped} \\{([^}]*)\\}`).exec(css)?.[1] ?? "";
};
const declaration = (body: string, property: string): string | null =>
  new RegExp(`(?:^|[;\\s])${property}:\\s*([^;]+);`).exec(body)?.[1]?.trim() ?? null;

describe("building panel rows fit the panel", () => {
  it("the speed-up grid's columns can shrink below their buttons' words", () => {
    const grid = rule(sheet, ".building-job .building-panel__buttons");
    expect(declaration(grid, "display")).toBe("grid");
    const columns = declaration(grid, "grid-template-columns");
    expect(columns).toBe("repeat(2, minmax(0, 1fr))");
  });

  it("a free speed-up takes the whole row, and so does its partner", () => {
    const body = rule(
      sheet,
      ".building-job .building-panel__buttons:has(> :is(.shiny-button--noted, .shiny-button--free)) > *",
    );
    expect(declaration(body, "grid-column")).toBe("1 / -1");
  });

  it("a Shiny button in a button row wraps its words rather than overflow", () => {
    const body = rule(sheet, ".building-panel__buttons > .shiny-button");
    expect(declaration(body, "flex-wrap")).toBe("wrap");
    expect(declaration(body, "white-space")).toBe("normal");
    expect(declaration(body, "max-width")).toBe("100%");
  });

  it("a block's heading row wraps its clock under the heading when both do not fit", () => {
    expect(declaration(rule(sheet, ".building-panel__head"), "flex-wrap")).toBe("wrap");
  });

  it("neither look sets its own width or columns on these rows", () => {
    expect(skin).not.toMatch(/building-panel__buttons|building-job|building-panel__head/);
  });
});
