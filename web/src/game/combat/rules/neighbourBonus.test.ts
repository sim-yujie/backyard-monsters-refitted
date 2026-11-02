import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { createBattle, type BattleOptions } from "./engine.js";
import {
  battleDefence,
  NEIGHBOUR_DEFENCE_BONUS,
  neighbourDefenceBonus,
  parseDefenderForces,
  type DefenderForces,
} from "./defence.js";
import { replayAttack } from "./replay.js";
import { buildEngineYard } from "./yard.js";
import type { CombatBuildingDataMap } from "./types.js";

/**
 * Map Room 2's neighbour defence bonus (`docs/mr2-neighbours.md`): tower
 * damage up and building damage down by the share the count of friendly
 * neighbours gives, and a battle without it exactly the battle it always was.
 */

const yardOf = (buildings: CombatBuildingDataMap) =>
  buildEngineYard({
    buildingdata: buildings,
    buildinghealthdata: {},
    resources: { r1: 100000, r2: 0, r3: 0, r4: 0 },
  });

const run = (battle: ReturnType<typeof createBattle>, ticks: number): void => {
  for (let step = 0; step < ticks && !battle.over(); step += 1) battle.step();
};

/** A level 1 Cannon Tower (damage 20) against one Pokey (200 health, 60 a swing). */
const CANNON: CombatBuildingDataMap = { "1": { id: 1, t: 20, l: 1, X: 0, Y: 0 } };
/** The same tower being upgraded: silent, so the Pokey only swings. */
const SILENT: CombatBuildingDataMap = { "1": { id: 1, t: 20, l: 1, X: 0, Y: 0, cU: 600 } };

const pokeyBattle = (buildings: CombatBuildingDataMap, extra: Partial<BattleOptions> = {}) => {
  const yard = yardOf(buildings);
  const battle = createBattle(yard, { seed: 1, shellBlastsWhereItLands: false, ...extra });
  battle.apply({ kind: "fling", t: 0, x: -100, y: -100, r: 200, monsters: { C1: 1 } });
  return { yard, battle };
};

const checkpointAfter = (buildings: CombatBuildingDataMap, extra: Partial<BattleOptions>, ticks: number) => {
  const { battle } = pokeyBattle(buildings, extra);
  run(battle, ticks);
  return battle.checkpoint();
};

const lost = (yard: ReturnType<typeof yardOf>) => yard.buildings[0]!.maxHp - yard.buildings[0]!.hp;

const FIXTURES = fileURLToPath(new URL("../../../../test/fixtures/combat/", import.meta.url));
const SANDBOX = fileURLToPath(new URL("../../../../test/fixtures/baseload-sandbox-yard.json", import.meta.url));
const read = (path: string) => JSON.parse(readFileSync(path, "utf8")) as Record<string, never>;

/** The bench battle on the sandbox yard: four flings, a champion, a bomb. */
const mixedWaves = (extra: { defenceBonus?: BattleOptions["defenceBonus"] } = {}) => {
  const fixture = read(`${FIXTURES}mixed-waves.json`);
  const sandbox = read(SANDBOX);
  return replayAttack({
    buildingdata: sandbox.buildingdata,
    buildinghealthdata: sandbox.buildinghealthdata,
    resources: sandbox.resources,
    kind: fixture.kind,
    log: fixture.log,
    levels: fixture.levels,
    playerLevel: fixture.playerLevel,
    tailTicks: fixture.tailTicks,
    ...extra,
  });
};

const FORCES: DefenderForces = { bunkers: {}, defenderLevels: {}, defenderChampions: [] };

describe("switched off: the battle as it always was", () => {
  it.each<[string, BattleOptions["defenceBonus"]]>([
    ["an empty bonus", {}],
    ["a bonus of nothing", { hp: 0, damage: 0 }],
    ["a negative bonus, which is ignored", { hp: -0.5, damage: -0.5 }],
  ])("plays the Cannon battle exactly as before with %s", (_name, defenceBonus) => {
    expect(checkpointAfter(CANNON, { defenceBonus }, 1500)).toEqual(checkpointAfter(CANNON, {}, 1500));
  });

  it("replays the bench battle to the same digest with no neighbours served", () => {
    const plain = mixedWaves();
    const served = mixedWaves(battleDefence(parseDefenderForces({ ...FORCES })));
    expect(served.digest).toBe(plain.digest);
    expect(served.damage).toBe(plain.damage);
  });

  it("serves no bonus for 0 neighbours, or a count it cannot read", () => {
    for (const neighbours of [undefined, 0, -1, 1.5, Number.NaN]) {
      expect(neighbourDefenceBonus(neighbours)).toBeUndefined();
      expect(battleDefence({ ...FORCES, ...(neighbours === undefined ? {} : { neighbours }) })).toEqual({});
    }
  });

  it("drops a count it cannot read from a stored defence", () => {
    expect(parseDefenderForces({ ...FORCES, neighbours: "3" })?.neighbours).toBeUndefined();
    expect(parseDefenderForces({ ...FORCES, neighbours: 0 })?.neighbours).toBeUndefined();
    expect(parseDefenderForces({ ...FORCES })?.neighbours).toBeUndefined();
  });
});

