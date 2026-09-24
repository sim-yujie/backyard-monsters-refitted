import { describe, expect, it } from "vitest";
import {
  ATTACK_DELAY_DEFAULT,
  ATTACK_MAX_SECONDS,
  BOMBS,
  capacity,
  championAttackDelay,
  championByType,
  championIds,
  championStat,
  flyerMode,
  fortifiedDamage,
  gridCost,
  hitsFlyers,
  hitsGround,
  isLootable,
  isTower,
  lowLevelLootBonus,
  maxBombDamage,
  maxBombSpend,
  maxHp,
  monsterAttackDelay,
  monsterIds,
  monsterRange,
  monsterStat,
  monsterTickSpeed,
  MR2_FLINGER_LEVEL,
  specialistMultiplier,
  TICKS_PER_SECOND,
  ticks,
  towerRearmTicks,
  towerStats,
  trapDamageAt,
  trapStats,
  VICTORY_THRESHOLD,
} from "./stats";

/**
 * The readers over the generated table, and the constants that live in code.
 *
 * The table's own integrity is `combatStatsData.test.ts`'s job. What is tested
 * here is the reading: the clamp a level past the end of a ladder takes, the
 * defaults the client substitutes for an absent field, and the handful of
 * formulas transcribed out of the client's classes. Each case names the figure
 * the source gives, so a transcription that drifts fails rather than rounds.
 */

describe("the clock", () => {
  it("counts in fast ticks at 80 a second (`GLOBAL.as:1234`)", () => {
    expect(TICKS_PER_SECOND).toBe(80);
    expect(ticks(1)).toBe(80);
    // A 300 s attack is 24,000 ticks and the retreat lands at 33,600
    // (`docs/design/server-combat.md` §3.4).
    expect(ticks(300)).toBe(24_000);
    expect(ticks(ATTACK_MAX_SECONDS)).toBe(43_200);
  });

  it("caps an honest attack at Declare War plus the retreat grace", () => {
    expect(ATTACK_MAX_SECONDS).toBe(540);
    expect(VICTORY_THRESHOLD).toBe(90);
  });
});

describe("monsterStat", () => {
  it("reads a Pokey's damage at level 6 and clamps level 9 to it", () => {
    // `monsterStats.C1.props.damage` is [60, 65, 70, 75, 80, 85].
    expect(monsterStat("C1", "damage", 6)).toBe(85);
    expect(monsterStat("C1", "damage", 9)).toBe(85);
    expect(monsterStat("C1", "damage", 1)).toBe(60);
  });

  it("reads a one-entry ladder at every level (`CREATURES.as:75-77`)", () => {
    // A Pokey's speed ladder is a single 1.2, which every level shares.
    expect(monsterStat("C1", "speed", 1)).toBe(1.2);
    expect(monsterStat("C1", "speed", 6)).toBe(1.2);
  });

  it("reads 0 for a stat the monster does not carry (`CREATURES.as:49-51`)", () => {
    expect(monsterStat("C1", "attackDelay", 1)).toBe(0);
    expect(monsterStat("C1", "range", 1)).toBe(0);
  });

  it("reads 0 for a monster the table does not hold", () => {
    expect(monsterStat("C999", "damage", 1)).toBe(0);
    expect(monsterIds()).toHaveLength(27);
  });
});

describe("monster defaults", () => {
  it("defaults an absent attackDelay to 60 (`CreepBase.as:108-111`)", () => {
    expect(ATTACK_DELAY_DEFAULT).toBe(60);
    expect(monsterAttackDelay("C1", 1)).toBe(60);
    // C14's ladder says 90, so the default does not reach it.
    expect(monsterAttackDelay("C14", 1)).toBe(90);
  });

  it("defaults an absent range to melee (`CreepBase.as:112-114`)", () => {
    expect(monsterRange("C1", 1)).toBe(1);
    expect(monsterRange("C14", 1)).toBe(150);
  });

  it("halves a monster's speed twice (`CreepBase.as:84`, `:1456`)", () => {
    // A Pokey's `speed: 1.2` is 0.3 yard units per fast tick, which is 24 a
    // second: a 900-unit walk takes about 37 s.
    expect(monsterTickSpeed("C1", 1)).toBeCloseTo(0.3, 10);
  });
});

