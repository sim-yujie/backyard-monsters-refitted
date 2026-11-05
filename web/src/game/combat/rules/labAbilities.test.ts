import { describe, expect, it } from "vitest";

import { createBattle, type Battle, type BattleVisualEvent, type CreepSnapshot } from "./engine.js";
import { replayAttack } from "./replay.js";
import {
  CRIT_MULTIPLIER,
  SWARM_SIZE,
  WEAKEN_SECONDS,
  critChance,
  swarmSpeedShare,
  thornsShare,
  weakenShare,
} from "./specialMoves.js";
import { monsterAttackDelay, ticks } from "./stats.js";
import type { CombatBuildingDataMap, FlingEvent } from "./types.js";
import { buildEngineYard } from "./yard.js";

/**
 * The revamp's four Monster Lab abilities (owner, beta 6 grill, 2 Nov 2026):
 * Pokey's Swarm, Octo-ooze's Weakening Ooze, Ichi's Thorns and Crabatron's
 * Critical Hits, on attack and on defence. Rank 0 is always the plain monster.
 */

const yardOf = (buildings: CombatBuildingDataMap) =>
  buildEngineYard({
    buildingdata: buildings,
    buildinghealthdata: {},
    resources: { r1: 100000, r2: 0, r3: 0, r4: 0 },
  });

/** Level 5 Town Hall-sized targets (type 1, 6,500 health): sturdy enough to outlast many swings. */
const block = (id: number, X: number, Y: number) => ({ id, t: 1, l: 5, X, Y });
/** A level 1 Cannon Tower. */
const cannon = (id: number, X: number, Y: number) => ({ id, t: 20, l: 1, X, Y });
/** A bunker. */
const bunker = (id: number, X: number, Y: number) => ({ id, t: 22, l: 1, X, Y });

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
  steps: number,
  each: (creeps: readonly CreepSnapshot[], events: readonly BattleVisualEvent[]) => void,
): void => {
  for (let step = 0; step < steps && !battle.over(); step += 1) {
    const before = battle.tick;
    battle.step();
    each(battle.creeps(), battle.recentEvents(before));
  }
};

type Hurt = Extract<BattleVisualEvent, { kind: "hurt" }>;
type Hit = Extract<BattleVisualEvent, { kind: "hit" }>;

describe("the numbers per rank", () => {
  it("gives the owner's figures", () => {
    expect(SWARM_SIZE).toBe(5);
    expect([1, 2, 3].map(swarmSpeedShare)).toEqual([0.1, 0.2, 0.3]);
    expect([1, 2, 3].map(weakenShare)).toEqual([0.05, 0.1, 0.15]);
    expect(WEAKEN_SECONDS).toBe(5);
    expect([1, 2, 3].map(thornsShare)).toEqual([0.1, 0.15, 0.2]);
    expect([1, 2, 3].map(critChance)).toEqual([0.1, 0.15, 0.2]);
    expect(CRIT_MULTIPLIER).toBe(2);
  });
});

