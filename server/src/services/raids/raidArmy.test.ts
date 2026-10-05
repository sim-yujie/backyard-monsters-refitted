import { describe, expect, test } from "bun:test";
import { Tribe } from "../../enums/Tribes.js";
import {
  raidArmy,
  raidArmySize,
  raidDamageDealer,
  raidTank,
  raidTier,
  raidWalk,
  type RaidArmyFacts,
} from "./raidArmy.js";

/**
 * Hand-worked against Flash's `ProcessC`s (`PROCESS3.as`, `PROCESS4.as`,
 * `PROCESS5.as`, `PROCESS7.as`). Where a float sum lands just under a whole
 * number, the expected figure is Flash's (a `Number` is the same double), and
 * the test says so.
 */

/** 10 harvesters, 10 towers and 10 silos (weight "building"), then 60 walls and 40 traps. */
const YARD: readonly number[] = [
  ...Array<number>(10).fill(1),
  ...Array<number>(10).fill(20),
  ...Array<number>(10).fill(6),
  ...Array<number>(60).fill(17),
  ...Array<number>(40).fill(24),
];

const facts = (overrides: Partial<RaidArmyFacts> = {}): RaidArmyFacts => ({
  types: YARD,
  level: 9,
  amplifier: 1,
  damageTaken: 0,
  resourcesGained: 0,
  walk: 200,
  ...overrides,
});

describe("raidArmySize", () => {
  test("counts harvesters, towers, special buildings, traps and walls by the tribe's weights", () => {
    expect(raidArmySize(Tribe.LEGIONNAIRE, YARD, 1)).toBe(43); // 30 + 100 x 0.13
    expect(raidArmySize(Tribe.KOZU, YARD, 1)).toBe(62); // 30 x 1.4 + 100 x 0.2
    // 30 + 100 x 0.15 and 30 x 0.3 + 100 x 0.01 are 45 and 10 on paper;
    // summed one by one as Flash adds them, the doubles land just under and
    // truncate.
    expect(raidArmySize(Tribe.DREADNAUT, YARD, 1)).toBe(44);
    expect(raidArmySize(Tribe.ABUNAKKI, YARD, 1)).toBe(9);
  });

  test("decorations, bunker cages, mushrooms and the like do not count", () => {
    expect(raidArmySize(Tribe.LEGIONNAIRE, [7, 28, 114, 52, 53, 27], 1)).toBe(0);
  });

  test("the amplifier: 1.3 more often, 1 the same, 0.5 less often", () => {
    expect(raidArmySize(Tribe.LEGIONNAIRE, YARD, 1.3)).toBe(55); // 39 + 16.9
    expect(raidArmySize(Tribe.LEGIONNAIRE, YARD, 1)).toBe(43);
    expect(raidArmySize(Tribe.LEGIONNAIRE, YARD, 0.5)).toBe(21); // 15 + 6.5
  });
});

describe("tiers", () => {
  test("tanks switch at levels 14, 27 and 40", () => {
    const at = (level: number) => raidTank(raidTier(level));
    expect([0, 13, 14, 26, 27, 39, 40, 70].map(at)).toEqual(["C2", "C2", "C6", "C6", "C10", "C10", "C12", "C12"]);
  });

  test("damage dealers switch every 8 levels, C11 from 32", () => {
    const at = (level: number) => raidDamageDealer(raidTier(level));
    expect([7, 8, 15, 16, 24, 32, 40].map(at)).toEqual(["C1", "C4", "C4", "C7", "C8", "C11", "C11"]);
  });
});

describe("raidWalk", () => {
  test("a quarter of the map width, more when the target is within 100 of the way in", () => {
    expect(raidWalk(500)).toBe(200);
    expect(raidWalk(40)).toBe(260);
  });
});

describe("Legionnaire", () => {
  test("the design's worked example: N = 43 gives 14 C2 tanks and 7 C4 at level 9", () => {
    const army = raidArmy(Tribe.LEGIONNAIRE, facts());
    expect(army.monsters).toEqual({ C2: 14, C4: 7 });
    // Tanks start 200 out; damage dealers the same walking time out plus 25.
    expect(army.distances.C2).toBeCloseTo(200, 9);
    expect(army.distances.C4).toBeCloseTo(25 + (200 / 1.4) * 1.3, 9);
  });

  test("C12 tanks are halved, rounded up", () => {
    expect(raidArmy(Tribe.LEGIONNAIRE, facts({ level: 40 })).monsters).toEqual({ C12: 8, C11: 7 });
  });

  test("tower fire changes nothing", () => {
    expect(raidArmy(Tribe.LEGIONNAIRE, facts({ damageTaken: 5000 }))).toEqual(raidArmy(Tribe.LEGIONNAIRE, facts()));
  });
});

