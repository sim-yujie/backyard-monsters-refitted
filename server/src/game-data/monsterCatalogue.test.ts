import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  hatchCost,
  isListed,
  LAB_ABILITIES,
  LISTED_MONSTERS,
  MONSTER_CATALOGUE,
  monsterEntry,
  trainingStep,
} from "./monsterCatalogue.js";
import { monsterStats } from "./stats/monsterStats.js";

/**
 * The generated monster catalogue, from the server's side.
 *
 * `web/src/game/monsters/monsterCatalogue.test.ts` checks the helpers and the
 * generator's tripwires; this file makes the sync assertion from the other
 * direction (so a forgotten regeneration fails both suites) and cross-checks
 * the economy numbers against the server's own stat table, which the attack
 * gate trusts (`server/src/services/maproom/validateAttack.ts`).
 */

const lf = (path: URL): string => readFileSync(path, "utf8").replace(/\r\n/g, "\n");

describe("monsterCatalogue", () => {
  test("is the same file as the web client's copy", () => {
    const web = new URL("../../../web/src/game/monsters/monsterCatalogue.ts", import.meta.url);
    const server = new URL("./monsterCatalogue.ts", import.meta.url);
    expect(lf(server)).toBe(lf(web));
  });

  test("holds C1 to C19, eighteen of them listed", () => {
    expect(MONSTER_CATALOGUE.map((entry) => entry.id)).toEqual(
      Array.from({ length: 19 }, (_, k) => `C${k + 1}`)
    );
    expect(LISTED_MONSTERS.length).toBe(18);
    expect(isListed("C18")).toBe(false);
    for (const id of ["C16", "C17", "C19"]) expect(isListed(id)).toBe(true);
    expect(LAB_ABILITIES.length).toBe(10);
  });

  test("agrees with monsterStats on every economy number", () => {
    for (const entry of MONSTER_CATALOGUE) {
      const stats = monsterStats[entry.id];
      expect(stats, entry.id).toBeDefined();
      expect(entry.resource, entry.id).toBe(stats.resource);
      expect(entry.time, entry.id).toBe(stats.time);
      expect(entry.trainingCosts, entry.id).toEqual(stats.trainingCosts);
      expect(entry.cResource, entry.id).toEqual(stats.props.cResource);
      expect(entry.cTime, entry.id).toEqual(stats.props.cTime);
      expect(entry.cStorage, entry.id).toEqual(stats.props.cStorage);
    }
  });

  test("answers the lookups the yard routes will make", () => {
    expect(monsterEntry("C1")?.resource).toBe(4000);
    expect(monsterEntry("C1")?.time).toBe(600);
    expect(monsterEntry("C200")).toBeUndefined();
    expect(hatchCost("C19", 3)).toBe(1000000);
    expect(trainingStep("C15", 4)).toEqual([18000000, 136 * 3600]);
    expect(trainingStep("C15", 5)).toBeUndefined();
  });
});
