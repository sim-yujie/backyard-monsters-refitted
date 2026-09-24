import { describe, expect, it } from "vitest";
import {
  auditHealth,
  clampHealth,
  countsTowardDamage,
  damagePercent,
  derivedDestroyed,
  isSpent,
  isTrap,
  isWall,
  MUSHROOM_TYPE,
} from "./damagePercent";
import { maxHp } from "./stats";
import { toCombatYard, type CombatBuildingDataMap, type CombatTargetKind } from "./types";

/**
 * The damage percentage and the health clamp (§2.2).
 *
 * The figures are hand-computed from the ladders the generated table carries,
 * so a change to either the sum or a ladder fails here rather than silently
 * moving what `destroyed` means. The yards are small on purpose: a sum over 575
 * buildings proves nothing a sum over four does not, and four can be checked
 * with a calculator.
 */

/** A Cannon Tower at level 1: `maxHp(20, 1)` is 6,000 (`YARD_PROPS.as:2184`). */
const TOWER = 20;
const TOWER_HP = 6000;
/** A Wooden Block: the `hp` ladder is `[1000, 2300, 5750, 18000, 27000]`. */
const WALL = 17;
/** A Booby Trap, 10 hp and a 50-unit blast (`YARD_PROPS.as:2724-2725`). */
const TRAP = 24;
/** A Twig Snapper, which is what loot comes out of. */
const HARVESTER = 1;

const yardOf = (
  buildings: readonly (readonly [id: number, type: number, level?: number])[],
  health: Readonly<Record<string, number>> = {},
  kind: CombatTargetKind = "main",
) => {
  const buildingdata: Record<string, CombatBuildingDataMap[string]> = {};
  for (const [id, type, level] of buildings) {
    buildingdata[String(id)] = { id, t: type, X: id * 40, Y: 0, ...(level ? { l: level } : {}) };
  }
  return toCombatYard({ kind, buildingdata, buildinghealthdata: health });
};

describe("the types the sum treats specially", () => {
  it("knows the walls, the traps and the mushroom", () => {
    // `BUILDING17` and `BUILDING18` are the only `BWALL` subclasses; `BUILDING24`
    // and `BUILDING117` the only traps; `BUILDING7 extends BMUSHROOM`.
    expect(isWall(17)).toBe(true);
    expect(isWall(18)).toBe(true);
    expect(isWall(20)).toBe(false);
    expect(isTrap(24)).toBe(true);
    expect(isTrap(117)).toBe(true);
    expect(MUSHROOM_TYPE).toBe(7);
  });
});

