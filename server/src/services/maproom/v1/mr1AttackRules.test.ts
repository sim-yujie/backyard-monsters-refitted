import { describe, expect, test } from "bun:test";
import { AttackPermission } from "../../../enums/MapRoom.js";
import type { NeighbourData } from "../../../types/NeighbourData.js";
import {
  MR1_ATTACK_LEVEL_EXEMPT_FROM,
  MR1_ATTACK_LEVEL_GAP,
  MR1_REVENGE_WINDOW_DAYS,
  keepRecentAttackers,
  mr1LevelPermission,
  vengeanceOwed,
} from "./mr1AttackRules.js";

const DAY = 24 * 60 * 60;
const NOW = 1_800_000_000;

const entry = (userid: number, fields: Partial<NeighbourData> = {}): NeighbourData => ({
  userid,
  baseid: `${userid}00`,
  level: 10,
  username: `u${userid}`,
  attacksTodayCount: 0,
  attacksTodayDate: 0,
  ...fields,
});

describe("Map Room 1 attack rule numbers (upstream 9a88febce)", () => {
  test("gap 7, both 40+ exempt, vengeance 14 days", () => {
    expect(MR1_ATTACK_LEVEL_GAP).toBe(7);
    expect(MR1_ATTACK_LEVEL_EXEMPT_FROM).toBe(40);
    expect(MR1_REVENGE_WINDOW_DAYS).toBe(14);
  });
});

describe("mr1LevelPermission", () => {
  const permission = (attackerLevel: number, defenderLevel: number, vengeance = 0) =>
    mr1LevelPermission({ attackerLevel, defenderLevel, vengeance });

  test("up to 7 below is attackable, 8 below is refused", () => {
    expect(permission(20, 13)).toBe(AttackPermission.ATTACKABLE);
    expect(permission(20, 12)).toBe(AttackPermission.LEVEL_RESTRICTION);
  });

  test("8 below with vengeance left is vengeance", () => {
    expect(permission(20, 12, 1)).toBe(AttackPermission.VENGEANCE_MODE);
  });

  test("up to 7 above is plain attackable, 8 above is higher level (allowed)", () => {
    expect(permission(13, 20)).toBe(AttackPermission.ATTACKABLE);
    expect(permission(12, 20)).toBe(AttackPermission.HIGHER_LEVEL);
  });

  test("vengeance changes nothing inside the gap", () => {
    expect(permission(20, 15, 3)).toBe(AttackPermission.ATTACKABLE);
  });

  test("two players at 40 or more can always attack each other", () => {
    expect(permission(55, 40)).toBe(AttackPermission.ATTACKABLE);
    expect(permission(55, 39)).toBe(AttackPermission.LEVEL_RESTRICTION);
  });
});

describe("vengeanceOwed", () => {
  test("counts while the last attack from them is under 14 days old", () => {
    expect(vengeanceOwed(entry(2, { vengeance: 2, lastattackfrom: NOW - 13 * DAY }), NOW)).toBe(2);
  });

  test("lapses 14 days after their last attack", () => {
    expect(vengeanceOwed(entry(2, { vengeance: 2, lastattackfrom: NOW - 14 * DAY }), NOW)).toBe(0);
  });

  test("none without a count, a time, or an entry", () => {
    expect(vengeanceOwed(entry(2, { lastattackfrom: NOW }), NOW)).toBe(0);
    expect(vengeanceOwed(entry(2, { vengeance: 1 }), NOW)).toBe(0);
    expect(vengeanceOwed(undefined, NOW)).toBe(0);
  });
});

describe("keepRecentAttackers", () => {
  test("a re-search keeps whoever attacked within 14 days, and drops older ones", () => {
    const previous = [
      entry(2, { attacksfrom: 1, lastattackfrom: NOW - DAY, vengeance: 1 }),
      entry(3, { attacksfrom: 4, lastattackfrom: NOW - 15 * DAY }),
      entry(4),
    ];
    const found = [entry(5)];

    expect(keepRecentAttackers(previous, found, NOW).map((one) => one.userid)).toEqual([5, 2]);
  });

  test("one found again is not doubled", () => {
    const previous = [entry(2, { lastattackfrom: NOW - DAY })];
    expect(keepRecentAttackers(previous, [entry(2)], NOW).map((one) => one.userid)).toEqual([2]);
  });
});
