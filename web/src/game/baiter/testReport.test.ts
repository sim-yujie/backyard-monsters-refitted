import { describe, expect, it } from "vitest";
import {
  buildEngineYard,
  clockOf,
  createBattle,
  maxHp,
  type Battle,
  type CombatBuildingDataMap,
  type FlingEvent,
} from "@/game/combat/rules";
import { buildTestReport, resultOf, type ReportBuilding, type TestReportInput } from "./testReport";

/**
 * A Baiter test's report (#22, WP4, `docs/design/baiter-simulator.md` §7)
 * read off a headless battle: its rows are the engine's own counters (WP0),
 * named and sorted for the panel.
 */

const yardOf = (buildings: CombatBuildingDataMap) =>
  buildEngineYard({ buildingdata: buildings, buildinghealthdata: {}, resources: { r1: 0, r2: 0, r3: 0, r4: 0 } });

const buildingsOf = (buildings: CombatBuildingDataMap): ReportBuilding[] =>
  Object.values(buildings).map((raw) => {
    const type = Number(raw.t);
    const level = Number(raw.l ?? 1);
    return { id: Number(raw.id), type, level, maxHp: maxHp(type, level) };
  });

const run = (battle: Battle, ticks: number): void => {
  for (let step = 0; step < ticks && !battle.over(); step += 1) battle.step();
};

const fling = (x: number, y: number, monsters: Record<string, number>, champion?: { t: number; l: number }): FlingEvent => ({
  kind: "fling",
  t: 0,
  x,
  y,
  r: 100,
  monsters,
  ...(champion ? { champion } : {}),
});

/** The report of `battle` on `buildings`, ended for `endReason`. */
const reportOf = (
  battle: Battle,
  buildings: CombatBuildingDataMap,
  extra: Partial<TestReportInput> = {},
) => {
  const state = battle.state();
  return buildTestReport({
    state,
    endReason: "exhausted",
    buildings: buildingsOf(buildings),
    damagePercent: 12.6,
    buildingsDestroyed: state.destroyedIds.length,
    buildingsTotal: Object.keys(buildings).length,
    ...extra,
  });
};

/** Two level-1 Cannon Towers far apart, and a Town Hall. */
const TWO_CANNONS: CombatBuildingDataMap = {
  "1": { id: 1, t: 20, l: 1, X: 0, Y: 0 },
  "2": { id: 2, t: 20, l: 1, X: 900, Y: 900 },
  "3": { id: 3, t: 14, l: 1, X: -900, Y: 900 },
};

