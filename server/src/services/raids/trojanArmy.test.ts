import { describe, expect, test } from "bun:test";
import { buildEngineYard, createBattle } from "../../game-rules/combat/index.js";
import {
  TROJAN_LAST_SPAWN_TICK,
  TROJAN_MONSTER_COUNT,
  trojanArmy,
  trojanDoorPoint,
  trojanSchedule,
  trojanStrength,
  trojanTickOf,
} from "./trojanArmy.js";

/**
 * The Trojan Horse's army (#306 WP2, `docs/design/trojan-horse.md` §4): the
 * pure builder's schedule and strength, and the engine's end rule for a raid
 * whose waves spread out rather than all landing at once.
 */

const ORDER = [
  ...Array<string>(6).fill("C1"),
  ...Array<string>(5).fill("C2"),
  ...Array<string>(5).fill("C3"),
  ...Array<string>(5).fill("C4"),
  ...Array<string>(5).fill("C6"),
  ...Array<string>(5).fill("C7"),
  ...Array<string>(5).fill("C8"),
  ...Array<string>(5).fill("C9"),
  ...Array<string>(5).fill("C10"),
  ...Array<string>(5).fill("C11"),
];

describe("trojanSchedule", () => {
  test("is exactly 51 monsters: 6 Pokey, then 5 each of nine types, weakest first", () => {
    const schedule = trojanSchedule();
    expect(schedule).toHaveLength(TROJAN_MONSTER_COUNT);
    expect(schedule.map((spawn) => spawn.monster)).toEqual(ORDER);
  });

  test("skips no Eye-ra (C5) and no D.A.V.E. (C12)", () => {
    const monsters = new Set(trojanSchedule().map((spawn) => spawn.monster));
    expect(monsters.has("C5")).toBe(false);
    expect(monsters.has("C12")).toBe(false);
  });

  test("ticks one every 20 frames at 24 fps, frame 1 first", () => {
    expect(trojanTickOf(1)).toBe(3);
    expect(trojanTickOf(20)).toBe(67);
    expect(trojanSchedule()[0]).toEqual({ tick: 3, monster: "C1" });
    expect(trojanSchedule()[1]).toEqual({ tick: 67, monster: "C1" });
  });

  test("lands its last spawn (frame 1100) about 45.8 s in", () => {
    const schedule = trojanSchedule();
    expect(schedule[schedule.length - 1]).toEqual({ tick: TROJAN_LAST_SPAWN_TICK, monster: "C11" });
    expect(TROJAN_LAST_SPAWN_TICK / 80).toBeCloseTo(45.8, 1);
  });
});

describe("trojanStrength", () => {
  test("is x0.4 at and below 3,000,000 empire points", () => {
    expect(trojanStrength(0)).toBe(0.4);
    expect(trojanStrength(3_000_000)).toBe(0.4);
  });

  test("steps to x0.6 past 3,000,000", () => {
    expect(trojanStrength(3_000_001)).toBe(0.6);
    expect(trojanStrength(5_000_000)).toBe(0.6);
  });

  test("steps to x0.8 past 5,000,000", () => {
    expect(trojanStrength(5_000_001)).toBe(0.8);
    expect(trojanStrength(8_000_000)).toBe(0.8);
  });

  test("steps to x1.0 past 8,000,000", () => {
    expect(trojanStrength(8_000_001)).toBe(1);
  });
});

describe("trojanArmy", () => {
  test("is 51 one-monster raid events, r: 0, at the door point and the score's strength", () => {
    const events = trojanArmy({ horseX: 100, horseY: -40, empirePoints: 4_000_000 });
    const door = trojanDoorPoint(100, -40);
    expect(events).toHaveLength(TROJAN_MONSTER_COUNT);
    for (const event of events) {
      expect(event.kind).toBe("raid");
      expect(event.r).toBe(0);
      expect(event.x).toBe(door.x);
      expect(event.y).toBe(door.y);
      expect(event.strength).toBe(0.6);
      expect(Object.values(event.monsters).reduce((sum, count) => sum + count, 0)).toBe(1);
    }
  });

  test("is the schedule's ticks and monsters, in order", () => {
    const events = trojanArmy({ horseX: 0, horseY: 0, empirePoints: 0 });
    const schedule = trojanSchedule();
    expect(events.map((event) => event.t)).toEqual(schedule.map((spawn) => spawn.tick));
    expect(events.map((event) => Object.keys(event.monsters)[0])).toEqual(ORDER);
  });

  test("is pure: the same input always gives the same events", () => {
    const input = { horseX: 240, horseY: -360, empirePoints: 9_000_000 };
    expect(trojanArmy(input)).toEqual(trojanArmy(input));
  });
});

describe(
  "the fight (issue #325 done-when: a defence that kills every monster " +
    "between spawns does not end the fight early)",
  () => {
    test("stays open through the gaps until every one of the 51 waves has landed", () => {
      // The real schedule and door point from the army builder, but with a
      // strength small enough to truncate every spawn's health to 0 (Flash's
      // own `int()` rule) — standing in for "a defence that kills every
      // monster", so each spawn is already dead by the very next tick, which
      // a real fight's timing is not guaranteed to be.
      const events = trojanArmy({ horseX: 0, horseY: 0, empirePoints: 0 }).map((event) => ({
        ...event,
        strength: 1e-6,
      }));
      const yard = buildEngineYard({
        buildingdata: { "1": { id: 1, t: 22, l: 1, X: 0, Y: 0 } },
        buildinghealthdata: {},
        resources: { r1: 0, r2: 0, r3: 0, r4: 0 },
      });
      const battle = createBattle(yard, {
        seed: 1,
        raid: true,
        raidSpawnsUntil: TROJAN_LAST_SPAWN_TICK,
      });
      for (const event of events) {
        battle.runTo(event.t);
        battle.apply(event);
        expect(battle.over()).toBe(false);
      }
      expect(battle.state().creepsFlung).toBe(TROJAN_MONSTER_COUNT);
      battle.runTo(TROJAN_LAST_SPAWN_TICK + 1);
      expect(battle.over()).toBe(true);
    });
  },
);
