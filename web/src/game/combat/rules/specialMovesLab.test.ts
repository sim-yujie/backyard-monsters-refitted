import { describe, expect, it } from "vitest";

import { createBattle, type Battle, type BattleVisualEvent, type CreepSnapshot } from "./engine.js";
import { replayAttack } from "./replay.js";
import {
  BANDITO_RADIUS,
  BLINK_HOPS,
  BOUNCE_RADIUS,
  banditoSpeedPercent,
  blinkRange,
  blinkRouteLimit,
  bounceCount,
  cloakDelaySeconds,
  venomShare,
} from "./specialMoves.js";
import { TICKS_PER_SECOND, monsterAttackDelay, monsterStat } from "./stats.js";
import type { CombatBuildingDataMap, FlingEvent } from "./types.js";
import { buildEngineYard } from "./yard.js";

/**
 * The Monster Lab's special moves, second package (issue #352): Bolt's blink,
 * Brain's cloak, Bandito's whirlwind, Fang's venom and Teratorn's bounces. Rank
 * 0 is always the plain monster.
 */

const yardOf = (buildings: CombatBuildingDataMap) =>
  buildEngineYard({
    buildingdata: buildings,
    buildinghealthdata: {},
    resources: { r1: 100000, r2: 0, r3: 0, r4: 0 },
  });

type Yard = ReturnType<typeof yardOf>;

/** Level 5 Town Hall-sized targets (type 1, 6,500 health): sturdy enough to outlast many swings. */
const block = (id: number, X: number, Y: number) => ({ id, t: 1, l: 5, X, Y });

const lossOf = (yard: Yard): number[] => yard.buildings.map((b) => b.maxHp - b.hp);

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
  each: (creeps: readonly CreepSnapshot[], events: readonly BattleVisualEvent[]) => void,
): void => {
  for (let step = 0; step < ticks && !battle.over(); step += 1) {
    const before = battle.tick;
    battle.step();
    each(battle.creeps(), battle.recentEvents(before));
  }
};

describe("the numbers per rank", () => {
  it("gives the Lab screen's figures", () => {
    expect([1, 2, 3].map(blinkRange)).toEqual([150, 300, 450]);
    expect([1, 2, 3].map(blinkRouteLimit)).toEqual([5, 10, 15]);
    expect(BLINK_HOPS).toBe(10);
    expect([1, 2, 3].map(cloakDelaySeconds)).toEqual([0, 4, 8]);
    expect([1, 2, 3].map(banditoSpeedPercent)).toEqual([100, 150, 200]);
    expect(BANDITO_RADIUS).toBe(60);
    expect([1, 2, 3].map(venomShare)).toEqual([0.1, 0.2, 0.3]);
    expect([1, 2, 3].map(bounceCount)).toEqual([1, 2, 3]);
    expect(BOUNCE_RADIUS).toBe(100);
  });
});