describe("a Baiter test's report", () => {
  it("lists each tower with the engine's own counters, named, timed and with its fate", () => {
    const battle = createBattle(yardOf(TWO_CANNONS), { seed: 1 });
    battle.apply(fling(-100, -100, { C1: 3 }));
    run(battle, 2400);
    const state = battle.state();
    const report = reportOf(battle, TWO_CANNONS);

    const near = state.towers.find((tower) => tower.id === 1)!;
    expect(near.firstShotTick).not.toBeNull();
    const row = report.towers.find((tower) => tower.id === 1)!;
    expect(row).toMatchObject({
      name: "Cannon Tower L1",
      damage: near.damageDealt,
      kills: near.kills,
      shots: near.shots,
      firstShot: clockOf(near.firstShotTick!),
      fired: true,
    });
    const health = state.health["1"] ?? maxHp(20, 1);
    expect(row.fate).toBe(
      near.destroyedTick === null
        ? `Standing, ${Math.floor((health / maxHp(20, 1)) * 100)}%`
        : `Destroyed at ${clockOf(near.destroyedTick)}`,
    );
  });

  it("sorts the towers by damage, the ones that never fired at the bottom, and says so", () => {
    const battle = createBattle(yardOf(TWO_CANNONS), { seed: 1 });
    battle.apply(fling(-100, -100, { C1: 3 }));
    run(battle, 2400);
    const report = reportOf(battle, TWO_CANNONS);

    expect(report.towers.map((tower) => tower.id)).toEqual([1, 2]);
    expect(report.towers[1]).toMatchObject({ firstShot: "Never fired", fired: false, damage: 0, fate: "Standing, 100%" });
    expect(report.hint).toBe("1 tower never fired.");
  });

  it("says when a ground-only tower met an army that only flew", () => {
    const yard: CombatBuildingDataMap = {
      "1": { id: 1, t: 20, l: 1, X: 0, Y: 0 },
      "2": { id: 2, t: 14, l: 1, X: -900, Y: 900 },
    };
    const battle = createBattle(yardOf(yard), { seed: 1 });
    battle.apply(fling(-100, -100, { C14: 2 }));
    run(battle, 800);
    const report = reportOf(battle, yard, { endReason: "retreat" });
    expect(report.hint).toBe("Your Cannon Tower can't hit flying monsters, and this army flew.");
    expect(report.towers[0]!.firstShot).toBe("Never fired");

    // A Pokey among them walks, so the hint falls back to the silent towers.
    const mixed = createBattle(yardOf(yard), { seed: 1 });
    mixed.apply(fling(900, 900, { C14: 1, C1: 1 }));
    run(mixed, 40);
    expect(reportOf(mixed, yard).hint).toBe("1 tower never fired.");
  });

  it("has nothing to hint before anything was dropped", () => {
    const battle = createBattle(yardOf(TWO_CANNONS), { seed: 1 });
    const report = reportOf(battle, TWO_CANNONS, { endReason: "retreat" });
    expect(report.hint).toBeNull();
    expect(report.attackers).toEqual([]);
    expect(report).toMatchObject({ result: "stopped", resultLine: "Stopped", attackersSent: 0, attackersBeaten: 0 });
  });

  it("counts its times from the first drop, not from when the screen opened", () => {
    const battle = createBattle(yardOf(TWO_CANNONS), { seed: 1 });
    run(battle, 800);
    battle.apply({ ...fling(-100, -100, { C1: 3 }), t: battle.tick });
    run(battle, 1600);
    const state = battle.state();
    const near = state.towers.find((tower) => tower.id === 1)!;
    const report = reportOf(battle, TWO_CANNONS, { startTick: 800 });
    expect(report.time).toBe(clockOf(state.tick - 800));
    expect(report.towers[0]!.firstShot).toBe(clockOf(near.firstShotTick! - 800));
  });

  it("stops the time at the countdown, not counting the retreat after it (#308)", () => {
    const battle = createBattle(yardOf(TWO_CANNONS), { seed: 1 });
    battle.apply(fling(-100, -100, { C1: 3 }));
    run(battle, 800);
    // The countdown ran out at tick 400, and the monsters pulled back after it.
    expect(reportOf(battle, TWO_CANNONS, { endReason: "expired", countdownTick: 400 }).time).toBe(clockOf(400));
    // Ended before the countdown ran out: the real time.
    expect(reportOf(battle, TWO_CANNONS, { countdownTick: 4000 }).time).toBe(clockOf(battle.tick));
    // Counted from the first drop all the same.
    expect(reportOf(battle, TWO_CANNONS, { countdownTick: 400, startTick: 100 }).time).toBe(clockOf(300));
  });

  it("says a champion that left the field alive retreated, with the health it left with (#308)", () => {
    const battle = createBattle(yardOf(TWO_CANNONS), { seed: 1 });
    battle.apply(fling(-100, -100, { C1: 2 }, { t: 1, l: 1 }));
    run(battle, 200);
    const health = battle.state().championsHp["G1"]!;
    expect(health).toBeGreaterThan(0);
    const fate = (extra: Partial<TestReportInput>) => reportOf(battle, TWO_CANNONS, extra).champions[0];

    // Gone from the field: called back, or home with the army.
    expect(fate({ championsOnField: [] })).toEqual({
      name: "Gorgo",
      survived: true,
      retreated: true,
      health,
      fellAt: null,
    });
    // Still out when the yard fell, or the test was stopped: it survived.
    expect(fate({ endReason: "destroyed", championsOnField: ["G1"] })).toMatchObject({ retreated: false, health });
    expect(fate({ endReason: "retreat", championsOnField: ["G1"] })).toMatchObject({ retreated: false });
    // When the time runs out the whole army pulls back, whoever is still out.
    expect(fate({ endReason: "expired", championsOnField: ["G1"] })).toMatchObject({ retreated: true, health });
  });

  it("credits a caged champion with every attacker it kills (#308)", () => {
    const yard: CombatBuildingDataMap = {
      "1": { id: 1, t: 114, l: 1, X: 0, Y: 0 },
      "2": { id: 2, t: 1, l: 1, X: 150, Y: 150 },
      "3": { id: 3, t: 1, l: 1, X: 1400, Y: 1400 },
    };
    const battle = createBattle(yardOf(yard), { seed: 3, defenderChampions: [{ t: 3, l: 6, hp: 200_000, pl: 3 }] });
    battle.apply({ kind: "fling", t: 0, x: 140, y: 140, r: 50, monsters: { C1: 4 } });
    run(battle, 6000);
    // Nothing else defends this yard: Fomor beat all four, and each one is his.
    expect(battle.state().creepsKilled).toBe(4);
    expect(reportOf(battle, yard).cagedChampions).toEqual([
      { name: "Fomor", damage: battle.state().defenderChampions[0]!.damageDealt, kills: 4, health: expect.any(Number) },
    ]);

    // Healers heal back what he deals: a lot of damage, and no kills to show for it.
    const healed = createBattle(yardOf(yard), { seed: 3, defenderChampions: [{ t: 3, l: 2, hp: 200_000, pl: 0 }] });
    healed.apply({ kind: "fling", t: 0, x: 140, y: 140, r: 50, monsters: { C15: 4 } });
    run(healed, 33_600);
    const [fomor] = healed.state().defenderChampions;
    expect(fomor!.hp).toBeGreaterThan(0);
    expect(fomor!.damageDealt).toBeGreaterThan(5000);
    expect(fomor!.kills).toBe(0);
    expect(healed.state().creepsKilled).toBe(0);
  });

  it("reads one result line per end reason", () => {
    expect(resultOf("exhausted")).toBe("held");
    expect(resultOf("destroyed")).toBe("flattened");
    expect(resultOf("expired")).toBe("time");
    expect(resultOf("retreat")).toBe("stopped");
    expect(resultOf("left")).toBe("stopped");
    expect(resultOf(null)).toBe("stopped");
    const battle = createBattle(yardOf(TWO_CANNONS), { seed: 1 });
    const lines = (["exhausted", "destroyed", "expired", "retreat"] as const).map(
      (endReason) => reportOf(battle, TWO_CANNONS, { endReason }).resultLine,
    );
    expect(lines).toEqual(["Your yard held", "Flattened", "Time ran out", "Stopped"]);
  });

  it("lists the attackers as the engine counted them, then the champion with its fate", () => {
    const battle = createBattle(yardOf(TWO_CANNONS), { seed: 1 });
    battle.apply(fling(-100, -100, { C1: 6, C7: 2 }, { t: 1, l: 1 }));
    run(battle, 1600);
    const state = battle.state();
    const report = reportOf(battle, TWO_CANNONS, { championFell: { G1: 400 } });

    const monsters = state.attackers.filter((row) => !row.champion);
    expect(report.attackers.map((row) => row.name)).toEqual(["Pokey L1", "Bandito L1", "Gorgo L1"]);
    for (const [index, engine] of state.attackers.entries()) {
      expect(report.attackers[index]).toMatchObject({
        sent: engine.sent,
        lost: engine.lost,
        buildingDamage: engine.buildingDamage,
        champion: engine.champion,
      });
    }
    expect(report.attackersSent).toBe(monsters.reduce((sum, row) => sum + row.sent + row.spawned, 0));
    expect(report.attackersBeaten).toBe(monsters.reduce((sum, row) => sum + row.lost, 0));

    expect(state.attackers.find((row) => row.champion)?.sent).toBe(1);
    const gorgo = state.championsHp["G1"]!;
    expect(report.champions).toEqual([
      gorgo > 0
        ? { name: "Gorgo", survived: true, retreated: false, health: gorgo, fellAt: null }
        : { name: "Gorgo", survived: false, retreated: false, health: 0, fellAt: "0:05" },
    ]);
    expect(report.time).toBe(clockOf(state.tick));
  });

  it("lists the traps that went off, the bunkers' garrisons and the caged champion", () => {
    const yard: CombatBuildingDataMap = {
      "1": { id: 1, t: 22, l: 1, X: 0, Y: 0 },
      "2": { id: 2, t: 24, l: 1, X: 240, Y: 240 },
      "3": { id: 3, t: 114, l: 1, X: -600, Y: -600 },
      "4": { id: 4, t: 14, l: 1, X: 1200, Y: 1200 },
    };
    const battle = createBattle(yardOf(yard), {
      seed: 3,
      bunkers: { 1: { C1: 4 } },
      defenderChampions: [
        { t: 5, l: 2, hp: 6000, pl: 1 },
        { t: 1, l: 2, hp: 5000, pl: 1 },
      ],
    });
    battle.apply({ kind: "fling", t: 0, x: 270, y: 270, r: 30, monsters: { C1: 3 } });
    run(battle, 3000);
    const state = battle.state();
    const report = reportOf(battle, yard);

    expect(state.traps.length).toBeGreaterThan(0);
    expect(report.traps).toEqual(
      state.traps.map((trap) => ({
        id: trap.id,
        name: expect.any(String),
        at: clockOf(trap.tick),
        damage: trap.damageDealt,
        kills: trap.kills,
      })),
    );
    const bunker = state.bunkers[0]!;
    expect(report.bunkers).toEqual([
      expect.objectContaining({ id: 1, name: "Monster Bunker L1", held: 4, sent: bunker.sent, damage: bunker.damageDealt, kills: bunker.kills }),
    ]);
    // One row per caged champion, in cage order (issue #310).
    expect(state.defenderChampions).toHaveLength(2);
    expect(report.cagedChampions).toEqual(
      state.defenderChampions.map((caged, at) => ({
        name: at === 0 ? "Krallen" : "Gorgo",
        damage: caged.damageDealt,
        kills: caged.kills,
        health: caged.hp,
      })),
    );
  });
});
