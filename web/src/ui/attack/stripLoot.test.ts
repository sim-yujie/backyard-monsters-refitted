// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { writeAmount } from "@/ui/amountChange";
import { stripLootFigure } from "./stripLoot";

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

describe("the attack strip's loot (7.7.1: none on an upright phone)", () => {
  it("writes the full figure where there is room, the short one on a phone", () => {
    expect(stripLootFigure(1575, false)).toBe(1575);
    expect(stripLootFigure(1575, true)).toBe("1.5K");
    expect(stripLootFigure(999, true)).toBe("999");
    expect(stripLootFigure(2_480_000, true)).toBe("2.4M");
    // A defence replay's loss is told by the sign writeAmount adds, not the figure.
    expect(stripLootFigure(-1575, true)).toBe("1.5K");
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

  it("gives the loot its own row on an upright phone and a small phone on its side", () => {
    const row = media("max-width: 620px), (min-width: 620.02px) and (max-width: 820px) and (max-height: 500px");
    // The side-on strip keeps to one row otherwise (nowrap); the loot row may wrap under it.
    expect(row).toMatch(/\.attack-strip \{\s*flex-wrap: wrap;/);
    // Its own full-width row after the controls; a hidden one (a test, a raid) stays hidden.
    expect(row).toMatch(/\.attack-strip__loot:not\(\[hidden\]\) \{\s*display: flex;[^}]*order: 1;[^}]*flex: 1 0 100%;/);
    // After the side-on rules that set nowrap, so it wins.
    expect(attackCss.indexOf(row)).toBeGreaterThan(attackCss.indexOf("@media (min-width: 620.02px) and (max-height: 500px) {"));
  });
});
