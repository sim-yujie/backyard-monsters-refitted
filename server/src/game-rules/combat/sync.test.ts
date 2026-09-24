import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * This copy of the shared combat rules still matches its source.
 *
 * Everything beside this file is generated or hand-written in
 * `web/src/game/combat/rules/` and copied here byte for byte by
 * `web/tools/sync-combat-rules.mjs`, which writes a SHA-256 manifest into both
 * directories (`docs/design/server-combat.md` §3.2). Nothing here is edited: an
 * audit that disagreed with the Wild Monster Baiter would refuse a battle the
 * player watched, so the two trees run the same bytes or neither ships.
 *
 * This file is the exception — it belongs to the server, not to the module, so
 * the sync neither copies nor deletes it. The source is reached through
 * `../../../../web/src/game/combat/rules`, the same relative reach
 * `src/game-data/buildingCosts.test.ts:28` makes for the sandbox fixture.
 * `web/src/game/combat/rules/sync.test.ts` makes the same assertions from the
 * other side, so a forgotten sync fails both suites.
 */

const TARGET = fileURLToPath(new URL(".", import.meta.url));
const SOURCE = fileURLToPath(new URL("../../../../web/src/game/combat/rules/", import.meta.url));

interface Manifest {
  files: Record<string, string>;
  count: number;
}

/** The module's files: every `.ts` that is not a test, as the sync script picks them. */
const members = (directory: string): string[] =>
  readdirSync(directory)
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .sort();

const sha256 = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

const manifestOf = (directory: string): Manifest =>
  JSON.parse(readFileSync(`${directory}MANIFEST.json`, "utf8"));

const REMEDY = "run `node tools/sync-combat-rules.mjs` from web/";

describe("game-rules/combat sync", () => {
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
