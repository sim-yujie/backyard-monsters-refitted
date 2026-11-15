import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { fitCentreWindow } from "./centreWindow";

/*
 * The layout check (15 Nov 2026) at 980x551: the Friends screen stopped
 * above Collect all at about 295px tall and its (empty) list showed 90px of
 * its 101px. The window now has a minimum height in the middle that leaves
 * a few rows of a list with friends, whose search and filters take more
 * room, so on a short screen it reaches over the dock instead (the rule in
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

/**
 * The title, the tabs, the count and the frame (about 205px, from the check:
 * a 295px window with a 90px list) plus, once there are friends, the search
 * and the filter row on a touch screen (44 + 8 + 44 + a 12px gap).
 */
const FRIENDS_CHROME = 205 + 108;
/** The fewest px of list the layout check accepts. */
const MIN_LIST = 120;

describe("Friends screen on a short screen", () => {
  it("has a minimum height that leaves a few rows of its list", () => {
    expect(friendsMinHeight() - FRIENDS_CHROME).toBeGreaterThanOrEqual(MIN_LIST);
  });

  it("reaches over Collect all at 980x551 rather than stop above it", () => {
    const layer = { width: 980, height: 551 };
    // Read off the check's screenshot, not measured: the dock row under the
    // 520px window (Collect all, More, Monsters) and Friends, Map at the side.
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
    // Taller than the band allows: it goes down to the screen's foot, over the dock.
    expect(after.bottom).toBe(16);
    expect(after.over).toBe(true);
  });

  it("stays above the dock where the band is tall enough (1180x690)", () => {
    const layer = { width: 1180, height: 690 };
    // The same dock, 139px further down and centred under a wider screen.
    const dockRow = [{ left: 640, top: 549, right: 736, bottom: 674 }];
    const fit = fitCentreWindow(layer, 520, dockRow, { top: 102, minHeight: friendsMinHeight() });
    expect(fit.over).toBe(false);
  });
});
