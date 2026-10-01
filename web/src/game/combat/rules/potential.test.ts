import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { KRALLEN_ID } from "./champions";
import { createBattle } from "./engine";
import {
  auditDamageBudget,
  auditLoot,
  bankedByResource,
  bombPotential,
  bombsPotential,
  championPotential,
  enrageBound,
  lootAuraBound,
  quakePotential,
  damagePotential,
  harvesterResource,
  lootCaps,
  monsterPotential,
  REZGHUL_ID,
  specialistBound,
  swings,
} from "./potential";
import { BOMBS, maxBombDamage, maxBombSpend } from "./stats";
import {
  noAmounts,
  toCombatYard,
  type AttackContext,
  type CombatBuildingDataMap,
  type ChampionOnField,
  type ResourceAmounts,
  type Roster,
} from "./types";
import { buildEngineYard } from "./yard";

const SANDBOX = fileURLToPath(
  new URL("../../../../test/fixtures/baseload-sandbox-yard.json", import.meta.url),
);

/**
 * The damage budget and the loot bounds (§2.3, §2.4).
 *
 * Every figure is hand-computed from the stat table and named in the case, so a
 * ladder that moves or a multiplier that is dropped fails here rather than
 * quietly widening the envelope a forged save has to clear. The worked examples
 * `docs/design/server-combat.md` §4.1 cites are the first four cases.
 */

const HARVESTER = 1;

const yardWith = (
  buildings: readonly (readonly [id: number, type: number, banked?: number])[] = [],
) => {
  const buildingdata: Record<string, CombatBuildingDataMap[string]> = {};
  for (const [id, type, banked] of buildings) {
    buildingdata[String(id)] = { id, t: type, X: 0, Y: 0, ...(banked ? { st: banked } : {}) };
  }
  return toCombatYard({ buildingdata });
};

interface ContextOptions {
  readonly flung?: Roster;
  readonly levels?: Readonly<Record<string, number>>;
  readonly elapsedSave?: number;
  readonly champion?: ChampionOnField | null;
  readonly catapultLevel?: number;
  readonly pool?: Partial<ResourceAmounts>;
  readonly caps?: Partial<ResourceAmounts>;
  readonly playerLevel?: number;
  readonly hasVacuum?: boolean;
  readonly yardBuildings?: readonly (readonly [id: number, type: number, banked?: number])[];
}

const contextOf = (options: ContextOptions = {}): AttackContext => ({
  startedAt: 1000,
  now: 1000 + (options.elapsedSave ?? 10),
  elapsedAttack: options.elapsedSave ?? 10,
  elapsedSave: options.elapsedSave ?? 10,
  levels: options.levels ?? {},
  flung: options.flung ?? {},
  champion: options.champion ?? null,
  yard: yardWith(options.yardBuildings ?? []),
  attacker: {
    pool: { ...noAmounts(), ...options.pool },
    caps: { r1: 1e9, r2: 1e9, r3: 1e9, r4: 1e9, ...options.caps },
    playerLevel: options.playerLevel ?? 30,
    catapultLevel: options.catapultLevel ?? 0,
    hasVacuum: options.hasVacuum ?? false,
  },
});

describe("swings", () => {
  it("counts the swing on the first tick as well as the ones after it", () => {
    // §2.3: `floor(elapsed * 80 / delay) + 1`. A creep already in range when
    // the last save went out swings immediately.
    expect(swings(10, 60)).toBe(14);
    expect(swings(0, 60)).toBe(1);
    expect(swings(10, 8)).toBe(101);
  });

  it("reads a delay of 0 as one tick rather than dividing by it", () => {
    expect(swings(1, 0)).toBe(81);
  });
});