describe("Pokey's Swarm", () => {
  /** `count` Pokeys dropped on one block: whether any swarmed, and one Pokey's swing gap. */
  const onBlock = (count: number, rank: number) => {
    const battle = createBattle(yardOf({ "1": block(1, 0, 0) }), { seed: 5, ranks: { C1: rank } });
    battle.apply(dropOf("C1", 0, 0, count, 0));
    let swarmed = false;
    let first = -1;
    const swings: number[] = [];
    watch(battle, 900, (creeps, events) => {
      if (creeps.some((creep) => creep.swarming)) swarmed = true;
      for (const event of events) {
        if (event.kind !== "hit") continue;
        if (first < 0) first = event.creepId;
        if (event.creepId === first) swings.push(battle.tick);
      }
    });
    // Late swings, once every Pokey has long been at the block.
    const gap = (swings.at(-1) ?? 0) - (swings.at(-2) ?? 0);
    return { swarmed, gap };
  };

  const delay = monsterAttackDelay("C1", 1);
  const plainGap = Math.trunc(delay) + 1;

  it("needs 5 on one target: 4 never swarm", () => {
    const four = onBlock(4, 3);
    expect(four.swarmed).toBe(false);
    expect(four.gap).toBe(plainGap);
  });

  it("never swarms at rank 0, however many", () => {
    const plain = onBlock(8, 0);
    expect(plain.swarmed).toBe(false);
    expect(plain.gap).toBe(plainGap);
  });

  it.each([1, 2, 3])("swings 1 + %i/10 times as fast with 5 on one target", (rank) => {
    const five = onBlock(5, rank);
    expect(five.swarmed).toBe(true);
    expect(five.gap).toBe(Math.trunc(delay / (1 + rank / 10)) + 1);
  });

  it("gains nothing more past 5", () => {
    expect(onBlock(9, 3).gap).toBe(onBlock(5, 3).gap);
  });

  it("stops once fewer than 5 are left", () => {
    // A Cannon Tower picks the swarm off as it hits the block beside it.
    const yard = yardOf({ "1": block(1, 0, 0), "2": cannon(2, 120, 0) });
    const battle = createBattle(yard, { seed: 5, ranks: { C1: 3 } });
    battle.apply(dropOf("C1", 0, 0, 6, 0));
    let swarmedTicks = 0;
    let fewSince = -1;
    let swarmedWhenFew = 0;
    watch(battle, 2000, (creeps) => {
      const alive = creeps.filter((creep) => creep.monsterId === "C1" && creep.hp > 0);
      const swarming = alive.filter((creep) => creep.swarming).length;
      if (swarming > 0) swarmedTicks += 1;
      if (alive.length < SWARM_SIZE && fewSince < 0) fewSince = battle.tick;
      // A tick for the step after the fall to see it.
      if (fewSince >= 0 && battle.tick > fewSince + 1) swarmedWhenFew += swarming;
    });
    expect(swarmedTicks).toBeGreaterThan(0);
    expect(fewSince).toBeGreaterThan(0);
    expect(swarmedWhenFew).toBe(0);
  });

  it("swarms for a bunker's Pokeys at the defender's rank", () => {
    const fight = (defenderRanks: Record<string, number>) => {
      const yard = yardOf({ "1": bunker(1, 0, 0), "2": block(2, 200, 200) });
      const battle = createBattle(yard, { seed: 3, bunkers: { 1: { C1: 8 } }, defenderRanks });
      battle.apply(dropOf("C6", 180, 180, 1, 0));
      let swarmed = false;
      watch(battle, 1500, (creeps) => {
        if (creeps.some((creep) => creep.friendly && creep.swarming)) swarmed = true;
      });
      return swarmed;
    };
    expect(fight({})).toBe(false);
    expect(fight({ C1: 2 })).toBe(true);
  });
});