describe("damagePercent", () => {
  it("is 0 over a yard nothing has touched", () => {
    const yard = yardOf([
      [1, TOWER],
      [2, TOWER],
      [3, HARVESTER],
    ]);
    expect(damagePercent(yard, {})).toBe(0);
  });

  it("is 0 with every wall at 0, because walls are not in the sum", () => {
    // `getBuildingSaveData` skips `BWALL` on both sides (`BFOUNDATION.as:444-451`).
    const yard = yardOf([
      [1, TOWER],
      [2, WALL],
      [3, WALL],
    ]);
    expect(damagePercent(yard, { "2": 0, "3": 0 })).toBe(0);
  });

  it("halves to 50 when the only counted building is at half", () => {
    const full = maxHp(TOWER, 1);
    expect(full).toBe(TOWER_HP);
    const yard = yardOf([[1, TOWER]]);
    expect(damagePercent(yard, { "1": full / 2 })).toBeCloseTo(50, 10);
  });

  it("weights by maximum health, not by building count", () => {
    // A level 1 Cannon Tower is 6,000 and a level 1 Wooden Block is 1,000, but
    // the block is a wall, so a second tower is what moves the figure: one of
    // two towers at half is 25% of the yard.
    const yard = yardOf([
      [1, TOWER],
      [2, TOWER],
    ]);
    expect(damagePercent(yard, { "1": TOWER_HP / 2 })).toBeCloseTo(25, 10);
  });

  it("leaves a fired trap out of both sums", () => {
    // 10 hp at 0 would otherwise add 10 to the maximum and nothing to the
    // total, so a yard of one tower and one fired trap would read as damaged.
    const yard = yardOf([
      [1, TOWER],
      [2, TRAP],
    ]);
    expect(maxHp(TRAP, 1)).toBe(10);
    expect(damagePercent(yard, { "2": 0 })).toBe(0);
    expect(countsTowardDamage(yard.byId.get(2)!, { "2": 0 })).toBe(false);
    expect(countsTowardDamage(yard.byId.get(2)!, {})).toBe(true);
  });

  it("leaves a trap the save dropped from buildingdata out as well", () => {
    const yard = yardOf([
      [1, TOWER],
      [2, TRAP],
    ]);
    expect(damagePercent(yard, {}, new Set([2]))).toBe(0);
    expect(isSpent(yard.byId.get(2)!, {}, new Set([2]))).toBe(true);
  });

  it("skips mushrooms, which the client's loop never reaches", () => {
    const yard = yardOf([
      [1, TOWER],
      [2, MUSHROOM_TYPE],
    ]);
    expect(damagePercent(yard, { "2": 0 })).toBe(0);
  });

  it("is 0 on an empty yard rather than a division by zero", () => {
    expect(damagePercent(yardOf([]), {})).toBe(0);
  });
});

describe("destroyed", () => {
  it("exists only for an outpost or a wild monster camp", () => {
    // `BASE.SaveB` writes the key for those two targets alone
    // (`client/scripts/BASE.as:3297-3308`).
    expect(derivedDestroyed(100, "main")).toBeUndefined();
    expect(derivedDestroyed(100, "tribe")).toBeUndefined();
    expect(derivedDestroyed(100, "outpost")).toBe(1);
    expect(derivedDestroyed(100, "wild")).toBe(1);
  });

  it("turns at the victory threshold of 90, inclusive", () => {
    // `BYMConfig.k_sVICTORY_THRESHOLD` (`configs/BYMConfig.as:30`).
    expect(derivedDestroyed(89.999, "outpost")).toBe(0);
    expect(derivedDestroyed(90, "outpost")).toBe(1);
  });
});

describe("clampHealth", () => {
  it("takes the lower of the stored and the submitted value", () => {
    const yard = yardOf([[1, TOWER]], { "1": 800 });
    expect(clampHealth(yard, { "1": 500 })).toEqual({ "1": 500 });
    expect(clampHealth(yard, { "1": 1200 })).toEqual({ "1": 800 });
  });

  it("keeps a stored value the save left out rather than healing it", () => {
    // §2.2: a building missing from the save keeps S's value. Repairs cannot
    // run during an attack (`BFOUNDATION.as:1964-2015`), so a save that omits a
    // damaged building is wrong, and being wrong is not a repair.
    const yard = yardOf([[1, TOWER]], { "1": 800 });
    expect(clampHealth(yard, {})).toEqual({ "1": 800 });
  });

  it("writes only the buildings below full, as the client does", () => {
    const yard = yardOf([
      [1, TOWER],
      [2, TOWER],
    ]);
    expect(clampHealth(yard, { "1": TOWER_HP, "2": 600 })).toEqual({ "2": 600 });
  });
});

