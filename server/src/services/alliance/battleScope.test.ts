import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { EntityManager } from "@mikro-orm/core";

import { CONSTELLATIONS } from "../../config/AllianceConfig.js";
import { AllianceType } from "../../enums/Alliance.js";
import { BaseType } from "../../enums/Base.js";
import { defenderForcesOf } from "../../game-rules/combat/index.js";
import {
  allianceDefenceApplies,
  allianceDefenceOfOwner,
  attackLootPercent,
  bonusesFor,
} from "./allianceBonuses.js";

/**
 * Where the constellation battle effects apply (owner, 10 Nov 2026: "battle
 * bonuses against players only, or attacks on wild monster tribes"):
 * - a player attacks a member's yard: the member's defence stars count;
 * - a member attacks a wild monster tribe: the member's attack stars (loot)
 *   count, the tribe has none;
 * - wild monsters raid a member's yard: no alliance stars at all.
 */

const FORTRESS = AllianceType.FORTRESS;
const allLit = (type: AllianceType) => Object.fromEntries(CONSTELLATIONS[type].map((c) => [c.id, 5]));

/** A stand-in entity manager: user 7 is in a Fortress with every star lit, user 8 in a Midas with none. */
const em = {
  execute: async (_sql: string, params: unknown[]) => {
    const userid = Number(params[0]);
    if (userid === 7) return [{ type: FORTRESS, stars: allLit(FORTRESS) }];
    if (userid === 8) return [{ type: AllianceType.MIDAS, stars: {} }];
    return [];
  },
} as unknown as EntityManager;

describe("alliance battle effects: where they apply", () => {
  test("a player attacking a member's main yard or outpost meets the member's defence stars", async () => {
    expect(allianceDefenceApplies({ type: BaseType.MAIN, saveuserid: 7 })).toBe(true);
    expect(allianceDefenceApplies({ type: BaseType.OUTPOST, saveuserid: 7 })).toBe(true);
    const main = await allianceDefenceOfOwner(em, 7, false);
    const outpost = await allianceDefenceOfOwner(em, 7, true);
    expect(main?.hp ?? 0).toBeGreaterThan(0);
    // An outpost adds outpost health on top.
    expect(outpost?.hp ?? 0).toBeGreaterThanOrEqual(main?.hp ?? 0);
  });

  test("a member attacking a wild monster tribe: the tribe's yard has no alliance stars", () => {
    expect(allianceDefenceApplies({ type: BaseType.TRIBE, saveuserid: 0 })).toBe(false);
    // A wild camp on the map has no player owner, whatever its type says.
    expect(allianceDefenceApplies({ type: BaseType.OUTPOST, saveuserid: 0 })).toBe(false);
    expect(allianceDefenceApplies({ type: BaseType.MAIN, saveuserid: null })).toBe(false);
    expect(allianceDefenceApplies({ type: BaseType.INFERNO, saveuserid: 7 })).toBe(false);
  });

  test("a member attacking a wild monster tribe keeps their own loot stars", async () => {
    const loot = bonusesFor(FORTRESS, allLit(FORTRESS)).loot;
    // No defending owner: only the attacker's loot counts.
    expect(await attackLootPercent(em, 7, 0)).toBeCloseTo(loot, 5);
    expect(await attackLootPercent(em, 7, null)).toBeCloseTo(loot, 5);
  });

  test("against a player, the attacker's loot and the defender's raiders-carry both count", async () => {
    const mine = bonusesFor(FORTRESS, allLit(FORTRESS)).loot;
    const theirs = bonusesFor(AllianceType.MIDAS, {}).raidersCarry;
    expect(await attackLootPercent(em, 7, 8)).toBeCloseTo(mine + theirs, 5);
  });

  test("a wild monster raid on a member's yard defends with the yard alone, no alliance stars", () => {
    // The raid's defence is the yard's own (bunkers, academy, champion, shop boosts).
    const forces = defenderForcesOf({ buildingdata: {}, academy: {}, champion: null, storedata: {}, now: 0 });
    expect("alliance" in forces).toBe(false);
    // Neither raid fight reads the alliance: a tripwire against wiring it in later by mistake.
    for (const file of ["../raids/raidFlow.ts", "../raids/trojanFight.ts", "../raids/raidFight.ts"]) {
      const source = readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");
      expect(source).not.toMatch(/allianceDefence|allianceBonuses|attackLootPercent/);
    }
  });
});
