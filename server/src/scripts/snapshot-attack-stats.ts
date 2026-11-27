/**
 * Writes the current attack-stat table into `game-data/stats/pastAttackStats/`
 * (beta 10, owner's pick B+, `pastAttackStats.ts`), so that once this table
 * goes live and is later replaced, a page still holding it is told to reload
 * instead of being banned.
 *
 *   bun run stats:snapshot [note]
 *
 * Run it whenever `monsterStats.ts` or `championStats.ts` changes
 * (`pastAttackStats.test.ts` fails until you do), and commit the new file.
 * The note is free text, e.g. the branch or release ("beta 10 rebalance").
 * Writing a table that already has its file changes nothing.
 */
import { existsSync, writeFileSync } from "node:fs";
import { ATTACK_STATS_VERSION, CURRENT_ATTACK_STATS } from "../game-data/stats/attackStatsVersion.js";
import { PAST_ATTACK_STATS_DIR } from "../game-data/stats/pastAttackStats.js";

const file = `${PAST_ATTACK_STATS_DIR}${ATTACK_STATS_VERSION}.json`;

if (existsSync(file)) {
  console.log(`Already kept: ${file}`);
} else {
  const note = process.argv.slice(2).join(" ").trim();
  // One line per monster or champion, so a diff between two files reads easily.
  const block = (rows: Record<string, unknown>): string =>
    `{\n${Object.entries(rows)
      .map(([id, row]) => `  ${JSON.stringify(id)}: ${JSON.stringify(row)}`)
      .join(",\n")}\n }`;
  const text = [
    "{",
    ` "version": ${JSON.stringify(ATTACK_STATS_VERSION)},`,
    ...(note ? [` "note": ${JSON.stringify(note)},`] : []),
    ` "written": ${JSON.stringify(new Date().toISOString().slice(0, 10))},`,
    ` "monsters": ${block(CURRENT_ATTACK_STATS.monsters)},`,
    ` "champions": ${block(CURRENT_ATTACK_STATS.champions)}`,
    "}",
    "",
  ].join("\n");
  writeFileSync(file, text);
  console.log(`Wrote ${file}`);
}
