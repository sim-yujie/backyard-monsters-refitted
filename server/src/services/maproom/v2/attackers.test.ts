import { describe, expect, test } from "bun:test";
import type { EntityManager } from "@mikro-orm/postgresql";
import { attackersAmong } from "./attackers.js";

const emWith = (logs: { defender_userid: number; attacker_userid: number }[]) => {
  const calls: unknown[] = [];
  const em = {
    find: async (_entity: unknown, where: { defender_userid: number; attacker_userid: { $in: number[] } }) => {
      calls.push(where);
      return logs.filter(
        (log) => log.defender_userid === where.defender_userid && where.attacker_userid.$in.includes(log.attacker_userid),
      );
    },
  } as unknown as EntityManager;
  return { em, calls };
};

describe("attackersAmong", () => {
  test("returns the owners who have ever attacked the viewer, however long ago, and no others", async () => {
    const { em } = emWith([
      { defender_userid: 1, attacker_userid: 2 },
      { defender_userid: 1, attacker_userid: 2 },
      { defender_userid: 3, attacker_userid: 4 },
    ]);
    expect([...(await attackersAmong(em, 1, [2, 4, 5]))]).toEqual([2]);
  });

  test("asks nothing when there are no owners but the viewer", async () => {
    const { em, calls } = emWith([]);
    expect((await attackersAmong(em, 1, [1])).size).toBe(0);
    expect(calls).toHaveLength(0);
  });
});
