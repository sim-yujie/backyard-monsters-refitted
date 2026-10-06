import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import bcrypt from "bcrypt";
import JWT from "jsonwebtoken";
import type { Context } from "koa";

/**
 * The Discord login lock is a switch (issue #213): with
 * REQUIRE_DISCORD_VERIFICATION=true a production server refuses an account
 * that has not verified its Discord, as it always did; unset, anyone may sign
 * in, so a player who signed up on the web client can play. A local server
 * never asks.
 */

type Row = Record<string, unknown>;

let user: Row;
/** Userids with a `bot` row (issue #235). */
let botIds: number[];

const em = {
  global: true,
  getContext: () => em,
  findOne: async (entity: { name?: string }) =>
    entity?.name === "Bot" ? (botIds.includes(user.userid as number) ? { userid: user.userid } : null) : user,
  persist: () => {},
  flush: async () => {},
  fork: () => ({ findOne: async () => null, flush: async () => {} }),
};

mock.module("../../server.js", () => ({
  postgres: { em },
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
mock.module("../../utils/logger.js", () => ({
  logger: { warn: mock(() => {}), error: mock(() => {}), info: mock(() => {}), debug: mock(() => {}) },
}));

const { login } = await import("./login.js");

const PASSWORD = "hunter22!";
const HASH = await bcrypt.hash(PASSWORD, 4);

const saved: Record<string, string | undefined> = {};
const SWITCHES = ["ENV", "REQUIRE_DISCORD_VERIFICATION", "DISCORD_TOKEN", "SECRET_KEY"];

const run = async (password = PASSWORD) => {
  const ctx = {
    request: { body: { email: "player@example.com", password } },
    ip: "127.0.0.1",
    get: () => "test",
  } as unknown as Context & { body: Row };
  try {
    await login(ctx, async () => {});
    const claims = JWT.decode(ctx.body.token as string) as { user: { discordId?: string | null } };
    return { status: ctx.status, discordId: claims.user.discordId, message: undefined, body: ctx.body };
  } catch (caught) {
    const error = caught as { status?: number; message: string };
    return { status: error.status, discordId: undefined, message: error.message, body: undefined };
  }
};

beforeEach(() => {
  for (const key of SWITCHES) saved[key] = process.env[key];
  process.env.ENV = "production";
  process.env.SECRET_KEY = "test-secret";
  delete process.env.REQUIRE_DISCORD_VERIFICATION;
  delete process.env.DISCORD_TOKEN;
  user = {
    userid: 7,
    username: "zz_player",
    email: "player@example.com",
    password: HASH,
    banned: false,
    discord_verified: false,
    discord_id: null,
  };
  botIds = [];
});

afterEach(() => {
  for (const key of SWITCHES) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("login and REQUIRE_DISCORD_VERIFICATION", () => {
  test("unset: an account without Discord signs in on production", async () => {
    expect(await run()).toMatchObject({ status: 200, discordId: null });
  });

  test("anything but true counts as unset", async () => {
    process.env.REQUIRE_DISCORD_VERIFICATION = "false";
    expect((await run()).status).toBe(200);
    process.env.REQUIRE_DISCORD_VERIFICATION = "yes";
    expect((await run()).status).toBe(200);
  });

  test("true: production refuses an account that has not verified its Discord, as before", async () => {
    process.env.REQUIRE_DISCORD_VERIFICATION = "true";
    const result = await run();
    expect(result.status).toBe(401);
    expect(result.message).toContain("Discord");
  });

  test("true: a verified account signs in with its Discord ID in the token", async () => {
    process.env.REQUIRE_DISCORD_VERIFICATION = "true";
    user.discord_verified = true;
    user.discord_id = "80351110224678912";
    expect(await run()).toMatchObject({ status: 200, discordId: "80351110224678912" });
  });

  test("unset: a verified account still carries its Discord ID, an unverified one does not", async () => {
    user.discord_verified = true;
    user.discord_id = "80351110224678912";
    expect((await run()).discordId).toBe("80351110224678912");

    user.discord_verified = false;
    expect((await run()).discordId).toBeNull();
  });

  test("true: a local server never asks for Discord", async () => {
    process.env.REQUIRE_DISCORD_VERIFICATION = "true";
    process.env.ENV = "local";
    expect((await run()).status).toBe(200);
  });
});

describe("login and bot accounts (issue #235)", () => {
  test("a bot's account is refused exactly as a wrong password is", async () => {
    const wrongPassword = await run("not-the-password");
    botIds = [user.userid as number];
    const bot = await run();
    expect(bot.status).toBe(wrongPassword.status!);
    expect(bot.message).toBe(wrongPassword.message);
    expect(bot.body).toBeUndefined();
  });
});

describe("login does not say which emails have an account (issue #317)", () => {
  test("an unknown email gets the wrong-password answer, after a bcrypt compare", async () => {
    const wrongPassword = await run("not-the-password");

    const compare = spyOn(bcrypt, "compare");
    user = null as unknown as Row;
    const unknown = await run();
    expect(compare).toHaveBeenCalledTimes(1);
    compare.mockRestore();

    expect(unknown.status).toBe(wrongPassword.status!);
    expect(unknown.message).toBe(wrongPassword.message);
    expect(unknown.body).toBeUndefined();
  });

  test("an email with no password is a wrong password, not a crash", async () => {
    const wrongPassword = await run("not-the-password");
    const none = await run("");
    expect(none.message).toBe(wrongPassword.message);
  });
});