describe("monsterPotential", () => {
  it("bounds one level 1 Pokey over 10 s at 840", () => {
    // `60 * (floor(800 / 60) + 1)`, the worked example of §4.1. Damage 60,
    // target group 1 so no specialist double, no splash, the default delay.
    expect(monsterPotential("C1", 1, 1, 10)).toBe(840);
  });

  it("counts an Eye-ra's damage once, doubled, because it dies on its blast", () => {
    // `explode: [1]` (`CreepBase.as:896-898`) and target group 2, so the wall
    // specialist's double applies to a single 4,000 hit.
    expect(monsterPotential("C5", 1, 1, 10)).toBe(8000);
    // The interval does not change it: there is only ever one blast.
    expect(monsterPotential("C5", 1, 1, 300)).toBe(8000);
  });

  it("doubles a tower specialist's swing", () => {
    // Octo-ooze is target group 4: damage 15, doubled, over 14 swings.
    expect(specialistBound(4)).toBe(2);
    expect(monsterPotential("C2", 1, 1, 10)).toBe(15 * 2 * 14);
  });

  it("gives a splash creep the six footprints its blast can cover", () => {
    // Fink's `AOEDamageOnAttack(60, …)` (`creeps/Fink.as:12-17`): damage 300,
    // group 1, six footprints, 14 swings.
    expect(monsterPotential("C4", 1, 1, 10)).toBe(300 * 14 * 6);
    // D.A.V.E.'s two rockets are half damage each, so it stays at one.
    expect(monsterPotential("C12", 1, 1, 10)).toBe(1500 * 14);
  });

  it("gives a healer nothing, rather than a negative budget", () => {
    // C15 and C16 carry negative damage (`docs/specs/combat.md:508-510`).
    expect(monsterPotential("C15", 1, 1, 10)).toBe(0);
    expect(monsterPotential("C16", 6, 50, 300)).toBe(0);
  });

  it("adds a Slimeattikus's children at its own level", () => {
    // `splits` is 2 at level 1 (`creeps/Slimeattikus.as:11-13`); the children
    // are C18 at 310 damage.
    const own = 850 * 14;
    const children = 310 * 14 * 2;
    expect(monsterPotential("C17", 1, 1, 10)).toBe(own + children);
  });

  it("scales with the count and clamps a level past the ladder", () => {
    expect(monsterPotential("C1", 1, 30, 10)).toBe(840 * 30);
    // `CREATURES.GetProperty` shortens the level to the array (`:75-77`).
    expect(monsterPotential("C1", 9, 1, 10)).toBe(85 * 14);
  });

  it("is 0 for a count of 0 and for a monster the table does not hold", () => {
    expect(monsterPotential("C1", 1, 0, 10)).toBe(0);
    expect(monsterPotential("NOPE", 1, 5, 10)).toBe(0);
  });
});

describe("championPotential", () => {
  it("uses the champion's own swing interval", () => {
    // Gorgo swings at the 56-tick default (`ChampionBase.as:164`).
    expect(championPotential("G1", 1, 10)).toBe(1000 * 15);
    // Fomor is G3 and swings every 8 ticks (`champions/Fomor.as:12`).
    expect(championPotential("G3", 1, 10)).toBe(70 * 101);
  });

  it("gives a Korath without his quake one target a swing", () => {
    // G4, 72 ticks at level 1 (`champions/Korath.as:25-46`); the quake needs
    // power level 3 at level 5 (`:184`, issue #222).
    expect(championPotential("G4", 1, 10)).toBe(2000 * 12);
  });

  it("adds the power level's bonus damage (issue #202)", () => {
    // Gorgo level 1, power level 3: 1,000 + 600, 15 swings in 10 s.
    expect(championPotential("G1", 1, 10, 3)).toBe(1600 * 15);
  });

  it("bounds Korath's quakes from the yard: one per three swings, plus one (issue #222)", () => {
    // Level 5, power level 3: 5,000 + 1,000 damage every 80 ticks, 11 swings
    // in 10 s, so 4 quakes. Two level 1 Town Halls (4,000 each) side by side:
    // a quake takes at most both.
    const yard = contextOf({ yardBuildings: [[1, 14], [2, 14]] }).yard;
    expect(quakePotential(yard, 65 * 2.5, 6000)).toBe(8000);
    expect(championPotential("G4", 5, 10, 3, yard)).toBe(6000 * 11 + 4 * 8000);
    // One power level short, no quake.
    expect(championPotential("G4", 5, 10, 2, yard)).toBe(5600 * 11);
  });

  it("speeds the monsters and Krallen up under Fomor's enrage, not Fomor itself (issue #222)", () => {
    // Fomor level 6, power level 3: buff 0.6 + 0.15, so swings come
    // 1 + 2 * 0.75 = 2.5 times as fast: a Pokey's 30-tick swing every 12.
    expect(enrageBound([{ id: "G3", level: 6, powerLevel: 3 }])).toBeCloseTo(2.5, 12);
    expect(enrageBound([{ id: "G1", level: 6, powerLevel: 3 }])).toBe(1);
    const context = contextOf({
      flung: { C1: 1 },
      champion: null,
    });
    const plain = damagePotential(context).breakdown.monsters;
    const enraged = damagePotential({
      ...context,
      champions: [
        { id: "G3", level: 6, powerLevel: 3 },
        { id: KRALLEN_ID, level: 1, powerLevel: 0 },
      ],
    }).breakdown;
    expect(enraged.monsters).toBeGreaterThan(plain);
    expect(enraged.champion).toBe(
      championPotential("G3", 6, 10, 3) + championPotential(KRALLEN_ID, 1, 10, 0, null, 2.5),
    );
  });
});

