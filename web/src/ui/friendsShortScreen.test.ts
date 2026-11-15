import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { fitCentreWindow } from "./centreWindow";

/*
 * The layout check (15 Nov 2026) at 980x551: the Friends screen stopped
 * above Collect all at about 295px tall and its list showed 90px of its
 * 101px. The window now has a minimum height in the middle, so on a short
 * screen it reaches over the dock instead (the rule in
 * .claude/skills/layout-rules/SKILL.md), as Mail does.
 */

const here = dirname(fileURLToPath(import.meta.url));
const friendsCss = (): string =>
  readFileSync(resolve(here, "friends/friends.css"), "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "");

/** The px of `--centre-min-height` in the first `.friends-screen {` rule. */
const friendsMinHeight = (): number => {
  const css = friendsCss();
  const at = css.indexOf(".friends-screen {");
  const body = css.slice(at, css.indexOf("}", at));
  return Number(/--centre-min-height:\s*(\d+)px;/.exec(body)?.[1] ?? 0);
};

/** The title, the tabs, the count and the frame, from the check (about 295px window, 90px list). */
const FRIENDS_CHROME = 205;
/** The fewest px of list the layout check accepts. */
const MIN_LIST = 120;

describe("Friends screen on a short screen", () => {
  it("has a minimum height that leaves a few rows of its list", () => {
    expect(friendsMinHeight() - FRIENDS_CHROME).toBeGreaterThanOrEqual(MIN_LIST);
  });

  it("reaches over Collect all at 980x551 rather than stop above it", () => {
    const layer = { width: 980, height: 551 };
    // The dock row under the 520px window (Collect all, More, Monsters) and Friends, Map at the side.
    const dockRow = [
      { left: 540, top: 410, right: 636, bottom: 535 },
      { left: 655, top: 425, right: 725, bottom: 520 },
      { left: 755, top: 425, right: 825, bottom: 520 },
      { left: 115, top: 430, right: 190, bottom: 525 },
      { left: 35, top: 430, right: 105, bottom: 525 },
    ];
    const top = 102;
    const before = fitCentreWindow(layer, 520, dockRow, { top });
    expect(layer.height - before.bottom - top).toBeLessThan(FRIENDS_CHROME + MIN_LIST);
    const after = fitCentreWindow(layer, 520, dockRow, { top, minHeight: friendsMinHeight() });
    expect(layer.height - after.bottom - top).toBeGreaterThanOrEqual(friendsMinHeight());
    expect(after.over).toBe(true);
  });
});
