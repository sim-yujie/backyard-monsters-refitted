import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The rules the shared Map Room 2 range module lives by: the same three as the
 * combat rules (`../../combat/rules/boundary.test.ts` explains each). Every
 * file here is copied byte for byte into `server/src/game-rules/maproom/` and
 * run under Bun, so it imports nothing outside this directory, reads no clock
 * or randomness, and keeps inside 100 columns.
 */

const DIRECTORY = fileURLToPath(new URL(".", import.meta.url));

const MODULES = readdirSync(DIRECTORY)
  .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
  .sort();

const read = (name: string): string => readFileSync(`${DIRECTORY}${name}`, "utf8");

/** The file without its comments, which may name what the code must not use. */
const code = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

const specifiers = (text: string): string[] =>
  [...code(text).matchAll(/\bfrom\s+["']([^"']+)["']/g)].map((one) => one[1] ?? "");

describe("the shared Map Room 2 range module", () => {
  it("holds the range rule", () => {
    expect(MODULES).toContain("range.ts");
  });

  it.each(MODULES)("%s imports nothing outside this directory, with the .js suffix", (name) => {
    for (const specifier of specifiers(read(name))) {
      expect(specifier, `${name} imports "${specifier}"`).toMatch(/^\.\/[^/]+\.js$/);
    }
  });

  it.each(MODULES)("%s reads no clock, no randomness and no DOM", (name) => {
    const body = code(read(name));
    for (const banned of ["window", "document", "performance", "Date.now", "Math.random"]) {
      expect(body, `${name} mentions ${banned}`).not.toContain(banned);
    }
  });

  it.each(MODULES)("%s keeps every line inside 100 columns", (name) => {
    const over = read(name)
      .split("\n")
      .map((line, index) => ({ line: index + 1, width: line.length }))
      .filter((one) => one.width > 100);
    expect(over).toEqual([]);
  });
});
