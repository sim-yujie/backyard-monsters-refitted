import { describe, expect, test } from "bun:test";

import { defenderForcesOf } from "../../../game-rules/combat/defence.js";
import { replayAttack } from "../../../game-rules/combat/replay.js";
import { ticks } from "../../../game-rules/combat/stats.js";
import type { CombatBuildingDataMap, ResourceAmounts } from "../../../game-rules/combat/types.js";
import { MR1_TRIBE_IDS } from "../v1/index.js";
import { brukkargBases } from "./brukkarg.js";
import { creatureCarnageBases } from "./creatureCarnage.js";
import { EVENT_YARDS_MAP, EVENT_OF_YARD, eventYardOrder, isCopyYardId, isEventYardId } from "./index.js";

/**
 * The Brukkarg event yards ported from upstream (bruk-port, beta 10): every
 * template is a yard the combat engine can fight, with the defence the attack
 * start would serve (bunker monsters at the yard's own academy), and nothing
 * in it this game removed.
 */

type Building = { t: number; l?: number; m?: Record<string, number> };
const buildingsOf = (yard: { buildingdata?: unknown }): Building[] =>
  Object.values((yard.buildingdata ?? {}) as Record<string, Building>);

const ALL = [...creatureCarnageBases, ...brukkargBases];

describe("event yard ids", () => {
  test("ten Carnage yards 906-915, four Brukkarg yards 901-904, the copy yard 905", () => {
    expect(eventYardOrder("carnage")).toEqual(["906", "907", "908", "909", "910", "911", "912", "913", "914", "915"]);
    expect(eventYardOrder("brukwar")).toEqual(["901", "902", "903", "904", "905"]);
    expect(isCopyYardId("905")).toBe(true);
    expect(isCopyYardId("904")).toBe(false);
    expect(EVENT_OF_YARD.get("910")).toBe("carnage");
    expect(EVENT_OF_YARD.get("905")).toBe("brukwar");
  });

  test("clash with no other yard: below the player sequence's 1000, apart from every other tribe", () => {
    for (const id of EVENT_YARDS_MAP.keys()) {
      expect(Number(id)).toBeGreaterThan(900);
      expect(Number(id)).toBeLessThan(1000);
      expect(MR1_TRIBE_IDS.has(id)).toBe(false);
    }
    expect(isEventYardId("214")).toBe(false);
    expect(isEventYardId(906)).toBe(true);
  });

  test("Creature Carnage yards are Town Hall 3 with no bunker defenders", () => {
    creatureCarnageBases.forEach((yard) => {
      const hall = buildingsOf(yard).find((b) => b.t === 14);
      expect(hall?.l).toBe(3);
      expect(buildingsOf(yard).some((b) => b.m)).toBe(false);
    });
  });

  test("no Radio Tower (113, removed from this game) in any yard", () => {
    for (const yard of ALL) expect(buildingsOf(yard).some((b) => b.t === 113)).toBe(false);
  });
});

describe("every event yard fights", () => {
  const forcesOf = (yard: (typeof ALL)[number]) =>
    defenderForcesOf({
      buildingdata: yard.buildingdata,
      academy: yard.academy,
      champion: [],
      storedata: undefined,
      now: 1_800_000_000,
      monsters: yard.monsters,
      buildinghealthdata: {},
    } as never);

  test("Brukkarg yards' bunkers defend, at the yard's academy", () => {
    for (const yard of brukkargBases) {
      const forces = forcesOf(yard);
      const garrisoned = Object.values(forces.bunkers).reduce(
        (sum, roster) => sum + Object.values(roster).reduce((a, b) => a + (b ?? 0), 0),
        0
      );
      expect(garrisoned).toBeGreaterThan(0);
      expect(Object.keys(forces.defenderLevels).length).toBeGreaterThan(0);
      expect(forces.defenderChampions).toEqual([]);
    }
  });

  test("a big army flung at each yard fights to a result without throwing", () => {
    for (const yard of ALL) {
      const forces = forcesOf(yard);
      const out = replayAttack({
        buildingdata: yard.buildingdata as unknown as CombatBuildingDataMap,
        resources: yard.resources as unknown as Partial<ResourceAmounts>,
        kind: "tribe",
        levels: { C5: 6, C7: 6 },
        playerLevel: 20,
        bunkers: forces.bunkers,
        defenderLevels: forces.defenderLevels,
        defenderChampions: forces.defenderChampions,
        tailTicks: ticks(120),
        log: {
          v: 1,
          seed: 7,
          events: [
            { kind: "fling", t: 0, x: 500, y: 0, r: 100, monsters: { C5: 30 } },
            { kind: "fling", t: 20, x: -500, y: 0, r: 100, monsters: { C7: 60 } },
          ],
        },
      });
      expect(out.damage).toBeGreaterThanOrEqual(0);
      expect(out.damage).toBeLessThanOrEqual(100);
    }
  });
});
