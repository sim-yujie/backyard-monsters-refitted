import { describe, expect, mock, test } from "bun:test";

import { memoryRedis } from "../../testing/memoryRedis.js";
import { User } from "../../database/models/user.model.js";
import { Save } from "../../database/models/save.model.js";
import { BaseType } from "../../enums/Base.js";
import { AttackPermission } from "../../enums/MapRoom.js";
import { experiencePoints } from "../../game-data/stats/experiencePoints.js";
import type { NeighbourData } from "../../types/NeighbourData.js";

/**
 * The Map Room 1 list's codes carry the level rule (owner, 11 Nov 2026,
 * `v1/mr1AttackRules.ts`): what the map shows is what the attack load allows.
 * Runs the real service over a small stand-in for the database.
 */

const VIEWER = 1;
const DAY = 24 * 60 * 60;
const now = () => Math.floor(Date.now() / 1000);

/** Each neighbour's level, by user id. */
const levels = new Map<number, number>();
const protectedUntil = new Map<number, number>();

const saveRow = (userid: number) => ({
  userid,
  baseid: `${userid}00`,
  protected: protectedUntil.get(userid) ?? 0,
  createtime: 0,
  attackid: 0,
  attacks: [],
  damage: 0,
  points: String(experiencePoints[(levels.get(userid) ?? 1) - 1]),
  basevalue: "0",
});

const em = {
  find: async (entity: unknown, where: { userid?: { $in: number[] } }) => {
    const ids = where.userid?.$in ?? [];
    if (entity === User) return ids.map((userid) => ({ userid, username: `u${userid}`, pic_square: "" }));
    if (entity === Save) return ids.map(saveRow);
    return [];
  },
  execute: async () => [],
  persist: () => {},
  flush: async () => {},
};

mock.module("../../server.js", () => ({ postgres: { em }, redis: memoryRedis(new Map()) }));

const { updateNeighbourData } = await import("./updateNeighbourData.js");

const entry = (userid: number, level: number, fields: Partial<NeighbourData> = {}): NeighbourData => {
  levels.set(userid, level);
  return { userid, baseid: `${userid}00`, level: 1, username: `u${userid}`, attacksTodayCount: 0, attacksTodayDate: 0, ...fields };
};

const codes = async (viewerLevel: number | undefined, list: NeighbourData[]) =>
  (await updateNeighbourData(list, BaseType.MAIN, VIEWER, VIEWER, viewerLevel)).map((one) => [
    one.userid,
    one.attackpermitted,
    one.vengeance,
  ]);

describe("Map Room 1 list codes and the level rule", () => {
  test("in the gap 1, 8 below 3, 8 above 2, 8 below with vengeance 4", async () => {
    const list = [
      entry(2, 13),
      entry(3, 12),
      entry(4, 28),
      entry(5, 12, { vengeance: 2, lastattackfrom: now() - DAY }),
    ];
    expect(await codes(20, list)).toEqual([
      [2, AttackPermission.ATTACKABLE, 0],
      [3, AttackPermission.LEVEL_RESTRICTION, 0],
      [4, AttackPermission.HIGHER_LEVEL, 0],
      [5, AttackPermission.VENGEANCE_MODE, 2],
    ]);
  });

  test("vengeance older than 14 days shows as none", async () => {
    const list = [entry(5, 12, { vengeance: 2, lastattackfrom: now() - 15 * DAY })];
    expect(await codes(20, list)).toEqual([[5, AttackPermission.LEVEL_RESTRICTION, 0]]);
  });

  test("protection still comes first", async () => {
    protectedUntil.set(6, now() + DAY);
    const list = [entry(6, 5)];
    expect((await codes(20, list))[0]?.[1]).toBe(AttackPermission.DAMAGE_PROTECTION);
    protectedUntil.clear();
  });

  test("without the viewer's level (the Inferno's use), levels decide nothing, as before", async () => {
    const list = [entry(3, 1)];
    const [one] = await updateNeighbourData(list, BaseType.MAIN, VIEWER);
    expect(one?.attackpermitted).toBe(AttackPermission.ATTACKABLE);
    expect(one?.vengeance).toBeUndefined();
  });
});
