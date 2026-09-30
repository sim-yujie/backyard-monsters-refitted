import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The server's copy of the account rules still matches, from the source's
 * side (issue #213). The same three assertions the combat rules make
 * (`../../combat/rules/sync.test.ts`): the server's registration schema and the
 * sign-up form run the same bytes, and a forgotten
 * `node tools/sync-combat-rules.mjs` fails both suites.
 */

const SOURCE = fileURLToPath(new URL(".", import.meta.url));
const TARGET = fileURLToPath(
  new URL("../../../../../server/src/game-rules/account/", import.meta.url),
);

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

describe("the account rules sync", () => {
  it("hashes every source file to what the manifest claims", () => {
    const manifest = manifestOf(SOURCE);
    const names = members(SOURCE);
    expect(names, REMEDY).toEqual(Object.keys(manifest.files).sort());
    expect(manifest.count).toBe(names.length);
    for (const name of names) {
      expect(sha256(readFileSync(`${SOURCE}${name}`)), `${name}: ${REMEDY}`).toBe(
        manifest.files[name],
      );
    }
  });

  it("hashes every server copy to the same manifest", () => {
    const manifest = manifestOf(SOURCE);
    const names = members(TARGET);
    expect(names, REMEDY).toEqual(Object.keys(manifest.files).sort());
    for (const name of names) {
      expect(sha256(readFileSync(`${TARGET}${name}`)), `${name}: ${REMEDY}`).toBe(
        manifest.files[name],
      );
    }
  });

  it("holds the same manifest in both directories", () => {
    expect(readFileSync(`${TARGET}MANIFEST.json`, "utf8"), REMEDY).toBe(
      readFileSync(`${SOURCE}MANIFEST.json`, "utf8"),
    );
  });
});
