import { describe, expect, it } from "vitest";

import { defenderForcesOf } from "./defence.js";
import { createBattle, housedGarrisons, type BattleOptions } from "./engine.js";
import { buildEngineYard } from "./yard.js";
import type { CombatBuildingDataMap } from "./types.js";

/**
 * The Housing Bunker's defenders against Flash (`client/scripts/HOUSINGBUNKER.as`,
 * Inferno plan WP 1.6). A level 1 bunker at the origin is 160 x 160 and scans
 * 500 from the middle of its footprint; its first look is on tick 30.
 */

const yardOf = (buildings: CombatBuildingDataMap) =>
  buildEngineYard({
    buildingdata: buildings,
    buildinghealthdata: {},
    resources: { r1: 100000, r2: 0, r3: 0, r4: 0 },
  });

type Battle = ReturnType<typeof createBattle>;

const run = (battle: Battle, ticks: number): void => {
  for (let step = 0; step < ticks && !battle.over(); step += 1) battle.step();
};

const bunkerYard: CombatBuildingDataMap = {
  "1": { id: 1, t: 128, l: 1, X: 0, Y: 0 },
  "2": { id: 2, t: 1, l: 1, X: 900, Y: 900 },
};

const battleOf = (
  garrison: Record<string, number>,
  flings: ReadonlyArray<{ x: number; y: number; monsters: Record<string, number> }>,
  options: Partial<BattleOptions> = {},
  buildings: CombatBuildingDataMap = bunkerYard,
) => {
  const battle = createBattle(yardOf(buildings), { seed: 5, bunkers: { 1: garrison }, ...options });
  for (const fling of flings) battle.apply({ kind: "fling", t: 0, r: 0, ...fling });
  return battle;
};

const defenders = (battle: Battle) => battle.creeps().filter((creep) => creep.friendly);

describe("a Housing Bunker sends everything at once (`HOUSINGBUNKER.as:289-298`)", () => {
  it("sends every monster it holds at the nearest walker on its first look", () => {
    const battle = battleOf({ IC1: 3, IC2: 2 }, [
      { x: 160, y: 160, monsters: { C1: 1 } },
      { x: 420, y: 420, monsters: { C1: 1 } },
    ]);
    const [near] = battle.creeps();
    run(battle, 29);
    expect(defenders(battle)).toHaveLength(0);
    run(battle, 1);
    const out = defenders(battle);
    expect(out.map((creep) => creep.monsterId).sort()).toEqual(["IC1", "IC1", "IC1", "IC2", "IC2"]);
    for (const creep of out) expect(creep.targetCreep).toBe(near!.id);
    expect(battle.state().bunkers[0]!.sent).toBe(5);
  });

  it("sends nothing at a walker out of its range", () => {
    const battle = battleOf({ IC1: 3 }, [{ x: 700, y: 700, monsters: { C1: 1 } }]);
    run(battle, 30);
    expect(defenders(battle)).toHaveLength(0);
  });

  it("sends nothing while it is being upgraded (`:269`)", () => {
    const battle = battleOf({ IC1: 3 }, [{ x: 160, y: 160, monsters: { C1: 1 } }], {}, {
      ...bunkerYard,
      "1": { id: 1, t: 128, l: 1, X: 0, Y: 0, cU: 100 },
    });
    run(battle, 90);
    expect(defenders(battle)).toHaveLength(0);
  });
});

describe("a Housing Bunker's interceptors (`HOUSINGBUNKER.as:277-288`)", () => {
  it("sends a Balthazar or a Sabnox after each flyer, then the rest at the walker", () => {
    const battle = battleOf({ IC1: 2, IC5: 1, IC7: 1 }, [
      { x: 160, y: 160, monsters: { C1: 1 } },
      { x: 200, y: 200, monsters: { C15: 2 } },
    ]);
    const walker = battle.creeps().find((creep) => creep.monsterId === "C1")!;
    const flyers = battle.creeps().filter((creep) => creep.monsterId === "C15");
    run(battle, 30);
    const out = defenders(battle);
    const on = (id: string) => out.filter((creep) => creep.monsterId === id);
    expect(out).toHaveLength(4);
    for (const creep of on("IC1")) expect(creep.targetCreep).toBe(walker.id);
    const intercepted = [...on("IC5"), ...on("IC7")].map((creep) => creep.targetCreep).sort();
    expect(intercepted).toEqual(flyers.map((creep) => creep.id).sort());
  });

  it("sends only the interceptor when no walker is in range", () => {
    const battle = battleOf({ IC1: 2, IC5: 1 }, [{ x: 200, y: 200, monsters: { C15: 1 } }]);
    run(battle, 30);
    expect(defenders(battle).map((creep) => creep.monsterId)).toEqual(["IC5"]);
  });

  it("ignores flyers when it holds neither (`canTargetAir`, `:167-178`)", () => {
    const battle = battleOf({ IC1: 2 }, [{ x: 200, y: 200, monsters: { C15: 1 } }]);
    run(battle, 90);
    expect(defenders(battle)).toHaveLength(0);
  });

  it("sends no more interceptors than it has flyers in sight", () => {
    const battle = battleOf({ IC5: 3 }, [{ x: 200, y: 200, monsters: { C15: 1 } }]);
    run(battle, 30);
    expect(defenders(battle)).toHaveLength(1);
  });
});

