import { describe, expect, it } from "vitest";
import {
  auditDamageBudget,
  auditLoot,
  bankedByResource,
  championPotential,
  damagePotential,
  harvesterResource,
  KRALLEN_ID,
  lootCaps,
  monsterPotential,
  REZGHUL_ID,
  specialistBound,
  swings,
} from "./potential";
import { maxBombDamage, maxBombSpend } from "./stats";
import {
  noAmounts,
  toCombatYard,
  type AttackContext,
  type CombatBuildingDataMap,
  type ChampionOnField,
  type ResourceAmounts,
  type Roster,
} from "./types";

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

  it("gives Korath the stomp's six footprints", () => {
    // G4, 72 ticks at level 1 (`champions/Korath.as:25-46`), stomp at
    // `range * 2.5` (`:167-200`).
    expect(championPotential("G4", 1, 10)).toBe(2000 * 12 * 6);
  });
});

describe("damagePotential", () => {
  it("sums the roster, the champion and the bombs", () => {
    const context = contextOf({
      flung: { C1: 30 },
      champion: { id: "G1", level: 1, powerLevel: 0 },
      catapultLevel: 2,
    });
    const report = damagePotential(context);
    expect(report.breakdown.monsters).toBe(840 * 30);
    expect(report.breakdown.champion).toBe(1000 * 15);
    expect(report.breakdown.bombs).toBe(125_000);
    expect(report.breakdown.zombies).toBe(0);
    expect(report.potential).toBe(840 * 30 + 1000 * 15 + 125_000);
  });

  it("adds 125,000 of bombs at catapult 2 and nothing at catapult 0", () => {
    // One bomb per resource at its largest tier: 50,000 of twigs and 75,000 of
    // pebbles; putty deals no damage at all (`ResourceBombs.as:48-226`).
    expect(maxBombDamage(2)).toBe(125_000);
    expect(maxBombDamage(0)).toBe(0);
    expect(damagePotential(contextOf({ catapultLevel: 3 })).breakdown.bombs).toBe(125_000);
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
    const context = contextOf({ catapultLevel: 2 });
    expect(auditDamageBudget(context, 120_000).violations).toEqual([]);
    expect(auditDamageBudget(context, 200_000).violations).toHaveLength(1);
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
