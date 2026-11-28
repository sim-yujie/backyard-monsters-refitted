import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ATTACK_STATS_VERSION, CURRENT_ATTACK_STATS, attackStatsVersionOf } from "./attackStatsVersion.js";
import { PAST_ATTACK_STATS, laddersMatch, pastMonsterLadder, readPastAttackStats } from "./pastAttackStats.js";

/**
 * The kept attack-stat tables (beta 10, owner's pick B+, `pastAttackStats.ts`).
 *
 * The first test is the one that keeps the scheme honest: it fails while
 * today's table has no snapshot, so a table cannot reach a release without
 * one, and the release after it still knows that table's pages are only old.
 */

const REMEDY = "run `bun run stats:snapshot \"<branch or release>\"` in server/ and commit the new file in game-data/stats/pastAttackStats/";

describe("the kept attack-stat tables", () => {
  test("hold today's table (monsterStats.ts / championStats.ts)", () => {
    const kept = PAST_ATTACK_STATS.map((one) => one.version);
    expect(kept.includes(ATTACK_STATS_VERSION), `no snapshot of ${ATTACK_STATS_VERSION}: ${REMEDY}`).toBe(true);
  });

  test("today's snapshot equals the table itself", () => {
    const today = PAST_ATTACK_STATS.find((one) => one.version === ATTACK_STATS_VERSION);
    expect(today?.monsters).toEqual(JSON.parse(JSON.stringify(CURRENT_ATTACK_STATS.monsters)));
    expect(today?.champions).toEqual(JSON.parse(JSON.stringify(CURRENT_ATTACK_STATS.champions)));
  });

  test("a file whose name or table was edited by hand is refused at start-up", () => {
    const dir = `${mkdtempSync(join(tmpdir(), "past-stats-"))}/`;
    const table = { version: "0000000000000000", monsters: { C1: { health: [1] } }, champions: {} };
    writeFileSync(`${dir}0000000000000000.json`, JSON.stringify(table));
    expect(() => readPastAttackStats(dir)).toThrow(/stats:snapshot/);
  });
});

describe("the stats version", () => {
  test("does not depend on the order keys were written in", () => {
    const a = { monsters: { C1: { health: [1, 2], damage: [3] } }, champions: { G1: { t: 1, props: { speed: [1] } } } };
    const b = { champions: { G1: { props: { speed: [1] }, t: 1 } }, monsters: { C1: { damage: [3], health: [1, 2] } } };
    expect(attackStatsVersionOf(a)).toBe(attackStatsVersionOf(b));
    expect(attackStatsVersionOf(a)).toMatch(/^[0-9a-f]{16}$/);
  });

  test("changes when a hatch time changes", () => {
    const before = { monsters: { C1: { hTime: [5, 3] } }, champions: {} };
    const after = { monsters: { C1: { hTime: [6, 3] } }, champions: {} };
    expect(attackStatsVersionOf(before)).not.toBe(attackStatsVersionOf(after));
  });
});

describe("ladders", () => {
  test("match to two decimal places, as the gate always compared them", () => {
    expect(laddersMatch([1.2, 2.001], [1.2, 2])).toBe(true);
    expect(laddersMatch([1.2, 2.02], [1.2, 2])).toBe(false);
    expect(laddersMatch(["ground"], ["ground"])).toBe(true);
    expect(laddersMatch(undefined, undefined)).toBe(true);
    expect(laddersMatch([1], undefined)).toBe(false);
    expect(laddersMatch("1", [1])).toBe(false);
    expect(laddersMatch(["1"], [1])).toBe(false);
  });

  test("a past ladder is found by monster and stat", () => {
    const past = [{ monsters: { C1: { health: [10, 20] } }, champions: {} }];
    expect(pastMonsterLadder("C1", "health", [10, 20], past)).toBe(true);
    expect(pastMonsterLadder("C1", "health", [10, 21], past)).toBe(false);
    expect(pastMonsterLadder("C2", "health", [10, 20], past)).toBe(false);
  });
});
