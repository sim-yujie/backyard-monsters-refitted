import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The server's copy of this module still matches, from the source's side.
 *
 * `web/` and `server/` are separate packages with different compilers and no
 * workspace between them, so the combat rules are kept as one source here and
 * one checked copy at `server/src/game-rules/combat/`, with a SHA-256 manifest
 * in both directories (`docs/design/server-combat.md` §3.2). The Baiter and the
 * server therefore execute the same bytes, and a battle the player watched is
 * the battle the server audits.
 *
 * `server/src/game-rules/combat/sync.test.ts` makes the same three assertions
 * from the other side, so a forgotten `node tools/sync-combat-rules.mjs` fails
 * both suites rather than shipping two versions of one rule.
 */

const SOURCE = fileURLToPath(new URL(".", import.meta.url));
const TARGET = fileURLToPath(new URL("../../../../../server/src/game-rules/combat/", import.meta.url));

interface Manifest {
  files: Record<string, string>;
  count: number;
  version: string;
}

/** The module's files: every `.ts` that is not a test, as the sync script picks them. */
const members = (directory: string): string[] =>
  readdirSync(directory)
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .sort();

const sha256 = (bytes: Buffer | string): string => createHash("sha256").update(bytes).digest("hex");

/**
 * The rules version a defence replay is stamped with
 * (`docs/design/defence-replays.md` §4): the first 16 hex of a SHA-256 over one
 * `<name>:<sha256>` line per file, in name order, as the sync script writes it.
 */
const versionOf = (files: Record<string, string>): string =>
  sha256(
    Object.keys(files)
      .sort()
      .map((name) => `${name}:${files[name]}
`)
      .join(""),
  ).slice(0, 16);

const manifestOf = (directory: string): Manifest =>
  JSON.parse(readFileSync(`${directory}MANIFEST.json`, "utf8"));

const REMEDY = "run `node tools/sync-combat-rules.mjs` from web/";

describe("the combat rules sync", () => {
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

  it("carries the version its files hash to, which any edit to any file changes", () => {
    const manifest = manifestOf(SOURCE);
    expect(manifest.version, REMEDY).toMatch(/^[0-9a-f]{16}$/);
    expect(manifest.version, REMEDY).toBe(versionOf(manifest.files));
    for (const name of Object.keys(manifest.files)) {
      const edited = { ...manifest.files, [name]: sha256(`${manifest.files[name]} edited`) };
      expect(versionOf(edited), name).not.toBe(manifest.version);
    }
    const fewer = Object.fromEntries(Object.entries(manifest.files).slice(1));
    expect(versionOf(fewer)).not.toBe(manifest.version);
  });
});
