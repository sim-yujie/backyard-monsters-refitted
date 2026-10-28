import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { linearAreaDamage } from "./champions";
import {
  DECOY_BUILDING_REACH,
  DECOY_FALL_TICKS,
  DECOY_FLYER_STAY_SQUARED,
  DECOY_FRAME_TICKS,
  DECOY_STAND_DROP,
  decoyPlan,
  decoyStandPoint,
  decoyTouchesBuilding,
} from "./decoy";
import { createBattle } from "./engine";
import type { AttackEvent, BattleOptions } from "./engine";
import type { Rng } from "./rng";
import { TICKS_PER_SECOND } from "./stats";
import { buildEngineYard, screenOf, screenPointOf } from "./yard";
import type { CombatBuildingDataMap } from "./types";

/**
 * The Decoy (Inferno WP 6.5) against Flash: its own figures read out of
 * `Decoy.as` and `SPRITES.as`, its overlap test against a literal port of
 * `BASE.GetBuildingOverlap`, and the fight it makes in the engine.
 */

const SCRIPTS = "../../../../../client/scripts/";
const read = (path: string): string =>
  readFileSync(new URL(SCRIPTS + path, import.meta.url), "utf8");

describe("the Decoy's figures against Flash", () => {
  const decoy = read("com/monsters/siege/weapons/Decoy.as");

  it("falls for 0.6 s before it lands, and blows up `duration` seconds after the drop", () => {
    expect(decoy).toMatch(/TweenLite\.from\(this\._container, 0\.6,/);
    expect(DECOY_FALL_TICKS).toBe(0.6 * TICKS_PER_SECOND);
    expect(read("com/monsters/siege/SiegeWeapons.as")).toMatch(
      /new Timer\(1000, _loc4_\.duration\)/,
    );
    expect(decoyPlan(1, 100)).toEqual({
      range: 250,
      damage: 1000,
      landsAt: 100 + DECOY_FALL_TICKS,
      explodesAt: 100 + 10 * TICKS_PER_SECOND,
    });
    expect(decoyPlan(10, 0)).toEqual({
      range: 480,
      damage: 23_500,
      landsAt: DECOY_FALL_TICKS,
      explodesAt: 21 * TICKS_PER_SECOND,
    });
    expect(decoyPlan(0, 0)).toBeNull();
  });

  it("reaches buildings within 0.65 of its range, and pulls defenders half its wave's height below", () => {
    expect(decoy).toMatch(/< range \* 0\.65\)/);
    expect(DECOY_BUILDING_REACH).toBe(0.65);
    // The wave animation's frames are 61 x 70 (`SPRITES.as:92`); they gather
    // `decoyGraphic.height / 2` below the drop (`CreepBase.as:503`).
    expect(read("SPRITES.as")).toMatch(/decoy_wave_anim\.png", 61, 70,/);
    expect(read("com/monsters/monsters/creeps/CreepBase.as")).toMatch(
      /_loc4_\.y \+ _loc4_\.decoyGraphic\.height \/ 2/,
    );
    expect(DECOY_STAND_DROP).toBe(70 / 2);
    // Its update runs on `ENTER_FRAME`, a 40 fps frame: every second tick.
    expect(decoy).toMatch(/addEventListener\(Event\.ENTER_FRAME, this\.onEnterFrame\)/);
    expect(DECOY_FRAME_TICKS * 40).toBe(TICKS_PER_SECOND);
  });
});

describe("where a pulled defender stands", () => {
  /** A stream that hands out the same draw every time. */
  const steady = (value: number): Rng => ({
    next: () => Math.floor(value * 2 ** 32),
    float: () => value,
    int: (bound: number) => Math.floor(value * bound),
    state: () => 0,
    count: () => 0,
  });

  it("stands 30-40 px out on its own side, stretched 1.7 across, as `changeModeDecoy` puts it", () => {
    const drop = { x: 0, y: 0 };
    // A middle draw: no turn, 35 px out, no jitter. From due east of the spot.
    const east = decoyStandPoint(steady(0.5), { x: 200, y: DECOY_STAND_DROP }, drop, false);
    expect(east.x).toBeCloseTo(35 * 1.7, 6);
    expect(east.y).toBeCloseTo(DECOY_STAND_DROP, 6);
    // From due south, the stretch does not apply to the height.
    const south = decoyStandPoint(steady(0.5), { x: 0, y: 300 }, drop, false);
    expect(south.x).toBeCloseTo(0, 6);
    expect(south.y).toBeCloseTo(DECOY_STAND_DROP + 35, 6);
    // The lowest draws: 45 degrees round, 30 px out, then 5 px across and down.
    const low = decoyStandPoint(steady(0), { x: 200, y: DECOY_STAND_DROP }, drop, false);
    const angle = (-45 * Math.PI) / 180;
    expect(low.x).toBeCloseTo(Math.cos(angle) * 30 * 1.7 + 5, 6);
    expect(low.y).toBeCloseTo(DECOY_STAND_DROP + Math.sin(angle) * 30 + 5, 6);
  });

  it("leaves a flyer near the middle where it is, and puts one further off without the jitter", () => {
    const drop = { x: 10, y: 20 };
    const near = { x: 10 + 30, y: 20 + DECOY_STAND_DROP + 30 };
    expect(30 * 30 * 2).toBeLessThan(DECOY_FLYER_STAY_SQUARED);
    expect(decoyStandPoint(steady(0), near, drop, true)).toBe(near);
    const far = decoyStandPoint(steady(0.5), { x: 400, y: 20 + DECOY_STAND_DROP }, drop, true);
    expect(far.x).toBeCloseTo(10 + 35 * 1.7, 6);
    expect(far.y).toBeCloseTo(20 + DECOY_STAND_DROP, 6);
  });
});

describe("which bunkers the Decoy's range touches", () => {
  /** `BASE.EllipseEdgeDistance` (`BASE.as:4995-5006`), line for line, its sizes `int`. */
  const ellipseEdgeDistance = (angle: number, width: number, height: number): number => {
    const w = Math.trunc(width);
    const h = Math.trunc(height);
    let along = Math.pow(
      Math.pow(w / 2, -2) + Math.pow(Math.tan(angle), 2) * Math.pow(h / 2, -2),
      -0.5,
    );
    const degrees = (angle * 180) / Math.PI;
    if (degrees < -90 || degrees > 90) along *= -1;
    const up = Math.tan(angle) * along;
    return Math.sqrt(along * along + up * up);
  };

  /** `BASE.GetBuildingOverlap` (`:4934-4962`) for one building `(dx, dy)` from the drop. */
  const flashOverlaps = (range: number, dx: number, dy: number, size: number): boolean => {
    const towards = Math.atan2(-dy, -dx);
    const edge = ellipseEdgeDistance(towards, range, range * 0.8);
    const back = Math.atan2(dy, dx);
    const own = ellipseEdgeDistance(back, size * 0.5, size * 0.5 * 0.8);
    return Math.trunc(Math.sqrt(dx * dx + dy * dy)) < edge + own;
  };

  it("agrees with Flash's ellipse test all round the edge, at every Decoy range", () => {
    let checked = 0;
    for (const range of [250, 310, 480]) {
      for (const size of [100, 120, 190]) {
        for (let dx = -330; dx <= 330; dx += 7) {
          for (let dy = -330; dy <= 330; dy += 9) {
            if (dx === 0 && dy === 0) continue;
            expect(
              decoyTouchesBuilding(range, dx, dy, size),
              `${range} ${size} ${dx} ${dy}`,
            ).toBe(flashOverlaps(range, dx, dy, size));
            checked += 1;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(50_000);
  });
});

describe("the Decoy in a fight", () => {
  /**
   * A level 1 Monster Bunker (range 300) at the origin holding three level 1
   * C6s (2,000 health, so they live through the blast), and a Pokey off to the south-east hitting a Town Hall well
   * out of the bunker's reach, so the battle goes on and nothing provokes the
   * bunker itself. The Decoy lands at yard (100, 100): screen (0, 100), well
   * inside its 250 range of the bunker.
   */
  const buildings: CombatBuildingDataMap = {
    "1": { id: 1, t: 22, l: 1, X: 0, Y: 0 },
    "2": { id: 2, t: 14, l: 1, X: 800, Y: 800 },
  };
  const yardOf = () =>
    buildEngineYard({
      buildingdata: buildings,
      buildinghealthdata: {},
      resources: { r1: 100000, r2: 0, r3: 0, r4: 0 },
    });
  const pokey: AttackEvent = { kind: "fling", t: 0, x: 780, y: 780, r: 0, monsters: { C1: 1 } };
  const decoyAt: AttackEvent = { kind: "siege", t: 0, x: 100, y: 100, weapon: "decoy" };
  const drop = screenOf(100, 100);
  const plan = decoyPlan(1, 0)!;

  const battleOf = (options: Partial<BattleOptions>, events: AttackEvent[]) => {
    const yard = yardOf();
    const battle = createBattle(yard, { seed: 11, bunkers: { 1: { C6: 3 } }, ...options });
    for (const event of events) battle.apply(event);
    return { yard, battle };
  };

  const screenGap = (
    creep: { ix: number; iy: number },
    to: { x: number; y: number },
  ): number => {
    const at = screenPointOf(creep.ix, creep.iy);
    return Math.hypot(at.x - to.x, at.y - to.y);
  };

  it("does nothing without a Siege Lab level, nor for another weapon", () => {
    const plain = battleOf({}, [pokey]).battle;
    const unlevelled = battleOf({}, [pokey, decoyAt]).battle;
    // A Decoy level and a Vacuum event: the Vacuum has no level, so nothing drops.
    const vacuum = battleOf({ siege: { decoy: 1 } }, [
      pokey,
      { kind: "siege", t: 0, x: 100, y: 100, weapon: "vacuum" },
    ]).battle;
    for (const battle of [plain, unlevelled, vacuum]) battle.runTo(plan.explodesAt + 40);
    expect(unlevelled.checkpoint()).toEqual(plain.checkpoint());
    expect(vacuum.checkpoint()).toEqual(plain.checkpoint());
    expect(plain.creeps().filter((creep) => creep.friendly)).toHaveLength(0);
  });

  it("empties the bunker it touches on landing, one of a kind a frame, and stands them round it", () => {
    const { battle } = battleOf({ siege: { decoy: 1 } }, [pokey, decoyAt]);
    battle.runTo(plan.landsAt - 1);
    expect(battle.creeps().filter((creep) => creep.friendly)).toHaveLength(0);
    battle.runTo(plan.landsAt);
    expect(battle.creeps().filter((creep) => creep.friendly)).toHaveLength(1);
    battle.runTo(plan.landsAt + 2 * DECOY_FRAME_TICKS);
    expect(battle.creeps().filter((creep) => creep.friendly)).toHaveLength(3);
    expect(battle.state().bunkers[0]?.sent).toBe(3);

    battle.runTo(plan.explodesAt - 1);
    const spot = { x: drop.x, y: drop.y + DECOY_STAND_DROP };
    const held = battle.creeps().filter((creep) => creep.friendly);
    expect(held).toHaveLength(3);
    for (const creep of held) {
      // 30-40 px out, 1.7 times across, give or take the 5 px jitter and the last step.
      expect(screenGap(creep, spot)).toBeLessThan(40 * 1.7 + 5 * Math.SQRT2 + 2);
      expect(creep.state).toBe("walking");
      expect(creep.targetCreep).toBe(-1);
      expect(creep.hp).toBe(2000);
    }
  });

  it("leaves a Housing Bunker's monsters in: Flash ejects from a Monster Bunker only", () => {
    const housing = { ...buildings, "1": { id: 1, t: 128, l: 1, X: 0, Y: 0 } };
    const battle = createBattle(
      buildEngineYard({
        buildingdata: housing,
        buildinghealthdata: {},
        resources: { r1: 100000, r2: 0, r3: 0, r4: 0 },
      }),
      { seed: 11, bunkers: { 1: { IC2: 3 } }, siege: { decoy: 1 } },
    );
    for (const event of [pokey, decoyAt]) battle.apply(event);
    battle.runTo(plan.landsAt + 2 * DECOY_FRAME_TICKS);
    expect(battle.creeps().filter((creep) => creep.friendly)).toHaveLength(0);
    expect(battle.state().bunkers[0]?.sent).toBe(0);
  });

  it("blows up on its tick: the linear blast on the defenders and the bunker, then they go home", () => {
    const { yard, battle } = battleOf({ siege: { decoy: 1 } }, [pokey, decoyAt]);
    battle.runTo(plan.explodesAt - 1);
    const before = battle.creeps().filter((creep) => creep.friendly);
    const bunker = yard.buildings.find((building) => building.id === 1)!;
    expect(battle.state().health["1"]).toBeUndefined();

    battle.runTo(plan.explodesAt);
    const after = battle.creeps().filter((creep) => creep.friendly);
    expect(after.map((creep) => creep.id)).toEqual(before.map((creep) => creep.id));
    for (const creep of before) {
      const dealt = linearAreaDamage(plan.damage, plan.range, 0, screenGap(creep, drop))!;
      expect(dealt).toBeGreaterThanOrEqual(plan.damage / 5);
      expect(after.find((one) => one.id === creep.id)?.hp).toBe(creep.hp - dealt);
    }
    // The bunker's anchor is screen (0, 0), 100 px from the drop: inside 0.65 of 250.
    const bunkerDealt = linearAreaDamage(plan.damage, plan.range, 0, 100)!;
    expect(bunkerDealt).toBe(600);
    expect(battle.state().health["1"]).toBe(bunker.maxHp - bunkerDealt);
    // The Town Hall, far off, takes nothing from it.
    const hall = battle.state().health["2"];
    expect(hall === undefined || hall > 0).toBe(true);

    // Let go, with nobody to fight in its leash, each walks back into its bunker.
    battle.runTo(plan.explodesAt + 600);
    expect(battle.creeps().filter((creep) => creep.friendly)).toHaveLength(0);
    expect(battle.state().bunkerGarrisons[1]).toEqual({ C6: 3 });
  });

  it("calls the basic caged champion out of its cage, not the Krallen (owner's choice, 28 Oct)", () => {
    // A Champion Cage under the Decoy and the Town Hall far off, with a Pokey
    // at it out of the champions' sight, so neither comes out on its own.
    const caged = createBattle(
      buildEngineYard({
        buildingdata: {
          "1": { id: 1, t: 114, l: 1, X: 0, Y: 0 },
          "2": { id: 2, t: 14, l: 1, X: 1400, Y: 1400 },
        },
        buildinghealthdata: {},
        resources: { r1: 100000, r2: 0, r3: 0, r4: 0 },
      }),
      {
        seed: 3,
        siege: { decoy: 1 },
        defenderChampions: [
          { t: 5, l: 2, hp: 6000, pl: 1 },
          { t: 1, l: 2, hp: 5000, pl: 1 },
        ],
      },
    );
    for (const event of [
      { kind: "fling", t: 0, x: 1380, y: 1380, r: 0, monsters: { C1: 1 } },
      decoyAt,
    ] satisfies AttackEvent[]) {
      caged.apply(event);
    }
    const out = () => caged.creeps().filter((creep) => creep.champion && creep.friendly);
    caged.runTo(plan.landsAt - 1);
    expect(out()).toHaveLength(0);
    caged.runTo(plan.landsAt);
    expect(out().map((creep) => creep.monsterId)).toEqual(["G1"]);

    caged.runTo(plan.explodesAt - 1);
    const spot = { x: drop.x, y: drop.y + DECOY_STAND_DROP };
    const gorgo = out()[0]!;
    expect(out()).toHaveLength(1);
    expect(screenGap(gorgo, spot)).toBeLessThan(40 * 1.7 + 5 * Math.SQRT2 + 2);
    expect(gorgo).toMatchObject({ targetCreep: -1, hp: 5000 });

    // The blast takes its share, and the Krallen, still in, takes none.
    caged.runTo(plan.explodesAt);
    const dealt = linearAreaDamage(plan.damage, plan.range, 0, screenGap(gorgo, drop))!;
    expect(out()[0]?.hp).toBe(5000 - dealt);
    expect(caged.state().defenderChampions.map((one) => one.hp)).toEqual([6000, 5000 - dealt]);

    // Let go with nobody to fight, it walks back into its cage.
    caged.runTo(plan.explodesAt + 1200);
    expect(out()).toHaveLength(0);
  });

  it("never pulls the attacker's own champion: it fights on exactly as without a Decoy", () => {
    const champion: AttackEvent = {
      kind: "fling",
      t: 0,
      x: 110,
      y: 110,
      r: 0,
      monsters: {},
      champion: { t: 1, l: 1 },
    };
    const levels = { siege: { decoy: 1 } } as const;
    const open = (events: AttackEvent[], options: Partial<BattleOptions>) => {
      const battle = createBattle(yardOf(), { seed: 5, ...options });
      for (const event of events) battle.apply(event);
      battle.runTo(plan.explodesAt - 1);
      return battle.creeps();
    };
    const without = open([champion], {});
    const withDecoy = open([champion, decoyAt], levels);
    expect(without.some((creep) => creep.champion)).toBe(true);
    expect(withDecoy).toEqual(without);
  });
});
