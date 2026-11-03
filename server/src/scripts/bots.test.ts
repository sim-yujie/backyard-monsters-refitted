import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { evenSpread } from "../services/bots/factory.js";
import type { TodaysRebalance } from "../services/bots/sweep.js";
import { createPlan, describeRebalance, parseArgs } from "./bots.js";

/** The bots CLI (issue #239, `docs/design/bot-neighbours.md` §10). */

describe("parseArgs", () => {
  test("reads each command's options", () => {
    expect(parseArgs(["create", "--target", "500", "--per-day", "170", "--dry-run"])).toMatchObject({
      command: "create",
      target: 500,
      perDay: 170,
      dryRun: true,
    });
    expect(parseArgs(["create", "--levels", "25,30,35,40", "--count", "5"])).toMatchObject({
      levels: [25, 30, 35, 40],
      count: 5,
    });
    expect(parseArgs(["rebalance", "--dry-run", "--seed", "7"])).toMatchObject({ command: "rebalance", dryRun: true, seed: 7 });
    expect(parseArgs(["remove-all", "--yes"])).toMatchObject({ command: "remove-all", yes: true });
  });

  test("refuses unknown options, bad numbers and levels outside the floor (25 by default) to 40", () => {
    expect(() => parseArgs(["create", "--targt", "5"])).toThrow();
    expect(() => parseArgs(["create", "--target", "lots"])).toThrow();
    expect(() => parseArgs(["create", "--target"])).toThrow();
    expect(() => parseArgs(["create", "--levels", "0,5"])).toThrow();
    // No bot below the floor: 25 by default (owner 3 Nov 2026).
    expect(() => parseArgs(["create", "--levels", "24"])).toThrow();
    expect(() => parseArgs(["create", "--levels", "15"])).toThrow();
    expect(() => parseArgs(["create", "--levels", "41"])).toThrow();
    const before = process.env.BOTS_FLOOR_LEVEL;
    try {
      process.env.BOTS_FLOOR_LEVEL = "15";
      expect(parseArgs(["create", "--levels", "15"]).levels).toEqual([15]);
      expect(() => parseArgs(["create", "--levels", "14"])).toThrow();
    } finally {
      if (before === undefined) delete process.env.BOTS_FLOOR_LEVEL;
      else process.env.BOTS_FLOOR_LEVEL = before;
    }
  });
});

describe("createPlan", () => {
  const plan = (argv: string[], active: Record<number, number> = {}, madeToday = 0) =>
    createPlan(parseArgs(["create", ...argv]), active, madeToday, 500);

  test("--levels makes the levels given, in turn, one each unless --count says", () => {
    expect(plan(["--levels", "25,30,35,40"])).toEqual([25, 30, 35, 40]);
    expect(plan(["--levels", "26,30", "--count", "5"])).toEqual([26, 30, 26, 30, 26]);
    // Whatever is already there.
    expect(plan(["--levels", "25"], { 25: 99 })).toEqual([25]);
  });

  test("--fill tops up to BOTS_TOTAL; --target to its own number", () => {
    expect(plan(["--fill"])).toHaveLength(500);
    // Forty over levels 25-40 (the default floor): three each on the lowest eight, two on the rest.
    expect(plan(["--target", "40"])).toEqual(
      Array.from({ length: 16 }, (_, index) => Array<number>(index < 8 ? 3 : 2).fill(25 + index)).flat()
    );
  });

  test("--count without --levels caps a fill", () => {
    expect(plan(["--count", "5"])).toEqual([25, 25, 25, 25, 25]);
    expect(plan(["--count", "3", "--target", "16"], { 25: 1 })).toEqual([26, 27, 28]);
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

describe("rebalance --dry-run (owner 3 Nov 2026)", () => {
  const date = (daysAgo: number) => new Date(Date.UTC(2026, 10, 3) - daysAgo * 24 * 60 * 60 * 1000);
  const today = (): TodaysRebalance => ({
    bots: [
      { userid: 1, level: 16, level_since: date(1), quiet_since: null },
      { userid: 2, level: 24, level_since: date(1), quiet_since: date(1) },
      { userid: 3, level: 25, level_since: date(1), quiet_since: null },
      { userid: 4, level: 30, level_since: date(1), quiet_since: null },
      { userid: 5, level: 30, level_since: date(9), quiet_since: date(3) },
    ],
    share: evenSpread(16),
    floor: 25,
    plan: { retire: [1, 2, 5], born: 1, make: [26, 27] },
  });

  test("names every bot to retire with its level and why, and the new bots per level", () => {
    const names = new Map([
      [1, "MossyGoblin"],
      [2, "Fenwick"],
      [5, "Sludge"],
    ]);
    const lines = describeRebalance(today(), names, 16);
    expect(lines[0]).toBe("Floor: level 25. Total: 16 (1-1 a level from 25 to 40).");
    expect(lines).toContain("Would retire 3: 2 below the floor, 1 off crowded levels.");
    expect(lines).toContain("  retire 1 MossyGoblin level 16 (below the floor)");
    expect(lines).toContain("  retire 2 Fenwick level 24 (below the floor)");
    expect(lines).toContain("  retire 5 Sludge level 30 (crowded level)");
    expect(lines).toContain("Would make 3 new: 1 at the bottom of level 25, 2 on short levels: L25:1 L26:1 L27:1.");
    expect(lines).toContain("Active after: 5: L25:2 L26:1 L27:1 L30:1");
    expect(lines.at(-1)).toBe("Dry run: nothing written.");
  });

  test("the rebalance command takes only --dry-run", async () => {
    const { run } = await import("./bots.js");
    await expect(run(parseArgs(["rebalance"]))).rejects.toThrow("--dry-run");
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