describe("specialistMultiplier", () => {
  it("doubles a wall breaker against a wall and a tower killer against a tower", () => {
    // `CreepBase.as:884-894`.
    expect(specialistMultiplier(2, "wall")).toBe(2);
    expect(specialistMultiplier(4, "tower")).toBe(2);
  });

  it("leaves every other pairing alone", () => {
    expect(specialistMultiplier(2, "tower")).toBe(1);
    expect(specialistMultiplier(4, "wall")).toBe(1);
    expect(specialistMultiplier(1, "wall")).toBe(1);
    expect(specialistMultiplier(3, "resource")).toBe(1);
  });
});

describe("champions", () => {
  it("holds five, keyed by id and reachable by the `t` a save carries", () => {
    expect(championIds()).toEqual(["G1", "G2", "G3", "G4", "G5"]);
    expect(championByType(1)).toBe("G1");
    expect(championByType(5)).toBe("G5");
    expect(championByType(9)).toBeUndefined();
  });

  it("reads a champion ladder with the same clamp", () => {
    // `championStats.G1.props.damage` is [1000, 1200, 1500, 2000, 2500, 3000].
    expect(championStat("G1", "damage", 1)).toBe(1000);
    expect(championStat("G1", "damage", 6)).toBe(3000);
    expect(championStat("G1", "damage", 9)).toBe(3000);
  });

  it("swings every 56 ticks unless the class overrides it", () => {
    // `ChampionBase.as:164`, `Fomor.as:12`, `Korath.as:25-46`. The ids are the
    // stat table's, where G3 is Fomor, G4 is Korath and G5 is Krallen
    // (`server/src/game-data/stats/championStats.ts:98-158`) — the override
    // table named the wrong two when it landed, which made the damage bound of
    // `docs/design/server-combat.md` §2.3 seven times too tight for a Fomor.
    expect(championAttackDelay("G1", 1)).toBe(56);
    expect(championAttackDelay("G2", 1)).toBe(56);
    expect(championAttackDelay("G3", 1)).toBe(8);
    expect(championAttackDelay("G3", 6)).toBe(8);
    expect(championAttackDelay("G4", 1)).toBe(72);
    expect(championAttackDelay("G4", 2)).toBe(72);
    expect(championAttackDelay("G4", 3)).toBe(80);
    expect(championAttackDelay("G4", 9)).toBe(80);
    expect(championAttackDelay("G5", 1)).toBe(56);
  });

  it("names the champions the stat table names", () => {
    // The delay overrides and the AoE table of `potential.ts` are both keyed by
    // id, so a shifted id is a silent wrong answer rather than a failure.
    expect(championByType(3)).toBe("G3");
    expect(championByType(4)).toBe("G4");
    expect(championByType(5)).toBe("G5");
  });
});

describe("buildings", () => {
  it("reads a Wooden Block's top level (`YARD_PROPS.as:1828`)", () => {
    expect(maxHp(17, 5)).toBe(27_000);
    expect(maxHp(17, 1)).toBe(1000);
    // Past the end of the ladder clamps, as a level past a monster's does.
    expect(maxHp(17, 9)).toBe(27_000);
    expect(maxHp(999, 1)).toBe(0);
  });

  it("reads a tower's level and clamps past the end", () => {
    expect(towerStats(20, 1)?.damage).toBe(20);
    expect(towerStats(20, 10)?.damage).toBe(200);
    expect(towerStats(20, 99)?.damage).toBe(200);
    expect(towerStats(17, 1)).toBeUndefined();
    expect(isTower(20)).toBe(true);
    expect(isTower(17)).toBe(false);
  });

  it("re-arms a tower in `rate * 2` fast ticks (`BTOWER.as:179`)", () => {
    // The Cannon Tower's `rate: 40` is one shot a second.
    expect(towerRearmTicks(20, 1)).toBe(80);
    expect(towerRearmTicks(20, 1)).toBe(TICKS_PER_SECOND);
    // The Monster Bunker has a range and no rate, so it never fires.
    expect(towerRearmTicks(22, 1)).toBe(0);
  });

  it("reads the flyer table (`BTOWER.as:25-35`)", () => {
    expect(flyerMode(115)).toBe(2);
    expect(flyerMode(130)).toBe(0);
    expect(flyerMode(21)).toBe(1);
    // A type with no entry is ground only, which is the client's truthiness test.
    expect(flyerMode(20)).toBe(0);
    expect(flyerMode(999)).toBe(0);

    expect(hitsFlyers(115)).toBe(true);
    expect(hitsGround(115)).toBe(false);
    expect(hitsFlyers(21)).toBe(true);
    expect(hitsGround(21)).toBe(true);
    expect(hitsFlyers(20)).toBe(false);
  });

  it("prices a wall's inner rectangle by its level (`BFOUNDATION.as:3151`)", () => {
    expect(gridCost(17, 1)[1]?.[4]).toBe(125);
    expect(gridCost(17, 3)[1]?.[4]).toBe(175);
    expect(gridCost(17, 5)[1]?.[4]).toBe(225);
    // The outer ring is a constant 20 whatever the level (`BUILDING17.as:14`).
    expect(gridCost(17, 3)[0]?.[4]).toBe(20);
  });

  it("leaves every other type's rectangles alone", () => {
    expect(gridCost(20, 1)).toEqual(gridCost(20, 8));
    expect(gridCost(24)).toEqual([]);
  });

  it("reads the Map Room 2 capacities", () => {
    // A Map Room 2 fling is capped at the level 4 Flinger's payload
    // (`GLOBAL.as:863`, `:713`).
    expect(MR2_FLINGER_LEVEL).toBe(4);
    expect(capacity(5, MR2_FLINGER_LEVEL)).toBe(2250);
    expect(capacity(22, 5)).toBe(800);
    expect(capacity(15, 6)).toBe(540);
    expect(capacity(20, 1)).toBe(0);
  });
});

