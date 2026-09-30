import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Context } from "koa";
import { AccountMessage } from "../../game-rules/account/accountRules.js";

/**
 * A rename holds the new name to the same rules as a sign-up (issue #213):
 * the shared account rules with the reserved names, then the chat word
 * filter, each a clean 400 on the username field before anything is written.
 */

type Row = Record<string, unknown>;

let renames: number;

const em = {
  findOne: async () => null,
  nativeUpdate: async () => {
    renames += 1;
    return 0;
  },
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

const { changeUsername } = await import("./changeUsername.js");

const run = async (body: unknown) => {
  const user: Row = { userid: 7, username: "zz_player", username_changed_at: null };
  const ctx = { request: { body }, authUser: user } as unknown as Context & { body: Row };
  try {
    await changeUsername(ctx, async () => {});
    return { status: ctx.status, username: user.username, field: undefined, message: undefined };
  } catch (caught) {
    const error = caught as { status?: number; message: string; data?: { field?: string } };
    return { status: error.status, username: user.username, field: error.data?.field, message: error.message };
  }
};

beforeEach(() => {
  renames = 0;
});

describe("changeUsername", () => {
  test("renames to an ordinary name", async () => {
    expect(await run({ username: "zz_new" })).toMatchObject({ status: 200, username: "zz_new" });
    expect(renames).toBeGreaterThan(0);
  });

  test("refuses a reserved name with the shared message, writing nothing", async () => {
    expect(await run({ username: "Moderator" })).toMatchObject({
      status: 400,
      field: "username",
      message: AccountMessage.usernameReserved,
      username: "zz_player",
    });
    expect(renames).toBe(0);
  });

  test("refuses a name the word filter catches, writing nothing", async () => {
    expect(await run({ username: "big_shit" })).toMatchObject({
      status: 400,
      field: "username",
      message: AccountMessage.usernameBlocked,
    });
    expect(renames).toBe(0);
  });

  test("a broken rule is a 400, not a crash", async () => {
    expect(await run({ username: "a" })).toMatchObject({ status: 400, message: AccountMessage.usernameLength });
    expect((await run({})).status).toBe(400);
  });
});
