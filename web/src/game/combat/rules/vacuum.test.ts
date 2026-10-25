import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createBattle } from "./engine";
import type { AttackEvent, BattleOptions } from "./engine";
import { VACUUM, VACUUM_OUTPOST_LOOT_SHARE } from "./siege";
import { TICKS_PER_SECOND } from "./stats";
import {
  VACUUM_FRAME_TICKS,
  VACUUM_HOSE_RISE,
  VACUUM_LOWER_TICKS,
  VACUUM_NO_CAP,
  VACUUM_OUTPOST_TYPE,
  VACUUM_SPOUT_LIFT,
  VACUUM_SPOUT_Y,
  VACUUM_TARGET_TYPES,
  shootsHose,
  vacuumGain,
  vacuumHoseY,
  vacuumLootCap,
  vacuumPlan,
  vacuumTake,
} from "./vacuum";
import { buildEngineYard } from "./yard";
import type { CombatBuildingDataMap } from "./types";

/**
 * The Vacuum (Inferno WP 6.6) against Flash: its own figures read out of
 * `Vacuum.as`, `VacuumHose.as` and `BTOWER.as`, and the fight it makes in the
 * engine, its loot to the unit.
 */

const SCRIPTS = "../../../../../client/scripts/";
const read = (path: string): string =>
  readFileSync(new URL(SCRIPTS + path, import.meta.url), "utf8");

