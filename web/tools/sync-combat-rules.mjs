/**
 * Copies the shared combat rules module into the server tree.
 *
 *   cd web && node tools/sync-combat-rules.mjs          # copy and write manifests
 *   cd web && node tools/sync-combat-rules.mjs --check  # exit 1 on any drift
 *
 * `web/` and `server/` are separate packages with different compilers and no
 * workspace between them, so the combat rules — which the Wild Monster Baiter
 * and the server's attack audit must agree on to the byte — are kept as one
 * source and one checked copy rather than a third package with a build step
 * (`docs/design/server-combat.md` §3.2).
 *
 * What it does:
 *
 * 1. Copies every `*.ts` under `web/src/game/combat/rules/` that is not a test
 *    into `server/src/game-rules/combat/`, byte for byte.
 * 2. Deletes a copy whose source is gone, so a renamed file cannot leave a
 *    stale one behind for the server to import. The server's own
 *    `sync.test.ts` is not a copy and is never touched.
 * 3. Writes `MANIFEST.json` — file name to SHA-256, plus the count — into both
 *    directories.
 *
 * `sync.test.ts` in each tree re-hashes what it holds and compares it to the
 * manifest, so a forgotten sync fails both test suites rather than shipping two
 * versions of the same rule.
 *
 * Nothing here runs in the browser and nothing in `src/` imports it.
 */

import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");

const SOURCE = resolve(here, "../src/game/combat/rules");
const TARGET = resolve(repo, "server/src/game-rules/combat");
const MANIFEST = "MANIFEST.json";

const check = process.argv.includes("--check");

/**
 * The files that are part of the module.
 *
 * Tests stay in the source tree and are not copied: the server's own coverage
 * of the module is the golden replay fixtures under Bun and the drift test
 * (`docs/design/server-combat.md` §4.1). The manifest is not a member of
 * itself.
 */
const isMember = (name) => name.endsWith(".ts") && !name.endsWith(".test.ts");

const members = () => readdirSync(SOURCE).filter(isMember).sort();

/**
 * Copied files in the server tree, which is not everything `.ts` there.
 *
 * `server/src/game-rules/combat/sync.test.ts` is the server's own drift test
 * and belongs to the server, not to the module; it must survive a sync that
 * would otherwise see a file with no source and delete it.
 */
const copies = () => {
  try {
    return readdirSync(TARGET).filter(isMember).sort();
  } catch {
    return [];
  }
};

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** `{ files: { name: sha }, count }`, the shape both `sync.test.ts` files read. */
const manifestOf = (files) => ({
  files: Object.fromEntries(files.map(({ name, hash }) => [name, hash])),
  count: files.length,
});

const files = members();
if (files.length === 0) {
  throw new Error(`${SOURCE} holds no module files; refusing to sync an empty module.`);
}

const read = files.map((name) => {
  const bytes = readFileSync(resolve(SOURCE, name));
  return { name, bytes, hash: sha256(bytes) };
});

const manifest = `${JSON.stringify(manifestOf(read), null, 2)}\n`;

if (check) {
  const problems = [];
  for (const { name, bytes } of read) {
    let copy;
    try {
      copy = readFileSync(resolve(TARGET, name));
    } catch {
      problems.push(`${name}: missing from the server copy`);
      continue;
    }
    if (!copy.equals(bytes)) problems.push(`${name}: the server copy differs from the source`);
  }
  const known = new Set(files);
  for (const name of copies()) {
    if (!known.has(name)) problems.push(`${name}: in the server copy with no source`);
  }
  for (const directory of [SOURCE, TARGET]) {
    const path = resolve(directory, MANIFEST);
    let held;
    try {
      held = readFileSync(path, "utf8");
    } catch {
      problems.push(`${path}: missing`);
      continue;
    }
    if (held !== manifest) problems.push(`${path}: does not match the source`);
  }
  if (problems.length > 0) {
    console.error(`Combat rules are out of sync; run \`node tools/sync-combat-rules.mjs\`:`);
    for (const problem of problems) console.error(`  ${problem}`);
    process.exit(1);
  }
  console.log(`${files.length} file(s) in sync.`);
  process.exit(0);
}

mkdirSync(TARGET, { recursive: true });

// A copy whose source is gone would still compile on the server and would still
// be imported, so it goes before anything is written.
const known = new Set(files);
const stale = copies().filter((name) => !known.has(name));
for (const name of stale) rmSync(resolve(TARGET, name));

for (const { name, bytes } of read) writeFileSync(resolve(TARGET, name), bytes);

writeFileSync(resolve(SOURCE, MANIFEST), manifest, "utf8");
writeFileSync(resolve(TARGET, MANIFEST), manifest, "utf8");

console.log(`${files.length} file(s) -> ${TARGET}${stale.length > 0 ? `, ${stale.length} removed` : ""}`);
for (const { name, hash } of read) console.log(`  ${hash.slice(0, 12)}  ${name}`);
