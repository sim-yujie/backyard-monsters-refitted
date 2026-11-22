import { describe, expect, it } from "vitest";

import { createBattle, type Battle, type BattleVisualEvent, type CreepSnapshot } from "./engine.js";
import {
  MOLOCH_RAID_RANKS,
  SABNOX_BURN_SECONDS,
  VALGOS_WALL_RADIUS,
  balthazarMonsterMultiplier,
  grokusRadius,
  grokusSplashShare,
  kingWormzerMultiplier,
  kingWormzerRadius,
  malphusDodgeChance,
  sabnoxBurnShare,
  spurtzFury,
  spurtzFuryMost,
  spurtzFuryPerSecond,
  valgosExtraWalls,
  zagnoidHealShare,
} from "./specialMoves.js";
import { TICKS_PER_SECOND, monsterAttackDelay, monsterStat } from "./stats.js";
import type { CombatBuildingDataMap, FlingEvent, MonsterRanks } from "./types.js";
import { buildEngineYard } from "./yard.js";

/**
 * The Infernal Monster Lab's abilities (beta 9, owner, 21 Nov 2026; numbers
 * card b9-numbers, Spurtz on the middle ladder), each at each rank, the two
 * live nerfs at rank 0 and Moloch's raiders' fixed ranks. Rank 0 is the
 * plain monster everywhere else.
 */

const yardOf = (buildings: CombatBuildingDataMap) =>
  buildEngineYard({
    buildingdata: buildings,
    buildinghealthdata: {},
    resources: { r1: 100000, r2: 0, r3: 0, r4: 0 },
  });

type Yard = ReturnType<typeof yardOf>;

const dropOf = (id: string, x = 0, y = 0, count = 1, r = 0): FlingEvent => ({
  kind: "fling",
  t: 0,
  x,
  y,
  r,
  monsters: { [id]: count },
});

/** Steps the battle and hands every tick's creeps and new events to `each`. */
const watch = (
  battle: Battle,
  ticks: number,
  each: (creeps: readonly CreepSnapshot[], events: readonly BattleVisualEvent[]) => void = () => {},
): void => {
  for (let step = 0; step < ticks && !battle.over(); step += 1) {
    const before = battle.tick;
    battle.step();
    each(battle.creeps(), battle.recentEvents(before));
  }
};

const lostBy = (yard: Yard, id: number): number => {
  const building = yard.buildings.find((one) => one.id === id)!;
  return building.maxHp - building.hp;
};

/** A sturdy level 9 harvester (85,000 health). */
const harvester = (id: number, X: number, Y: number) => ({ id, t: 1, l: 9, X, Y });

const ranksOf = (id: string, rank: number): MonsterRanks => (rank > 0 ? { [id]: rank } : {});

describe("the numbers per rank (numbers card b9-numbers)", () => {
  it("gives the card's figures", () => {
    // Spurtz, middle ladder: ranks 1-2 low, rank 3 strong.
    expect([1, 2, 3].map(spurtzFuryPerSecond)).toEqual([0.0025, 0.004, 0.01]);
    expect([1, 2, 3].map(spurtzFuryMost)).toEqual([0.05, 0.08, 0.2]);
    expect([1, 2, 3].map(zagnoidHealShare)).toEqual([0.01, 0.015, 0.02]);
    expect([1, 2, 3].map(malphusDodgeChance)).toEqual([0.1, 0.2, 0.3]);
    expect([1, 2, 3].map(valgosExtraWalls)).toEqual([1, 2, 3]);
    expect(VALGOS_WALL_RADIUS).toBe(60);
    expect([0, 1, 2].map(balthazarMonsterMultiplier)).toEqual([1, 2, 3]);
    expect([1, 2, 3].map(grokusSplashShare)).toEqual([0.3, 0.45, 0.6]);
    expect([1, 2, 3].map(grokusRadius)).toEqual([60, 70, 80]);
    expect([1, 2, 3].map(sabnoxBurnShare)).toEqual([0.1, 0.2, 0.3]);
    expect(SABNOX_BURN_SECONDS).toBe(4);
    expect([0, 1, 2, 3].map(kingWormzerMultiplier)).toEqual([0, 1, 2, 3]);
    expect([1, 2, 3].map(kingWormzerRadius)).toEqual([60, 80, 100]);
  });

  it("grows Spurtz's fury each whole second up to its rank's most", () => {
    expect(spurtzFury(0, 100)).toBe(1);
    expect(spurtzFury(1, 0.9)).toBe(1);
    expect(spurtzFury(1, 4)).toBeCloseTo(1.01);
    expect(spurtzFury(1, 100)).toBeCloseTo(1.05);
    expect(spurtzFury(2, 10)).toBeCloseTo(1.04);
    expect(spurtzFury(2, 100)).toBeCloseTo(1.08);
    expect(spurtzFury(3, 10)).toBeCloseTo(1.1);
    expect(spurtzFury(3, 19)).toBeCloseTo(1.19);
    expect(spurtzFury(3, 60)).toBeCloseTo(1.2);
  });
});