describe("Bandito's whirlwind", () => {
  const cluster = () =>
    yardOf({
      "1": block(1, 0, 0),
      "2": block(2, 20, 0),
      "3": block(3, 0, 20),
      "4": block(4, 20, 20),
      "5": block(5, 10, 10),
      "6": block(6, 300, 300),
    });

  /** The first swing's splash: what each building lost and the splash note. */
  const firstSwing = (rank: number) => {
    const yard = cluster();
    const battle = createBattle(yard, { seed: 7, ranks: { C7: rank } });
    battle.apply(dropOf("C7"));
    let splashes = 0;
    for (let step = 0; step < 3000; step += 1) {
      const before = battle.tick;
      battle.step();
      const events = battle.recentEvents(before);
      splashes += events.filter((event) => event.kind === "splash").length;
      if (events.some((event) => event.kind === "hit")) break;
    }
    return { yard, splashes };
  };

  const swing = monsterStat("C7", "damage", 1);

  it("hits only its target at rank 0", () => {
    const { yard, splashes } = firstSwing(0);
    const hurt = lossOf(yard).filter((loss) => loss > 0);
    expect(hurt).toHaveLength(1);
    expect(splashes).toBe(0);
  });

  it.each([1, 2, 3])("splashes every other building within 60 at full damage, rank %i", (rank) => {
    const { yard } = firstSwing(rank);
    const hurt = lossOf(yard).filter((loss) => loss > 0);
    // The target and its neighbours, no cap, each for the whole swing.
    expect(hurt.length).toBeGreaterThanOrEqual(3);
    for (const loss of hurt) expect(loss % swing).toBe(0);
    expect(lossOf(yard)[5]).toBe(0);
  });

  it("splashes the same at every rank, whatever the speed", () => {
    expect(lossOf(firstSwing(1).yard)).toEqual(lossOf(firstSwing(3).yard));
  });

  it("spins at 1, 1.5 and 2 x the plain swing rate", () => {
    const gap = (rank: number): number => {
      const battle = createBattle(cluster(), { seed: 7, ranks: { C7: rank } });
      battle.apply(dropOf("C7"));
      const swings: number[] = [];
      watch(battle, 1500, (_creeps, events) => {
        if (events.some((event) => event.kind === "hit")) swings.push(battle.tick);
      });
      return (swings[2] ?? 0) - (swings[1] ?? 0);
    };
    const delay = monsterAttackDelay("C7", 1);
    // A swing every `delay` ticks of countdown plus the swing's own tick.
    const expected = (percent: number) => Math.trunc(delay / (percent / 100)) + 1;
    expect(gap(1)).toBe(expected(100));
    expect(gap(2)).toBe(expected(150));
    expect(gap(3)).toBe(expected(200));
    expect(gap(0)).toBe(expected(100));
  });
});

describe("Fang's venom", () => {
  /** A bunker holding a sturdy Ghoul-like brute, and Fangs dropped beside it. */
  const fight = (rank: number, fangs = 1) => {
    const yard = yardOf({
      "1": { id: 1, t: 22, l: 1, X: 0, Y: 0 },
      "2": block(2, 150, 150),
    });
    const battle = createBattle(yard, { seed: 3, bunkers: { 1: { C10: 1 } }, ranks: { C8: rank } });
    battle.apply(dropOf("C8", 130, 130, fangs, 10));
    return battle;
  };

  const foeOf = (creeps: readonly CreepSnapshot[]) => creeps.find((creep) => creep.friendly);

  it("poisons nothing at rank 0", () => {
    const battle = fight(0);
    let stacks = 0;
    watch(battle, 800, (creeps) => {
      stacks = Math.max(stacks, ...creeps.map((creep) => creep.poisonStacks ?? 0));
    });
    expect(stacks).toBe(0);
  });

  it.each([1, 2, 3])("adds a stack a bite and hurts every half second for stacks x damage x %i/10", (rank) => {
    const battle = fight(rank);
    const damage = monsterStat("C8", "damage", 1);
    let top = 0;
    const bites: { tick: number; amount: number; stacks: number }[] = [];
    let before = 0;
    watch(battle, 1200, (creeps, events) => {
      const foe = foeOf(creeps);
      const stacks = foe?.poisonStacks ?? 0;
      top = Math.max(top, stacks);
      if (foe) {
        for (const event of events) {
          if (event.kind === "hurt" && event.friendly && event.amount !== damage) {
            bites.push({ tick: battle.tick, amount: event.amount, stacks: before });
          }
        }
        before = stacks;
      }
    });
    expect(top).toBeGreaterThanOrEqual(2);
    expect(bites.length).toBeGreaterThan(0);
    for (const bite of bites) {
      expect(bite.amount).toBeCloseTo((bite.stacks * damage * rank) / 10, 6);
    }
    // One bite every 40 loops (half a second).
    if (bites.length > 1) {
      for (let at = 1; at < bites.length; at += 1) {
        expect((bites[at]?.tick ?? 0) - (bites[at - 1]?.tick ?? 0)).toBe(TICKS_PER_SECOND / 2);
      }
    }
  });

  it("never wears off and ends with the creep's death", () => {
    const battle = fight(1, 10);
    let seen = 0;
    let lastStacks = 0;
    let died = false;
    watch(battle, 3000, (creeps, events) => {
      const foe = foeOf(creeps);
      if (foe?.poisonStacks) {
        // Stacks only ever go up while it lives.
        expect(foe.poisonStacks).toBeGreaterThanOrEqual(lastStacks);
        lastStacks = foe.poisonStacks;
        seen += 1;
      }
      if (events.some((event) => event.kind === "death" && event.friendly)) died = true;
    });
    expect(seen).toBeGreaterThan(0);
    expect(died).toBe(true);
  });

  it("leaves a building unpoisoned", () => {
    const yard = yardOf({ "1": block(1, 0, 0) });
    const battle = createBattle(yard, { seed: 3, ranks: { C8: 3 } });
    battle.apply(dropOf("C8", 0, 0, 1, 10));
    let stacks = 0;
    watch(battle, 600, (creeps) => {
      stacks = Math.max(stacks, ...creeps.map((creep) => creep.poisonStacks ?? 0));
    });
    expect(stacks).toBe(0);
    expect(lossOf(yard)[0]).toBeGreaterThan(0);
  });
});

