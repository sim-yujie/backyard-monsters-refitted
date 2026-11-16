// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { writeAmount } from "@/ui/amountChange";
import { PHONE_LAYOUT_QUERY } from "@/ui/phoneLayout";
import { STRIP_SHORT_LOOT_QUERY, stripLootFigure } from "./stripLoot";

const here = dirname(fileURLToPath(import.meta.url));
const attackCss = readFileSync(resolve(here, "../styles/attack.css"), "utf8").replace(/\r\n/g, "\n");

/** The `@media (<query>)` block that opens with exactly this head, braces balanced. */
const media = (query: string): string => {
  const head = `@media (${query}) {`;
  const start = attackCss.indexOf(head);
  expect(start, head).toBeGreaterThanOrEqual(0);
  let depth = 0;
  for (let i = attackCss.indexOf("{", start); i < attackCss.length; i++) {
    if (attackCss[i] === "{") depth++;
    if (attackCss[i] === "}" && --depth === 0) return attackCss.slice(start, i + 1);
  }
  return "";
};

describe("the attack strip's loot (7.7.1: an upright phone showed none)", () => {
  it("writes the full figure where there is room, the short one on a phone", () => {
    expect(stripLootFigure(1575, false)).toBe(1575);
    expect(stripLootFigure(1575, true)).toBe("1.5K");
    expect(stripLootFigure(999, true)).toBe("999");
    expect(stripLootFigure(2_480_000, true)).toBe("2.4M");
    // A defence replay's loss is told by the sign writeAmount adds, not the figure.
    expect(stripLootFigure(-1575, true)).toBe("1.5K");
  });

  it("writes it short on every phone layout and under 1180 px wide (an iPad on its side wrapped)", () => {
    for (const part of PHONE_LAYOUT_QUERY.split(", ")) {
      if (part.includes("max-height")) expect(STRIP_SHORT_LOOT_QUERY).toContain(part);
    }
    expect(STRIP_SHORT_LOOT_QUERY).toContain("(max-width: 1179.98px)");
  });

  it("shows a short gain as '+1.5K' in green, and nothing yet as a plain 0", () => {
    const amount = document.createElement("span");
    writeAmount(amount, "res-amount", stripLootFigure(1575, true), { change: "gain", tooltip: false });
    expect(amount.querySelector(".res-amount__value")?.textContent).toBe("+1.5K");
    expect(amount.classList.contains("res-amount--gain")).toBe(true);
    writeAmount(amount, "res-amount", stripLootFigure(0, true), { change: "gain", tooltip: false });
    expect(amount.querySelector(".res-amount__value")?.textContent).toBe("0");
    expect(amount.classList.contains("res-amount--gain")).toBe(false);
  });

  it("never hides the loot on a phone, upright or on its side", () => {
    const phone = media("max-width: 620px");
    expect(phone).not.toMatch(/\.attack-strip__loot\s*[,{]/);
    expect(attackCss).not.toMatch(/\.attack-strip__loot\s*\{\s*display: none;/);
  });

  it("sits in a sunken tray inside the bar at every size (option A, the owner's pick)", () => {
    expect(attackCss).toMatch(
      /\n\.attack-strip \.attack-strip__loot:not\(\[hidden\]\) \{\s*border: 1px solid[^}]*background: var\(--colour-surface-sunken\);/,
    );
  });

  it("gives the tray its own full-width row under the controls on an upright phone", () => {
    const upright = attackCss.slice(attackCss.indexOf("/* Upright: a full-width tray under the controls"));
    expect(upright).toMatch(/\.attack-strip \{\s*flex-wrap: wrap;/);
    // After the controls, 44 px tall from the first second; a hidden one (a test, a raid) stays hidden.
    expect(upright).toMatch(/\.attack-strip__loot:not\(\[hidden\]\) \{\s*order: 1;\s*flex: 1 0 100%;\s*height: 44px;/);
    expect(upright).toMatch(/grid-template-columns: repeat\(4, minmax\(0, 1fr\)\);/);
  });

  it("keeps one row on a phone's side, the tray a 2x2 block between the readouts and the controls", () => {
    const side = attackCss.slice(attackCss.indexOf("/* On its side: one row, the tray a 2x2 block"));
    expect(side).toMatch(/\.attack-strip__loot:not\(\[hidden\]\) \{\s*order: 0;\s*flex: 0 0 216px;\s*height: 52px;/);
    expect(side).toMatch(/grid-template-columns: 1fr 1fr;\s*grid-template-rows: 1fr 1fr;/);
    // Nothing wraps the side-on strip onto a second row.
    expect(attackCss).not.toMatch(/\(max-width: 820px\) and \(max-height: 500px\)/);
  });
});
