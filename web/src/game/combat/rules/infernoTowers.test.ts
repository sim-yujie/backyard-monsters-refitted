import { describe, expect, it } from "vitest";

import { createBattle } from "./engine.js";
import {
  QUAKE_ANIM_FRAMES,
  QUAKE_FRAME_TICKS,
  maxHp,
  quakeDamage,
  towerStats,
} from "./stats.js";
import { QUAKE_REACH_SHARE, towerPerTick } from "./stance.js";
import { buildEngineYard } from "./yard.js";
import type { CombatBuildingDataMap } from "./types.js";

/**
 * The Inferno's two towers against Flash's numbers (Inferno plan WP 1.3, 1.4).
 *
 * The Quake Tower (`client/scripts/INFERNOQUAKETOWER.as`): its range and
 * damage from the props, its quake's fall-off, and the wind-up between `Fire`
 * and the quake. The Magma Tower (`INFERNO_MAGMA_TOWER.as`): a plain tower
 * that lobs one magma fireball at a time.
 */

const yardOf = (buildings: CombatBuildingDataMap, health?: Record<string, number>) =>
  buildEngineYard({
    buildingdata: buildings,
    buildinghealthdata: health ?? {},
    resources: { r1: 100000, r2: 0, r3: 0, r4: 0 },
  });

interface TowerBattleOptions {
  readonly level?: number;
  readonly health?: Record<string, number>;
  readonly overdrive?: boolean;
}

/** A level `level` tower of `type` and a harvester beside it, where `monsters` land. */
const towerBattle = (
  type: number,
  monsters: Record<string, number>,
  options: TowerBattleOptions = {},
) => {
  const yard = yardOf(
    {
      "1": { id: 1, t: type, l: options.level ?? 1, X: 0, Y: 0 },
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

const quakeBattle = (monsters: Record<string, number>, options: TowerBattleOptions = {}) =>
  towerBattle(129, monsters, options);

const magmaBattle = (monsters: Record<string, number>, options: TowerBattleOptions = {}) =>
  towerBattle(132, monsters, options);

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

/** The ticks the tower fired on, and each hurt with its tick, over `ticks`. */
const shotsAndHurts = (battle: ReturnType<typeof createBattle>, ticks: number) => {
  const shots: number[] = [];
  const hurts: { tick: number; amount: number }[] = [];
  for (let step = 0; step < ticks && !battle.over(); step += 1) {
    battle.step();
    for (const event of battle.recentEvents(battle.tick - 1)) {
      if (event.kind === "shot") shots.push(event.tick);
      if (event.kind === "hurt") hurts.push({ tick: event.tick, amount: event.amount });
    }
  }
  return { shots, hurts };
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

describe("the Magma Tower (`INFERNO_MAGMA_TOWER.as`)", () => {
  it("reaches 180 to 230 and burns for 180 to 480, re-arming at 20", () => {
    expect([1, 2, 3, 4, 5, 6].map((level) => towerStats(132, level)?.range)).toEqual([
      180, 190, 200, 210, 220, 230,
    ]);
    expect([1, 2, 3, 4, 5, 6].map((level) => towerStats(132, level)?.damage)).toEqual([
      180, 240, 300, 360, 420, 480,
    ]);
    expect(towerStats(132, 1)?.rate).toBe(20);
    expect(towerStats(132, 1)?.splash).toBe(0);
  });

  it("fires 20 + 30 ticks in, then every rate x 2, its whole damage at full health", () => {
    const { shots, hurts } = shotsAndHurts(magmaBattle({ C12: 1 }), 400);
    // `Props()` seeds the fire tick with `rate`; the first reload finds the
    // target and waits 30 (`BTOWER.as:184-190`); then one shot every 40.
    expect(shots).toEqual([50, 90, 130, 170, 210, 250, 290, 330, 370]);
    // Each `FIREBALL` lands some ticks on (fidelity note 1), all of it on the target.
    expect(hurts.map((hurt) => hurt.amount)).toEqual(shots.map(() => 180));
    hurts.forEach((hurt, at) => expect(hurt.tick).toBeGreaterThan(shots[at]!));
  });

  it("is weakened by its own health, as the other towers are (`:62`)", () => {
    const half = maxHp(132, 1) / 2;
    const hits = [...quakes(magmaBattle({ C12: 1 }, { health: { "1": half } }), 100).values()];
    // int(180 * (0.5 + 0.5 * 0.5)).
    expect(hits[0]).toEqual([135]);
  });

  it("shoots flyers as well as walkers (flyer mode 1)", () => {
    const hits = [...quakes(magmaBattle({ C15: 1 }), 100).values()];
    expect(hits).toEqual([[180], [180]]);
  });

  it("hits one creep a shot, with no splash and no burn after", () => {
    const hits = quakes(magmaBattle({ C1: 4 }), 400);
    for (const amounts of hits.values()) expect(amounts).toHaveLength(1);
    // The magma's `FlameEffect` hangs off `onProjectileCollision`, which
    // nothing ever listens with (`:81-89`), so a creep takes nothing between
    // shots: no more hurts than shells, one apiece.
    const { shots, hurts } = shotsAndHurts(magmaBattle({ C1: 4 }), 400);
    expect(hurts.length).toBeGreaterThan(0);
    expect(hurts.length).toBeLessThanOrEqual(shots.length);
  });

  it("burns a quarter harder under Tower Overdrive", () => {
    const hits = [...quakes(magmaBattle({ C12: 1 }, { overdrive: true }), 100).values()];
    expect(hits[0]).toEqual([225]);
  });
});