describe("damagePotential", () => {
  it("sums the roster, the champion and the bombs", () => {
    const context = contextOf({
      flung: { C1: 30 },
      champion: { id: "G1", level: 1, powerLevel: 0 },
      catapultLevel: 2,
      // A level 1 Town Hall, 4,000 health: each bomb can take all of it.
      yardBuildings: [[1, 14]],
    });
    const report = damagePotential(context);
    expect(report.breakdown.monsters).toBe(840 * 30);
    expect(report.breakdown.champion).toBe(1000 * 15);
    expect(report.breakdown.bombs).toBe(2 * 4000);
    expect(report.breakdown.zombies).toBe(0);
    expect(report.potential).toBe(840 * 30 + 1000 * 15 + 2 * 4000);
  });

  it("adds no bombs at catapult 0, and none at any level over an empty yard", () => {
    // The face damage is still 125,000 at catapult 2 (`ResourceBombs.as:48-226`),
    // but a bomb that lands on nothing takes nothing off (issue #84).
    expect(maxBombDamage(2)).toBe(125_000);
    expect(damagePotential(contextOf({ catapultLevel: 3 })).breakdown.bombs).toBe(0);
    const yardBuildings = [[1, 14]] as const;
    expect(damagePotential(contextOf({ yardBuildings })).breakdown.bombs).toBe(0);
  });

  it("doubles the roster term when a Rezghul is on the field", () => {
    // `RezghulResurrectAttack` is always on (`creeps/Rezghul.as:48-53`), so
    // every flung monster may fight twice.
    const context = contextOf({ flung: { C1: 10, [REZGHUL_ID]: 1 } });
    const report = damagePotential(context);
    expect(report.breakdown.zombies).toBe(report.breakdown.monsters);
    expect(report.potential).toBe(report.breakdown.monsters * 2);
  });

  it("takes each monster at its academy level", () => {
    const context = contextOf({ flung: { C1: 1 }, levels: { C1: 6 } });
    // `monsterStat("C1", "damage", 6)` is 85 (`docs/specs/combat.md:501`).
    expect(damagePotential(context).potential).toBe(85 * 14);
  });

  it("slacks by 1%, never below 1,000 hit points", () => {
    const small = damagePotential(contextOf({ flung: { C1: 1 } }));
    expect(small.potential).toBe(840);
    expect(small.slack).toBe(1000);
    expect(small.limit).toBe(1840);

    const large = damagePotential(contextOf({ flung: { C1: 1000 } }));
    expect(large.slack).toBeCloseTo(large.potential * 0.01, 6);
  });

  it("is empty only with nothing flung, no champion and no catapult", () => {
    expect(damagePotential(contextOf()).empty).toBe(true);
    expect(damagePotential(contextOf({ flung: { C1: 0 } })).empty).toBe(true);
    expect(damagePotential(contextOf({ flung: { C1: 1 } })).empty).toBe(false);
    expect(damagePotential(contextOf({ catapultLevel: 1 })).empty).toBe(false);
    expect(
      damagePotential(contextOf({ champion: { id: "G1", level: 1, powerLevel: 0 } })).empty,
    ).toBe(false);
  });
});