describe("Brain's cloak", () => {
  /** A Cannon Tower with a Brain dropped well outside its range. */
  const scene = (rank: number) => {
    const yard = yardOf({ "1": { id: 1, t: 20, l: 1, X: 0, Y: 0 } });
    const battle = createBattle(yard, { seed: 5, ranks: { C9: rank } });
    battle.apply(dropOf("C9", -300, -300, 1, 0));
    return { yard, battle };
  };

  const timeline = (rank: number) => {
    const { battle } = scene(rank);
    let invisibleFrom = -1;
    let invisibleTo = -1;
    let arrived = -1;
    let shotsWhileHidden = 0;
    let lastShots = 0;
    watch(battle, 2500, (creeps) => {
      const brain = creeps.find((creep) => creep.monsterId === "C9");
      if (!brain) return;
      const shots = battle.state().towers[0]?.shots ?? 0;
      if (brain.invisible) {
        if (invisibleFrom < 0) invisibleFrom = battle.tick;
        invisibleTo = battle.tick;
        shotsWhileHidden += shots - lastShots;
        if (arrived < 0 && brain.state === "attacking") arrived = battle.tick;
      }
      lastShots = shots;
    });
    return { invisibleFrom, invisibleTo, arrived, shotsWhileHidden };
  };

  it("is shot at rank 0 as it walks in", () => {
    const { battle } = scene(0);
    let invisible = false;
    watch(battle, 2500, (creeps) => {
      if (creeps.some((creep) => creep.invisible)) invisible = true;
    });
    expect(invisible).toBe(false);
    expect(battle.state().towers[0]?.shots).toBeGreaterThan(0);
  });

  it.each([1, 2, 3])("is unseen while it walks and for the delay after, rank %i", (rank) => {
    const { invisibleFrom, invisibleTo, arrived, shotsWhileHidden } = timeline(rank);
    expect(invisibleFrom).toBeGreaterThan(0);
    expect(arrived).toBeGreaterThan(invisibleFrom);
    expect(shotsWhileHidden).toBe(0);
    const stayed = invisibleTo - arrived;
    const wanted = cloakDelaySeconds(rank) * TICKS_PER_SECOND;
    expect(Math.abs(stayed - wanted)).toBeLessThanOrEqual(2);
  });

  it("is seen by a trap, which reaches the invisible", () => {
    const yard = yardOf({
      "1": { id: 1, t: 20, l: 1, X: 0, Y: 0 },
      "2": { id: 2, t: 24, l: 1, X: -100, Y: -100 },
    });
    const battle = createBattle(yard, { seed: 5, ranks: { C9: 3 } });
    battle.apply(dropOf("C9", -110, -110, 1, 0));
    watch(battle, 600, () => undefined);
    expect(yard.buildings[1]?.fired).toBe(true);
  });

  it("cannot be fought by a bunker's monsters while it is cloaked", () => {
    const hurt = (rank: number) => {
      const yard = yardOf({
        "1": { id: 1, t: 22, l: 1, X: 0, Y: 0 },
        "2": block(2, 150, 150),
      });
      const battle = createBattle(yard, { seed: 3, bunkers: { 1: { C10: 1 } }, ranks: { C9: rank } });
      battle.apply(dropOf("C9", 300, 300, 1, 0));
      let whileHidden = 0;
      let total = 0;
      watch(battle, 1500, (creeps, events) => {
        const brain = creeps.find((creep) => !creep.friendly);
        const taken = events.filter((event) => event.kind === "hurt" && !event.friendly).length;
        total += taken;
        if (brain?.invisible) whileHidden += taken;
      });
      return { whileHidden, total };
    };
    // Plain, the bunker's monster fights it; cloaked, it is left alone.
    expect(hurt(0).total).toBeGreaterThan(0);
    expect(hurt(3).whileHidden).toBe(0);
  });
});