describe("Kozu", () => {
  test("int(0.33 N) of each of three neighbouring fodder slots", () => {
    // N = 62, int(20.46) = 20 each. Level 9: slots 0, 1, 2, all C1.
    expect(raidArmy(Tribe.KOZU, facts()).monsters).toEqual({ C1: 60 });
    // Level 20: int(2.5) = 2, slots 1, 2, 3.
    expect(raidArmy(Tribe.KOZU, facts({ level: 20 })).monsters).toEqual({ C1: 40, C3: 20 });
    // Level 40: slot 5, held at the end: 4, 5, 5.
    expect(raidArmy(Tribe.KOZU, facts({ level: 40 })).monsters).toEqual({ C8: 20, C9: 40 });
  });

  test("every type walks as long as the low slot's", () => {
    const army = raidArmy(Tribe.KOZU, facts({ level: 20 }));
    expect(army.distances.C1).toBeCloseTo(200, 9);
    expect(army.distances.C3).toBeCloseTo((200 / 1.2) * 2.5, 9);
  });
});

describe("Abunakki", () => {
  test("no fire on the way in: all kamikaze, those over 5 become looters", () => {
    expect(raidArmy(Tribe.ABUNAKKI, facts()).monsters).toEqual({ C3: 4, C5: 5 });
  });

  test("fire on the way in: looters, tanks and kamikaze, the kamikaze capped at 5", () => {
    // N = 9: looters ceil(1.8) = 2, tanks ceil(7.2 / 1.3) = 6, kamikaze
    // ceil(5.54 / 0.3) = 19, so 14 more looters.
    const army = raidArmy(Tribe.ABUNAKKI, facts({ damageTaken: 1 }));
    expect(army.monsters).toEqual({ C3: 16, C2: 6, C5: 5 });
    expect(army.distances.C2).toBeCloseTo(200, 9);
    expect(army.distances.C5).toBeCloseTo(40 + (200 / 1.4) * 2, 9);
    expect(army.distances.C3).toBeCloseTo(80 + (200 / 1.4) * 2.5, 9);
  });

  test("level 40: C9 looters and halved C12 tanks", () => {
    expect(raidArmy(Tribe.ABUNAKKI, facts({ level: 40, damageTaken: 1 })).monsters).toEqual({ C9: 16, C12: 3, C5: 5 });
  });

  test("an empty yard still sends one kamikaze", () => {
    expect(raidArmy(Tribe.ABUNAKKI, facts({ types: [] })).monsters).toEqual({ C5: 1 });
  });
});

describe("Dreadnaut", () => {
  test("no fire on the way in: all looters", () => {
    expect(raidArmy(Tribe.DREADNAUT, facts()).monsters).toEqual({ C9: 44 });
  });

  test("fire on the way in: at least half looters, the rest tanks", () => {
    // N = 44. Loot 0: the share is held at 0.5.
    expect(raidArmy(Tribe.DREADNAUT, facts({ damageTaken: 9000 })).monsters).toEqual({ C9: 22, C2: 22 });
    // Loot 1,000 against fire 9,000 is a tenth: still a half.
    expect(raidArmy(Tribe.DREADNAUT, facts({ damageTaken: 9000, resourcesGained: 1000 })).monsters).toEqual({
      C9: 22,
      C2: 22,
    });
    // Loot 4,000 against fire 1,000: 0.8 looters, 35.2 and 8.8, truncated.
    expect(raidArmy(Tribe.DREADNAUT, facts({ damageTaken: 1000, resourcesGained: 4000 })).monsters).toEqual({
      C9: 35,
      C2: 8,
    });
  });

  test("level 40: C14 looters divided by 2.5 and C12 tanks halved, both rounded up", () => {
    expect(raidArmy(Tribe.DREADNAUT, facts({ level: 40 })).monsters).toEqual({ C14: 18 });
    expect(raidArmy(Tribe.DREADNAUT, facts({ level: 40, damageTaken: 1000, resourcesGained: 4000 })).monsters).toEqual({
      C14: 15,
      C12: 5,
    });
  });

  test("looters keep no lead: they start the tanks' walking time out", () => {
    const army = raidArmy(Tribe.DREADNAUT, facts({ damageTaken: 9000 }));
    expect(army.distances.C2).toBeCloseTo(200, 9);
    expect(army.distances.C9).toBeCloseTo((200 / 1.4) * 2, 9);
  });
});
