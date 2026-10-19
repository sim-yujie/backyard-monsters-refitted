import { describe, expect, mock, test } from "bun:test";

import { memoryRedis } from "../../testing/memoryRedis.js";
import { User } from "../../database/models/user.model.js";
import { Save } from "../../database/models/save.model.js";
import { BaseType } from "../../enums/Base.js";

/**
 * The friend flag on a Map Room 1 or Inferno neighbour (friends WP2, #369):
 * set from the friend table on every answer, so the cached list never keeps a
 * stale 0 or 1. Runs the real service over a small stand-in for the database.
 */

const VIEWER = 1;
const FRIEND = 2;
const STRANGER = 3;

/** What the friend lookup reads back, and who it was asked for. */
let friendRows: Array<{ friend_userid: number }> = [];
let asked: unknown[][] = [];

const saveRow = (userid: number) => ({
  userid,
  baseid: `${userid}00`,
  protected: 0,
  createtime: 0,
  attackid: 0,
  attacks: [],
  damage: 0,
  points: 0,
  basevalue: 0,
});

const em = {
  find: async (entity: unknown, where: { userid?: { $in: number[] } }) => {
    const ids = where.userid?.$in ?? [];
    if (entity === User) return ids.map((userid) => ({ userid, username: `u${userid}`, pic_square: "" }));
    if (entity === Save) return ids.map(saveRow);
    return [];
  },
  execute: async (sql: string, params: unknown[]) => {
    if (!/FROM bym\.friend /.test(sql)) return [];
    asked.push(params);
    return friendRows;
  },
  persist: () => {},
  flush: async () => {},
};

mock.module("../../server.js", () => ({ postgres: { em }, redis: memoryRedis(new Map()) }));

const { updateNeighbourData } = await import("./updateNeighbourData.js");

const cached = () =>
  [FRIEND, STRANGER].map((userid) => ({ userid, baseid: `${userid}00`, friend: userid === STRANGER ? 1 : 0 }) as any);

describe("updateNeighbourData friend flag", () => {
  test("a friend is 1 and anyone else 0, whatever the cache held", async () => {
    friendRows = [{ friend_userid: FRIEND }];
    asked = [];
    const list = await updateNeighbourData(cached(), BaseType.MAIN, VIEWER);
    expect(list.map((n) => [n.userid, n.friend])).toEqual([
      [FRIEND, 1],
      [STRANGER, 0],
    ]);
    expect(asked[0]?.[0]).toBe(VIEWER);
  });

  test("a list with no friends is all 0", async () => {
    friendRows = [];
    const list = await updateNeighbourData(cached(), BaseType.MAIN, VIEWER);
    expect(list.map((n) => n.friend)).toEqual([0, 0]);
  });

  test("the Inferno list flags friends too, naming the viewer apart from the truce lookup", async () => {
    friendRows = [{ friend_userid: FRIEND }];
    asked = [];
    const list = await updateNeighbourData(cached(), BaseType.INFERNO, undefined, VIEWER);
    expect(list.map((n) => n.friend)).toEqual([1, 0]);
    expect(asked[0]?.[0]).toBe(VIEWER);
  });
});
