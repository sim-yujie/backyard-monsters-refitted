import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { fitCentreWindow } from "./centreWindow";

/*
 * The layout check at 980x551 in Classic (16 Nov 2026): Shop and Events
 * stopped above the Main yard button, whose Classic ribbon is wider and sits
 * under their left edge, at about 192px tall; the Shop's list showed 112px
 * (half a card) and Events' 114px. Each now has a minimum height in the
 * middle, so on a short screen it reaches over the dock instead (the rule in
 * .claude/skills/layout-rules/SKILL.md), as Mail does.
 */

const here = dirname(fileURLToPath(import.meta.url));

/** The px of `--centre-min-height` in the rule `selector {` of `file` that sets one. */
const minHeight = (file: string, selector: string): number => {
  const css = readFileSync(resolve(here, file), "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  for (
    let at = css.indexOf(`${selector} {`);
    at >= 0;
    at = css.indexOf(`${selector} {`, at + 1)
  ) {
    const body = css.slice(at, css.indexOf("}", at));
    const found = /--centre-min-height:\s*(\d+)px;/.exec(body);
    if (found) return Number(found[1]);
  }
  return 0;
};

/** Title and frame around the list, from the check (Shop: 192px window, 112px list). */
const CHROME = 80;
/** The fewest px of list the layout check accepts. */
const MIN_LIST = 120;

const WINDOWS = [
  { name: "Shop", file: "styles/shop.css", selector: ".shop-screen", width: 720 },
  { name: "Events", file: "events/events.css", selector: ".events-panel", width: 731 },
] as const;

describe.each(WINDOWS)("$name on a short screen", ({ file, selector, width }) => {
  it("has a minimum height that leaves a few rows of its list", () => {
    expect(minHeight(file, selector) - CHROME).toBeGreaterThanOrEqual(MIN_LIST);
  });

  it("reaches over Main yard at 980x551 rather than stop above it", () => {
    const layer = { width: 980, height: 551 };
    // Classic's Main yard, its ribbon just under the window's left edge, and the dock row
    // (boxes read off the check's 980x551 picture, not measured).
    const mainYard = { left: 24, top: 320, right: 126, bottom: 415 };
    const dockRow = [
      { left: 40, top: 430, right: 105, bottom: 525 },
      { left: 540, top: 410, right: 640, bottom: 535 },
      { left: 655, top: 425, right: 725, bottom: 520 },
    ];
    const top = 115;
    const before = fitCentreWindow(layer, width, [mainYard, ...dockRow], { top });
    expect(layer.height - before.bottom - top).toBeLessThan(CHROME + MIN_LIST);
    const after = fitCentreWindow(layer, width, [mainYard, ...dockRow], {
      top,
      minHeight: minHeight(file, selector),
    });
    expect(layer.height - after.bottom - top).toBeGreaterThanOrEqual(minHeight(file, selector));
    expect(after.over).toBe(true);
  });
});
