import { describe, expect, test } from "bun:test";
import { BOMBS } from "../../../game-rules/combat/index.js";
import { bombSpendOf, catapultLevelOf, chargeBombSpend, CATAPULT_TYPE } from "./bombSpend.js";

/**
 * The bomb charge of issue #90, read against the shared rules' own table so a
 * change to a cost there moves these figures with it.
 */

const cost = (id: string): number => {
  const bomb = BOMBS.find((one) => one.id === id);
  if (!bomb) throw new Error(`no bomb ${id}`);
  return bomb.cost;
};

const logOf = (...events: object[]) => ({ v: 1, seed: 7, events });
const bomb = (id: string, t = 100) => ({ kind: "bomb", t, x: 0, y: 0, id });
const fling = { kind: "fling", t: 50, x: 0, y: 0, r: 100, monsters: { C1: 5 } };

const rich = { r1: 20_000_000, r2: 20_000_000, r3: 20_000_000, r4: 1_000 };
const attacker = (resources: object = rich, catapultLevel = 3) => ({ resources, catapultLevel });

/** The attacker's pool after a save's bombs are charged. */
const after = (log: unknown, resources: Record<string, number>, catapultLevel = 3) =>
  chargeBombSpend(bombSpendOf(log, attacker(resources, catapultLevel)).spend, { ...resources });

describe("bombSpendOf and chargeBombSpend", () => {
  test("one tw0 bomb lowers the attacker's twigs by its cost", () => {
    const pool = after(logOf(fling, bomb("tw0")), { r1: 50_000, r2: 40_000, r3: 30_000, r4: 20_000 });

    expect(cost("tw0")).toBe(10_000);
    expect(pool).toEqual({ r1: 40_000, r2: 40_000, r3: 30_000, r4: 20_000 });
  });

  test("no bombs, no change", () => {
    const resources = { r1: 50_000, r2: 40_000, r3: 30_000, r4: 20_000 };

    expect(after(logOf(fling), resources)).toEqual(resources);
    expect(after(logOf(), resources)).toEqual(resources);
    expect(after(undefined, resources)).toEqual(resources);

    const spend = bombSpendOf(logOf(fling), attacker());
    expect(spend.charges).toEqual([]);
    expect(spend.violations).toEqual([]);
  });

  test("several bombs of different resources each come out of their own resource", () => {
    const log = logOf(bomb("tw1", 100), fling, bomb("pb2", 300), bomb("pu0", 500));
    const spend = bombSpendOf(log, attacker());

    expect(spend.violations).toEqual([]);
    expect(spend.spend).toEqual({ r1: cost("tw1"), r2: cost("pb2"), r3: cost("pu0") });
    expect(spend.charges.map((charge) => charge.id)).toEqual(["tw1", "pb2", "pu0"]);
    expect(chargeBombSpend(spend.spend, { ...rich })).toEqual({
      r1: rich.r1 - 100_000,
      r2: rich.r2 - 2_000_000,
      r3: rich.r3 - 10_000,
      r4: rich.r4,
    });
  });

  test("an unaffordable bomb is reported and charged down to zero, never below", () => {
    const resources = { r1: 4_000, r2: 0, r3: 0, r4: 0 };
    const spend = bombSpendOf(logOf(bomb("tw0")), attacker(resources));

    expect(spend.violations).toEqual([
      {
        rule: "bombSpend",
        enforced: true,
        detail: { reason: "unaffordable", id: "tw0", t: 100, resource: "r1", cost: 10_000, pool: 4_000 },
      },
    ]);
    expect(chargeBombSpend(spend.spend, { ...resources }).r1).toBe(0);
  });

  test("the pool is checked before this attack's loot, as Flash checked the stored pool", () => {
    // Exactly the cost is affordable; one short is not.
    expect(bombSpendOf(logOf(bomb("pb0")), attacker({ r2: 10_000 })).violations).toEqual([]);
    expect(bombSpendOf(logOf(bomb("pb0")), attacker({ r2: 9_999 })).violations).toHaveLength(1);
  });

  test("a second bomb of one resource is one Flash never fired, and is still charged", () => {
    const spend = bombSpendOf(logOf(bomb("tw0", 100), bomb("tw1", 200)), attacker());

    expect(spend.violations.map((one) => one.detail?.reason)).toEqual(["secondBomb"]);
    expect(spend.spend.r1).toBe(cost("tw0") + cost("tw1"));
  });

  test("a tier above the attacker's catapult is reported", () => {
    const spend = bombSpendOf(logOf(bomb("pb0")), attacker(rich, 1));

    expect(spend.violations).toEqual([
      {
        rule: "bombSpend",
        enforced: true,
        detail: { reason: "catapultLevel", id: "pb0", t: 100, needs: 2, has: 1 },
      },
    ]);
  });

  test("an id the bomb table lacks is reported and costs nothing", () => {
    const spend = bombSpendOf(logOf(bomb("gg9")), attacker());

    expect(spend.violations.map((one) => one.detail?.reason)).toEqual(["unknownBomb"]);
    expect(spend.charges).toEqual([]);
    expect(spend.spend).toEqual({ r1: 0, r2: 0, r3: 0 });
  });

  test("a log that is not a log is malformed and charges nothing", () => {
    for (const log of ["{not json", 42, { v: 1 }, { events: [null] }, { events: [{ kind: "bomb" }] }]) {
      const spend = bombSpendOf(log, attacker());
      expect(spend.violations.map((one) => one.rule)).toEqual(["malformed"]);
      expect(spend.charges).toEqual([]);
    }
  });

  test("a missing or non-numeric stored resource counts as zero", () => {
    expect(chargeBombSpend({ r1: 10_000, r2: 0, r3: 0 }, { r1: "junk" })).toEqual({ r1: 0 });
    expect(chargeBombSpend({ r1: 10_000, r2: 0, r3: 0 }, null)).toEqual({ r1: 0 });
  });
});

describe("catapultLevelOf", () => {
  const catapult = (l: number | undefined, extra: object = {}) => ({ t: CATAPULT_TYPE, l, ...extra });

  test("the higher of the saved field and the finished Catapult", () => {
    expect(catapultLevelOf({ catapult: 0, buildingdata: {} })).toBe(0);
    expect(catapultLevelOf({ catapult: 2, buildingdata: {} })).toBe(2);
    expect(catapultLevelOf({ catapult: 0, buildingdata: { "5": catapult(3) } })).toBe(3);
    expect(catapultLevelOf({ catapult: 2, buildingdata: { "5": catapult(1) } })).toBe(2);
    expect(catapultLevelOf({ buildingdata: { "5": catapult(undefined) } })).toBe(1);
  });

  test("a Catapult still being built fires nothing, and other buildings are ignored", () => {
    expect(catapultLevelOf({ buildingdata: { "5": catapult(1, { cB: 300 }) } })).toBe(0);
    expect(catapultLevelOf({ buildingdata: { "5": { t: 14, l: 6 } } })).toBe(0);
  });
});
