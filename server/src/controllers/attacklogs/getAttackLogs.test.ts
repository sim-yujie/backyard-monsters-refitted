import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Context } from "koa";

/**
 * The attack log's cache key holds only the checked filter (security audit
 * 2026-10-29, M3): a player sending a new `?filter=` each time used to make a
 * new Redis key each time, each holding up to 50 full reports. Every key it
 * writes also expires.
 */

const ME = 2505;

let written: Array<{ key: string; ttl: number }>;
let wheres: unknown[];

mock.module("../../server.js", () => ({
  postgres: {
    em: {
      find: async (_entity: unknown, where: unknown) => {
        wheres.push(where);
        return [];
      },
    },
  },
  redis: {
    get: async () => null,
    setex: async (key: string, ttl: number) => {
      written.push({ key, ttl });
      return "OK";
    },
  },
}));

const { getAttackLogs, attackLogFilterOf } = await import("./getAttackLogs.js");
const { AttackLogFilter } = await import("../../enums/AttackLogFilter.js");

const ask = (filter: unknown) =>
  getAttackLogs(
    { authUser: { userid: ME }, query: filter === undefined ? {} : { filter } } as unknown as Context,
    async () => {}
  );

beforeEach(() => {
  written = [];
  wheres = [];
});

describe("the attack log cache key (security audit 2026-10-29, M3)", () => {
  test("any filter outside the three known ones is cached as both", async () => {
    for (const filter of [undefined, "", "1", "2", "both2", "x".repeat(5_000), ["myattacks", "x"]]) await ask(filter);

    expect(new Set(written.map(({ key }) => key))).toEqual(new Set([`attackLogs:${ME}:both`]));
    expect(wheres.every((where) => JSON.stringify(where).includes("$or"))).toBe(true);
  });

  test("the three known filters each keep their own key and read", async () => {
    await ask("myattacks");
    await ask("peopleattackingme");
    await ask("both");

    expect(written.map(({ key }) => key)).toEqual([
      `attackLogs:${ME}:myattacks`,
      `attackLogs:${ME}:peopleattackingme`,
      `attackLogs:${ME}:both`,
    ]);
    expect(wheres).toEqual([
      { attacker_userid: ME },
      { defender_userid: ME },
      { $or: [{ attacker_userid: ME }, { defender_userid: ME }] },
    ]);
  });

  test("every key it writes expires", async () => {
    await ask("myattacks");
    await ask("anything");

    expect(written.every(({ ttl }) => ttl > 0 && ttl <= 1800)).toBe(true);
  });

  test("attackLogFilterOf", () => {
    expect(attackLogFilterOf("peopleattackingme")).toBe(AttackLogFilter.MY_DEFENCES);
    expect(attackLogFilterOf("constructor")).toBe(AttackLogFilter.BOTH);
    expect(attackLogFilterOf(["myattacks"])).toBe(AttackLogFilter.BOTH);
  });
});
