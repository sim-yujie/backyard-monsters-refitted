import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The rules the shared combat module lives by.
 *
 * Every file under this directory is copied byte for byte into
 * `server/src/game-rules/combat/` and executed there under Bun, and bundled
 * into the web client for the Wild Monster Baiter
 * (`docs/design/server-combat.md` §3.2). That gives it three constraints a
 * normal file in either tree does not have, and this test is what keeps them:
 *
 * 1. **It may import nothing outside itself.** No `@/`, no `pixi.js`, no
 *    `node:`, nothing from Bun or Koa, and no relative path that climbs out of
 *    the directory. The server has no bundler and no path aliases, and the web
 *    client must not pull a server dependency into the browser.
 * 2. **It may not read a clock or a random number.** The engine is
 *    deterministic: the tick and the seed are inputs, so that the Baiter's
 *    replay and the server's produce the same digest (§3.4).
 * 3. **No line over 100 columns**, so the two copies stay readable side by
 *    side in a review of the diff the sync produces.
 *
 * Tests are not part of the module — the sync does not copy them and they
 * legitimately import `vitest` and `node:fs` — so they are excluded, by the
 * same filter `tools/sync-combat-rules.mjs` uses.
 */

const DIRECTORY = fileURLToPath(new URL(".", import.meta.url));

const members = (): string[] =>
  readdirSync(DIRECTORY)
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .sort();

const read = (name: string): string => readFileSync(`${DIRECTORY}${name}`, "utf8");

/**
 * The file with its comments removed.
 *
 * The prose in these files names the very things the checks refuse — this
 * comment says `Math.random` twice — so a check that scanned the raw text would
 * fail on documentation that is doing its job.
 */
const code = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

/** Every module specifier the file imports from or re-exports from. */
const specifiers = (text: string): string[] =>
  [...code(text).matchAll(/\bfrom\s+["']([^"']+)["']/g)].map((one) => one[1] ?? "");

const MODULES = members();

describe("the shared combat rules module", () => {
  it("holds the files the sync copies", () => {
    expect(MODULES).toContain("combatStatsData.ts");
    expect(MODULES).toContain("stats.ts");
    expect(MODULES).toContain("index.ts");
  });

  it.each(MODULES)("%s imports nothing outside this directory", (name) => {
    for (const specifier of specifiers(read(name))) {
      expect(specifier, `${name} imports "${specifier}"`).toMatch(/^\.\//);
      expect(specifier, `${name} imports "${specifier}"`).not.toContain("..");
    }
  });

  it.each(MODULES)("%s gives every relative import the .js suffix", (name) => {
    // `NodeNext` requires it on the server side and `bundler` resolution
    // accepts it for a `.ts` file, so the copy needs no rewriting.
    for (const specifier of specifiers(read(name))) {
      expect(specifier, `${name} imports "${specifier}"`).toMatch(/\.js$/);
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
