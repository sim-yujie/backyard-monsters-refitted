import { describe, expect, it } from "vitest";

import { createBattle } from "./engine.js";
import {
  QUAKE_ANIM_FRAMES,
  QUAKE_FRAME_TICKS,
  quakeDamage,
  towerStats,
} from "./stats.js";
import { QUAKE_REACH_SHARE, towerPerTick } from "./stance.js";
import { buildEngineYard } from "./yard.js";
import type { CombatBuildingDataMap } from "./types.js";

/**
 * The Quake Tower (`client/scripts/INFERNOQUAKETOWER.as`, Inferno plan WP 1.3),
 * against Flash's numbers: its range and damage from the props, its quake's
 * fall-off, and the wind-up between `Fire` and the quake.
 */

const yardOf = (buildings: CombatBuildingDataMap, health?: Record<string, number>) =>
  buildEngineYard({
    buildingdata: buildings,
    buildinghealthdata: health ?? {},
    resources: { r1: 100000, r2: 0, r3: 0, r4: 0 },
  });

/** A level `level` Quake Tower and a harvester beside it, where `monsters` land. */
const quakeBattle = (
  monsters: Record<string, number>,
  options: { level?: number; health?: Record<string, number>; overdrive?: boolean } = {},
) => {
  const yard = yardOf(
    {
      "1": { id: 1, t: 129, l: options.level ?? 1, X: 0, Y: 0 },
      "2": { id: 2, t: 1, l: 1, X: 100, Y: 100 },
    },
    options.health,
  );
  const battle = createBattle(yard, {
    seed: 7,
    ...(options.overdrive ? { buffs: { defender: { towerDamage: true } } } : {}),
  });
  battle.apply({ kind: "fling", t: 0, x: 110, y: 110, r: 0, monsters });
  return battle;
};

/** Every tick a creep was hurt, with what each took; only the tower hurts them here. */
const quakes = (battle: ReturnType<typeof createBattle>, ticks: number) => {
  const out = new Map<number, number[]>();
  for (let step = 0; step < ticks && !battle.over(); step += 1) {
    battle.step();
    for (const event of battle.recentEvents(battle.tick - 1)) {
      if (event.kind !== "hurt" || event.tick !== battle.tick) continue;
      const amounts = out.get(event.tick) ?? [];
      amounts.push(event.amount);
      out.set(event.tick, amounts);
    }
  }
  return out;
};

describe("the Quake Tower's numbers (`YARD_PROPS.as:6886`)", () => {
  it("reaches 160 to 210 and shakes for 1,100 to 4,400, re-arming at 15", () => {
    expect([1, 2, 3, 4, 5, 6].map((level) => towerStats(129, level)?.range)).toEqual([
      160, 170, 180, 190, 200, 210,
    ]);
    expect([1, 2, 3, 4, 5, 6].map((level) => towerStats(129, level)?.damage)).toEqual([
      1100, 1680, 2220, 2880, 3640, 4400,
    ]);
    expect(towerStats(129, 1)?.rate).toBe(15);
  });

  it("has a 33-cell strip that steps every sixth tick", () => {
    expect(QUAKE_ANIM_FRAMES).toBe(33);
    expect(QUAKE_FRAME_TICKS).toBe(6);
  });
});

describe("the quake's fall-off (`INFERNOQUAKETOWER.as:174-179`)", () => {
  it("is whole at the tower, half at half the range", () => {
    expect(quakeDamage(1100, 160, 0, 10_000)).toBe(1100);
    expect(quakeDamage(1100, 160, 80, 10_000)).toBe(550);
  });

  it("truncates the distance and the result", () => {
    // 1100 / 160 * (160 - 33) = 873.125.
    expect(quakeDamage(1100, 160, 33.9, 10_000)).toBe(873);
  });

  it("never falls below a third of the damage", () => {
    expect(quakeDamage(1100, 160, 150, 10_000)).toBe(366);
    expect(quakeDamage(1100, 160, 159.9, 10_000)).toBe(366);
  });

  it("takes no more than the creep has", () => {
    expect(quakeDamage(1100, 160, 0, 200)).toBe(200);
    expect(quakeDamage(1100, 160, 0, 199.5)).toBe(199);
  });
});