describe("traps", () => {
  it("falls off linearly over half the blast (`BTRAP.as:106`)", () => {
    expect(trapStats(24)).toEqual({ damage: 1000, size: 50, hp: 10 });
    expect(trapDamageAt(24, 0)).toBe(1000);
    expect(trapDamageAt(24, 25)).toBe(750);
    // The edge of the blast still deals half, not nothing.
    expect(trapDamageAt(24, 50)).toBe(500);
    expect(trapDamageAt(24, 51)).toBe(0);
  });

  it("gives a non-trap nothing", () => {
    expect(trapStats(20)).toBeUndefined();
    expect(trapDamageAt(20, 0)).toBe(0);
  });
});

describe("fortifiedDamage", () => {
  it("takes 10 + level * 10 percent off (`BFOUNDATION.as:508-512`)", () => {
    expect(fortifiedDamage(1000, 0)).toBe(1000);
    expect(fortifiedDamage(1000, 1)).toBe(800);
    expect(fortifiedDamage(1000, 4)).toBe(500);
  });

  it("applies armour on top, and reads a negative swing as its size", () => {
    expect(fortifiedDamage(1000, 0, 0.25)).toBe(750);
    expect(fortifiedDamage(-1000, 1)).toBe(800);
  });
});

describe("loot", () => {
  it("gives a level 1 attacker the +57% the client does (`ATTACK.as:678-680`)", () => {
    expect(lowLevelLootBonus(1)).toBeCloseTo(1.57, 10);
    expect(lowLevelLootBonus(19)).toBeCloseTo(1.03, 10);
    expect(lowLevelLootBonus(20)).toBe(1);
    expect(lowLevelLootBonus(45)).toBe(1);
  });

  it("names the harvesters and the three storage types", () => {
    for (const type of [1, 2, 3, 4, 6, 14, 112]) expect(isLootable(type)).toBe(true);
    for (const type of [17, 20, 24]) expect(isLootable(type)).toBe(false);
  });
});

describe("bombs", () => {
  it("transcribes all eleven tiers (`ResourceBombs.as:48-226`)", () => {
    expect(BOMBS).toHaveLength(11);
    expect(BOMBS.filter((one) => one.resource === 1)).toHaveLength(3);
    expect(BOMBS.filter((one) => one.resource === 2)).toHaveLength(4);
    expect(BOMBS.filter((one) => one.resource === 3)).toHaveLength(4);
    // There is no goo bomb.
    expect(BOMBS.some((one) => one.resource === 4)).toBe(false);
  });

  it("adds 125,000 at catapult 2 and nothing at 0", () => {
    // 50,000 of twigs plus 75,000 of pebbles; putty deals no damage at all.
    expect(maxBombDamage(0)).toBe(0);
    expect(maxBombDamage(1)).toBe(50_000);
    expect(maxBombDamage(2)).toBe(125_000);
    expect(maxBombDamage(3)).toBe(125_000);
  });

  it("caps a resource's spend at its largest unlocked tier", () => {
    expect(maxBombSpend(1, 0)).toBe(0);
    expect(maxBombSpend(1, 1)).toBe(5_000_000);
    expect(maxBombSpend(2, 1)).toBe(0);
    expect(maxBombSpend(2, 2)).toBe(10_000_000);
    expect(maxBombSpend(3, 3)).toBe(10_000_000);
    // Goo has no bomb at any catapult level.
    expect(maxBombSpend(4, 3)).toBe(0);
  });
});