describe("auditHealth", () => {
  const yard = yardOf(
    [
      [1, TOWER],
      [2, TOWER],
      [3, WALL],
      [4, TRAP],
      [5, HARVESTER],
    ],
    {},
  );

  it("passes an identity save with nothing to say", () => {
    const audit = auditHealth({ yard, submitted: {} });
    expect(audit.violations).toEqual([]);
    expect(audit.malformed).toEqual([]);
    expect(audit.damage).toBe(0);
    expect(audit.drop).toBe(0);
    expect(audit.lootableDrop).toBe(0);
    expect(audit.health).toEqual({});
    expect(audit.destroyed).toBeUndefined();
  });

  it("derives the damage the health map summarises", () => {
    // Two towers at 6,000, one harvester at 500 and an unfired trap at 10 are
    // in the sum; the wall is not. One tower at half is the hand figure: 3,000
    // of 12,510 gone.
    const harvester = maxHp(HARVESTER, 1);
    const trap = maxHp(TRAP, 1);
    expect([harvester, trap]).toEqual([500, 10]);
    const half = TOWER_HP / 2;
    const totalMax = TOWER_HP * 2 + harvester + trap;
    const audit = auditHealth({ yard, submitted: { "1": half } });
    const expected = 100 - (100 / totalMax) * (totalMax - half);
    expect(expected).toBeCloseTo(23.980815, 6);
    expect(audit.damage).toBeCloseTo(expected, 10);
    expect(audit.health).toEqual({ "1": half });
  });

  it("counts a wall's loss in the drop but not in the damage", () => {
    const audit = auditHealth({ yard, submitted: { "3": 0 } });
    expect(audit.damage).toBe(0);
    expect(audit.drop).toBe(maxHp(WALL, 1));
    expect(audit.lootableDrop).toBe(0);
  });

  it("counts only lootable buildings in the lootable drop", () => {
    const audit = auditHealth({ yard, submitted: { "1": 300, "5": 0 } });
    expect(audit.lootableDrop).toBe(maxHp(HARVESTER, 1));
    expect(audit.drop).toBe(TOWER_HP - 300 + maxHp(HARVESTER, 1));
  });

  it("reports and clamps a health value above the stored one", () => {
    const stored = yardOf([[1, TOWER]], { "1": 400 });
    const audit = auditHealth({ yard: stored, submitted: { "1": 900 } });
    expect(audit.health).toEqual({ "1": 400 });
    expect(audit.violations).toEqual([
      {
        rule: "healthRose",
        ids: [1],
        detail: { 1: { stored: 400, sent: 900 } },
        enforced: true,
      },
    ]);
    expect(audit.drop).toBe(0);
  });

  it("reports health for a building the yard does not hold", () => {
    const audit = auditHealth({ yard, submitted: { "99": 10 } });
    const violation = audit.violations.find((one) => one.rule === "unknownBuilding");
    expect(violation).toEqual({
      rule: "unknownBuilding",
      ids: [99],
      detail: { count: 1 },
      enforced: true,
    });
  });

  it("refuses a health value that is not an integer in range", () => {
    // §3.9: a 400, not a 409 — only a broken client sends one.
    const audit = auditHealth({ yard, submitted: { "1": 1.5 } });
    expect(audit.malformed).toHaveLength(1);
    expect(audit.malformed[0]?.detail).toMatchObject({ id: 1, sent: 1.5, max: TOWER_HP });
    expect(audit.violations).toEqual([]);
  });

  it("refuses a health value above the building's maximum", () => {
    const audit = auditHealth({ yard, submitted: { "1": TOWER_HP + 1 } });
    expect(audit.malformed).toHaveLength(1);
    expect(audit.violations).toEqual([]);
  });

  it("records a dropped trap whose health map disagrees", () => {
    const audit = auditHealth({ yard, submitted: { "4": 5 }, droppedTraps: [4] });
    const violation = audit.violations.find((one) => one.rule === "trapState");
    expect(violation).toEqual({ rule: "trapState", ids: [4], enforced: false });
  });

  it("says nothing when a dropped trap carries 0 or nothing at all", () => {
    expect(
      auditHealth({ yard, submitted: { "4": 0 }, droppedTraps: [4] }).violations,
    ).toEqual([]);
    expect(auditHealth({ yard, submitted: {}, droppedTraps: [4] }).violations).toEqual([]);
  });

  it("records a damage figure more than a point from the derived one", () => {
    // The client logs an `int()` of the float it saves, so one point is
    // rounding (`BFOUNDATION.as:468`, `:525`).
    const half = TOWER_HP / 2;
    const derived = auditHealth({ yard, submitted: { "1": half } }).damage;
    expect(auditHealth({ yard, submitted: { "1": half }, reportedDamage: derived }).violations)
      .toEqual([]);
    const off = auditHealth({ yard, submitted: { "1": half }, reportedDamage: derived + 5 });
    expect(off.violations).toEqual([
      { rule: "damageMismatch", detail: { sent: derived + 5, derived }, enforced: false },
    ]);
    expect(off.violations[0]?.enforced).toBe(false);
  });

  it("records a destroyed flag that disagrees with the derived damage", () => {
    const outpost = yardOf([[1, TOWER]], {}, "outpost");
    const audit = auditHealth({ yard: outpost, submitted: {}, reportedDestroyed: 1 });
    expect(audit.destroyed).toBe(0);
    expect(audit.violations).toEqual([
      { rule: "destroyedMismatch", detail: { sent: 1, derived: 0 }, enforced: false },
    ]);
  });

  it("derives destroyed for an outpost razed past the threshold", () => {
    const outpost = yardOf([[1, TOWER]], {}, "outpost");
    const audit = auditHealth({ yard: outpost, submitted: { "1": 100 } });
    expect(audit.damage).toBeCloseTo(100 - (100 / TOWER_HP) * 100, 10);
    expect(audit.destroyed).toBe(1);
  });

  it("never stops at the first violation", () => {
    const stored = yardOf(
      [
        [1, TOWER],
        [2, TOWER],
      ],
      { "1": 400 },
    );
    const audit = auditHealth({
      yard: stored,
      submitted: { "1": 900, "99": 5 },
      reportedDamage: 0,
    });
    expect(audit.violations.map((one) => one.rule).sort()).toEqual([
      "damageMismatch",
      "healthRose",
      "unknownBuilding",
    ]);
  });
});

