import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * This copy of the shared account rules still matches its source (issue #213).
 *
 * Everything beside this file is written in `web/src/game/account/rules/` and
 * copied here byte for byte by `web/tools/sync-combat-rules.mjs`, as the combat
 * rules are (`../combat/sync.test.ts`). Nothing here is edited: a registration
 * schema that disagreed with the sign-up form would refuse a name or password
 * the form had passed. This file belongs to the server and is never copied.
 */

const TARGET = fileURLToPath(new URL(".", import.meta.url));
const SOURCE = fileURLToPath(new URL("../../../../web/src/game/account/rules/", import.meta.url));

interface Manifest {
  files: Record<string, string>;
  count: number;
}

const members = (directory: string): string[] =>
  readdirSync(directory)
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .sort();

const sha256 = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

const manifestOf = (directory: string): Manifest =>
  JSON.parse(readFileSync(`${directory}MANIFEST.json`, "utf8"));

const REMEDY = "run `node tools/sync-combat-rules.mjs` from web/";

describe("game-rules/account sync", () => {
  test("every copied file hashes to what this directory's manifest claims", () => {
    const manifest = manifestOf(TARGET);
    const names = members(TARGET);
    expect(names).toEqual(Object.keys(manifest.files).sort());
    expect(manifest.count).toBe(names.length);
    for (const name of names) {
      expect(sha256(readFileSync(`${TARGET}${name}`)), `${name}: ${REMEDY}`).toBe(
        manifest.files[name],
      );
    }
  });

  test("the web source hashes to the same manifest", () => {
    const manifest = manifestOf(TARGET);
    const names = members(SOURCE);
    expect(names).toEqual(Object.keys(manifest.files).sort());
    for (const name of names) {
      expect(sha256(readFileSync(`${SOURCE}${name}`)), `${name}: ${REMEDY}`).toBe(
        manifest.files[name],
      );
    }
  });

  test("both directories hold the same manifest", () => {
    expect(readFileSync(`${TARGET}MANIFEST.json`, "utf8")).toBe(
      readFileSync(`${SOURCE}MANIFEST.json`, "utf8"),
    );
  });
});
