import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { EnumYardType } from "../../../enums/EnumYardType.js";
import { strongholds } from "../../../game-data/tribes/v3/strongholds.js";
import { dreadnaught } from "../../../game-data/tribes/v3/outposts/dreadnaught.js";
import { mr3TribeSaves } from "./mr3TribeSaves.js";

/**
 * Map Room 3's tribe templates load on first use, not at server start (owner,
 * 21 Nov 2026: Map Room 3 stays off until its build).
 */

const SRC = join(import.meta.dir, "../../../");

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [path] : [];
  });

describe("Map Room 3's tribe templates", () => {
  test("hands out the same templates the tribe data files hold, read once", async () => {
    const first = await mr3TribeSaves();
    expect(first.structures[EnumYardType.STRONGHOLD]).toBe(strongholds);
    expect(first.outposts[3]).toBe(dreadnaught);
    expect(Object.keys(first.structures).map(Number).sort()).toEqual(
      [EnumYardType.STRONGHOLD, EnumYardType.RESOURCE, EnumYardType.FORTIFICATION].sort(),
    );
    expect(Object.keys(first.outposts)).toEqual(["0", "1", "2", "3"]);
    expect(await mr3TribeSaves()).toBe(first);
  });

  test("no server file imports the tribe data up front; only the loader reads it, on first use", () => {
    const staticImport = /^\s*(?:import|export)\b[^;]*?from\s+["'][^"']*tribes\/v3\//m;
    const offenders = sourceFiles(SRC)
      .filter((path) => !relative(SRC, path).startsWith("game-data/tribes/v3/"))
      .filter((path) => staticImport.test(readFileSync(path, "utf8")))
      .map((path) => relative(SRC, path));
    expect(offenders).toEqual([]);
  });
});
