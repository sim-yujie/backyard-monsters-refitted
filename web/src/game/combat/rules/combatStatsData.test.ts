import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  BUILDING_HP,
  CHAMPION_PROPS,
  FLYER_MODE,
  GRID_COST,
  GRID_COST_FORMULA,
  MONSTER_PROPS,
  MR2_CAPACITY,
  TOWER_STATS,
  TRAP_STATS,
} from "./combatStatsData";
import { monsterStats } from "../../../../../server/src/game-data/stats/monsterStats";
import { championStats } from "../../../../../server/src/game-data/stats/championStats";

/**
 * The generated combat stats table, checked against what the sources hold.
 *
 * The table is machine-written, so these are not tests of arithmetic: they are
 * a tripwire on `web/tools/gen-combat-stats.mjs`. A regex that stops matching
 * after an edit to `YARD_PROPS.as` would quietly emit an empty stats block, and
 * the server would then bound a battle against a tower that deals no damage and
 * refuse honest play.
 *
 * The two cross-checks against `server/src/game-data/stats/` are the drift
 * tripwire in the other direction: those tables are already authoritative — the
 * attack gate bans a client whose declared stats differ from them
 * (`server/src/services/maproom/validateAttack.ts:25-91`) — so the shared
 * module copies rather than re-derives, and a copy that stops matching is a
 * regeneration that did not happen. The import reaches outside `web/` and is
 * the reason it lives in the test rather than in the module, which may import
 * nothing outside itself (`docs/design/server-combat.md` §3.2).
 */

/**
 * The sandbox yard capture the planner's tests run against: a real 575 building
 * save, so every type in it is a type a live account can send us.
 */
const FIXTURE = "../../../../test/fixtures/baseload-sandbox-yard.json";

const fixtureTypes = (): number[] => {
  const raw = JSON.parse(readFileSync(new URL(FIXTURE, import.meta.url), "utf8"));
  const buildings = Object.values(raw.buildingdata as Record<string, { t: number }>);
  return [...new Set(buildings.map((building) => building.t))].sort((a, b) => a - b);
};

describe("TOWER_STATS", () => {
  it("holds the Cannon Tower's ten levels as YARD_PROPS.as:1979-2183 spells them", () => {
    const cannon = TOWER_STATS[20];
    expect(cannon).toBeDefined();
    expect(cannon).toHaveLength(10);
    expect(cannon?.map((one) => one.range)).toEqual([
      160, 170, 180, 190, 200, 210, 220, 230, 240, 250,
    ]);
    expect(cannon?.map((one) => one.damage)).toEqual([
      20, 40, 60, 80, 100, 120, 140, 160, 180, 200,
    ]);
    expect(cannon?.map((one) => one.rate)).toEqual([40, 40, 40, 40, 40, 40, 40, 40, 40, 40]);
    expect(cannon?.map((one) => one.splash)).toEqual([30, 35, 40, 45, 50, 55, 60, 65, 70, 75]);
  });

  it("keeps the thirteen blocks the props file carries, whatever keys each has", () => {
    expect(Object.keys(TOWER_STATS).map(Number).sort((a, b) => a - b)).toEqual([
      20, 21, 22, 23, 25, 115, 118, 129, 132, 134, 136, 137, 138,
    ]);
    // The Monster Bunker carries a range and nothing else (`:2423`).
    expect(TOWER_STATS[22]?.map((one) => one.range)).toEqual([300, 350, 400, 450, 500]);
    expect(TOWER_STATS[22]?.[0]?.damage).toBeUndefined();
    // The Spurtz Cannons are the only ones with `shots` (`:7566`, `:7678`).
    expect(TOWER_STATS[136]?.[0]?.shots).toBeGreaterThan(0);
  });

  it("gives every flyer-mode tower a stats block except 130, which has none", () => {
    const missing = Object.keys(FLYER_MODE)
      .map(Number)
      .filter((type) => TOWER_STATS[type] === undefined);
    expect(missing).toEqual([130]);
  });
});

describe("BUILDING_HP", () => {
  it("ends the Cannon Tower's ladder at 98,200 (`YARD_PROPS.as:2184`)", () => {
    const ladder = BUILDING_HP[20];
    expect(ladder).toHaveLength(10);
    expect(ladder?.at(-1)).toBe(98_200);
  });

  it("holds the Wooden Block's five levels (`:1828`)", () => {
    expect(BUILDING_HP[17]).toEqual([1000, 2300, 5750, 18_000, 27_000]);
  });

  it("holds the Stone Block's single level (`:1872`)", () => {
    expect(BUILDING_HP[18]).toEqual([3600]);
  });

  it("gives every type in the sandbox yard a row", () => {
    const missing = fixtureTypes().filter((type) => BUILDING_HP[type] === undefined);
    expect(missing).toEqual([]);
  });

  it("leaves out only the three entries the props file gives no hp", () => {
    // 112 is the outpost core, 128 and 130 are Inferno buildings whose ladders
    // live in their own props files. None of them is a Map Room 2 main-yard
    // type, so none reaches the audit of `docs/design/server-combat.md` §2.2.
    expect(Object.keys(BUILDING_HP)).toHaveLength(137);
    for (const type of [112, 128, 130]) expect(BUILDING_HP[type]).toBeUndefined();
  });
});

describe("TRAP_STATS", () => {
  it("gives the Booby Trap 1000 damage over a 50-unit blast with 10 hp", () => {
    expect(TRAP_STATS[24]).toEqual({ damage: 1000, size: 50, hp: 10 });
  });

  it("gives the Heavy Trap 10,000 over 90 units (`:6283`)", () => {
    expect(TRAP_STATS[117]).toEqual({ damage: 10_000, size: 90, hp: 10 });
  });

  it("holds the two traps and nothing else", () => {
    expect(Object.keys(TRAP_STATS).map(Number).sort((a, b) => a - b)).toEqual([24, 117]);
  });
});

