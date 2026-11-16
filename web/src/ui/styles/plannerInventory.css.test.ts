import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Stored buildings could not be taken back out (player report, 16 Nov 2026).
 *
 * After Clear yard, an iPhone showed the drawer's count, its search box and
 * three rows of kind chips, and nothing under them: the list was 0 px tall.
 * The body is a flex column and the list its scroll box, and a scroll box's
 * automatic minimum height is zero, so on a short sheet it was the one part
 * that gave way. Nothing could be picked, so nothing could be placed, so Apply
 * stayed blocked. These rules keep the list open on every screen.
 */

const here = dirname(fileURLToPath(import.meta.url));
const sheet = readFileSync(resolve(here, "planner.css"), "utf8").replace(/\r\n/g, "\n");

const block = (css: string, at: string): string => {
  const start = css.indexOf(`${at} {`);
  if (start < 0) return "";
  let depth = 0;
  for (let i = css.indexOf("{", start); i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return css.slice(css.indexOf("{", start) + 1, i);
  }
  return "";
};
const rule = (css: string, selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|\\n)\\s*${escaped} \\{([^}]*)\\}`).exec(css)?.[1] ?? "";
};
const declaration = (body: string, property: string): string | null =>
  new RegExp(`(?:^|[;\\s])${property}:\\s*([^;]+);`).exec(body)?.[1]?.trim() ?? null;

const short = block(sheet, "@media (max-width: 620px), (max-height: 700px)");

describe("the stored-buildings list never folds to nothing", () => {
  it("a list with rows keeps a floor of a few rows", () => {
    const body = rule(sheet, ".planner-inventory__rows:not(:empty)");
    expect(declaration(body, "min-height")).toBe("7.5rem");
    expect(declaration(body, "flex")).toBe("1 1 auto");
  });

  it("covers every phone layout, upright and on its side, and the short iPad", () => {
    // phoneLayout.ts: "(max-width: 620px), (max-height: 500px)", inside this one.
    expect(short).not.toBe("");
  });

  it("on a short screen the list is not a scroll box that can be squeezed", () => {
    const rows = rule(short, ".planner-inventory__rows,\n  .planner-inventory__rows:not(:empty)");
    expect(declaration(rows, "overflow")).toBe("visible");
    expect(declaration(rows, "flex")).toBe("none");
    expect(declaration(rows, "max-height")).toBe("none");
  });

  it("on a short screen the chips keep one row, and that row cannot collapse either", () => {
    const chips = rule(short, ".planner-inventory .planner-search__chips");
    expect(declaration(chips, "flex")).toBe("none");
    expect(declaration(chips, "flex-wrap")).toBe("nowrap");
    expect(declaration(chips, "overflow-x")).toBe("auto");
    expect(declaration(rule(short, ".planner-inventory .planner-search__chip"), "flex")).toBe("none");
  });

  it("on a short screen the window fits its dock and its body scrolls", () => {
    const panel = rule(short, ".planner-dock > .planner-inventory");
    expect(declaration(panel, "flex")).toBe("0 1 auto");
    expect(declaration(panel, "min-height")).toBe("0");
    expect(declaration(rule(short, ".planner-inventory > .panel__body"), "min-height")).toBe("0");
  });
});
