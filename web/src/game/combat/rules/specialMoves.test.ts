import { describe, expect, it } from "vitest";

import { linearAreaDamage } from "./champions.js";
import {
  academyRanks,
  battleDefence,
  defenderForcesOf,
  parseDefenderForces,
} from "./defence.js";
import { createBattle, type Battle, type BattleOptions } from "./engine.js";
import { replayAttack } from "./replay.js";
import {
  AIRBURST_BUILDING_RADIUS,
  AIRBURST_CREEP_RADIUS,
  FINK_RADIUS,
  MAX_RANK,
  PROJECT_X_RADIUS,
  WORMZER_RADIUS,
  airburstPercent,
  airburstRadius,
  daveRange,
  finkExtraTargets,
  projectXMultiplier,
  rankOf,
  wormzerMultiplier,
} from "./specialMoves.js";
import { monsterStat } from "./stats.js";
import type { CombatBuildingDataMap, FlingEvent, MonsterRanks } from "./types.js";
import { buildEngineYard, rangePointOf } from "./yard.js";

/**
 * The Monster Lab's special moves (issue #352): the numbers per rank, and the
 * battle that carries them out. Rank 0 is always the plain monster.
 */

const yardOf = (buildings: CombatBuildingDataMap) =>
  buildEngineYard({
    buildingdata: buildings,
    buildinghealthdata: {},
    resources: { r1: 100000, r2: 0, r3: 0, r4: 0 },
  });

type Yard = ReturnType<typeof yardOf>;

/** Level 5 Town Hall-sized targets (type 1, 6,500 health): sturdy enough to outlast one swing. */
const block = (id: number, X: number, Y: number) => ({ id, t: 1, l: 5, X, Y });

/** Three buildings close together and one far away, the first at the drop point. */
const cluster = () =>
  yardOf({
    "1": block(1, 0, 0),
    "2": block(2, 40, 0),
    "3": block(3, 0, 40),
    "4": block(4, 300, 300),
  });

const lossOf = (yard: Yard): number[] => yard.buildings.map((b) => b.maxHp - b.hp);

/** Steps until the first swing of the battle has landed, returns the tick it did. */
const untilFirstHit = (battle: Battle, limit = 3000): number => {
  for (let step = 0; step < limit; step += 1) {
    battle.step();
    if (battle.recentEvents(battle.tick - 1).some((event) => event.kind === "hit")) {
      return battle.tick;
    }
  }
  throw new Error("nothing swung");
};

const dropOf = (id: string, x = 0, y = 0, count = 1): FlingEvent => ({
  kind: "fling",
  t: 0,
  x,
  y,
  r: 10,
  monsters: { [id]: count },
});

const fightFirstSwing = (id: string, rank: number, seed = 7) => {
  const yard = cluster();
  const battle = createBattle(yard, { seed, ranks: { [id]: rank } });
  battle.apply(dropOf(id));
  const tick = untilFirstHit(battle);
  return { yard, battle, tick };
};

describe("the numbers per rank", () => {
  it("reads a rank as a whole number from 0 to 3, and anything else as 0", () => {
    expect(MAX_RANK).toBe(3);
    expect(rankOf({ C4: 2 }, "C4")).toBe(2);
    expect(rankOf({ C4: 2.9 }, "C4")).toBe(2);
    expect(rankOf({ C4: 9 }, "C4")).toBe(3);
    expect(rankOf({ C4: -1 }, "C4")).toBe(0);
    expect(rankOf({ C4: Number.NaN }, "C4")).toBe(0);
    expect(rankOf({}, "C4")).toBe(0);
    expect(rankOf(undefined, "C4")).toBe(0);
  });

  it("gives the Lab screen's figures", () => {
    expect([1, 2, 3].map(finkExtraTargets)).toEqual([1, 2, 3]);
    expect([1, 2, 3].map(wormzerMultiplier)).toEqual([1, 2, 3]);
    expect([1, 2, 3].map(projectXMultiplier)).toEqual([1, 2, 3]);
    expect([1, 2, 3].map(airburstPercent)).toEqual([120, 130, 140]);
    expect([1, 2, 3].map(daveRange)).toEqual([140, 180, 220]);
    expect(FINK_RADIUS).toBe(60);
    expect(WORMZER_RADIUS).toBe(100);
    expect(PROJECT_X_RADIUS).toBe(60);
  });

  it("stretches Eye-ra's two blast radii by the same percentage, in whole pixels", () => {
    expect([1, 2, 3].map((rank) => airburstRadius(AIRBURST_BUILDING_RADIUS, rank))).toEqual([
      72, 78, 84,
    ]);
    expect([1, 2, 3].map((rank) => airburstRadius(AIRBURST_CREEP_RADIUS, rank))).toEqual([
      108, 117, 126,
    ]);
  });
});