describe("IC1 Spurtz: Fury", () => {
  /** One Spurtz at a harvester: each of its blows' amount and tick. */
  const blows = (rank: number) => {
    const yard = yardOf({ "1": harvester(1, 0, 0) });
    const battle = createBattle(yard, { seed: 3, ranks: ranksOf("IC1", rank) });
    battle.apply(dropOf("IC1", 60, 60));
    const hits: { tick: number; amount: number }[] = [];
    watch(battle, TICKS_PER_SECOND * 40, (_creeps, events) => {
      for (const event of events) if (event.kind === "hit") hits.push({ tick: event.tick, amount: event.amount });
    });
    return hits;
  };

  it("hits the same all fight at rank 0", () => {
    const hits = blows(0);
    expect(hits.length).toBeGreaterThan(5);
    expect(new Set(hits.map((hit) => hit.amount)).size).toBe(1);
  });

  it.each([1, 2, 3])("at rank %i hits harder the longer it fights, up to its most", (rank) => {
    const plain = monsterStat("IC1", "damage", 1);
    const hits = blows(rank);
    expect(hits.length).toBeGreaterThan(5);
    for (let k = 1; k < hits.length; k += 1) {
      expect(hits[k]!.amount).toBeGreaterThanOrEqual(hits[k - 1]!.amount);
    }
    expect(hits[0]!.amount).toBeGreaterThanOrEqual(plain);
    const last = hits.at(-1)!;
    // 40 seconds in, every rank is at its most.
    expect(last.amount).toBeCloseTo(plain * (1 + spurtzFuryMost(rank)), 6);
  });

  it("swings more often at rank 3", () => {
    expect(blows(3).length).toBeGreaterThan(blows(0).length);
  });
});

describe("IC2 Zagnoid: Regeneration", () => {
  /** Zagnoid under a Sniper Tower: its health a second after the tower's first shot. */
  const healthUnderFire = (rank: number) => {
    const yard = yardOf({ "1": { id: 1, t: 21, l: 1, X: 0, Y: 0 }, "2": harvester(2, 200, 200) });
    const battle = createBattle(yard, { seed: 5, ranks: ranksOf("IC2", rank) });
    battle.apply(dropOf("IC2", 150, 150));
    const heals: number[] = [];
    let previous: number | null = null;
    watch(battle, TICKS_PER_SECOND * 20, (creeps) => {
      const zagnoid = creeps.find((creep) => creep.monsterId === "IC2" && !creep.friendly);
      if (!zagnoid) return;
      if (previous !== null && zagnoid.hp > previous) heals.push(zagnoid.hp - previous);
      previous = zagnoid.hp;
    });
    return heals;
  };

  it("never heals at rank 0", () => {
    expect(healthUnderFire(0)).toEqual([]);
  });

  it.each([1, 2, 3])("heals its rank's share of full health a second at rank %i", (rank) => {
    const heals = healthUnderFire(rank);
    expect(heals.length).toBeGreaterThan(0);
    const full = monsterStat("IC2", "health", 1);
    for (const heal of heals) expect(heal).toBeLessThanOrEqual(full * zagnoidHealShare(rank) + 1e-9);
    expect(Math.max(...heals)).toBeCloseTo(full * zagnoidHealShare(rank), 6);
  });
});

