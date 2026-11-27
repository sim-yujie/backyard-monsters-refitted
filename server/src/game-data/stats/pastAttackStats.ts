import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { type AttackStatTable, type StatLadder, attackStatsVersionOf } from "./attackStatsVersion.js";

/**
 * Every attack-stat table this game has shipped, kept so an attack start
 * from a page left open across a release is told to reload, never banned
 * (beta 10, owner's pick B+, 27 Nov 2026; `validateAttack.ts`).
 *
 * One JSON file per table in `pastAttackStats/`, named by its version
 * (`attackStatsVersion.ts`). `bun run stats:snapshot` writes the current
 * table's file, and `pastAttackStats.test.ts` fails CI while the current
 * table has none. So every table that ever passed CI on the way to a release
 * is here when the next release goes live: the live page's table cannot be
 * forgotten, and no release step has to remember it. A file may be deleted
 * once no open tab can still hold its table (a month after the release that
 * replaced it is plenty); the newest few must stay.
 *
 * Read once, at start-up: the files cannot change while the server runs.
 */

/** A snapshot file: the table, its version and where it came from. */
export interface PastAttackStats extends AttackStatTable {
  readonly version: string;
  /** Free text: the release or branch the table was written from. */
  readonly note?: string;
}

/** The folder the snapshots live in. */
export const PAST_ATTACK_STATS_DIR = fileURLToPath(new URL("./pastAttackStats/", import.meta.url));

/** Reads every snapshot in `directory`, refusing one whose name or version does not match its table. */
export const readPastAttackStats = (directory: string = PAST_ATTACK_STATS_DIR): PastAttackStats[] =>
  readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => {
      const table = JSON.parse(readFileSync(`${directory}${name}`, "utf8")) as PastAttackStats;
      const version = attackStatsVersionOf({ monsters: table.monsters, champions: table.champions });
      if (version !== table.version || `${version}.json` !== name) {
        throw new Error(`${directory}${name} does not hold the table its name says (${version}): rewrite it with \`bun run stats:snapshot\``);
      }
      return table;
    });

/** Every past table, read at start-up. */
export const PAST_ATTACK_STATS: readonly PastAttackStats[] = readPastAttackStats();

/** Two ladders are the same to two decimal places, as the attack gate compares them; absent equals absent. */
export const laddersMatch = (received: unknown, expected: StatLadder | undefined): boolean => {
  if (received === undefined || expected === undefined) return received === expected;
  if (!Array.isArray(received) || received.length !== expected.length) return false;
  return received.every((value, i) => {
    const want = expected[i];
    if (typeof value === "number" && typeof want === "number") return Number(value.toFixed(2)) === Number(want.toFixed(2));
    return typeof value === "string" && value === want;
  });
};

/**
 * Whether a monster ladder an attack start declared is one a past table held
 * for that monster and stat: the page was built before the table changed.
 */
export const pastMonsterLadder = (
  id: string,
  key: string,
  received: unknown,
  past: readonly AttackStatTable[] = PAST_ATTACK_STATS
): boolean => past.some((table) => table.monsters[id] !== undefined && laddersMatch(received, table.monsters[id]?.[key]));

/** {@link pastMonsterLadder} for a champion's stat. */
export const pastChampionLadder = (
  type: string,
  key: string,
  received: unknown,
  past: readonly AttackStatTable[] = PAST_ATTACK_STATS
): boolean =>
  past.some((table) => table.champions[type] !== undefined && laddersMatch(received, table.champions[type]?.props[key]));

/** Whether a past table knew a monster id or champion type the current one does not. */
export const pastKnows = (
  kind: "monsters" | "champions",
  id: string,
  past: readonly AttackStatTable[] = PAST_ATTACK_STATS
): boolean => past.some((table) => table[kind][id] !== undefined);