describe("where the ranks come from", () => {
  it("reads them off a save's academy, 1 to 3, and leaves out an unranked monster", () => {
    expect(
      academyRanks({
        C1: { level: 3 },
        C4: { level: 4, powerup: 2 },
        C13: { level: 5, powerup: 7 },
        C5: { level: 2, powerup: 0 },
        C9: null,
      }),
    ).toEqual({ C4: 2, C13: 3 });
    expect(academyRanks(null)).toEqual({});
  });

  it("serves a defender's ranks only when it has researched something", () => {
    const save = { buildingdata: {}, champion: null };
    expect(defenderForcesOf({ ...save, academy: { C4: { level: 2 } } })).not.toHaveProperty(
      "defenderRanks",
    );
    expect(defenderForcesOf({ ...save, academy: { C4: { level: 2, powerup: 1 } } })).toMatchObject({
      defenderRanks: { C4: 1 },
    });
  });

  it("keeps them through the attack session's copy of the defence", () => {
    const forces = defenderForcesOf({
      buildingdata: { "5": { id: 5, t: 22, l: 1, X: 0, Y: 0, m: { C4: 2 } } },
      champion: null,
      academy: { C4: { level: 2, powerup: 3 } },
    });
    const parsed = parseDefenderForces(JSON.parse(JSON.stringify(forces)));
    expect(parsed?.defenderRanks).toEqual({ C4: 3 });
  });

  it("hands the battle the defender's ranks only for bunkers to use", () => {
    const base = { defenderLevels: {}, defenderChampions: [], defenderRanks: { C4: 2 } };
    expect(battleDefence({ ...base, bunkers: {} })).not.toHaveProperty("defenderRanks");
    expect(battleDefence({ ...base, bunkers: { 5: { C4: 1 } } })).toMatchObject({
      defenderRanks: { C4: 2 },
    });
  });
});

describe("Fink's extra targets", () => {
  const hpLoss = (rank: number) => lossOf(fightFirstSwing("C4", rank).yard);
  const swing = monsterStat("C4", "damage", 1);

  it("hits only its target at rank 0", () => {
    expect(hpLoss(0)).toEqual([swing, 0, 0, 0]);
  });

  it("splashes one, two, then no more than two buildings within 60 at full damage", () => {
    const hurt = (rank: number) => hpLoss(rank).filter((loss) => loss > 0);
    expect(hurt(1)).toEqual([swing, swing]);
    expect(hurt(2)).toEqual([swing, swing, swing]);
    // Rank 3 has a third extra target to give and nothing else within 60.
    expect(hurt(3)).toEqual([swing, swing, swing]);
    expect(hpLoss(3)[3]).toBe(0);
  });

  it("starts the same battle as rank 0, swing for swing", () => {
    expect(fightFirstSwing("C4", 1).tick).toBe(fightFirstSwing("C4", 0).tick);
  });
});