describe("IC3 Malphus: Dodge", () => {
  /** Twenty Malphus under Sniper Towers, over ten seeds: hits that landed and hits dodged. */
  const underFire = (rank: number) => {
    let hurt = 0;
    let dodged = 0;
    for (let seed = 1; seed <= 10; seed += 1) {
      // Three level 7 Snipers, sturdy enough to keep shooting a while.
      const yard = yardOf({
        "1": { id: 1, t: 21, l: 7, X: 0, Y: 0 },
        "2": { id: 2, t: 21, l: 7, X: -120, Y: 0 },
        "3": { id: 3, t: 21, l: 7, X: 0, Y: -120 },
      });
      const battle = createBattle(yard, { seed, ranks: ranksOf("IC3", rank) });
      battle.apply(dropOf("IC3", 250, 250, 20, 20));
      watch(battle, TICKS_PER_SECOND * 60, (_creeps, events) => {
        for (const event of events) {
          if (event.kind === "hurt" && !event.friendly) hurt += 1;
          if (event.kind === "dodge") dodged += 1;
        }
      });
    }
    return { hurt, dodged };
  };

  it("dodges nothing at rank 0", () => {
    const plain = underFire(0);
    expect(plain.hurt).toBeGreaterThan(0);
    expect(plain.dodged).toBe(0);
  });

  it.each([1, 2, 3])("dodges about its rank's share of the hits at rank %i", (rank) => {
    const { hurt, dodged } = underFire(rank);
    const share = dodged / (hurt + dodged);
    expect(hurt + dodged).toBeGreaterThan(150);
    expect(share).toBeGreaterThan(malphusDodgeChance(rank) - 0.08);
    expect(share).toBeLessThan(malphusDodgeChance(rank) + 0.08);
  });
});

describe("IC4 Valgos: Wall Crusher", () => {
  /** Valgos dropped by a line of walls: how many walls its first blow hurt. */
  const wallsHurt = (rank: number) => {
    const walls: Record<string, CombatBuildingDataMap[string]> = {};
    for (let k = 0; k < 8; k += 1) walls[String(10 + k)] = { id: 10 + k, t: 17, l: 1, X: 0, Y: k * 10 };
    const yard = yardOf({ ...walls, "1": harvester(1, -200, 40) });
    const battle = createBattle(yard, { seed: 3, ranks: ranksOf("IC4", rank) });
    battle.apply(dropOf("IC4", 60, 40));
    let firstHitTick = -1;
    for (let step = 0; step < TICKS_PER_SECOND * 30 && firstHitTick < 0; step += 1) {
      const before = battle.tick;
      battle.step();
      for (const event of battle.recentEvents(before)) if (event.kind === "hit") firstHitTick = event.tick;
    }
    const hurtWalls = yard.buildings.filter((one) => one.kind === "wall" && one.hp < one.maxHp).length;
    return { hurtWalls, firstHitTick };
  };

  it("hits one wall at a time at rank 0", () => {
    const { hurtWalls, firstHitTick } = wallsHurt(0);
    expect(firstHitTick).toBeGreaterThanOrEqual(0);
    expect(hurtWalls).toBe(1);
  });

  it.each([1, 2, 3])("hits 1 + %i walls with one blow", (rank) => {
    expect(wallsHurt(rank).hurtWalls).toBe(1 + valgosExtraWalls(rank));
  });

  it("never reaches a wall more than 60 from the one struck", () => {
    const yard = yardOf({
      "10": { id: 10, t: 17, l: 1, X: 0, Y: 0 },
      "11": { id: 11, t: 17, l: 1, X: 0, Y: 200 },
      "1": harvester(1, -200, 0),
    });
    const battle = createBattle(yard, { seed: 3, ranks: { IC4: 3 } });
    battle.apply(dropOf("IC4", 60, 0));
    let hit = false;
    for (let step = 0; step < TICKS_PER_SECOND * 30 && !hit; step += 1) {
      const before = battle.tick;
      battle.step();
      hit = battle.recentEvents(before).some((event) => event.kind === "hit");
    }
    expect(hit).toBe(true);
    expect(lostBy(yard, 10) + lostBy(yard, 11)).toBeGreaterThan(0);
    expect(Math.min(lostBy(yard, 10), lostBy(yard, 11))).toBe(0);
  });
});

