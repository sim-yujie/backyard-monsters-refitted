import { describe, expect, test } from "bun:test";

import { AttackPermission } from "../../enums/MapRoom.js";
import type { NeighbourData } from "../../types/NeighbourData.js";
import {
  housedAfterBattle,
  inInfernoRange,
  infernoAttackPermission,
  keepRevenge,
  permitsAttack,
  vengeanceLeft,
  withAttackFrom,
  withAttackOn,
} from "./infernoPvp.js";

/**
 * The rules of Inferno player attacks (`docs/design/inferno.md` §2.7, S3):
 * the range, Flash's attack codes, the revenge counters, and what an
 * attacked yard's Housing Bunkers keep.
 */

const NOW = 1_800_000_000;

const entry = (userid: number, counters: Partial<NeighbourData> = {}): NeighbourData => ({
  userid,
  baseid: String(6000 + userid),
  level: 10,
  username: `player${userid}`,
  attacksTodayCount: 0,
  attacksTodayDate: 0,
  attacksfrom: 0,
  attacksto: 0,
  retaliatecount: 0,
  ...counters,
});

const state = (over: Partial<Parameters<typeof infernoAttackPermission>[0]> = {}) => ({
  mine: 10,
  theirs: 10,
  vengeance: 0,
  protectedUntil: 0,
  underAttack: false,
  now: NOW,
  ...over,
});

describe("range and permission", () => {
  test("7 levels either way is in range, 8 is not", () => {
    expect(inInfernoRange(10, 17)).toBe(true);
    expect(inInfernoRange(10, 3)).toBe(true);
    expect(inInfernoRange(10, 18)).toBe(false);
    expect(inInfernoRange(10, 2)).toBe(false);
  });

  test("protected beats under attack beats range", () => {
    expect(infernoAttackPermission(state({ protectedUntil: NOW + 60, underAttack: true, theirs: 1 }))).toBe(
      AttackPermission.DAMAGE_PROTECTION
    );
    expect(infernoAttackPermission(state({ underAttack: true, theirs: 1 }))).toBe(AttackPermission.UNDER_ATTACK);
    // Protection that has run out protects nobody.
    expect(infernoAttackPermission(state({ protectedUntil: NOW }))).toBe(AttackPermission.ATTACKABLE);
  });

  test("out of range is refused unless they attacked first; higher in range is allowed with a warning", () => {
    expect(infernoAttackPermission(state({ theirs: 2 }))).toBe(AttackPermission.LEVEL_RESTRICTION);
    expect(infernoAttackPermission(state({ theirs: 2, vengeance: 1 }))).toBe(AttackPermission.VENGEANCE_MODE);
    expect(infernoAttackPermission(state({ theirs: 12 }))).toBe(AttackPermission.HIGHER_LEVEL);
    expect(permitsAttack(AttackPermission.LEVEL_RESTRICTION)).toBe(false);
    expect(permitsAttack(AttackPermission.DAMAGE_PROTECTION)).toBe(false);
    expect(permitsAttack(AttackPermission.UNDER_ATTACK)).toBe(false);
    expect(permitsAttack(AttackPermission.VENGEANCE_MODE)).toBe(true);
    expect(permitsAttack(AttackPermission.HIGHER_LEVEL)).toBe(true);
  });
});

describe("revenge counters", () => {
  test("revenge left is their attacks less the ones paid back", () => {
    expect(vengeanceLeft(entry(1, { attacksfrom: 3, retaliatecount: 1 }))).toBe(2);
    expect(vengeanceLeft(entry(1, { attacksfrom: 1, retaliatecount: 4 }))).toBe(0);
    expect(vengeanceLeft(null)).toBe(0);
  });

  test("the defender's list gets the attacker first when new, one more attack when known", () => {
    const list = [entry(2)];
    expect(withAttackFrom(list, entry(1)).map((one) => [one.userid, one.attacksfrom])).toEqual([
      [1, 1],
      [2, 0],
    ]);
    expect(withAttackFrom([entry(1, { attacksfrom: 2 })], entry(1))[0]!.attacksfrom).toBe(3);
  });

  test("the attacker's list counts the attack, and the revenge paid back only when it was revenge", () => {
    const list = [entry(2, { attacksfrom: 2 })];
    const plain = withAttackOn(list, entry(2), false)[0]!;
    expect([plain.attacksto, plain.retaliatecount]).toEqual([1, 0]);
    const revenge = withAttackOn(list, entry(2), true)[0]!;
    expect([revenge.attacksto, revenge.retaliatecount]).toEqual([1, 1]);
    const added = withAttackOn([], entry(3, { attacksto: 9 }), false);
    expect(added.map((one) => [one.userid, one.attacksto])).toEqual([[3, 1]]);
  });

  test("a re-search keeps the counters of those found again and everyone with revenge left", () => {
    const previous = [entry(1, { attacksto: 2 }), entry(2, { attacksfrom: 1 }), entry(3, { attacksfrom: 1, retaliatecount: 1 })];
    const kept = keepRevenge(previous, [entry(1), entry(4)]);
    expect(kept.map((one) => [one.userid, one.attacksto ?? 0, one.attacksfrom ?? 0])).toEqual([
      [1, 2, 0],
      [4, 0, 0],
      // Player 2 attacked and was never paid back: kept though not found.
      [2, 0, 1],
    ]);
  });
});

describe("what the Housing Bunkers keep", () => {
  // Two Housing Bunkers: the engine deals the housed monsters out over them in turn.
  const buildingdata = {
    "10": { id: 10, t: 128, l: 1, X: 0, Y: 0 },
    "11": { id: 11, t: 128, l: 1, X: 50, Y: 0 },
  } as never;

  test("a standing bunker keeps what the battle left it; a fallen one loses all it housed", () => {
    const { housed, lost } = housedAfterBattle({
      buildingdata,
      housed: { IC1: 4 },
      before: {},
      after: { "10": 500, "11": 0 },
      // Bunker 10 lost one of its two; bunker 11 fell.
      garrisons: { 10: { IC1: 1 }, 11: { IC1: 2 } },
    });
    expect(housed).toEqual({ IC1: 1 });
    expect(lost).toEqual({ IC1: 3 });
  });

  test("a yard with no bunker standing at the start keeps its housed monsters", () => {
    const { housed, lost } = housedAfterBattle({
      buildingdata,
      housed: { IC1: 4 },
      before: { "10": 0, "11": 0 },
      after: { "10": 0, "11": 0 },
      garrisons: {},
    });
    expect(housed).toEqual({ IC1: 4 });
    expect(lost).toEqual({});
  });
});