describe("Wormzer's splash damage", () => {
  const swing = monsterStat("C13", "damage", 1);

  it("hits only its target at rank 0", () => {
    expect(lossOf(fightFirstSwing("C13", 0).yard)).toEqual([swing, 0, 0, 0]);
  });

  it.each([1, 2, 3])("splashes within 100 for the swing times rank %i, falling off", (rank) => {
    const { yard, battle } = fightFirstSwing("C13", rank);
    const worm = battle.creeps().find((creep) => creep.monsterId === "C13")!;
    const at = rangePointOf(worm.ix, worm.iy);
    const expected = yard.buildings.map((building, index) => {
      const squared = Math.trunc((at.x - building.cx) ** 2 + (at.y - building.cy) ** 2);
      const splash = linearAreaDamage(swing * wormzerMultiplier(rank), 100, 0, Math.sqrt(squared));
      return (index === 0 ? swing : 0) + (splash ?? 0);
    });
    expect(lossOf(yard)).toEqual(expected);
    // The neighbours really were reached, and the one far off was not.
    expect(expected[1]).toBeGreaterThan(0);
    expect(expected[3]).toBe(0);
  });

  it("splashes once per target in a row, not on every swing at the same building", () => {
    const yard = cluster();
    const battle = createBattle(yard, { seed: 7, ranks: { C13: 1 } });
    battle.apply(dropOf("C13"));
    untilFirstHit(battle);
    const afterFirst = lossOf(yard);
    // The next swing lands on the same building, so it must not splash again.
    const first = battle.tick;
    let hits = 0;
    for (let step = 0; step < 3000 && hits < 1; step += 1) {
      battle.step();
      if (battle.recentEvents(battle.tick - 1).some((event) => event.kind === "hit")) hits += 1;
    }
    expect(battle.tick).toBeGreaterThan(first);
    const afterSecond = lossOf(yard);
    expect(afterSecond[0]).toBeGreaterThan(afterFirst[0]!);
    expect(afterSecond.slice(1)).toEqual(afterFirst.slice(1));
  });
});

