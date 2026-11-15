import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { fitCentreWindow } from "./centreWindow";

/*
 * The layout check (15 Nov 2026) at 980x551: Mail, narrowed to clear the
 * Events column, stopped above the Main yard button at 194px tall and its
 * list showed 9px. The window now has a minimum height in the middle, so on
 * a short screen it reaches over the dock instead (the rule in
 * .claude/skills/layout-rules/SKILL.md).
 */

const here = dirname(fileURLToPath(import.meta.url));
const mailCss = (): string =>
  readFileSync(resolve(here, "styles/mail.css"), "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "");

/** The px of `--centre-min-height` in the first `.mail-screen {` rule. */
const mailMinHeight = (): number => {
  const css = mailCss();
  const at = css.indexOf(".mail-screen {");
  const body = css.slice(at, css.indexOf("}", at));
  return Number(/--centre-min-height:\s*(\d+)px;/.exec(body)?.[1] ?? 0);
};

/** The title, the New message bar and the frame, measured in the check (194px window, 9px list). */
const MAIL_CHROME = 185;
/** The fewest px of list the layout check accepts. */
const MIN_LIST = 120;

describe("Mail on a short screen", () => {
  it("has a minimum height that leaves a few rows of its list", () => {
    expect(mailMinHeight() - MAIL_CHROME).toBeGreaterThanOrEqual(MIN_LIST);
  });

  it("reaches over Main yard at 980x551 rather than stop above it", () => {
    const layer = { width: 980, height: 551 };
    // Main yard's button, just under the narrowed window's left edge, and the dock row.
    const mainYard = { left: 30, top: 321, right: 115, bottom: 390 };
    const dockRow = [
      { left: 120, top: 430, right: 185, bottom: 500 },
      { left: 540, top: 408, right: 640, bottom: 520 },
      { left: 660, top: 427, right: 725, bottom: 500 },
    ];
    const top = 102;
    const before = fitCentreWindow(layer, 747, [mainYard, ...dockRow], { top });
    expect(layer.height - before.bottom - top).toBeLessThan(MAIL_CHROME + MIN_LIST);
    const after = fitCentreWindow(layer, 747, [mainYard, ...dockRow], {
      top,
      minHeight: mailMinHeight(),
    });
    expect(layer.height - after.bottom - top).toBeGreaterThanOrEqual(mailMinHeight());
    expect(after.over).toBe(true);
  });
});