describe("toCombatYard", () => {
  it("reads an absent level as 1 and an absent health entry as full", () => {
    // `Export` writes neither at its default (`BFOUNDATION.as:2975-2977`, `:3025`).
    const yard = toCombatYard({ buildingdata: { "1": { id: 1, t: TOWER, X: 0, Y: 0 } } });
    const building = yard.byId.get(1);
    expect(building?.level).toBe(1);
    expect(building?.hp).toBe(TOWER_HP);
    expect(building?.maxHp).toBe(TOWER_HP);
  });

  it("reads a level out of `l` and the ladder at that level", () => {
    const yard = toCombatYard({
      buildingdata: { "1": { id: 1, t: WALL, X: 0, Y: 0, l: 5 } },
    });
    expect(yard.byId.get(1)?.maxHp).toBe(27_000);
  });

  it("prefers the health map over the building's own hp", () => {
    const yard = toCombatYard({
      buildingdata: { "1": { id: 1, t: TOWER, X: 0, Y: 0, hp: 900 } },
      buildinghealthdata: { "1": 200 },
    });
    expect(yard.byId.get(1)?.hp).toBe(200);
  });

  it("sorts by id, so every pass over a yard is in one order", () => {
    const yard = toCombatYard({
      buildingdata: {
        "30": { id: 30, t: TOWER },
        "4": { id: 4, t: TOWER },
        "11": { id: 11, t: TOWER },
      },
    });
    expect(yard.buildings.map((one) => one.id)).toEqual([4, 11, 30]);
  });

  it("carries a harvester's banked buffer, which loot can also draw from", () => {
    const yard = toCombatYard({
      buildingdata: { "1": { id: 1, t: HARVESTER, st: 4321 } },
    });
    expect(yard.byId.get(1)?.banked).toBe(4321);
  });
});