describe("the table", () => {
  it("rises with every neighbour, by less each time, to +24% at six", () => {
    expect(NEIGHBOUR_DEFENCE_BONUS).toEqual([0, 0.08, 0.14, 0.18, 0.2, 0.22, 0.24]);
    for (let n = 1; n <= 6; n += 1) {
      expect(NEIGHBOUR_DEFENCE_BONUS[n]!).toBeGreaterThan(NEIGHBOUR_DEFENCE_BONUS[n - 1]!);
    }
  });

  it("boosts building health and tower damage alike", () => {
    expect(neighbourDefenceBonus(1)).toEqual({ hp: 0.08, damage: 0.08 });
    expect(neighbourDefenceBonus(6)).toEqual({ hp: 0.24, damage: 0.24 });
    // More than six cannot happen on a hex grid; it reads as six.
    expect(neighbourDefenceBonus(9)).toEqual({ hp: 0.24, damage: 0.24 });
  });

  it("keeps a served count through the attack session and into the battle", () => {
    const forces = parseDefenderForces({ ...FORCES, neighbours: 2 });
    expect(forces?.neighbours).toBe(2);
    expect(battleDefence(forces).defenceBonus).toEqual({ hp: 0.14, damage: 0.14 });
  });
});

describe("switched on", () => {
  it("puts 21 on the Cannon's first shot with one neighbour, int(20 x 1.08)", () => {
    const { battle } = pokeyBattle(CANNON, { defenceBonus: { damage: 0.08 } });
    let hurt: number | undefined;
    for (let step = 0; step < 400 && hurt === undefined; step += 1) {
      battle.step();
      hurt = battle.recentEvents(0).find((event) => event.kind === "hurt")?.amount;
    }
    expect(hurt).toBe(21);
  });

  it("stacks on Tower Overdrive: int(20 x 1.25 x 1.24) = 31", () => {
    const { battle } = pokeyBattle(CANNON, {
      defenceBonus: { damage: 0.24 },
      buffs: { defender: { towerDamage: true } },
    });
    let hurt: number | undefined;
    for (let step = 0; step < 400 && hurt === undefined; step += 1) {
      battle.step();
      hurt = battle.recentEvents(0).find((event) => event.kind === "hurt")?.amount;
    }
    expect(hurt).toBe(31);
  });

  it("makes a building take 1 / 1.08 of each swing", () => {
    const plain = pokeyBattle(SILENT);
    const tough = pokeyBattle(SILENT, { defenceBonus: { hp: 0.08 } });
    run(plain.battle, 1500);
    run(tough.battle, 1500);
    const swings = lost(plain.yard) / 60;
    expect(swings).toBeGreaterThan(0);
    expect(lost(tough.yard)).toBeCloseTo((swings * 60) / 1.08, 6);
    // Its health ceiling stays where it was: only the damage shrinks.
    expect(tough.yard.buildings[0]!.maxHp).toBe(plain.yard.buildings[0]!.maxHp);
  });

  it("leaves the attacker's Pokey hitting as hard when only tower damage is boosted", () => {
    const plain = pokeyBattle(SILENT);
    const boosted = pokeyBattle(SILENT, { defenceBonus: { damage: 0.24 } });
    run(plain.battle, 1500);
    run(boosted.battle, 1500);
    expect(lost(boosted.yard)).toBe(lost(plain.yard));
  });

  it("does less to the sandbox yard in the bench battle with six neighbours", () => {
    const plain = mixedWaves();
    const ringed = mixedWaves({ defenceBonus: neighbourDefenceBonus(6) });
    expect(ringed.digest).not.toBe(plain.digest);
    expect(ringed.damage).toBeLessThan(plain.damage);
  });
});