describe("Octo-ooze's Weakening Ooze", () => {
  /**
   * A level 6 Cannon Tower, a sturdy Ichi for it to keep shooting, and
   * `octos` Octo-oozes spread `spread` round one spot: the ticks the tower is
   * weakened, the Octo-oozes' deaths and every hurt.
   */
  const byCannon = (rank: number, octos: number, spread = 0) => {
    const yard = yardOf({ "1": { ...cannon(1, 0, 0), l: 6 }, "2": block(2, 300, 300) });
    const battle = createBattle(yard, { seed: 8, ranks: { C2: rank }, levels: { C6: 3 } });
    battle.apply(dropOf("C6", 60, 60, 1, 0));
    battle.apply(dropOf("C2", 40, 40, octos, spread));
    const weakTicks: number[] = [];
    const octoDeaths: number[] = [];
    const hurts: { event: Hurt; survived: boolean }[] = [];
    watch(battle, 3000, (creeps, events) => {
      if (battle.weakenedTowers().includes(1)) weakTicks.push(battle.tick);
      for (const event of events) {
        if (event.kind === "death" && event.monsterId === "C2") octoDeaths.push(battle.tick);
        if (event.kind === "hurt") {
          const survived = creeps.some((creep) => creep.id === event.creepId && creep.hp > 0);
          hurts.push({ event, survived });
        }
      }
    });
    return { weakTicks, octoDeaths, hurts };
  };

  it("weakens nothing at rank 0", () => {
    const { weakTicks, octoDeaths, hurts } = byCannon(0, 2);
    expect(octoDeaths.length).toBe(2);
    expect(weakTicks).toEqual([]);
    expect(hurts.some(({ event }) => event.reduced !== undefined)).toBe(false);
  });

  it.each([1, 2, 3])("cuts the killer tower's shots by 5 x %i% for 5 seconds", (rank) => {
    const { weakTicks, octoDeaths, hurts } = byCannon(rank, 1);
    expect(octoDeaths.length).toBe(1);
    expect(weakTicks.length).toBe(ticks(WEAKEN_SECONDS));
    expect(weakTicks[0]).toBe(octoDeaths[0]);
    const cut = hurts.filter(({ event, survived }) => survived && event.reduced !== undefined);
    expect(cut.length).toBeGreaterThan(0);
    for (const { event } of cut) {
      expect(event.reduced! / (event.amount + event.reduced!)).toBeCloseTo(weakenShare(rank), 9);
    }
  });

  it("refreshes on a second kill instead of stacking", () => {
    const { weakTicks, octoDeaths, hurts } = byCannon(3, 4, 120);
    expect(octoDeaths.length).toBe(4);
    // Some Octo-ooze fell while the tower was still weakened by an earlier one.
    const span = ticks(WEAKEN_SECONDS);
    const overlaps = octoDeaths.filter((death, at) =>
      octoDeaths.slice(0, at).some((earlier) => death > earlier && death - earlier < span),
    );
    expect(overlaps.length).toBeGreaterThan(0);
    // Weakened exactly 5 seconds from each kill: a later kill starts the time again.
    const expected = new Set<number>();
    for (const death of octoDeaths) for (let at = death; at < death + span; at += 1) expected.add(at);
    expect(weakTicks).toEqual([...expected].sort((one, two) => one - two));
    // And the cut stays the one share.
    const shares = hurts
      .filter(({ event, survived }) => survived && event.reduced !== undefined)
      .map(({ event }) => event.reduced! / (event.amount + event.reduced!));
    expect(shares.length).toBeGreaterThan(0);
    for (const share of shares) expect(share).toBeCloseTo(weakenShare(3), 9);
  });

  it("weakens the attacking monster that kills a bunker's Octo-ooze", () => {
    const fight = (defenderRanks: Record<string, number>) => {
      const yard = yardOf({ "1": bunker(1, 0, 0), "2": block(2, 200, 200) });
      const battle = createBattle(yard, {
        seed: 3,
        bunkers: { 1: { C2: 2 } },
        defenderRanks,
        levels: { C6: 4 },
      });
      battle.apply(dropOf("C6", 180, 180, 1, 0));
      let weakened = false;
      const cut: number[] = [];
      watch(battle, 2500, (creeps, events) => {
        const ichi = creeps.find((creep) => !creep.friendly);
        if (ichi?.weakened) weakened = true;
        for (const event of events) {
          if (event.kind !== "hurt" || !event.friendly || event.reduced === undefined) continue;
          const alive = creeps.some((creep) => creep.id === event.creepId && creep.hp > 0);
          if (alive) cut.push(event.reduced / (event.amount + event.reduced));
        }
      });
      return { weakened, cut };
    };
    expect(fight({})).toEqual({ weakened: false, cut: [] });
    const ranked = fight({ C2: 2 });
    expect(ranked.weakened).toBe(true);
    expect(ranked.cut.length).toBeGreaterThan(0);
    for (const share of ranked.cut) expect(share).toBeCloseTo(weakenShare(2), 9);
  });
});

