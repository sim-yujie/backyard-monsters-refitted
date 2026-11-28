import { describe, expect, it } from "vitest";

import { createBattle } from "./engine.js";
import { TICKS_PER_SECOND, monsterStat } from "./stats.js";
import { buildEngineYard } from "./yard.js";
import type { CombatBuildingDataMap, RaidEvent } from "./types.js";

/**
 * A wave event's raid wave (beta 10, Wild Monster Invasion): its own level,
 * Monster Lab rank and enrage seconds (`RaidEvent.level`, `rank`, `rage`), in
 * place of the defender's academy level, Moloch's ranks and no enrage.
 */

const BUNKER: CombatBuildingDataMap = { "1": { id: 1, t: 22, l: 1, X: 0, Y: 0 } };
const NO_RESOURCES = { r1: 0, r2: 0, r3: 0, r4: 0 };
const yard = () =>
  buildEngineYard({ buildingdata: BUNKER, buildinghealthdata: {}, resources: NO_RESOURCES });
const wave = (extra: Partial<RaidEvent>): RaidEvent => ({
  kind: "raid",
  t: 0,
  x: 400,
  y: 0,
  r: 20,
  monsters: { IC5: 2 },
  ...extra,
});

describe("a wave event's raid wave", () => {
  it("spawns at the wave's level, not the defender's academy level", () => {
    const battle = createBattle(yard(), { seed: 1, defenderLevels: { IC5: 1 }, raid: true });
    battle.apply(wave({ level: 6 }));
    for (const creep of battle.creeps()) {
      expect(creep.level).toBe(6);
      expect(creep.maxHp).toBe(Math.trunc(monsterStat("IC5", "health", 6)));
    }
  });

  it("takes the wave's Lab rank over Moloch's, which stays when the wave names none", () => {
    const ranked = createBattle(yard(), { seed: 1, raid: true });
    ranked.apply(wave({ rank: 0 }));
    expect(ranked.creeps().map((creep) => creep.rank)).toEqual([undefined, undefined]);
    const moloch = createBattle(yard(), { seed: 1, raid: true });
    moloch.apply(wave({}));
    expect(moloch.creeps().map((creep) => creep.rank)).toEqual([2, 2]);
  });

  it("lands enraged for its seconds: twice as fast, no armour, then back to normal", () => {
    const battle = createBattle(yard(), { seed: 1, raid: true });
    battle.apply(wave({ rage: 2 }));
    for (const creep of battle.creeps()) expect(creep.puttied).toBe(true);
    for (let step = 0; step < 3 * TICKS_PER_SECOND; step += 1) battle.step();
    for (const creep of battle.creeps()) expect(creep.puttied).toBeFalsy();
  });

  it("a wave without the fields spawns as before", () => {
    const battle = createBattle(yard(), { seed: 1, defenderLevels: { IC5: 3 }, raid: true });
    battle.apply(wave({}));
    for (const creep of battle.creeps()) {
      expect(creep.level).toBe(3);
      expect(creep.puttied).toBeFalsy();
    }
  });
});