describe("auditDamageBudget", () => {
  it("passes a drop inside the envelope", () => {
    const context = contextOf({ flung: { C1: 300 } });
    const { violations, report } = auditDamageBudget(context, 100_000);
    expect(report.potential).toBe(840 * 300);
    expect(violations).toEqual([]);
  });

  it("refuses a drop past the envelope", () => {
    // Ten Pokeys over 10 s bound 8,400, and the slack is 1,000.
    const context = contextOf({ flung: { C1: 10 } });
    const { violations } = auditDamageBudget(context, 3_000_000);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.rule).toBe("damageBudget");
    expect(violations[0]?.enforced).toBe(true);
    expect(violations[0]?.detail).toMatchObject({
      drop: 3_000_000,
      potential: 8400,
      elapsed: 10,
    });
  });

  it("passes the same drop with a roster that could have dealt it", () => {
    // 300 Pokeys over 10 s bound 252,000, so a 3,000,000 drop still fails;
    // over the full 540 s they bound far more than the yard holds.
    const context = contextOf({ flung: { C1: 300 }, elapsedSave: 540 });
    expect(auditDamageBudget(context, 3_000_000).violations).toEqual([]);
  });

  it("refuses any drop at all with nothing on the field", () => {
    const { violations } = auditDamageBudget(contextOf(), 1);
    expect(violations).toEqual([
      { rule: "damageWithoutMonsters", detail: { drop: 1 }, enforced: true },
    ]);
  });

  it("says nothing when nothing was flung and nothing fell", () => {
    expect(auditDamageBudget(contextOf(), 0).violations).toEqual([]);
  });

  it("allows a bomb-only drop when the attacker owns a catapult", () => {
    // Three 4,000-health Town Halls under both bombs: 24,000, slack 1,000.
    const yardBuildings = [
      [1, 14],
      [2, 14],
      [3, 14],
    ] as const;
    const context = contextOf({ catapultLevel: 2, yardBuildings });
    expect(auditDamageBudget(context, 20_000).violations).toEqual([]);
    expect(auditDamageBudget(context, 30_000).violations).toHaveLength(1);
  });
});