describe("Ichi's Thorns", () => {
  /** An Ichi under a Cannon Tower: what it lost, and what its thorns took off the tower. */
  const underCannon = (rank: number) => {
    const yard = yardOf({ "1": { ...cannon(1, 0, 0), l: 6 }, "2": block(2, 300, 300) });
    const battle = createBattle(yard, { seed: 8, ranks: { C6: rank } });
    battle.apply(dropOf("C6", 60, 60, 1, 0));
    let lost = 0;
    let reflected = 0;
    let maxHp = 0;
    watch(battle, 3000, (creeps, events) => {
      const ichi = creeps.find((creep) => creep.monsterId === "C6");
      if (ichi) maxHp = ichi.maxHp;
      for (const event of events) {
        if (event.kind === "hurt") lost += event.amount;
        if (event.kind === "thorns") {
          expect(event.buildingId).toBe(1);
          reflected += event.amount;
        }
      }
    });
    return { lost, reflected, maxHp };
  };

  it("reflects nothing at rank 0", () => {
    const { lost, reflected } = underCannon(0);
    expect(lost).toBeGreaterThan(0);
    expect(reflected).toBe(0);
  });

  it.each([1, 2, 3])("sends back 5 + 5 x %i% of what it lost, never overkill", (rank) => {
    const { lost, reflected, maxHp } = underCannon(rank);
    expect(lost).toBeGreaterThan(0);
    // Only health it actually lost, its splash share included: never more than its own health.
    expect(lost).toBeLessThanOrEqual(maxHp + 1e-9);
    expect(reflected).toBeCloseTo(lost * thornsShare(rank), 6);
    expect(reflected).toBeLessThanOrEqual(maxHp * thornsShare(rank) + 1e-9);
  });

  it("reflects onto the attacking monsters that strike a bunker's Ichi", () => {
    const fight = (defenderRanks: Record<string, number>) => {
      const yard = yardOf({ "1": bunker(1, 0, 0), "2": block(2, 200, 200) });
      const battle = createBattle(yard, { seed: 3, bunkers: { 1: { C6: 1 } }, defenderRanks });
      battle.apply(dropOf("C10", 180, 180, 2, 10));
      let ichiLost = 0;
      let thorns = 0;
      watch(battle, 1500, (_creeps, events) => {
        for (const event of events) {
          if (event.kind !== "hurt") continue;
          if (event.friendly) ichiLost += event.amount;
          else if (event.thorns) thorns += event.amount;
        }
      });
      return { ichiLost, thorns };
    };
    expect(fight({}).thorns).toBe(0);
    const ranked = fight({ C6: 3 });
    expect(ranked.ichiLost).toBeGreaterThan(0);
    expect(ranked.thorns).toBeGreaterThan(0);
    // A striker that is already dead takes none, so never more than the share.
    expect(ranked.thorns).toBeLessThanOrEqual(ranked.ichiLost * thornsShare(3) + 1e-9);
  });
});

describe("Crabatron's Critical Hits", () => {
  /** Crabatrons on a row of blocks: every hit they land, and the battle's rng draws. */
  const onBlocks = (rank: number, seed: number) => {
    const buildings: CombatBuildingDataMap = Object.fromEntries(
      [1, 2, 3, 4].map((id) => [String(id), block(id, id * 70, 0)]),
    );
    const battle = createBattle(yardOf(buildings), { seed, ranks: { C10: rank } });
    battle.apply(dropOf("C10", 140, 0, 6, 30));
    const hits: Hit[] = [];
    watch(battle, 1500, (_creeps, events) => {
      for (const event of events) if (event.kind === "hit") hits.push(event);
    });
    return { hits, draws: battle.state().rngDraws };
  };

  it("never crits at rank 0, and draws nothing for it", () => {
    const { hits, draws } = onBlocks(0, 2);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((hit) => hit.bonus !== undefined)).toBe(false);
    // A ranked Crabatron's battle draws once more a swing.
    const ranked = onBlocks(3, 2);
    expect(ranked.draws - draws).toBeGreaterThanOrEqual(ranked.hits.length);
  });

  it.each([1, 2, 3])("crits about 5 + 5 x %i% of its hits, for double damage", (rank) => {
    let crits = 0;
    let halves = 0;
    let all = 0;
    for (let seed = 1; seed <= 12; seed += 1) {
      for (const hit of onBlocks(rank, seed).hits) {
        if (hit.amount <= 0) continue;
        all += 1;
        if (hit.bonus === undefined) continue;
        crits += 1;
        // The bonus is the half a crit doubled; never more than the number itself.
        expect(hit.bonus).toBeLessThanOrEqual(hit.amount);
        if (Math.abs(hit.bonus - hit.amount / CRIT_MULTIPLIER) < 1e-9) halves += 1;
      }
    }
    expect(all).toBeGreaterThan(1200);
    // All but the blows that brought a block down, capped at what it had left.
    expect(halves).toBeGreaterThan(crits * 0.9);
    expect(crits / all).toBeGreaterThan(critChance(rank) - 0.025);
    expect(crits / all).toBeLessThan(critChance(rank) + 0.025);
  });

  it("crits for a bunker's Crabatrons at the defender's rank", () => {
    const fight = (defenderRanks: Record<string, number>) => {
      const yard = yardOf({ "1": bunker(1, 0, 0), "2": block(2, 200, 200) });
      const battle = createBattle(yard, { seed: 3, bunkers: { 1: { C10: 2 } }, defenderRanks });
      battle.apply(dropOf("C6", 180, 180, 2, 10));
      let crits = 0;
      watch(battle, 1500, (_creeps, events) => {
        for (const event of events) {
          if (event.kind === "hurt" && !event.friendly && event.bonus !== undefined) crits += 1;
        }
      });
      return crits;
    };
    expect(fight({})).toBe(0);
    expect(fight({ C10: 3 })).toBeGreaterThan(0);
  });
});