describe("Project X's death blast", () => {
  /** Cannons that kill it on the way in, and three blocks where it falls. */
  const field = () =>
    yardOf({
      "1": block(1, 30, -60),
      "2": block(2, -10, -80),
      "3": block(3, 40, -120),
      "5": { id: 5, t: 20, l: 6, X: 120, Y: 120 },
      "6": { id: 6, t: 20, l: 6, X: -120, Y: 120 },
      "7": { id: 7, t: 20, l: 6, X: 120, Y: -120 },
    });

  const fall = (rank: number) => {
    const yard = field();
    const battle = createBattle(yard, { seed: 7, ranks: { C11: rank } });
    battle.apply(dropOf("C11"));
    for (let step = 0; step < 6000 && !battle.over(); step += 1) {
      battle.step();
      const death = battle.recentEvents(battle.tick - 1).find((event) => event.kind === "death");
      if (death?.kind === "death") return { yard, battle, death };
    }
    throw new Error("Project X never fell");
  };

  it("leaves nothing behind at rank 0", () => {
    expect(lossOf(fall(0).yard)).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it.each([1, 2, 3])("blasts 60 round it for its damage times %i, falling off", (rank) => {
    const { yard, death } = fall(rank);
    const at = rangePointOf(death.ix, death.iy);
    const blast = monsterStat("C11", "damage", 1) * projectXMultiplier(rank);
    const expected = yard.buildings.map((building) => {
      const squared = Math.trunc((at.x - building.cx) ** 2 + (at.y - building.cy) ** 2);
      return linearAreaDamage(blast, 60, 0, Math.sqrt(squared)) ?? 0;
    });
    expect(lossOf(yard)).toEqual(expected);
    expect(expected.filter((loss) => loss > 0).length).toBeGreaterThan(1);
  });

  it("falls on the same tick whatever the rank", () => {
    expect(fall(2).battle.tick).toBe(fall(0).battle.tick);
  });
});

describe("Eye-ra's airburst", () => {
  const swing = monsterStat("C5", "damage", 1);

  const burst = (ranks?: MonsterRanks) => {
    const yard = cluster();
    const options: BattleOptions = { seed: 7, ...(ranks ? { ranks } : {}) };
    const battle = createBattle(yard, options);
    battle.apply(dropOf("C5"));
    let death;
    for (let step = 0; step < 3000 && !death; step += 1) {
      battle.step();
      death = battle.recentEvents(battle.tick - 1).find((event) => event.kind === "death");
    }
    if (death?.kind !== "death") throw new Error("Eye-ra never burst");
    return { yard, death };
  };

  it("is the old blast at rank 0, with or without a ranks input", () => {
    expect(lossOf(burst({ C5: 0 }).yard)).toEqual(lossOf(burst().yard));
  });

  it.each([1, 2, 3])("adds %i0 and 10 per cent to the target, and reaches further", (rank) => {
    const { yard, death } = burst({ C5: rank });
    const boosted = (swing * airburstPercent(rank)) / 100;
    expect(yard.buildings[0]!.maxHp - yard.buildings[0]!.hp).toBe(boosted);
    const at = rangePointOf(death.ix, death.iy);
    const radius = airburstRadius(AIRBURST_BUILDING_RADIUS, rank);
    yard.buildings.slice(1).forEach((building) => {
      const squared = (at.x - 5 - building.cx) ** 2 + (at.y - 5 - building.cy) ** 2;
      const share =
        squared < radius * radius
          ? Math.trunc((boosted * (radius * radius - squared)) / (radius * radius))
          : 0;
      expect(building.maxHp - building.hp).toBe(share);
    });
  });
});

describe("D.A.V.E.'s rocket range", () => {
  /** The tick of the first hit on a block 1,000 yard units off, dropped 600 from it. */
  const reachedAt = (rank: number) => {
    const yard = yardOf({ "1": block(1, 0, 0) });
    const battle = createBattle(yard, { seed: 3, ranks: { C12: rank } });
    battle.apply(dropOf("C12", -600, 0));
    return untilFirstHit(battle, 6000);
  };

  it("starts swinging from further off with each rank, and has to walk up at rank 0", () => {
    const ticks = [0, 1, 2, 3].map(reachedAt);
    expect(ticks[0]).toBeGreaterThan(ticks[1]!);
    expect(ticks[1]).toBeGreaterThan(ticks[2]!);
    expect(ticks[2]).toBeGreaterThan(ticks[3]!);
  });
});

describe("a bunker's monsters fight at the defender's rank", () => {
  /** A bunker holding a Wormzer sends it at a dozen Pokeys dropped beside a harvester in its range. */
  const fight = (options: Partial<BattleOptions>) => {
    const yard = yardOf({
      "1": { id: 1, t: 22, l: 1, X: 0, Y: 0 },
      "2": { id: 2, t: 1, l: 1, X: 150, Y: 150 },
    });
    const battle = createBattle(yard, { seed: 3, bunkers: { 1: { C13: 1 } }, ...options });
    battle.apply(dropOf("C1", 130, 130, 12));
    // The attackers' health every half second, so the trace shows the fight, not only its end.
    const trace: number[][] = [];
    for (let step = 0; step < 400; step += 1) {
      battle.step();
      if (step % 20 === 0) {
        trace.push(
          battle
            .creeps()
            .filter((creep) => !creep.friendly)
            .map((creep) => creep.hp),
        );
      }
    }
    return trace;
  };

  it("splashes the attackers with the defender's rank, not the attacker's", () => {
    const plain = fight({});
    const ranked = fight({ defenderRanks: { C13: 3 } });
    const attackersRanked = fight({ ranks: { C13: 3 } });
    expect(ranked).not.toEqual(plain);
    expect(attackersRanked).toEqual(plain);
  });
});

describe("the same battle on the server", () => {
  const log = {
    v: 1 as const,
    seed: 11,
    events: [dropOf("C13", 0, 0, 2), dropOf("C4", 20, 20, 2), dropOf("C11", 10, -10, 1)],
  };
  const input = {
    buildingdata: {
      "1": block(1, 0, 0),
      "2": block(2, 40, 0),
      "3": block(3, 0, 40),
      "5": { id: 5, t: 20, l: 6, X: 120, Y: 120 },
    },
    log,
    tailTicks: 3000,
  };

  it("replays identically with the same ranks", () => {
    const ranks = { C13: 3, C4: 2, C11: 1 };
    const one = replayAttack({ ...input, ranks });
    const two = replayAttack({ ...input, ranks });
    expect(two.digest).toBe(one.digest);
    expect(two.checkpoints).toEqual(one.checkpoints);
  });

  it("is a different battle with ranks than without, and the same without as with rank 0", () => {
    const plain = replayAttack(input);
    expect(replayAttack({ ...input, ranks: { C13: 0, C4: 0, C11: 0 } }).digest).toBe(plain.digest);
    expect(replayAttack({ ...input, ranks: { C13: 3 } }).digest).not.toBe(plain.digest);
  });
});