describe("IC5 Balthazar: Monster Hunter (beta 9's live nerf at rank 0)", () => {
  /** A defending Balthazar from a bunker against three attacking Grokus: its blows' amounts. */
  const defenceBlows = (rank: number) => {
    const yard = yardOf({ "1": { id: 1, t: 22, l: 1, X: 0, Y: 0 }, "2": harvester(2, 150, 150) });
    const battle = createBattle(yard, {
      seed: 3,
      bunkers: { 1: { IC5: 1 } },
      ...(rank > 0 && { defenderRanks: { IC5: rank } }),
    });
    battle.apply(dropOf("IC6", 130, 130, 3, 10));
    const amounts: number[] = [];
    const defenders = new Set<number>();
    watch(battle, TICKS_PER_SECOND * 30, (creeps, events) => {
      for (const creep of creeps) if (creep.friendly) defenders.add(creep.id);
      for (const event of events) if (event.kind === "hurt" && !event.friendly) amounts.push(event.amount);
    });
    return { amounts, defenders };
  };

  it.each([
    [0, 1],
    [1, 2],
    [2, 3],
  ])("defending at rank %i strikes monsters %ix", (rank, times) => {
    const { amounts, defenders } = defenceBlows(rank);
    expect(defenders.size).toBe(1);
    const damage = monsterStat("IC5", "damage", 1);
    expect(amounts.length).toBeGreaterThan(0);
    // Every full blow is the multiple (a killing blow can be less).
    expect(Math.max(...amounts)).toBeCloseTo(damage * times, 6);
  });
});

describe("IC6 Grokus: Shockwave", () => {
  // A tower it goes for, with two harvesters touching it that it never strikes.
  const yardFor = () =>
    yardOf({
      "1": { id: 1, t: 21, l: 1, X: 0, Y: 0 },
      "2": harvester(2, 0, 40),
      "3": harvester(3, 40, 0),
    });

  const nearbyLoss = (rank: number) => {
    const yard = yardFor();
    const battle = createBattle(yard, { seed: 3, ranks: ranksOf("IC6", rank) });
    battle.apply(dropOf("IC6", -60, -60));
    const struck = new Set<number>();
    watch(battle, TICKS_PER_SECOND * 15, (_creeps, events) => {
      for (const event of events) if (event.kind === "hit") struck.add(event.buildingId);
    });
    expect(struck.has(1)).toBe(true);
    expect(struck.has(2) || struck.has(3)).toBe(false);
    return lostBy(yard, 2) + lostBy(yard, 3);
  };

  it("leaves the buildings round its target alone at rank 0", () => {
    expect(nearbyLoss(0)).toBe(0);
  });

  it("shakes the buildings round it, more with each rank", () => {
    const [one, two, three] = [nearbyLoss(1), nearbyLoss(2), nearbyLoss(3)];
    expect(one).toBeGreaterThan(0);
    expect(two).toBeGreaterThan(one);
    expect(three).toBeGreaterThan(two);
  });

  it("splashes no building when it defends", () => {
    const harvesterLoss = (rank: number) => {
      const yard = yardOf({ "1": { id: 1, t: 22, l: 1, X: 0, Y: 0 }, "2": harvester(2, 150, 150) });
      const battle = createBattle(yard, {
        seed: 3,
        bunkers: { 1: { IC6: 2 } },
        ...(rank > 0 && { defenderRanks: { IC6: rank } }),
      });
      battle.apply(dropOf("IC2", 130, 130, 3, 10));
      watch(battle, TICKS_PER_SECOND * 30);
      return yard.buildings.map((building) => building.maxHp - building.hp);
    };
    // Its own yard loses exactly what it loses with a plain Grokus.
    expect(harvesterLoss(3)).toEqual(harvesterLoss(0));
  });

});

