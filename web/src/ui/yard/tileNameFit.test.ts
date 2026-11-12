import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { typeName } from "@/game/yard/planner/summary";
import { nameFitEm, wordEm } from "./tileNameFit";

const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../styles/build-menu.css"), "utf8");

/** Every rule for the tile's name, all layouts. */
const nameRules = [...css.matchAll(/\.build-tile__name \{([^}]*)\}/g)].map((match) => match[1] ?? "");

/** Every building and decoration name either yard can show. */
const names = [
  ...new Set(
    (["main", "inferno"] as const).flatMap((kind) =>
      Array.from({ length: 400 }, (_, type) => typeName(type, kind)).filter((name) => !name.startsWith("Type ")),
    ),
  ),
];

/** The CSS's font size: `clamp(10px, room / fit, normal)`. */
const fitted = (name: string, room: number, normal: number): number =>
  Math.min(normal, Math.max(10, room / nameFitEm(name)));

describe("Build tile names (lead, 11 Nov: \"Observator\" / \"y\")", () => {
  it("measures a word by its letters in the display fonts", () => {
    expect(wordEm("Observatory")).toBeCloseTo(7.02, 2);
    expect(wordEm("WWW")).toBeCloseTo(3.06, 2);
    expect(wordEm("é")).toBeCloseTo(0.88, 2);
  });

  it("fits the widest word, a hyphenated one whole, with a little to spare", () => {
    expect(nameFitEm("Hatchery Control Center")).toBe(Math.round(wordEm("Hatchery") * 1.04 * 100) / 100);
    expect(nameFitEm("Mini-Pumpkin")).toBe(Math.round(wordEm("Mini-Pumpkin") * 1.04 * 100) / 100);
    expect(nameFitEm("")).toBe(1);
  });

  it("never breaks a name inside a word, in any layout", () => {
    expect(nameRules.length).toBeGreaterThanOrEqual(3);
    for (const rule of nameRules) {
      expect(rule).not.toMatch(/overflow-wrap:\s*(anywhere|break-word)/);
      expect(rule).not.toMatch(/word-break:\s*break-all/);
      expect(rule).not.toMatch(/hyphens:\s*auto/);
    }
    expect(nameRules[0]).toContain("overflow-wrap: normal;");
    expect(nameRules[0]).toContain("word-break: normal;");
  });

  it("shrinks a long word to the tile's own width instead", () => {
    expect(css).toMatch(/\.build-tile \{[^}]*container-type: inline-size;/);
    expect(nameRules[0]).toContain(
      "font-size: clamp(10px, calc(var(--name-room) / var(--name-fit-em, 1)), var(--name-size));",
    );
    expect(nameRules[0]).toContain("--name-room: 100cqi;");
    // Beside the picture on a phone, the name has the tile less the picture and the gap.
    expect(css).toContain("--name-room: calc(100cqi - 48px - var(--space-2));");
    expect(css).toContain("--name-room: calc(100cqi - 40px - var(--space-2));");
    // Only the base rule sets the size; the layouts set its inputs.
    for (const rule of nameRules.slice(1)) expect(rule).not.toMatch(/\bfont-size:/);
  });

  it("fits every name's widest word above the 10px floor on a computer and a phone", () => {
    expect(names).toContain("Observatory");
    // Computer: the narrowest tile is 108px, less 8px padding and a 1px border each side.
    const computer = 108 - 2 * 8 - 2;
    // Phone, 360-390 wide, two across: a tile is 160px or more, less padding, border, the 48px picture and the gap.
    const phone = 160 - 2 * 8 - 2 - 48 - 8;
    for (const name of names) {
      expect(fitted(name, computer, 15), name).toBeGreaterThan(10);
      expect(fitted(name, phone, 13), name).toBeGreaterThan(10);
    }
    // The name the lead saw broken: a size smaller, on one line.
    expect(fitted("Observatory", computer, 15)).toBeLessThan(15);
    expect(fitted("Observatory", computer, 15) * wordEm("Observatory")).toBeLessThanOrEqual(computer);
  });
});