describe("MR2_CAPACITY", () => {
  it("holds the three ladders GLOBAL.as replaces outside Map Room 3", () => {
    expect(MR2_CAPACITY[5]).toEqual([500, 1000, 1750, 2250, 3000, 4000]); // GLOBAL.as:713
    expect(MR2_CAPACITY[15]).toEqual([200, 260, 320, 380, 450, 540]); //     GLOBAL.as:682
    expect(MR2_CAPACITY[22]).toEqual([380, 450, 540, 660, 800]); //          GLOBAL.as:683
  });
});

describe("FLYER_MODE", () => {
  it("transcribes BTOWER._targetFlyerMode (`BTOWER.as:25-35`)", () => {
    expect(FLYER_MODE).toEqual({
      20: 0,
      21: 1,
      23: 0,
      25: 1,
      115: 2,
      118: 0,
      129: 0,
      130: 0,
      132: 1,
    });
  });
});

describe("GRID_COST", () => {
  it("stamps a wall as a 40-unit ring at 20 around a 20-unit core", () => {
    // `BUILDING17.as:14`; the 200 on the inner rectangle is overwritten per
    // level by `GRID_COST_FORMULA`.
    expect(GRID_COST[17]).toEqual([
      [-10, -10, 40, 40, 20],
      [0, 0, 20, 20, 200],
    ]);
    expect(GRID_COST_FORMULA[17]).toEqual({ rect: 1, base: 100, perLevel: 25 });
  });

  it("stamps a Cannon Tower as 70 units at 10 around 50 at 200", () => {
    // `BUILDING20.as:19`.
    expect(GRID_COST[20]).toEqual([
      [0, 0, 70, 70, 10],
      [10, 10, 50, 50, 200],
    ]);
  });

  it("resolves a class that inherits its rectangles", () => {
    // `BUILDING13` and `BUILDING16` both extend `HatcheryBase`
    // (`HatcheryBase.as:17`), so the generator follows `extends` to find them.
    expect(GRID_COST[13]).toEqual(GRID_COST[16]);
    expect(GRID_COST[13]).toEqual([
      [0, 0, 100, 100, 10],
      [10, 10, 80, 80, 200],
    ]);
  });

  it("takes the main-yard branch of the Town Hall's ternary", () => {
    // `BUILDING14.as:19` picks 160 units on an Inferno yard and 130 elsewhere;
    // this project runs Map Room 2.
    expect(GRID_COST[14]).toEqual([
      [0, 0, 130, 130, 10],
      [10, 10, 110, 110, 200],
    ]);
  });

  it("sizes a decoration's rectangle from its own size prop", () => {
    // `BDECORATION.as:22-26` reads `_buildingProps[type - 1].size`.
    const flag = GRID_COST[28];
    expect(flag).toHaveLength(1);
    expect(flag?.[0]?.[4]).toBe(2);
    expect(flag?.[0]?.[2]).toBe(flag?.[0]?.[3]);
  });

  it("gives a trap no rectangles, because BTRAP declares none", () => {
    expect(GRID_COST[24]).toBeUndefined();
    expect(GRID_COST[117]).toBeUndefined();
  });
});

describe("MONSTER_PROPS", () => {
  it("holds every Map Room 2 monster and no Map Room 3 one", () => {
    expect(Object.keys(MONSTER_PROPS)).toEqual(Object.keys(monsterStats));
    expect(Object.keys(MONSTER_PROPS)).toHaveLength(27);
  });

  it("equals monsterStats key for key on every ladder it carries", () => {
    for (const [id, stat] of Object.entries(MONSTER_PROPS)) {
      const source = monsterStats[id];
      expect(source, `monsterStats has no ${id}`).toBeDefined();
      for (const [key, values] of Object.entries(stat.props)) {
        expect(values, `${id}.${key}`).toEqual(
          source?.props[key as keyof typeof source.props],
        );
      }
      expect(stat.movement, `${id}.movement`).toEqual(source?.movement);
      expect(stat.pathing, `${id}.pathing`).toEqual(source?.pathing);
    }
  });

  it("leaves the training and hatching ladders out", () => {
    for (const stat of Object.values(MONSTER_PROPS)) {
      for (const key of ["cTime", "cResource", "hTime", "hResource"]) {
        expect(stat.props).not.toHaveProperty(key);
      }
    }
  });
});

describe("CHAMPION_PROPS", () => {
  it("holds all five champions with the `t` an attack save carries", () => {
    expect(Object.keys(CHAMPION_PROPS)).toEqual(Object.keys(championStats));
    expect(Object.values(CHAMPION_PROPS).map((one) => one.t)).toEqual([1, 2, 3, 4, 5]);
    expect(CHAMPION_PROPS.G1?.name).toBe("Gorgo");
  });

  it("equals championStats key for key on every ladder it carries", () => {
    for (const [id, stat] of Object.entries(CHAMPION_PROPS)) {
      const source = championStats[id];
      expect(source, `championStats has no ${id}`).toBeDefined();
      expect(stat.t).toBe(source?.t);
      expect(stat.name).toBe(source?.name);
      for (const [key, values] of Object.entries(stat.props)) {
        expect(values, `${id}.${key}`).toEqual(
          source?.props[key as keyof typeof source.props],
        );
      }
    }
  });

  it("gives every champion three power-level bonus tiers", () => {
    for (const [id, stat] of Object.entries(CHAMPION_PROPS)) {
      for (const key of ["bonusSpeed", "bonusHealth", "bonusDamage"] as const) {
        expect(stat.props[key], `${id}.${key}`).toHaveLength(3);
      }
    }
  });
});
