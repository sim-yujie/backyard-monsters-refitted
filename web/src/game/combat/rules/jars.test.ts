import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createBattle } from "./engine";
import type { AttackEvent, BattleOptions } from "./engine";
import { JARS } from "./siege";
import { TICKS_PER_SECOND, isSpurtzCannon, towerStats } from "./stats";
import { isBunker } from "./targeting";
import {
  JAR_CHECK_TICKS,
  JAR_FALL_TICKS,
  JAR_FRAMES,
  JAR_QUAKE_TYPE,
  JAR_SHOT_MULTIPLIER,
  JAR_TOWER_TYPES,
  jarFrame,
  jarShot,
  jarsPlan,
} from "./jars";
import { buildEngineYard, buildingClass } from "./yard";
import {
  BUILD_CATALOGUE,
  BuildCategory,
  INFERNO_BUILD_CATALOGUE,
  OUTPOST_BUILD_CATALOGUE,
} from "@/game/yard/buildCatalogue";
import type { CombatBuildingDataMap } from "./types";

/**
 * The Candy Jars (Inferno WP 6.7) against Flash: their own figures read out
 * of `Jars.as`, `BTOWER.as` and each tower's `Fire`, and the fights they make
 * in the engine, shot by shot.
 */

const SCRIPTS = "../../../../../client/scripts/";
const read = (path: string): string =>
  readFileSync(new URL(SCRIPTS + path, import.meta.url), "utf8");