describe("the Vacuum's figures against Flash", () => {
  const hose = read("com/monsters/siege/weapons/VacuumHose.as");
  const vacuum = read("com/monsters/siege/weapons/Vacuum.as");

  it("latches onto a Town Hall or a Resource Outpost, and lasts `duration` seconds", () => {
    expect(vacuum).toMatch(
      /Vector\.<String>\(\[getQualifiedClassName\(BUILDING14\), getQualifiedClassName\(ResourceOutpost\)\]\)/,
    );
    expect(read("ResourceOutpost.as")).toContain(`k_TYPE:int = ${VACUUM_OUTPOST_TYPE};`);
    expect(VACUUM_TARGET_TYPES).toEqual([14, VACUUM_OUTPOST_TYPE]);
    expect(read("com/monsters/siege/SiegeWeapons.as")).toMatch(
      /new Timer\(1000, _loc4_\.duration\)/,
    );
    expect(vacuumPlan(1, 100)).toEqual({
      durability: 6000,
      rate: 25_000,
      endsAt: 100 + 30 * TICKS_PER_SECOND,
    });
    expect(vacuumPlan(10, 0)).toEqual({
      durability: 44_200,
      rate: 593_977,
      endsAt: 85 * TICKS_PER_SECOND,
    });
    expect(vacuumPlan(0, 0)).toBeNull();
  });

  it("lowers its hose over 2 s from 400 px up to 50 px above the spout", () => {
    expect(hose).toContain("this._vacuum.y = this._target.y - 400;");
    expect(hose).toMatch(
      /TweenLite\.to\(this\._vacuum, 2, \{\s*"y": this\._target\.y \+ this\._target\._spoutPoint\.y - 50,/,
    );
    expect(hose).toMatch(/"ease": Expo\.easeOut/);
    expect(read("BUILDING14.as")).toContain("_spoutPoint = new Point(1, -67);");
    expect(read("BFOUNDATION.as")).toContain("this._spoutPoint = new Point(1, -67);");
    expect(VACUUM_HOSE_RISE).toBe(400);
    expect(VACUUM_SPOUT_Y).toBe(-67);
    expect(VACUUM_SPOUT_LIFT).toBe(50);
    expect(VACUUM_LOWER_TICKS).toBe(2 * TICKS_PER_SECOND);
    expect(vacuumHoseY(800, 0)).toBe(400);
    expect(vacuumHoseY(800, VACUUM_LOWER_TICKS)).toBe(800 - 67 - 50);
    expect(vacuumHoseY(800, 10_000)).toBe(800 - 67 - 50);
    // `Expo.easeOut` half way: 1 - 2^-5 of the way down.
    expect(vacuumHoseY(800, VACUUM_LOWER_TICKS / 2)).toBeCloseTo(400 + 283 * (1 - 2 ** -5), 9);
    // It sucks on its own frame, every second tick.
    expect(vacuum).toMatch(/addEventListener\(Event\.ENTER_FRAME, this\.onEnterFrame\)/);
    expect(VACUUM_FRAME_TICKS * 40).toBe(TICKS_PER_SECOND);
  });

  it("can be shot by the towers whose `_targetFlyerMode` is not 0, and no other", () => {
    const table = /_targetFlyerMode:Object = \{([^}]*)\}/.exec(read("BTOWER.as"))?.[1] ?? "";
    const modes = [...table.matchAll(/"(\d+)": (\d+)/g)].map(([, type, mode]) => [
      Number(type),
      Number(mode),
    ]);
    expect(modes).toHaveLength(9);
    const shooters = modes.filter(([, mode]) => mode !== 0).map(([type]) => type);
    expect(shooters).toEqual([21, 25, 115, 132]);
    for (const [type] of modes)
      expect(shootsHose(type!), String(type)).toBe(shooters.includes(type!));
    // A tower with no entry, the Monster Bunker, cannot either.
    expect(shootsHose(22)).toBe(false);
  });

  it("sucks `int(ms * rate / 1000)` a frame, whole, from one resource picked at random", () => {
    expect(hose).toMatch(
      /_loc2_ = \(this\._vacuumCurrTime - this\._vacuumStartTime\) \* this\._vacuumLootRate\.Get\(\) \/ 1000;/,
    );
    expect(hose).toMatch(/_loc4_\[int\(Math\.random\(\) \* _loc4_\.length\)\]/);
    expect(hose).toMatch(/quantity >= Math\.ceil\(param1\)/);
    // A frame is 25 ms: 625 a frame at 25,000 a second.
    expect(vacuumGain(25_000, 0, VACUUM_FRAME_TICKS)).toBe(625);
    // Frame by frame it adds up to what is due by the end, never more.
    let total = 0;
    for (let at = 2; at <= 400; at += 2) total += vacuumGain(38_153, at - 2, at);
    expect(total).toBe(Math.trunc((400 * 12.5 * 38_153) / 1000));
    expect(vacuumTake(10_000, 624.2)).toBe(625);
    expect(vacuumTake(300.9, 625)).toBe(300);
  });

  it("takes at most a tenth of the pool from a Resource Outpost, no cap from a Town Hall", () => {
    expect(hose).toContain("MR3_MAX_LOOT_MULTIPLIER:Number = 0.1;");
    expect(hose).toMatch(/return this\._amountLooted > this\._totalPossibleLoot;/);
    expect(hose).toContain("this._totalPossibleLoot = uint.MAX_VALUE;");
    const pool = { r1: 1_000_001, r2: 5, r3: 0, r4: 0 };
    expect(vacuumLootCap(VACUUM_OUTPOST_TYPE, pool)).toBe(
      Math.trunc(1_000_006 * VACUUM_OUTPOST_LOOT_SHARE),
    );
    expect(vacuumLootCap(14, pool)).toBe(VACUUM_NO_CAP);
    expect(VACUUM_NO_CAP).toBe(2 ** 32 - 1);
    expect(VACUUM.lootBonus[0]).toBe(25_000);
  });
});

describe("the Vacuum in a fight", () => {
  /** A level 1 Vacuum: 25,000 a second, 30 s, 6,000 health; 625 a frame. */
  const plan = vacuumPlan(1, 0)!;
  /** Everything a level 1 Vacuum sucks if nothing stops it: its last frame is 2 ticks before its end. */
  const fullLoot = Math.trunc(((plan.endsAt - 2) * 12.5 * 25_000) / 1000);
  /**
   * The Town Hall at yard (800, 800), screen (0, 800); its hose comes down
   * from screen y 400 to 683. Anything else is put on the line above it.
   */
  const hall = { id: 1, t: 14, l: 1, X: 800, Y: 800 };
  const drop: AttackEvent = { kind: "siege", t: 0, x: 100, y: 100, weapon: "vacuum" };

  const battleOf = (
    extra: CombatBuildingDataMap,
    resources: Record<string, number>,
    options: Partial<BattleOptions> = { siege: { vacuum: 1 } },
    events: AttackEvent[] = [drop],
    health: Record<string, number> = {},
  ) => {
    const yard = buildEngineYard({
      buildingdata: { "1": hall, ...extra },
      buildinghealthdata: health,
      resources: { r1: 0, r2: 0, r3: 0, r4: 0, ...resources },
    });
    const battle = createBattle(yard, { seed: 3, ...options });
    for (const event of events) battle.apply(event);
    return { yard, battle };
  };

  it("sucks 625 a frame out of the pool into the loot for its 30 s, then lets go", () => {
    expect(fullLoot).toBe(749_375);
    const { yard, battle } = battleOf({}, { r1: 10_000_000 });
    battle.runTo(VACUUM_FRAME_TICKS);
    expect(battle.state().loot.r1).toBe(625);
    battle.runTo(plan.endsAt + 400);
    const state = battle.state();
    expect(state.loot).toEqual({ r1: fullLoot, r2: 0, r3: 0, r4: 0 });
    expect(state.defenderLoss).toEqual(state.loot);
    expect(yard.resources.r1).toBe(10_000_000 - fullLoot);
  });

  it("picks among the resources that are left, and stops once the pool is dry", () => {
    const { yard, battle } = battleOf({}, { r1: 100_000, r3: 100_000 });
    battle.runTo(plan.endsAt + 40);
    const { loot } = battle.state();
    expect(loot.r1).toBe(100_000);
    expect(loot.r3).toBe(100_000);
    expect(loot.r2 + loot.r4).toBe(0);
    expect(yard.resources).toEqual({ r1: 0, r2: 0, r3: 0, r4: 0 });
  });

  it("takes just past a tenth of a Resource Outpost's pool and no more", () => {
    // The outpost in place of the Town Hall: a tenth of 1,000,000 is 100,000,
    // and it stops once it has taken more, after the frame that reaches 100,625.
    const { battle } = battleOf(
      { "1": { ...hall, t: VACUUM_OUTPOST_TYPE } },
      { r1: 1_000_000 },
    );
    battle.runTo(plan.endsAt);
    expect(battle.state().loot.r1).toBe(100_625);
  });

  it("does nothing without a level, without a Town Hall, or on a fallen one", () => {
    const quiet = { r1: 0, r2: 0, r3: 0, r4: 0 };
    const unlevelled = battleOf({}, { r1: 1_000_000 }, {}).battle;
    const noHall = battleOf({ "1": { ...hall, t: 112 } }, { r1: 1_000_000 }).battle;
    const fallen = battleOf({}, { r1: 1_000_000 }, undefined, [drop], { "1": 0 }).battle;
    for (const battle of [unlevelled, noHall, fallen]) {
      battle.runTo(400);
      expect(battle.state().loot).toEqual(quiet);
    }
  });

  it("is one weapon at a time: a second drop while it is out does nothing", () => {
    const { battle } = battleOf({}, { r1: 10_000_000 }, { siege: { vacuum: 1, decoy: 1 } }, [
      drop,
      drop,
      { ...drop, weapon: "decoy" },
    ]);
    battle.runTo(plan.endsAt + 40);
    expect(battle.state().loot.r1).toBe(fullLoot);
  });

  it("is shot down by a Sniper Tower with nobody else to shoot: 14 shots of 430", () => {
    // A level 4 Sniper (430 a shot, rate 80, range 324) at screen (0, 700). Its
    // first fire tick, 80, finds the hose in reach and waits 30; then it shoots
    // every 160 ticks from 110. The 14th, on tick 2,190, takes it past 6,000,
    // and that tick's frame lets go: the last suck was on 2,188.
    const sniper = { "2": { id: 2, t: 21, l: 4, X: 700, Y: 700 } };
    const { battle } = battleOf(sniper, { r1: 10_000_000 });
    battle.runTo(plan.endsAt + 400);
    const state = battle.state();
    expect(Math.ceil(6000 / 430)).toBe(14);
    expect(state.loot.r1).toBe(Math.trunc((2188 * 12.5 * 25_000) / 1000));
    const report = state.towers.find((tower) => tower.id === 2);
    expect(report?.shots).toBe(14);
    expect(report?.firstShotTick).toBe(110);
  });

  it("is shot down by a Magma Tower too, once the hose comes into its short range", () => {
    // Level 1 Magma (180 a shot, rate 20, range 180) at screen (0, 600): the hose
    // is in reach by its first fire tick, 20. Shots every 40 ticks from 50; the
    // 34th, on tick 1,370, takes it past 6,000, and that tick's frame lets go.
    const magma = { "2": { id: 2, t: 132, l: 1, X: 600, Y: 600 } };
    const { battle } = battleOf(magma, { r1: 10_000_000 });
    battle.runTo(plan.endsAt + 400);
    const state = battle.state();
    expect(state.loot.r1).toBe(Math.trunc((1368 * 12.5 * 25_000) / 1000));
    expect(state.towers.find((tower) => tower.id === 2)?.shots).toBe(34);
  });

  it("is zapped down by a Tesla Tower", () => {
    const tesla = { "2": { id: 2, t: 25, l: 3, X: 700, Y: 700 } };
    const { battle } = battleOf(tesla, { r1: 10_000_000 });
    battle.runTo(plan.endsAt + 400);
    const state = battle.state();
    const zaps = state.towers.find((tower) => tower.id === 2)?.shots ?? 0;
    // 140 a zap: 43 of them take the 6,000.
    expect(zaps).toBe(Math.ceil(6000 / 140));
    expect(state.loot.r1).toBeGreaterThan(0);
    expect(state.loot.r1).toBeLessThan(fullLoot);
    expect(state.loot.r1 % 625).toBe(0);
  });

  it("is not hurt by the Aerial Defense, whose shells burst on it and hit nothing there", () => {
    const aerial = { "2": { id: 2, t: 115, l: 1, X: 700, Y: 700 } };
    const { battle } = battleOf(aerial, { r1: 10_000_000 });
    battle.runTo(plan.endsAt + 400);
    const state = battle.state();
    expect(state.towers.find((tower) => tower.id === 2)?.shots).toBeGreaterThan(0);
    expect(state.loot.r1).toBe(fullLoot);
  });

  it("is ignored by a tower that cannot shoot it, a Cannon Tower", () => {
    const cannon = { "2": { id: 2, t: 20, l: 10, X: 700, Y: 700 } };
    const { battle } = battleOf(cannon, { r1: 10_000_000 });
    battle.runTo(plan.endsAt + 400);
    const state = battle.state();
    expect(state.towers.find((tower) => tower.id === 2)?.shots).toBe(0);
    expect(state.loot.r1).toBe(fullLoot);
  });

  it("lets go once the Town Hall under it falls", () => {
    // A Town Hall on its last point of health, and a Pokey to knock it over.
    const pokey: AttackEvent = {
      kind: "fling",
      t: 0,
      x: 780,
      y: 780,
      r: 0,
      monsters: { C1: 1 },
    };
    const { battle } = battleOf({}, { r1: 10_000_000 }, undefined, [pokey, drop], { "1": 1 });
    let fell = 0;
    for (let at = 1; at < plan.endsAt && fell === 0; at += 1) {
      battle.runTo(at);
      if (battle.state().destroyedIds.includes(1)) fell = at;
    }
    expect(fell).toBeGreaterThan(0);
    battle.runTo(fell + VACUUM_FRAME_TICKS);
    const after = battle.state().loot.r1;
    battle.runTo(plan.endsAt);
    expect(battle.state().loot.r1).toBe(after);
  });
});