describe("bombs (issue #84)", () => {
  const twigs = BOMBS.find((bomb) => bomb.id === "tw2")!;
  const pebbles = BOMBS.find((bomb) => bomb.id === "pb3")!;

  /** Buildings by `[id, type, X, Y, level]`, all at full health. */
  const placed = (rows: readonly (readonly [number, number, number, number, number?])[]) => {
    const buildingdata: Record<string, CombatBuildingDataMap[string]> = {};
    for (const [id, t, X, Y, l] of rows) buildingdata[String(id)] = { id, t, X, Y, l: l ?? 1 };
    return toCombatYard({ buildingdata });
  };

  it("counts every building a blast can cover, each up to its health", () => {
    // Five level 1 harvesters (500 health) side by side, and a sixth far off.
    const yard = placed([
      [1, 1, 0, 0],
      [2, 1, 60, 0],
      [3, 1, 0, 60],
      [4, 1, 60, 60],
      [5, 1, -60, 0],
      [6, 1, 1200, -1200],
    ]);
    expect(bombPotential(twigs, yard)).toBe(5 * 500);
    expect(bombPotential(pebbles, yard)).toBe(5 * 500);
    expect(bombsPotential(2, yard)).toBe(2 * 5 * 500);
  });

  it("takes a building at what the bomb deals it when that is less than its health", () => {
    // A level 3 wall has 5,750 health; a wall takes 6% of each particle's
    // share, int(250 * 0.06) = 15 of twigs and int(375 * 0.06) = 22 of pebbles,
    // two hundred times over.
    const yard = placed([[1, 17, 0, 0, 3]]);
    expect(bombPotential(twigs, yard)).toBe(15 * 200);
    expect(bombPotential(pebbles, yard)).toBe(22 * 200);
    expect(bombsPotential(2, yard)).toBe(3000 + 4400);
  });

  it("skips what a bomb cannot hurt and putty altogether", () => {
    // A trap, a decoration and a destroyed Town Hall.
    const yard = toCombatYard({
      buildingdata: {
        "1": { id: 1, t: 24, X: 0, Y: 0 },
        "2": { id: 2, t: 28, X: 40, Y: 0 },
        "3": { id: 3, t: 14, X: 0, Y: 40 },
      },
      buildinghealthdata: { "3": 0 },
    });
    expect(bombsPotential(3, yard)).toBe(0);
    const putty = BOMBS.find((bomb) => bomb.id === "pu3")!;
    expect(bombPotential(putty, placed([[1, 14, 0, 0]]))).toBe(0);
  });

  it("is never beaten by the engine, wherever the bomb lands", () => {
    // Forty buildings of mixed sizes crowded into a small plot, and two hundred
    // drop points over and around it, each bomb on its own.
    let state = 7;
    const next = (): number => {
      state = (Math.imul(state, 1103515245) + 12345) >>> 0;
      return state / 2 ** 32;
    };
    const types = [1, 2, 6, 14, 17, 20, 21];
    const buildingdata: Record<string, CombatBuildingDataMap[string]> = {};
    for (let id = 1; id <= 40; id += 1) {
      const t = types[Math.floor(next() * types.length)]!;
      const X = Math.round(next() * 500 - 250);
      const Y = Math.round(next() * 500 - 250);
      buildingdata[String(id)] = { id, t, X, Y, l: 1 + Math.floor(next() * 3) };
    }
    const input = { buildingdata, buildinghealthdata: {}, resources: {} };
    const combat = toCombatYard({ buildingdata });
    for (const bomb of [twigs, pebbles]) {
      const bound = bombPotential(bomb, combat);
      let worst = 0;
      for (let drop = 0; drop < 200; drop += 1) {
        const yard = buildEngineYard(input);
        const before = yard.buildings.reduce((sum, building) => sum + building.hp, 0);
        const battle = createBattle(yard, { seed: 1 });
        const x = next() * 800 - 400;
        const y = next() * 800 - 400;
        battle.apply({ kind: "bomb", t: 0, x, y, id: bomb.id });
        const after = yard.buildings.reduce((sum, building) => sum + building.hp, 0);
        expect(before - after).toBeLessThanOrEqual(bound);
        worst = Math.max(worst, before - after);
      }
      // Not a vacuous pass: some drops land in the thick of it.
      expect(worst).toBeGreaterThan(bound / 4);
    }
  });

  it("keeps a dense, honest bombing of the sandbox yard inside the budget", () => {
    // The owner's yard: 575 buildings, silos and all. Drop both top bombs on
    // every building's middle in turn, in the engine, and keep the worst.
    const sandbox = JSON.parse(readFileSync(SANDBOX, "utf8")) as {
      buildingdata: CombatBuildingDataMap;
      buildinghealthdata: Record<string, number>;
      resources: Record<string, number>;
    };
    const input = {
      buildingdata: sandbox.buildingdata,
      buildinghealthdata: sandbox.buildinghealthdata,
      resources: sandbox.resources,
    };
    let worst = 0;
    for (const target of buildEngineYard(input).buildings) {
      const yard = buildEngineYard(input);
      const before = yard.buildings.reduce((sum, building) => sum + building.hp, 0);
      const battle = createBattle(yard, { seed: 1 });
      const x = target.x + target.middle;
      const y = target.y + target.middle;
      battle.apply({ kind: "bomb", t: 0, x, y, id: "tw2" });
      battle.apply({ kind: "bomb", t: 0, x, y, id: "pb3" });
      const after = yard.buildings.reduce((sum, building) => sum + building.hp, 0);
      worst = Math.max(worst, before - after);
    }
    // The face damage, one bomb's worth per bomb, is nowhere near it: this is
    // the drop the old budget would have refused.
    expect(worst).toBeGreaterThan(maxBombDamage(2) * 5);

    const context: AttackContext = {
      ...contextOf({ catapultLevel: 2 }),
      yard: toCombatYard({
        buildingdata: sandbox.buildingdata,
        buildinghealthdata: sandbox.buildinghealthdata,
      }),
    };
    const { report, violations } = auditDamageBudget(context, worst);
    expect(violations).toEqual([]);
    expect(report.breakdown.bombs).toBeGreaterThanOrEqual(worst);
    // And it is still a bound, not a blank cheque: under three times the worst.
    expect(report.breakdown.bombs).toBeLessThan(worst * 3);
  });
});