describe("the Jars' figures against Flash", () => {
  const jars = read("com/monsters/siege/weapons/Jars.as");
  const btower = read("BTOWER.as");

  it("reach `range`, hold `durability`, and have no timer: a 0 `duration`", () => {
    expect(jars).toContain(
      "new SiegeWeaponProperty([200, 210, 235, 335, 360, 370, 380, 390, 400, 410], 1)",
    );
    expect(jars).toContain(
      "new SiegeWeaponProperty([2000, 3000, 4500, 7000, 11000, 13500, 16500, 20500, 25500, 31500], 2)",
    );
    expect(jars).toContain("new SiegeWeaponProperty([0, 0, 0, 0, 0, 0, 0, 0, 0, 0])");
    expect(jarsPlan(1, 100)).toEqual({
      range: 200,
      durability: 2000,
      landsAt: 100 + TICKS_PER_SECOND,
    });
    expect(jarsPlan(10, 0)).toEqual({
      range: 410,
      durability: 31_500,
      landsAt: JAR_FALL_TICKS,
    });
    expect(jarsPlan(0, 0)).toBeNull();
    expect(JARS.range).toHaveLength(10);
  });

  it("fall for 1 s, are checked every second, and break over a 23-cell strip", () => {
    expect(btower).toMatch(
      /RENDERER_ON\) \{\s+TweenLite\.from\(this\._jarAnimation, 1, \{[^}]*"onComplete": this\.JarLanded/,
    );
    expect(JAR_FALL_TICKS).toBe(TICKS_PER_SECOND);
    expect(jars).toContain("this._activeTimer = new Timer(1000, duration);");
    expect(jars).toMatch(/activeDurability <= 0\) \{\s+SiegeWeapons\.deactivateWeapon\(\);/);
    expect(JAR_CHECK_TICKS).toBe(TICKS_PER_SECOND);
    expect(jars).toContain(`JAR_GRAPHIC_FRAMES:int = ${JAR_FRAMES};`);
    expect(btower).toMatch(
      /currentFrame >= this\._jarAnimation\.totalFrames\) \{\s+this\.RemoveJar\(\);/,
    );
  });

  it("land only on the defences among the BTOWERs the drop touches, never on a bunker", () => {
    expect(jars).toMatch(/if \(_loc5_ is BTOWER\) \{\s+_loc4_\.push\(_loc5_\);/);
    const files: Record<number, string> = {
      20: "BUILDING20.as",
      21: "BUILDING21.as",
      23: "BUILDING23.as",
      25: "BUILDING25.as",
      115: "BUILDING115.as",
      118: "BUILDING118.as",
      129: "INFERNOQUAKETOWER.as",
      130: "INFERNO_CANNON_TOWER.as",
      132: "INFERNO_MAGMA_TOWER.as",
      136: "SpurtzCannon.as",
      138: "GuardTower.as",
    };
    for (const file of Object.values(files)) expect(read(file)).toMatch(/ extends BTOWER\b/);
    expect(read("BlackSpurtzCannon.as")).toContain("extends SpurtzCannon");
    expect(read("BUILDING22.as")).toContain("extends Bunker");
    expect(read("HOUSINGBUNKER.as")).toContain("extends Bunker");
    expect(read("Bunker.as")).toContain("class Bunker extends BFOUNDATION");
    // Flash: every tower the yard knows but the two bunkers.
    const towers = Array.from({ length: 200 }, (_, type) => type).filter(
      (type) => buildingClass(type) === "tower",
    );
    expect(towers.filter((type) => !isBunker(type))).toEqual([...JAR_TOWER_TYPES, 138]);
    // The owner keeps jars to the defences, each tower on a Defensive tab, and
    // the Spurtz Cannons.
    const defensive = [BUILD_CATALOGUE, OUTPOST_BUILD_CATALOGUE, INFERNO_BUILD_CATALOGUE]
      .flatMap((catalogue) => catalogue.filter((tab) => tab.id === BuildCategory.DEFENSIVE))
      .flatMap((tab) => tab.types);
    expect(JAR_TOWER_TYPES).toEqual(
      towers.filter((type) => (defensive.includes(type) || isSpurtzCannon(type)) && !isBunker(type)),
    );
    expect(isBunker(22) && isBunker(128)).toBe(true);
    expect(JAR_TOWER_TYPES.filter(isSpurtzCannon)).toEqual([136, 137]);
  });

  it("take each tower's shot times its own multiple; the Inferno Cannon and Stronghold none", () => {
    const hit = (file: string, multiple: string, scale = "_loc2_ * _loc3_"): void =>
      expect(read(file)).toContain(`_jarHealth.Add(-int(damage${multiple} * ${scale}));`);
    hit("BUILDING20.as", " * 6");
    hit("BUILDING21.as", "");
    hit("BUILDING23.as", " * 25");
    hit("BUILDING25.as", "");
    hit("BUILDING115.as", "");
    hit("BUILDING118.as", " * 3");
    hit("INFERNOQUAKETOWER.as", " * 3", "_loc1_ * _loc2_");
    hit("INFERNO_MAGMA_TOWER.as", "");
    // The Quake's `_loc1_` is 1, not its health (`INFERNOQUAKETOWER.as:139`).
    expect(read("INFERNOQUAKETOWER.as")).toMatch(
      /var _loc1_:Number = 1;\s+var _loc2_:Number = 1;/,
    );
    const spurtz = read("SpurtzCannon.as");
    expect(spurtz).toContain("var _loc3_:int = damage * 0.25 * _loc1_ * _loc2_;");
    expect(spurtz).toMatch(/if \(isJard\) \{\s+this\.shootJar\(\);\s+return;/);
    for (const file of ["INFERNO_CANNON_TOWER.as", "GuardTower.as"]) {
      expect(read(file)).not.toContain("_jarHealth");
    }
    expect(JAR_SHOT_MULTIPLIER).toEqual({
      20: 6,
      21: 1,
      23: 25,
      25: 1,
      115: 1,
      118: 3,
      129: 3,
      132: 1,
      136: 0.25,
      137: 0.25,
    });
    // `int(damage * multiple * scale)`: a half-health Cannon of 100 deals int(100 * 6 * 0.75).
    expect(jarShot(20, 100, 500, 1000)).toBe(450);
    expect(jarShot(JAR_QUAKE_TYPE, 1100, 1, 1000)).toBe(3300);
    expect(jarShot(136, 410, 1000, 1000)).toBe(102);
    expect(jarShot(130, 500, 1000, 1000)).toBeNull();
    expect(jarShot(138, 900, 1000, 1000)).toBeNull();
  });

  it("set the strip's cell by health as each shot is fired: 2 under 30%, 1 under 60%", () => {
    expect(btower).toMatch(
      /if \(_loc1_ < 0\.3\) \{\s+this\._jarAnimation\.gotoAndStop\(2\);[\s\S]*?else if \(_loc1_ < 0\.6\) \{\s+this\._jarAnimation\.gotoAndStop\(1\);/,
    );
    // `BTOWER.Fire` sets it before the tower's own `Fire` takes the jar's health.
    expect(btower).toMatch(
      /function Fire\(param1:IAttackable\):void \{\s+if \(this\._jarHealth\) \{\s+this\.UpdateJar\(\);/,
    );
    expect(jarFrame(2000, 2000)).toBe(0);
    expect(jarFrame(1200, 2000)).toBe(0);
    expect(jarFrame(1199, 2000)).toBe(1);
    expect(jarFrame(599, 2000)).toBe(2);
    expect(jarFrame(-5, 2000)).toBe(2);
  });
});

describe("the Jars in a fight", () => {
  /**
   * A tower at yard (700, 700), screen (0, 700), the Town Hall beside it for
   * the monsters to beat on, and a few Pokeys flung between the two, all well
   * inside the tower's range. A level 1 jar holds 2,000.
   */
  const hall = { id: 1, t: 14, l: 1, X: 820, Y: 820 };
  const pokeys: AttackEvent = {
    kind: "fling",
    t: 0,
    x: 760,
    y: 760,
    r: 0,
    monsters: { C1: 4 },
  };
  const jarsAt = (x = 700, y = 700): AttackEvent => ({
    kind: "siege",
    t: 0,
    x,
    y,
    weapon: "jars",
  });

  const battleOf = (
    extra: CombatBuildingDataMap,
    options: Partial<BattleOptions> = { siege: { jars: 1 } },
    events: AttackEvent[] = [pokeys, jarsAt()],
    health: Record<string, number> = {},
  ) => {
    const yard = buildEngineYard({
      buildingdata: { "1": hall, ...extra },
      buildinghealthdata: health,
      resources: { r1: 1_000_000, r2: 0, r3: 0, r4: 0 },
    });
    const battle = createBattle(yard, { seed: 5, ...options });
    for (const event of events) battle.apply(event);
    return { yard, battle };
  };

  /** The tick a jar dropped on tick 0 lands, from which the tower's shots hit it. */
  const landsAt = jarsPlan(1, 0)!.landsAt;

  /**
   * Runs `battle` tick by tick until the tower `id` can be attacked again, or
   * `limit`. A shot on its report with no shot drawn is one at its jar.
   * Returns that tick, its jar hits, the tick of the last, and its damage to
   * monsters from the landing to the last jar hit.
   */
  const untilFree = (
    built: ReturnType<typeof battleOf>,
    id: number,
    limit = 6000,
  ): { freedAt: number; shots: number; lastShotAt: number; dealt: number } => {
    const { yard, battle } = built;
    const tower = yard.buildings.find((building) => building.id === id)!;
    const reportAt = (tick: number) => {
      battle.runTo(tick);
      return battle.state().towers.find((entry) => entry.id === id)!;
    };
    const before = reportAt(landsAt - 1);
    let fired = before.shots;
    let shots = 0;
    let lastShotAt = -1;
    let dealt = 0;
    for (let tick = landsAt; tick <= limit; tick += 1) {
      const report = reportAt(tick);
      if (!tower.jarred) return { freedAt: tick, shots, lastShotAt, dealt };
      const drawn = battle
        .recentEvents(tick - 1)
        .filter((event) => event.kind === "shot" && event.towerId === id).length;
      if (report.shots - fired > drawn) {
        shots += report.shots - fired - drawn;
        lastShotAt = tick;
        dealt = report.damageDealt - before.damageDealt;
      }
      fired = report.shots;
    }
    throw new Error(`tower ${id} still jarred at ${limit}`);
  };

  it("does nothing without a level, and never jars a bunker", () => {
    const sniper = { "2": { id: 2, t: 21, l: 4, X: 700, Y: 700 } };
    const plain = battleOf(sniper, {}, [pokeys]).battle;
    const unlevelled = battleOf(sniper, {}).battle;
    for (const battle of [plain, unlevelled]) battle.runTo(600);
    expect(unlevelled.checkpoint()).toEqual(plain.checkpoint());

    const bunkers = {
      "2": { id: 2, t: 22, l: 1, X: 700, Y: 700 },
      "3": { id: 3, t: 128, l: 1, X: 640, Y: 700 },
    };
    const { yard } = battleOf(bunkers);
    expect(yard.buildings.filter((building) => building.jarred)).toEqual([]);
  });

  it("makes the tower untargetable at once; it shoots on till the jar lands", () => {
    const sniper = { "2": { id: 2, t: 21, l: 4, X: 700, Y: 700 } };
    const { yard } = battleOf(sniper);
    expect(yard.buildings.find((building) => building.id === 2)?.jarred).toBe(true);
    expect(yard.buildings.find((building) => building.id === 1)?.jarred).toBe(false);
  });

  it("takes a level 4 Sniper's five shots of 430, then breaks over 21 cells", () => {
    // 2,000 less 430 four times leaves 280, under 30%: cell 2 as the fifth is
    // fired, which breaks it. 21 more cells to 23 and the tower is free.
    const sniper = { "2": { id: 2, t: 21, l: 4, X: 700, Y: 700 } };
    const run = untilFree(battleOf(sniper), 2);
    expect(run.shots).toBe(Math.ceil(2000 / 430));
    expect(run.dealt).toBe(0);
    expect(run.freedAt - run.lastShotAt).toBe(JAR_FRAMES - 2);
  });

  it.each([
    ["Cannon", 20, 3],
    ["Laser", 23, 1],
    ["Tesla", 25, 3],
    ["Railgun", 118, 3],
    ["Quake Tower", 129, 1],
    ["Magma Tower", 132, 3],
    ["Spurtz Cannon", 136, 1],
    ["Black Spurtz Cannon", 137, 1],
  ])("takes a %s's shots times its multiple till it breaks", (_name, type, level) => {
    const tower = { "2": { id: 2, t: type, l: level, X: 700, Y: 700 } };
    const damage = towerStats(type, level)?.damage ?? 0;
    const each = jarShot(type, damage, 1, 1)!;
    const run = untilFree(battleOf(tower), 2);
    const shots = Math.ceil(2000 / each);
    expect(run.shots).toBe(shots);
    expect(run.dealt).toBe(0);
    // The strip breaks on from the cell its last `Fire` set. The Tesla's zaps
    // and the Spurtz's shells do not set it; their reloads do.
    if (type === 25 || isSpurtzCannon(type)) return;
    const cell = jarFrame(2000 - (shots - 1) * each, 2000);
    expect(run.freedAt - run.lastShotAt).toBe(JAR_FRAMES - cell);
  });

  it("shoots monsters again once free", () => {
    const sniper = { "2": { id: 2, t: 21, l: 4, X: 700, Y: 700 } };
    const built = battleOf(sniper);
    const run = untilFree(built, 2);
    built.battle.runTo(run.freedAt + 400);
    const report = built.battle.state().towers.find((entry) => entry.id === 2)!;
    expect(report.shots).toBeGreaterThan(run.shots);
    expect(report.damageDealt).toBeGreaterThan(0);
  });

  it("never lands on a Stronghold, which fires on and can still be hit (owner)", () => {
    const stronghold = { "2": { id: 2, t: 138, l: 1, X: 700, Y: 700 } };
    const built = battleOf(stronghold);
    const tower = built.yard.buildings.find((building) => building.id === 2)!;
    for (const tick of [1, landsAt, landsAt + 1, 1200]) {
      built.battle.runTo(tick);
      expect(tower.jarred).toBe(false);
    }
    const report = built.battle.state().towers.find((entry) => entry.id === 2)!;
    expect(report.damageDealt).toBeGreaterThan(0);
  });

  it("caps the other towers a drop touches but leaves the Stronghold beside them alone", () => {
    const both = {
      "2": { id: 2, t: 138, l: 1, X: 700, Y: 700 },
      "3": { id: 3, t: 21, l: 4, X: 720, Y: 720 },
    };
    const built = battleOf(both);
    built.battle.runTo(landsAt + 1);
    const jarred = (id: number) =>
      built.yard.buildings.find((building) => building.id === id)!.jarred;
    expect(jarred(3)).toBe(true);
    expect(jarred(2)).toBe(false);
  });

  it("lands on a fallen tower too, and that jar never breaks", () => {
    const sniper = { "2": { id: 2, t: 21, l: 4, X: 700, Y: 700 } };
    const { yard, battle } = battleOf(sniper, undefined, undefined, { "2": 0 });
    battle.runTo(1200);
    expect(yard.buildings.find((building) => building.id === 2)?.jarred).toBe(true);
  });

  /** The Vacuum on the Town Hall, to see whether the weapon slot is free. */
  const vacuum: AttackEvent = { kind: "siege", t: 0, x: 100, y: 100, weapon: "vacuum" };
  const both = { siege: { jars: 1, vacuum: 1 } };

  /** `extra`'s fight with `events`, and the Vacuum dropped after tick `at` or not at all. */
  const vacuumAfter = (
    extra: CombatBuildingDataMap,
    events: AttackEvent[],
    at: number | null,
    end: number,
  ) => {
    const { battle } = battleOf(extra, both, events);
    if (at !== null) {
      battle.runTo(at);
      battle.apply(vacuum);
    }
    battle.runTo(end);
    return battle.checkpoint();
  };

  it("dropped on no tower, they hold the weapon slot for good (Flash's NaN)", () => {
    const nothing = [pokeys, jarsAt(2000, 2000)];
    // Without the Jars the Vacuum does take; with them it is ignored.
    expect(vacuumAfter({}, [pokeys], 200, 800)).not.toEqual(
      vacuumAfter({}, [pokeys], null, 800),
    );
    expect(vacuumAfter({}, nothing, 200, 800)).toEqual(vacuumAfter({}, nothing, null, 800));
  });

  it("free the weapon slot on the first whole second after the last jar breaks", () => {
    const sniper = { "2": { id: 2, t: 21, l: 4, X: 700, Y: 700 } };
    const run = untilFree(battleOf(sniper, both), 2);
    // Broken on `lastShotAt`; the next whole second after the drop lets go.
    const freedSlot = Math.ceil((run.lastShotAt + 1) / JAR_CHECK_TICKS) * JAR_CHECK_TICKS;
    const events = [pokeys, jarsAt()];
    const end = freedSlot + 400;
    const without = vacuumAfter(sniper, events, null, end);
    expect(vacuumAfter(sniper, events, freedSlot - 1, end)).toEqual(without);
    expect(vacuumAfter(sniper, events, freedSlot, end)).not.toEqual(without);
  });
});