describe("Fomor's enrage armour on the numbers", () => {
  it("shows what the armour took off as `reduced`", () => {
    const yard = yardOf({
      "1": { id: 1, t: 1, l: 1, X: 0, Y: 0, st: 100_000 },
      "2": { id: 2, t: 20, l: 1, X: 100, Y: 0 },
    });
    const battle = createBattle(yard, { seed: 4 });
    battle.apply({
      kind: "fling",
      t: 0,
      x: -60,
      y: -60,
      r: 100,
      monsters: { C6: 3 },
      champion: { t: 3, l: 6, pl: 3 },
    });
    const shares: number[] = [];
    let plainReduced = 0;
    watch(battle, 600, (creeps, events) => {
      for (const event of events) {
        if (event.kind !== "hurt") continue;
        const creep = creeps.find((one) => one.id === event.creepId);
        if (!creep || creep.hp <= 0 || creep.champion) continue;
        if (creep.enraged && event.reduced !== undefined) {
          shares.push(event.reduced / (event.amount + event.reduced));
        } else if (!creep.enraged && event.reduced !== undefined) plainReduced += 1;
      }
    });
    expect(shares.length).toBeGreaterThan(0);
    // Buff 0.75 at level 6, power 3: a quarter of each hit gets through.
    for (const share of shares) expect(share).toBeCloseTo(0.75, 9);
    expect(plainReduced).toBe(0);
  });
});

describe("the same battle on the server", () => {
  const log = {
    v: 1 as const,
    seed: 13,
    events: [
      dropOf("C1", -40, -40, 6, 5),
      dropOf("C2", 0, 80, 3, 10),
      dropOf("C6", 80, 0, 2, 10),
      dropOf("C10", 40, 40, 3, 10),
    ],
  };
  const input = {
    buildingdata: {
      "1": block(1, 0, 0),
      "2": block(2, 60, 0),
      "5": { id: 5, t: 20, l: 6, X: 120, Y: 120 },
      "6": { id: 6, t: 22, l: 1, X: 150, Y: 0 },
    },
    log,
    tailTicks: 3000,
  };
  const ranks = { C1: 3, C2: 2, C6: 3, C10: 3 };

  it("replays identically with the same ranks", () => {
    const one = replayAttack({ ...input, ranks });
    const two = replayAttack({ ...input, ranks });
    expect(two.digest).toBe(one.digest);
    expect(two.checkpoints).toEqual(one.checkpoints);
  });

  it("is a different battle with ranks than without, and the same with rank 0", () => {
    const plain = replayAttack(input);
    const zero = replayAttack({ ...input, ranks: { C1: 0, C2: 0, C6: 0, C10: 0 } });
    expect(zero.digest).toBe(plain.digest);
    expect(replayAttack({ ...input, ranks }).digest).not.toBe(plain.digest);
  });
});
