import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { createPlan, parseArgs } from "./bots.js";

/** The bots CLI (issue #239, `docs/design/bot-neighbours.md` §10). */

describe("parseArgs", () => {
  test("reads each command's options", () => {
    expect(parseArgs(["create", "--target", "500", "--per-day", "170", "--dry-run"])).toMatchObject({
      command: "create",
      target: 500,
      perDay: 170,
      dryRun: true,
    });
    expect(parseArgs(["create", "--levels", "15,20,25,35,40", "--count", "5"])).toMatchObject({
      levels: [15, 20, 25, 35, 40],
      count: 5,
    });
    expect(parseArgs(["remove-all", "--yes"])).toMatchObject({ command: "remove-all", yes: true });
  });

  test("refuses unknown options, bad numbers and levels outside 15-40", () => {
    expect(() => parseArgs(["create", "--targt", "5"])).toThrow();
    expect(() => parseArgs(["create", "--target", "lots"])).toThrow();
    expect(() => parseArgs(["create", "--target"])).toThrow();
    expect(() => parseArgs(["create", "--levels", "0,5"])).toThrow();
    // No bot below level 15 (owner, 2026-10-23).
    expect(() => parseArgs(["create", "--levels", "14"])).toThrow();
    expect(() => parseArgs(["create", "--levels", "41"])).toThrow();
  });
});

describe("createPlan", () => {
  const plan = (argv: string[], active: Record<number, number> = {}, madeToday = 0) =>
    createPlan(parseArgs(["create", ...argv]), active, madeToday, 500);

  test("--levels makes the levels given, in turn, one each unless --count says", () => {
    expect(plan(["--levels", "15,20,25,35,40"])).toEqual([15, 20, 25, 35, 40]);
    expect(plan(["--levels", "16,20", "--count", "5"])).toEqual([16, 20, 16, 20, 16]);
    // Whatever is already there.
    expect(plan(["--levels", "15"], { 15: 99 })).toEqual([15]);
  });

  test("--fill tops up to BOTS_TOTAL; --target to its own number", () => {
    expect(plan(["--fill"])).toHaveLength(500);
    // Forty over levels 15-40: one each, and one more on the lowest fourteen.
    expect(plan(["--target", "40"])).toEqual(
      Array.from({ length: 26 }, (_, index) => (index < 14 ? [15 + index, 15 + index] : [15 + index])).flat()
    );
  });

  test("--count without --levels caps a fill", () => {
    expect(plan(["--count", "5"])).toEqual([15, 15, 15, 15, 15]);
    expect(plan(["--count", "3", "--target", "26"], { 15: 1 })).toEqual([16, 17, 18]);
    expect(plan(["--count", "50", "--fill", "--per-day", "10"])).toHaveLength(10);
  });

  test("--per-day counts what the last 24 hours already made", () => {
    expect(plan(["--fill", "--per-day", "170"], {}, 0)).toHaveLength(170);
    expect(plan(["--fill", "--per-day", "170"], {}, 150)).toHaveLength(20);
    expect(plan(["--fill", "--per-day", "170"], {}, 200)).toEqual([]);
  });

  test("refuses mixed or missing modes", () => {
    expect(() => plan([])).toThrow();
    expect(() => plan(["--fill", "--target", "5"])).toThrow();
    expect(() => plan(["--levels", "5", "--fill"])).toThrow();
  });
});

describe("the CLI never boots a server", () => {
  const SRC = fileURLToPath(new URL("../", import.meta.url));
  /**
   * Static value imports and re-exports: what loading a module loads.
   * `import type` is erased. A dynamic `import()` loads only when its code
   * runs (`yard/mapRoom.ts` reaches the server that way, for a Map Room 2 join
   * the factory never makes), so the CLI run on a scratch database is the
   * check for those.
   */
  const IMPORTS = /(?:^|\n)\s*(?:import(?!\s+type\b)[^"';(]*?from\s*|export\s[^"';]*?from\s*)["'](\.[^"']+)["']/g;

  const graph = (entry: string): Set<string> => {
    const seen = new Set<string>();
    const visit = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      for (const match of readFileSync(file, "utf8").matchAll(IMPORTS)) {
        const target = resolve(dirname(file), match[1]!).replace(/\.js$/, ".ts");
        if (existsSync(target)) visit(target);
      }
    };
    visit(entry);
    return seen;
  };

  test("scripts/bots.ts does not import server.ts, directly or through anything it imports", () => {
    const files = [...graph(join(SRC, "scripts", "bots.ts"))].map((file) => relative(SRC, file).split(sep).join("/"));
    expect(files).toContain("services/bots/factory.ts");
    expect(files).not.toContain("server.ts");
  });
});