describe("the Quake Tower in a battle", () => {
  it("winds up 179 ticks after its first Fire and 174 after each later one", () => {
    const hits = [...quakes(quakeBattle({ C12: 1 }), 1000).keys()];
    // `Props()` seeds the fire tick with `rate` (15); at 0 it finds its target
    // and waits 30; at 0 again it fires, and the wind-up starts (`Fire`, :132).
    // The first wind-up from `_frameNumber` 0 is 6 ticks to the first step,
    // 28 more steps 6 apart, then 4 steps a tick and the quake the tick after:
    // 179. It ends on 179, 5 past a multiple of 6, so every later one is 174.
    // Between them the fire tick, frozen through the wind-up, runs out its 30.
    expect(hits).toEqual([15 + 30 + 179, 224 + 30 + 174, 428 + 204, 632 + 204]);
  });

  it("shakes a whole clump of Pokeys down in one quake", () => {
    const battle = quakeBattle({ C1: 4 });
    const hits = quakes(battle, 400);
    // A Pokey has 200 health; a third of 1,100 is 366, so each takes all it has.
    expect([...hits.values()]).toEqual([[200, 200, 200, 200]]);
    expect(battle.state().towers[0]?.kills).toBe(4);
  });

  it("is not weakened by the tower's own health", () => {
    const whole = [...quakes(quakeBattle({ C12: 1 }), 700).values()];
    const hurt = [...quakes(quakeBattle({ C12: 1 }, { health: { "1": 5000 } }), 700).values()];
    expect(hurt).toEqual(whole);
    for (const [amount] of whole) {
      expect(amount).toBeGreaterThanOrEqual(366);
      expect(amount).toBeLessThanOrEqual(1100);
    }
  });

  it("shakes a quarter harder under Tower Overdrive, cut to a whole number first", () => {
    const [plain] = [...quakes(quakeBattle({ C12: 1 }), 300).values()];
    const [boosted] = [...quakes(quakeBattle({ C12: 1 }, { overdrive: true }), 300).values()];
    // The same creep at the same spot: 1,375 in place of 1,100.
    expect(boosted?.[0]).toBeGreaterThan(plain?.[0] ?? Infinity);
    expect(Math.abs((boosted?.[0] ?? 0) - (plain?.[0] ?? 0) * 1.25)).toBeLessThanOrEqual(2);
  });

  it("leaves flyers alone: it neither picks them nor shakes them", () => {
    const battle = quakeBattle({ C15: 1 });
    expect(quakes(battle, 800).size).toBe(0);
    expect(battle.state().towers[0]?.shots).toBe(0);
  });

  it("counts each quake as one shot", () => {
    const battle = quakeBattle({ C12: 1 });
    quakes(battle, 700);
    expect(battle.state().towers[0]?.shots).toBe(3);
  });
});

describe("the champion's read of a Quake Tower (stance)", () => {
  it("averages the fall-off over the reach to 35/81", () => {
    // A fine grid over the disc, against the engine's own fall-off.
    const range = 1000;
    let sum = 0;
    let cells = 0;
    for (let x = -range; x <= range; x += 4) {
      for (let y = -range; y <= range; y += 4) {
        const dist = Math.sqrt(x * x + y * y);
        if (dist >= range) continue;
        sum += quakeDamage(1_000_000, range, dist, Infinity) / 1_000_000;
        cells += 1;
      }
    }
    expect(sum / cells).toBeCloseTo(QUAKE_REACH_SHARE, 2);
  });

  it("is one quake every reload and wind-up, whatever the tower's health", () => {
    const expected = (1100 * QUAKE_REACH_SHARE) / (15 * 2 + 174);
    expect(towerPerTick(129, 1, 1100, 15, 2, 10_000, 10_000)).toBeCloseTo(expected, 9);
    expect(towerPerTick(129, 1, 1100, 15, 2, 2_000, 10_000)).toBeCloseTo(expected, 9);
  });
});
