import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { User } from "../../database/models/user.model.js";
import { matchesWhere } from "../../testing/matchesWhere.js";

/**
 * A rename holds the same rule as a sign-up (issue #213): a username is taken
 * whatever its case, so "BOB" cannot be had while "bob" exists. A player may
 * still change the case of their own name.
 */

type Row = Record<string, unknown>;

let users: Row[];

const em = {
  findOne: async (_entity: unknown, where: Row) => users.find((row) => matchesWhere(row, where)) ?? null,
  nativeUpdate: async () => 0,
};

mock.module("../../server.js", () => ({
  postgres: { em: { transactional: async (work: (inner: typeof em) => Promise<void>) => work(em) } },
  redis: {
    get: async () => null,
    set: async () => "OK",
    setex: async () => "OK",
    del: async () => 0,
    sadd: async () => 1,
    srem: async () => 1,
    smembers: async () => [],
  },
}));

const { renameUser } = await import("./renameUser.js");

const rename = async (user: Row, username: string) => {
  try {
    await renameUser(user as unknown as User, username);
    return { renamed: user.username, reason: undefined };
  } catch (caught) {
    return { renamed: undefined, reason: (caught as { data?: { reason?: string } }).data?.reason };
  }
};

beforeEach(() => {
  users = [
    { userid: 1, username: "bob" },
    { userid: 2, username: "carol_1" },
  ];
});

describe("renameUser", () => {
  test("a name another player holds in another case is taken", async () => {
    expect(await rename(users[1], "BOB")).toEqual({ renamed: undefined, reason: "usernameTaken" });
  });

  test("a player may change the case of their own name", async () => {
    expect((await rename(users[0], "Bob")).renamed).toBe("Bob");
  });

  test("an underscore is not a wildcard", async () => {
    expect((await rename(users[0], "carolx1")).renamed).toBe("carolx1");
  });
});
