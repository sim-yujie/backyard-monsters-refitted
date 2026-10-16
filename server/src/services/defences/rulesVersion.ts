import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The combat rules' version, as `web/tools/sync-combat-rules.mjs` wrote it
 * into `game-rules/combat/MANIFEST.json`: the first 16 hex of a SHA-256 over
 * every rules file's hash (`docs/design/defence-replays.md` §4).
 *
 * A defence replay is stamped with it; once it no longer matches, the battle
 * would not play the same, so the replay is not offered. The web bundle reads
 * the same string from its own copy of the manifest. Read once, at start-up:
 * the rules cannot change while the server runs.
 */
const MANIFEST = fileURLToPath(new URL("../../game-rules/combat/MANIFEST.json", import.meta.url));

const versionOf = (manifest: unknown): string => {
  const version = (manifest as { version?: unknown } | null)?.version;
  if (typeof version !== "string" || !/^[0-9a-f]{16}$/.test(version)) {
    throw new Error(`${MANIFEST} has no rules version: run \`node tools/sync-combat-rules.mjs\` from web/`);
  }
  return version;
};

export const RULES_VERSION: string = versionOf(JSON.parse(readFileSync(MANIFEST, "utf8")));
