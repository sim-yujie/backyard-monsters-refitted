import { describe, expect, it } from "vitest";
import {
  ATTACK_DELAY_DEFAULT,
  ATTACK_MAX_SECONDS,
  BOMBS,
  bombBlast,
  bombParticleDamage,
  bombReaches,
  ellipseEdgeSquared,
  propsSizeOf,
  puttyReach,
  squashedEllipse,
  capacity,
  championAttackDelay,
  championByType,
  championIds,
  championMode,
  championStat,
  championStatWithPower,
  flyerMode,
  fortifiedDamage,
  gridCost,
  hpLadder,
  hitsFlyers,
  hitsGround,
  isLootable,
  isTower,
  lowLevelLootBonus,
  maxBombDamage,
  maxBombSpend,
  maxHp,
  outpostHarvesterStock,
  monsterAttackDelay,
  monsterIds,
  monsterRange,
  monsterStat,
  monsterTickSpeed,
  MR2_FLINGER_LEVEL,
  specialistMultiplier,
  storageFallLoot,
  storageScalar,
  isWildMonsterAttack,
  TICKS_PER_SECOND,
  ticks,
  towerRearmTicks,
  towerRange,
  towerStats,
  trapDamageAt,
  trapStats,
  VICTORY_THRESHOLD,
  withLowLevelBonus,
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

  it("reads a champion's movement at its level, so only Fomor flies, and from 3 (issue #69)", () => {
    // `CHAMPIONCAGE.as:160`: Fomor is ["ground", "ground", "fly"]; every other
    // champion is ["ground"] (`:71`, `:114`, `:205`, `:251`).
    expect(championMode("G3", "movement", 1)).toBe("ground");
    expect(championMode("G3", "movement", 2)).toBe("ground");
    expect(championMode("G3", "movement", 3)).toBe("fly");
    expect(championMode("G3", "movement", 6)).toBe("fly");
    for (const id of ["G1", "G2", "G4", "G5"]) {
      for (let level = 1; level <= 6; level += 1) {
        expect(championMode(id, "movement", level)).toBe("ground");
      }
    }
    expect(championMode("G3", "attack", 4)).toBe("ranged");
    expect(championMode("G9", "movement", 1)).toBeUndefined();
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

  it("truncates each bonused gain on its own, as `param2 += param2 * bonus` on an int does", () => {
    expect(withLowLevelBonus(400, 1)).toBe(628);
    expect(withLowLevelBonus(10, 1)).toBe(15);
    expect(withLowLevelBonus(10.9, 1)).toBe(15);
    expect(withLowLevelBonus(3, 19)).toBe(3);
    expect(withLowLevelBonus(1000, 20)).toBe(1000);
    expect(withLowLevelBonus(1000, 45)).toBe(1000);
  });
});

describe("storageScalar and isWildMonsterAttack (`BSTORAGE.Loot`)", () => {
  // `BSTORAGE.as:77` compares the Map Room 2 cell's `_base` with
  // `EnumYardType.OUTPOST` (1), and a cell's 1 is a wild monster camp.
  it("halves a Map Room 2 camp's draw and takes nine tenths everywhere else", () => {
    expect(storageScalar("wild")).toBe(0.5);
    expect(storageScalar("outpost")).toBe(0.9);
    expect(storageScalar("main")).toBe(0.9);
    expect(storageScalar("tribe")).toBe(0.9);
  });

  it("gives a fifth in a wild monster attack, on either map room", () => {
    expect(isWildMonsterAttack("wild")).toBe(true);
    expect(isWildMonsterAttack("tribe")).toBe(true);
    expect(isWildMonsterAttack("outpost")).toBe(false);
    expect(isWildMonsterAttack("main")).toBe(false);
  });
});

describe("storageFallLoot (`BSTORAGE.Destroyed`, issue #167)", () => {
  it("takes a tenth for the Town Hall, a twentieth for an outpost, a twenty-fifth for a silo", () => {
    expect(storageFallLoot(14, 1, 13_000_000, false)).toBe(1_300_000);
    expect(storageFallLoot(112, 1, 1_000_000, false)).toBe(50_000);
    expect(storageFallLoot(6, 1, 1_000_000, false)).toBe(40_000);
  });

  it("truncates the share", () => {
    expect(storageFallLoot(14, 1, 1_009, false)).toBe(100);
    expect(storageFallLoot(6, 2, 49, false)).toBe(1);
  });

  it("caps each share, lower for a silo or a Town Hall on a Map Room 2 wild monster camp", () => {
    expect(storageFallLoot(14, 1, 500_000_000, false)).toBe(10_000_000);
    expect(storageFallLoot(14, 1, 500_000_000, true)).toBe(2_000_000);
    expect(storageFallLoot(6, 1, 500_000_000, false)).toBe(4_000_000);
    expect(storageFallLoot(6, 1, 500_000_000, true)).toBe(500_000);
    expect(storageFallLoot(112, 1, 500_000_000, true)).toBe(10_000_000);
  });

  it("halves goo, rounding up, after the cap", () => {
    expect(storageFallLoot(14, 4, 2_500_000, false)).toBe(125_000);
    expect(storageFallLoot(14, 4, 1_010, false)).toBe(51);
    expect(storageFallLoot(14, 4, 500_000_000, false)).toBe(5_000_000);
  });

  it("takes nothing from an empty or negative pool", () => {
    expect(storageFallLoot(14, 1, 0, false)).toBe(0);
    expect(storageFallLoot(14, 1, -50, false)).toBe(0);
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

describe("the bomb blast (#75)", () => {
  const byId = (id: string) => BOMBS.find((one) => one.id === id)!;

  it("reads the radius as a full width, squashed by 0.8 (`ResourceBomb.as`)", () => {
    expect(bombBlast(byId("tw0"))).toEqual({ rx: 100, ry: 80 });
    expect(bombBlast(byId("pb1"))).toEqual({ rx: 150, ry: 120 });
    expect(bombBlast(byId("pb2"))).toEqual({ rx: 175, ry: 140 });
    expect(bombBlast(byId("pb3"))).toEqual({ rx: 200, ry: 160 });
  });

  it("truncates the width and the squashed height separately, as the int parameters do", () => {
    // `EllipseEdgeDistanceSqrd(a, int(12.5), int(12.5 * 0.8))`: 12 wide, 10 tall.
    expect(squashedEllipse(12.5)).toEqual({ rx: 6, ry: 5 });
  });

  it("carries the particle counts the damage is split over", () => {
    for (const bomb of BOMBS.filter((one) => one.resource !== 3)) {
      expect(bomb.particles).toBe(200);
    }
    expect(BOMBS.filter((one) => one.resource === 3).map((one) => one.particles)).toEqual([
      25, 37, 43, 50,
    ]);
  });

  it("measures the edge of an ellipse without trigonometry", () => {
    const ellipse = { rx: 100, ry: 80 };
    expect(ellipseEdgeSquared(ellipse, 5, 0)).toBeCloseTo(100 * 100, 9);
    expect(ellipseEdgeSquared(ellipse, 0, -5)).toBeCloseTo(80 * 80, 9);
    // At 45 degrees: x = y, x^2 (1/a^2 + 1/b^2) = 1.
    const x2 = 1 / (1 / 100 ** 2 + 1 / 80 ** 2);
    expect(ellipseEdgeSquared(ellipse, 3, 3)).toBeCloseTo(2 * x2, 6);
    // `atan2(0, 0)` is 0: the horizontal semi-axis.
    expect(ellipseEdgeSquared(ellipse, 0, 0)).toBe(100 * 100);
    expect(ellipseEdgeSquared({ rx: 0, ry: 0 }, 3, 4)).toBe(0);
  });

  it("reaches a sizeless building only inside the blast ellipse", () => {
    const twig = byId("tw0");
    expect(bombReaches(twig, 99, 0, 0)).toBe(true);
    expect(bombReaches(twig, 100, 0, 0)).toBe(false);
    expect(bombReaches(twig, -99, 0, 0)).toBe(true);
    expect(bombReaches(twig, 0, 79, 0)).toBe(true);
    expect(bombReaches(twig, 0, 80, 0)).toBe(false);
    expect(bombReaches(twig, 0, 0, 0)).toBe(true);
  });

  it("reaches a little further for a big building, in quadrature", () => {
    // A 100-size building stands in as an ellipse 50 wide: sqrt(100^2 + 25^2) = 103.08.
    const twig = byId("tw0");
    expect(bombReaches(twig, 103, 0, 100)).toBe(true);
    expect(bombReaches(twig, 104, 0, 100)).toBe(false);
  });

  it("splits the damage over the particles with no falloff", () => {
    const pebble = byId("pb3"); // 75,000 over 200: 375 a particle.
    const plain = { type: 14, level: 1, kind: "special" };
    expect(bombParticleDamage(pebble, plain)).toBe(375);
    expect(bombParticleDamage(byId("tw0"), plain)).toBe(11); // int(2200 / 200)
  });

  it("scales walls, towers, silos and the cage as `ResourceBomb.Damage` does", () => {
    const pebble = byId("pb3");
    expect(bombParticleDamage(pebble, { type: 17, level: 1, kind: "wall" })).toBe(22);
    expect(bombParticleDamage(pebble, { type: 20, level: 1, kind: "tower" })).toBe(337);
    expect(bombParticleDamage(pebble, { type: 6, level: 3, kind: "special" })).toBe(1125);
    expect(bombParticleDamage(pebble, { type: 114, level: 1, kind: "cage" })).toBe(0);
    // A jarred tower takes nothing, except the two bunkers.
    expect(
      bombParticleDamage(pebble, { type: 20, level: 1, kind: "tower", jarred: true }),
    ).toBe(0);
    expect(
      bombParticleDamage(pebble, { type: 22, level: 1, kind: "tower", jarred: true }),
    ).toBe(337);
    // The smallest twig bomb cannot dent a wall: int(11 * 0.06) is 0.
    expect(bombParticleDamage(byId("tw0"), { type: 17, level: 1, kind: "wall" })).toBe(0);
  });

  it("sizes a putty bomb's reach at half its radius, and reads props sizes as ints", () => {
    expect(puttyReach(byId("pu3"))).toBe(250);
    expect(propsSizeOf(1)).toBe(100);
    // The Laser Tower's props entry has no `size`; `GameObject._size` is an int.
    expect(propsSizeOf(23)).toBe(0);
  });
});

/**
 * A player's Map Room 2 outpost reads `OUTPOST_YARD_PROPS.as`
 * (`client/scripts/GLOBAL.as:716-723`), issue #179.
 */
describe("the outpost props table", () => {
  it("gives the core 200,000 health on an outpost and none anywhere else", () => {
    expect(maxHp(112, 1, "outpost")).toBe(200_000);
    expect(maxHp(112, 1)).toBe(0);
    expect(maxHp(112, 1, "wild")).toBe(0);
    expect(hpLadder(112, "outpost")).toEqual([200_000]);
  });

  it("reads the outpost's own six-level tower ladders, and the main ones where it has none", () => {
    // Laser 6: 60,200 health and range 172 on an outpost, 42,200 and 175 on a main yard.
    expect(maxHp(23, 6, "outpost")).toBe(60_200);
    expect(maxHp(23, 6)).toBe(42_200);
    expect(towerStats(23, 6, "outpost")?.range).toBe(172);
    expect(towerStats(23, 6)?.range).toBe(175);
    // A level past the outpost ladder clamps to its sixth level, as `atLevel` does.
    expect(towerStats(23, 8, "outpost")).toEqual(towerStats(23, 6, "outpost"));
    // The railgun's level 6 is 13,200, below its level 5; Flash ran it that way.
    expect(maxHp(118, 6, "outpost")).toBe(13_200);
    // The cannon's ladders are the same in both tables.
    expect(maxHp(20, 10, "outpost")).toBe(maxHp(20, 10));
    expect(towerStats(20, 10, "outpost")).toEqual(towerStats(20, 10));
  });

  it("reads harvester capacity only on an outpost", () => {
    expect(capacity(1, 10, "outpost")).toBe(775_018);
    expect(capacity(1, 10)).toBe(0);
    expect(capacity(15, 6, "outpost")).toBe(540);
  });
});

describe("towerRange: the terrain (`BTOWER.as:80-85`, `:94-99`)", () => {
  const laser = towerStats(23, 1, "outpost")?.range ?? 0;

  it("doubles at height 250 what it is at 125", () => {
    expect(laser).toBe(160);
    expect(towerRange(23, 1, "outpost", 125)).toBe(160);
    expect(towerRange(23, 1, "outpost", 250)).toBe(320);
  });

  it("scales as int(h * range / 125) from height 100 up", () => {
    expect(towerRange(23, 1, "outpost", 100)).toBe(128);
    expect(towerRange(23, 1, "outpost", 131)).toBe(Math.trunc((131 * 160) / 125));
    expect(towerRange(23, 1, "outpost", 131)).toBe(167);
  });

  it("leaves the table range below height 100", () => {
    expect(towerRange(23, 1, "outpost", 99)).toBe(160);
    expect(towerRange(23, 1, "outpost", 0)).toBe(160);
  });

  it("leaves a wild monster camp and a main yard alone, whatever the height", () => {
    expect(towerRange(23, 1, "wild", 250)).toBe(towerStats(23, 1)?.range);
    expect(towerRange(23, 1, "main", 250)).toBe(towerStats(23, 1)?.range);
    expect(towerRange(23, 1, "tribe", 250)).toBe(towerStats(23, 1)?.range);
  });

  it("is undefined for a type with no range", () => {
    expect(towerRange(14, 1, "outpost", 250)).toBeUndefined();
  });
});

describe("outpostHarvesterStock (`BRESOURCE.as:506-518`)", () => {
  const ceiling = maxHp(1, 10, "outpost");
  const room = capacity(1, 10, "outpost");

  it("holds half its capacity above half health", () => {
    expect(outpostHarvesterStock(1, 10, ceiling * 0.6, ceiling)).toBe(Math.trunc(room * 0.5));
    expect(outpostHarvesterStock(1, 10, ceiling, ceiling)).toBe(387_509);
  });

  it("holds a quarter at half health or below", () => {
    expect(outpostHarvesterStock(1, 10, ceiling * 0.4, ceiling)).toBe(Math.trunc(room * 0.25));
    expect(outpostHarvesterStock(1, 10, ceiling * 0.5, ceiling)).toBe(193_754);
  });

  it("holds nothing once destroyed, and nothing for a building that is not a harvester", () => {
    expect(outpostHarvesterStock(1, 10, 0, ceiling)).toBe(0);
    expect(outpostHarvesterStock(20, 1, 6000, 6000)).toBe(0);
  });
});

describe("championStatWithPower (issue #195)", () => {
  it("adds the power level's bonus to the level figure, and nothing at power level 0", () => {
    // Gorgo at level 2: 80,000 health and 1,200 damage; bonuses 12,500 / 27,500 / 50,000 and 150 / 330 / 600.
    expect(championStatWithPower("G1", "health", 2, 0)).toBe(80000);
    expect(championStatWithPower("G1", "health", 2, 1)).toBe(92500);
    expect(championStatWithPower("G1", "health", 2, 3)).toBe(130000);
    expect(championStatWithPower("G1", "damage", 2, 2)).toBe(1530);
  });

  it("clamps the power level to 0..3", () => {
    expect(championStatWithPower("G1", "health", 2, 9)).toBe(130000);
    expect(championStatWithPower("G1", "health", 2, -1)).toBe(80000);
  });
});