describe("IC7 Sabnox: Burn", () => {
  /** A Sabnox at a lone Sniper Tower for 20 seconds: its blows' total and the tower's loss. */
  const atTower = (rank: number) => {
    const yard = yardOf({ "1": { id: 1, t: 21, l: 9, X: 0, Y: 0 } });
    const battle = createBattle(yard, { seed: 3, ranks: ranksOf("IC7", rank) });
    battle.apply(dropOf("IC7", 200, 200));
    let blows = 0;
    watch(battle, TICKS_PER_SECOND * 20, (_creeps, events) => {
      for (const event of events) if (event.kind === "hit" && event.buildingId === 1) blows += event.amount;
    });
    return { blows, lost: lostBy(yard, 1) };
  };

  it("burns nothing at rank 0", () => {
    const { blows, lost } = atTower(0);
    expect(blows).toBeGreaterThan(0);
    expect(lost).toBeCloseTo(blows, 6);
  });

  it.each([1, 2, 3])("burns its rank's share once a second at rank %i, one burn per target", (rank) => {
    const { blows, lost } = atTower(rank);
    const burned = lost - blows;
    expect(burned).toBeGreaterThan(0);
    // One burn at a time, refreshed by each blow: about the rank's share of
    // one blow a second for as long as it keeps striking. Stacked burns
    // (one per blow) would come to SABNOX_BURN_SECONDS / swing-seconds
    // times as much.
    const swingSeconds = monsterAttackDelay("IC7", 1) / TICKS_PER_SECOND;
    const blowCount = blows / (monsterStat("IC7", "damage", 1) * 2);
    const oneBurn = sabnoxBurnShare(rank) * (blows / blowCount) * blowCount * swingSeconds;
    expect(burned).toBeLessThan(oneBurn * 1.3 + sabnoxBurnShare(rank) * (blows / blowCount) * SABNOX_BURN_SECONDS);
    expect(burned).toBeGreaterThan(oneBurn * 0.5);
  });

  it("sets an attacking monster burning when it defends, and the burn goes out", () => {
    const yard = yardOf({ "1": { id: 1, t: 22, l: 1, X: 0, Y: 0 }, "2": harvester(2, 150, 150) });
    const battle = createBattle(yard, { seed: 3, bunkers: { 1: { IC7: 1 } }, defenderRanks: { IC7: 3 } });
    battle.apply(dropOf("IC8", 130, 130, 1, 0));
    let burning = false;
    watch(battle, TICKS_PER_SECOND * 30, (creeps) => {
      if (creeps.some((creep) => !creep.friendly && creep.burning)) burning = true;
    });
    expect(burning).toBe(true);
  });
});

describe("IC8 King Wormzer: Quake Splash (beta 9's live nerf at rank 0)", () => {
  // `infernoMonsters.test.ts` has rank 0 against rank 1-3; here the reach.
  it.each([1, 2, 3])("at rank %i reaches only its rank's distance", (rank) => {
    const yard = yardOf({ "1": harvester(1, 0, 0), "2": harvester(2, 0, 200) });
    const battle = createBattle(yard, { seed: 3, ranks: { IC8: rank } });
    battle.apply(dropOf("IC8", 60, -20));
    watch(battle, TICKS_PER_SECOND * 5);
    expect(lostBy(yard, 2)).toBe(0);
  });
});

describe("Moloch's emergence raids keep their strength", () => {
  it("fight with Balthazar at rank 2 and King Wormzer at rank 3, the rest at rank 0", () => {
    expect(MOLOCH_RAID_RANKS).toEqual({ IC5: 2, IC8: 3 });
    const yard = yardOf({ "1": { id: 1, t: 22, l: 1, X: 0, Y: 0 } });
    const battle = createBattle(yard, { seed: 1, raid: true });
    battle.apply({ kind: "raid", t: 0, x: 400, y: 0, r: 20, monsters: { IC1: 1, IC5: 1, IC8: 1 } });
    const ranks = Object.fromEntries(battle.creeps().map((creep) => [creep.monsterId, creep.rank ?? 0]));
    expect(ranks).toEqual({ IC1: 0, IC5: 2, IC8: 3 });
  });

  it("ignore any Lab ranks a player passes in", () => {
    const yard = yardOf({ "1": { id: 1, t: 22, l: 1, X: 0, Y: 0 } });
    const battle = createBattle(yard, { seed: 1, raid: true, ranks: { IC1: 3, IC5: 1 } });
    battle.apply({ kind: "raid", t: 0, x: 400, y: 0, r: 20, monsters: { IC1: 1, IC5: 1 } });
    const ranks = Object.fromEntries(battle.creeps().map((creep) => [creep.monsterId, creep.rank ?? 0]));
    expect(ranks).toEqual({ IC1: 0, IC5: 2 });
  });
});