describe("the loot bounds", () => {
  it("maps a harvester's type to its own resource", () => {
    // `BASE._resources["r" + _type]` (`client/scripts/BRESOURCE.as:106`).
    expect(harvesterResource(1)).toBe("r1");
    expect(harvesterResource(4)).toBe("r4");
    expect(harvesterResource(6)).toBeUndefined();
  });

  it("sums the harvesters' own buffers per resource", () => {
    const yard = yardWith([
      [1, 1, 300],
      [2, 1, 200],
      [3, 3, 50],
    ]);
    expect(bankedByResource(yard)).toEqual({ r1: 500, r2: 0, r3: 50, r4: 0 });
  });

  it("raises the cap by Krallen's buff and no other champion's", () => {
    const caps = { r1: 1000, r2: 1000, r3: 1000, r4: 1000 };
    const krallen = contextOf({ caps, champion: { id: KRALLEN_ID, level: 1, powerLevel: 0 } });
    // `buffs[0]` is 0.2 for Krallen (`ATTACK.as:696-702`).
    expect(lootCaps(krallen).r1).toBeCloseTo(1200, 6);
    // Fomor's `buffs` ladder is an enrage aura, not a storage cap.
    const fomor = contextOf({ caps, champion: { id: "G3", level: 1, powerLevel: 0 } });
    expect(lootCaps(fomor).r1).toBe(1000);
    expect(lootCaps(contextOf({ caps })).r1).toBe(1000);
  });

  it("refuses a gain more than 1.6 times the matching loss", () => {
    // §4.1: 1,601 against 1,000 fails, 1,600 passes.
    const context = contextOf();
    const at = (gain: number) =>
      auditLoot({
        context,
        attackloot: { r1: gain },
        defenderDelta: { r1: -1000 },
        defenderPool: { r1: 10_000, r2: 0, r3: 0, r4: 0 },
        lootableDrop: 1_000_000,
      }).violations.filter((one) => one.rule === "lootExceedsLoss");

    expect(at(1600)).toEqual([]);
    expect(at(1601)).toHaveLength(1);
    expect(at(1601)[0]).toMatchObject({
      detail: { resource: "r1", gain: 1601, loss: 1000 },
      enforced: true,
    });
  });

  it("refuses a loss larger than the pool plus the harvesters' buffers", () => {
    const context = contextOf({ yardBuildings: [[1, HARVESTER, 50]] });
    const audit = auditLoot({
      context,
      attackloot: {},
      defenderDelta: { r1: -200 },
      defenderPool: { r1: 100, r2: 0, r3: 0, r4: 0 },
      lootableDrop: 1000,
    });
    expect(audit.violations.filter((one) => one.rule === "lossExceedsPool")).toEqual([
      { rule: "lossExceedsPool", detail: { resource: "r1", loss: 200, pool: 150 }, enforced: true },
    ]);
  });

  it("refuses a gain larger than the damage that could have carried it", () => {
    const context = contextOf();
    const audit = auditLoot({
      context,
      attackloot: { r1: 10_000 },
      defenderDelta: { r1: -10_000 },
      defenderPool: { r1: 1e9, r2: 0, r3: 0, r4: 0 },
      lootableDrop: 1000,
    });
    // 1,000 of lootable damage allows 5,000 at the largest multiplier.
    expect(audit.violations.filter((one) => one.rule === "lootExceedsDamage")).toHaveLength(1);
  });

  it("widens that allowance by Krallen's loot aura when she has it (issue #222)", () => {
    // Level 5, power level 2: 2 + 1 + 0.3 over 2, so 5,000 becomes 8,250.
    expect(lootAuraBound([{ id: KRALLEN_ID, level: 5, powerLevel: 2 }])).toBeCloseTo(1.65, 12);
    expect(lootAuraBound([{ id: KRALLEN_ID, level: 5, powerLevel: 1 }])).toBe(1);
    const input = {
      attackloot: { r1: 8000 },
      defenderDelta: { r1: -8000 },
      defenderPool: { r1: 1e9, r2: 0, r3: 0, r4: 0 },
      lootableDrop: 1000,
    };
    const plain = auditLoot({ context: contextOf(), ...input });
    const aura = auditLoot({
      context: contextOf({ champion: { id: KRALLEN_ID, level: 5, powerLevel: 2 } }),
      ...input,
    });
    expect(plain.violations.some((one) => one.rule === "lootExceedsDamage")).toBe(true);
    expect(aura.violations.some((one) => one.rule === "lootExceedsDamage")).toBe(false);
  });

  it("doubles that allowance for a Vacuum, whose bonus was never traced", () => {
    // §6, item 4.
    const input = {
      attackloot: { r1: 10_000 },
      defenderDelta: { r1: -10_000 },
      defenderPool: { r1: 1e9, r2: 0, r3: 0, r4: 0 },
      lootableDrop: 1000,
    };
    const plain = auditLoot({ context: contextOf(), ...input });
    const vacuum = auditLoot({ context: contextOf({ hasVacuum: true }), ...input });
    expect(plain.violations.some((one) => one.rule === "lootExceedsDamage")).toBe(true);
    expect(vacuum.violations.some((one) => one.rule === "lootExceedsDamage")).toBe(false);
  });

  it("credits only what fits under the attacker's cap, and records the gap", () => {
    const context = contextOf({ caps: { r1: 1000 }, pool: { r1: 900 } });
    const audit = auditLoot({
      context,
      attackloot: { r1: 500 },
      defenderDelta: { r1: -500 },
      defenderPool: { r1: 1e9, r2: 0, r3: 0, r4: 0 },
      lootableDrop: 1_000_000,
    });
    expect(audit.credited.r1).toBe(100);
    expect(audit.attackloot.r1).toBe(100);
    expect(audit.violations.filter((one) => one.rule === "lootOverCap")).toEqual([
      {
        rule: "lootOverCap",
        detail: { resource: "r1", gain: 500, credited: 100, cap: 1000 },
        enforced: false,
      },
    ]);
  });

  it("preserves bomb spend in the credited figure", () => {
    const context = contextOf({ catapultLevel: 2 });
    const audit = auditLoot({
      context,
      attackloot: { r1: 400, r2: -100_000 },
      defenderDelta: { r1: -400 },
      defenderPool: { r1: 1e9, r2: 0, r3: 0, r4: 0 },
      lootableDrop: 1_000_000,
    });
    expect(audit.attackloot).toEqual({ r1: 400, r2: -100_000, r3: 0, r4: 0 });
    expect(audit.violations.filter((one) => one.rule === "bombSpend")).toEqual([]);
  });

  it("refuses a spend past the largest bomb that resource has", () => {
    // Twigs top out at 5,000,000 and pebbles at 10,000,000
    // (`ResourceBombs.as:79`, `:139`); goo has no bomb at any level.
    expect(maxBombSpend(1, 3)).toBe(5_000_000);
    expect(maxBombSpend(2, 3)).toBe(10_000_000);
    expect(maxBombSpend(4, 3)).toBe(0);

    const context = contextOf({ catapultLevel: 3 });
    const audit = auditLoot({
      context,
      attackloot: { r1: -6_000_000, r4: -1 },
      defenderDelta: {},
      defenderPool: noAmounts(),
      lootableDrop: 0,
    });
    const spend = audit.violations.filter((one) => one.rule === "bombSpend");
    expect(spend).toHaveLength(2);
    expect(spend[0]).toMatchObject({ detail: { resource: "r1", max: 5_000_000 } });
    expect(spend[1]).toMatchObject({ detail: { resource: "r4", max: 0 } });
  });

  it("refuses any spend at all without a catapult", () => {
    const audit = auditLoot({
      context: contextOf({ catapultLevel: 0 }),
      attackloot: { r1: -10_000 },
      defenderDelta: {},
      defenderPool: noAmounts(),
      lootableDrop: 0,
    });
    expect(audit.violations.filter((one) => one.rule === "bombSpend")).toHaveLength(1);
  });

  it("says nothing at all about a save that looted nothing", () => {
    const audit = auditLoot({
      context: contextOf(),
      attackloot: {},
      defenderDelta: {},
      defenderPool: noAmounts(),
      lootableDrop: 0,
    });
    expect(audit.violations).toEqual([]);
    expect(audit.attackloot).toEqual(noAmounts());
  });
});
