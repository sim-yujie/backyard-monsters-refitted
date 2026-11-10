import { describe, expect, it } from "vitest";
import { damagePercent } from "./damagePercent.js";
import { createBattle } from "./engine.js";
import { maxHp, propsSizeOf } from "./stats.js";
import { buildEngineYard, buildingClass, footprintOf, isMainTarget } from "./yard.js";
import { toCombatYard } from "./types.js";

/**
 * The Observatory, 150, this project's own alliance building, in a battle
 * (owner 10 Nov 2026): a normal building like the Map Room. It has health, a
 * creep chooses it and knocks it down, it counts towards the damage
 * percentage, and it holds no loot. Its numbers are placeholders from
 * `web/tools/gen-combat-stats.mjs`, "This project's own buildings".
 */

const OBSERVATORY = 150;

describe("the Observatory in a battle", () => {
  it("is a 100 x 100 special with the Map Room's level 2 health", () => {
    expect(buildingClass(OBSERVATORY)).toBe("special");
    expect(isMainTarget(buildingClass(OBSERVATORY))).toBe(true);
    expect(footprintOf(OBSERVATORY)).toEqual({ w: 100, h: 100 });
    expect(maxHp(OBSERVATORY, 1)).toBe(maxHp(11, 2));
    expect(maxHp(OBSERVATORY, 1)).toBe(10_000);
    // One level: anything past it reads the same rung.
    expect(maxHp(OBSERVATORY, 3)).toBe(10_000);
    expect(propsSizeOf(OBSERVATORY)).toBe(120);
  });

  it("is chosen and destroyed by creeps, and gives no loot", () => {
    const yard = buildEngineYard({
      buildingdata: { "1": { id: 1, t: OBSERVATORY, l: 1, X: 0, Y: 0 } },
      buildinghealthdata: {},
      resources: { r1: 100000, r2: 100000, r3: 100000, r4: 100000 },
    });
    expect(yard.buildings[0]?.maxHp).toBe(10_000);
    const battle = createBattle(yard, { seed: 1, playerLevel: 20 });
    battle.apply({ kind: "fling", t: 0, x: -100, y: -100, r: 60, monsters: { C1: 20 } });
    for (let step = 0; step < 40_000 && !battle.over(); step += 1) battle.step();
    const state = battle.state();
    expect(state.destroyedIds).toEqual([1]);
    expect(yard.buildings[0]?.hp).toBe(0);
    expect(state.loot).toEqual({ r1: 0, r2: 0, r3: 0, r4: 0 });
    expect(state.defenderLoss).toEqual({ r1: 0, r2: 0, r3: 0, r4: 0 });
  });

  it("counts towards the damage percentage like any building", () => {
    const yard = toCombatYard({
      kind: "main",
      buildingdata: {
        "1": { id: 1, t: OBSERVATORY, l: 1, X: 0, Y: 0 },
        // A level 2 Map Room, the same 10,000 health.
        "2": { id: 2, t: 11, l: 2, X: 200, Y: 0 },
      },
      buildinghealthdata: {},
    });
    expect(damagePercent(yard, { "1": 0 })).toBe(50);
    expect(damagePercent(yard, { "1": 5_000 })).toBe(25);
  });
});