describe("a fallen Housing Bunker (`HOUSINGBUNKER.as:116-127`)", () => {
  /**
   * Eye-ras, which never fight a defender back, blow up a lone bunker on
   * tick 60; a Pokey off to the side has drawn its defenders out by then.
   */
  const fallen = (garrison: Record<string, number>, busy: boolean) => {
    const battle = battleOf(
      garrison,
      [{ x: 330, y: 330, monsters: { C1: 1 } }],
      { levels: { C5: 6 } },
      {
        "1": { id: 1, t: 128, l: 1, X: 0, Y: 0, ...(busy ? { cU: 100 } : {}) },
        "2": { id: 2, t: 1, l: 1, X: 900, Y: 900 },
      },
    );
    run(battle, 60);
    battle.apply({ kind: "fling", t: 60, x: 120, y: 120, r: 0, monsters: { C5: 30 } });
    let falls = -1;
    for (let step = 0; step < 3000 && !battle.over() && falls < 0; step += 1) {
      battle.step();
      if (battle.state().destroyedIds.includes(1)) falls = battle.tick;
    }
    return { battle, falls };
  };

  it("kills every monster it never sent, counted against it", () => {
    const { battle, falls } = fallen({ IC1: 4, IC2: 1 }, true);
    expect(falls).toBeGreaterThan(0);
    const state = battle.state();
    expect(state.bunkerLosses[1]).toEqual({ IC1: 4, IC2: 1 });
    expect(state.bunkerGarrisons[1]).toEqual({});
  });

  it("kills the ones out fighting too", () => {
    const { battle, falls } = fallen({ IC6: 3 }, false);
    expect(falls).toBeGreaterThan(30);
    const state = battle.state();
    expect(state.bunkers[0]!.sent).toBe(3);
    expect(state.bunkerLosses[1]).toEqual({ IC6: 3 });
    expect(state.bunkerGarrisons[1]).toEqual({});
    battle.step();
    expect(defenders(battle)).toHaveLength(0);
  });
});

describe("a yard's housed monsters in its Housing Bunkers (`HOUSING.as:201-235`)", () => {
  const twoBunkers: CombatBuildingDataMap = {
    "262": { id: 262, t: 128, l: 4, X: 0, Y: 0 },
    "1059": { id: 1059, t: 128, l: 4, X: 300, Y: 0 },
    "5": { id: 5, t: 1, l: 1, X: 0, Y: 300 },
  };

  it("deals them out in turn, monster ids in order, bunkers by id", () => {
    expect(housedGarrisons(twoBunkers, { IC7: 3, IC5: 5 })).toEqual({
      262: { IC5: 3, IC7: 1 },
      1059: { IC5: 2, IC7: 2 },
    });
  });

  it("leaves out a bunker that is down, and anything it does not know", () => {
    expect(housedGarrisons(twoBunkers, { IC1: 3, X9: 2, IC2: 0 }, { "262": 0 })).toEqual({
      1059: { IC1: 3 },
    });
  });

  it("houses nobody on a yard with no Housing Bunker", () => {
    expect(housedGarrisons({ "5": { id: 5, t: 15, l: 1, X: 0, Y: 0 } }, { C1: 10 })).toEqual({});
  });

  it("is what an Inferno yard defends with", () => {
    const forces = defenderForcesOf({
      buildingdata: twoBunkers,
      academy: { IC5: { level: 4 } },
      champion: [],
      monsters: { IC5: 5, IC7: 3 },
      buildinghealthdata: {},
    });
    expect(forces.bunkers).toEqual({ 262: { IC5: 3, IC7: 1 }, 1059: { IC5: 2, IC7: 2 } });
    expect(forces.defenderLevels).toEqual({ IC5: 4 });
  });
});