describe("Bolt's blink", () => {
  const scene = (rank: number, drop = -60) => {
    const yard = yardOf({ "1": { id: 1, t: 20, l: 1, X: 0, Y: 0 } });
    const battle = createBattle(yard, { seed: 5, ranks: { C3: rank } });
    battle.apply(dropOf("C3", drop, drop, 1, 0));
    return { yard, battle };
  };

  it("walks the whole way at rank 0", () => {
    const { battle } = scene(0);
    let blinking = false;
    let blinks = 0;
    watch(battle, 1500, (creeps, events) => {
      if (creeps.some((creep) => creep.blinking)) blinking = true;
      blinks += events.filter((event) => event.kind === "blink").length;
    });
    expect(blinking).toBe(false);
    expect(blinks).toBe(0);
  });

  it.each([1, 2, 3])("hops ten times, untargetable, and arrives, rank %i", (rank) => {
    const { battle } = scene(rank, -40 * rank);
    const hops: { hop: number; ix: number; iy: number }[] = [];
    let blinkingTicks = 0;
    let shotsWhileBlinking = 0;
    let lastShots = 0;
    let arrivedAfter = false;
    watch(battle, 1500, (creeps, events) => {
      const bolt = creeps.find((creep) => creep.monsterId === "C3");
      const shots = battle.state().towers[0]?.shots ?? 0;
      if (bolt?.blinking) {
        blinkingTicks += 1;
        shotsWhileBlinking += shots - lastShots;
      }
      lastShots = shots;
      for (const event of events) {
        if (event.kind === "blink") hops.push({ hop: event.hop, ix: event.ix, iy: event.iy });
      }
      if (hops.length === BLINK_HOPS && bolt?.state === "attacking") arrivedAfter = true;
    });
    expect(hops.map((hop) => hop.hop)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    // The start of the blink and the ten hops.
    expect(blinkingTicks).toBe(BLINK_HOPS);
    expect(shotsWhileBlinking).toBe(0);
    expect(arrivedAfter).toBe(true);
  });

  it("gets to the tower sooner than walking would", () => {
    const firstHit = (rank: number): number => {
      const { battle } = scene(rank, -100);
      let at = -1;
      watch(battle, 3000, (_creeps, events) => {
        if (at < 0 && events.some((event) => event.kind === "hit")) at = battle.tick;
      });
      return at;
    };
    expect(firstHit(1)).toBeGreaterThan(0);
    expect(firstHit(1)).toBeLessThan(firstHit(0));
  });
});

describe("Teratorn's bounces", () => {
  const swing = monsterStat("C14", "damage", 1);

  /** A row of buildings 60 apart, a wall beside the first, and a far one. */
  const row = () =>
    yardOf({
      "1": block(1, 0, 0),
      "2": block(2, 60, 0),
      "3": block(3, 120, 0),
      "4": block(4, 180, 0),
      "5": { id: 5, t: 17, l: 1, X: 0, Y: 60 },
      "6": block(6, 300, 300),
    });

  const firstFireball = (rank: number) => {
    const yard = row();
    const battle = createBattle(yard, { seed: 9, ranks: { C14: rank } });
    battle.apply(dropOf("C14", -40, 0, 1, 0));
    const bounces: Extract<BattleVisualEvent, { kind: "bounce" }>[] = [];
    let landed = false;
    watch(battle, 1500, (_creeps, events) => {
      if (landed) return;
      for (const event of events) {
        if (event.kind === "bounce") bounces.push(event);
      }
      landed = events.some((event) => event.kind === "hit");
    });
    return { yard, bounces };
  };

  it("lands on one building at rank 0", () => {
    const { yard, bounces } = firstFireball(0);
    expect(bounces).toHaveLength(0);
    expect(lossOf(yard).filter((loss) => loss > 0)).toHaveLength(1);
  });

  it.each([1, 2, 3])("jumps %i time(s), half the last each, never to a wall", (rank) => {
    const { yard, bounces } = firstFireball(rank);
    expect(bounces).toHaveLength(rank);
    let expected = swing;
    for (const bounce of bounces) {
      expected /= 2;
      expect(bounce.amount).toBeCloseTo(expected, 6);
      expect(bounce.toBuildingId).not.toBe(5);
      expect(bounce.toBuildingId).not.toBe(6);
    }
    // Each jump starts where the last one landed.
    for (let at = 1; at < bounces.length; at += 1) {
      expect(bounces[at]?.fromBuildingId).toBe(bounces[at - 1]?.toBuildingId);
    }
    // The wall was never touched by the fireball.
    expect(lossOf(yard)[4]).toBe(0);
  });

  it("stops when no building is within 100", () => {
    const yard = yardOf({ "1": block(1, 0, 0), "2": block(2, 400, 400) });
    const battle = createBattle(yard, { seed: 9, ranks: { C14: 3 } });
    battle.apply(dropOf("C14", -40, 0, 1, 0));
    let bounces = 0;
    watch(battle, 800, (_creeps, events) => {
      bounces += events.filter((event) => event.kind === "bounce").length;
    });
    expect(bounces).toBe(0);
  });
});

describe("the same battle on the server", () => {
  const log = {
    v: 1 as const,
    seed: 11,
    events: [
      dropOf("C3", -80, -80, 2),
      dropOf("C7", 0, 0, 2, 10),
      dropOf("C8", 20, 20, 2, 10),
      dropOf("C9", -60, 60, 2, 10),
      dropOf("C14", 10, -10, 2, 10),
    ],
  };
  const input = {
    buildingdata: {
      "1": block(1, 0, 0),
      "2": block(2, 60, 0),
      "3": block(3, 0, 60),
      "5": { id: 5, t: 20, l: 6, X: 120, Y: 120 },
      "6": { id: 6, t: 22, l: 1, X: 150, Y: 0 },
    },
    log,
    tailTicks: 3000,
  };
  const ranks = { C3: 3, C7: 2, C8: 3, C9: 2, C14: 3 };

  it("replays identically with the same ranks", () => {
    const one = replayAttack({ ...input, ranks });
    const two = replayAttack({ ...input, ranks });
    expect(two.digest).toBe(one.digest);
    expect(two.checkpoints).toEqual(one.checkpoints);
  });

  it("is a different battle with ranks than without, and the same with rank 0", () => {
    const plain = replayAttack(input);
    const zero = replayAttack({ ...input, ranks: { C3: 0, C7: 0, C8: 0, C9: 0, C14: 0 } });
    expect(zero.digest).toBe(plain.digest);
    expect(replayAttack({ ...input, ranks }).digest).not.toBe(plain.digest);
  });
});
