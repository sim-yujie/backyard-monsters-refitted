import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  atChampionLevel,
  CHAMPION_CATALOGUE,
  championEntry,
  evolveShinyPrice,
  feedRecipe,
  feedShinyPrice,
} from "./championCatalogue";

/**
 * The generated champion catalogue, the generator's tripwires and the
 * web/server sync. `server/src/game-data/championCatalogue.test.ts` checks the
 * rows against the server's champion stat table.
 */

const WEB = fileURLToPath(new URL("./championCatalogue.ts", import.meta.url));
const SERVER = fileURLToPath(
  new URL("../../../../server/src/game-data/championCatalogue.ts", import.meta.url),
);
const GENERATOR = fileURLToPath(
  new URL("../../../tools/gen-champion-catalogue.mjs", import.meta.url),
);
const SCRIPTS = fileURLToPath(new URL("../../../../client/scripts/", import.meta.url));

const lf = (path: string): string => readFileSync(path, "utf8").replace(/\r\n/g, "\n");

describe("the champion catalogue", () => {
  it("is the same file on the web and the server", () => {
    expect(lf(WEB)).toBe(lf(SERVER));
  });

  it("holds the five champions; Gorgo, Drull and Fomor can be raised", () => {
    expect(CHAMPION_CATALOGUE.map((entry) => entry.id)).toEqual(["G1", "G2", "G3", "G4", "G5"]);
    expect(CHAMPION_CATALOGUE.filter((entry) => entry.raisable).map((entry) => entry.name)).toEqual(
      ["Gorgo", "Drull", "Fomor"],
    );
    expect(championEntry(1)?.role).toBe("High Defense");
    expect(championEntry("G5")?.role).toBeNull();
  });

  it("clamps levels like GetGuardianProperty", () => {
    expect(atChampionLevel([1, 2, 3], 0)).toBe(1);
    expect(atChampionLevel([1, 2, 3], 9)).toBe(3);
    expect(atChampionLevel([7], 4)).toBe(7);
  });

  it("uses the Map Room 2 recipes (CHAMPIONCAGE.setFeedProps)", () => {
    const drull = championEntry("G2")!;
    expect(feedRecipe(drull, 1, 0)).toEqual({ C1: 30 });
    expect(feedRecipe(drull, 6, 2)).toEqual({ C8: 30 });
    expect(feedShinyPrice(drull, 4, 0, true)).toBe(105);
    expect(evolveShinyPrice(drull, 4, 11)).toBe(210);
  });
});

describe("the generator", () => {
  let scratch: string | null = null;

  afterEach(() => {
    if (scratch) rmSync(scratch, { recursive: true, force: true });
    scratch = null;
  });

  const run = (...args: string[]) =>
    spawnSync(process.execPath, [GENERATOR, "--check", ...args], { encoding: "utf8" });

  /** A copy of CHAMPIONCAGE.as with `edit` applied. */
  const mutated = (edit: (source: string) => string): string => {
    scratch = mkdtempSync(join(tmpdir(), "champion-catalogue-"));
    const target = join(scratch, "CHAMPIONCAGE.as");
    copyFileSync(join(SCRIPTS, "CHAMPIONCAGE.as"), target);
    const before = readFileSync(target, "utf8");
    const after = edit(before);
    expect(after, "the edit must change something").not.toBe(before);
    writeFileSync(target, after);
    return scratch;
  };

  it("finds both copies up to date with the Flash source", () => {
    const result = run();
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });

  it("fails loudly when a Map Room 2 recipe override goes missing", () => {
    const dir = mutated((source) => source.replace("_guardians.G2.props.feeds = ", "var unused = "));
    const result = run("--scripts", dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/feed overrides no longer cover exactly G1-G4 \(G2\)/);
  });

  it("fails loudly when Korath becomes raisable (D17)", () => {
    const dir = mutated((source) =>
      source.replace(/("powerLevel2Desc"[\s\S]*?"powerLevel": )0/, (_, head: string) => `${head}1`),
    );
    const result = run("--scripts", dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/raisable champions changed/);
  });

  it("reports a changed source as stale", () => {
    const dir = mutated((source) => source.replace(`"feedShiny": [26, 44, 75, 111, 136]`, `"feedShiny": [27, 44, 75, 111, 136]`));
    const result = run("--scripts", dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Stale champion catalogue/);
  });
});
