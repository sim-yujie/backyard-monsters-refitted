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

/** Redis keys the sign-in back-off keeps: key -> value and seconds left. */
const kept = new Map<string, { value: string; ttl: number }>();

mock.module("../../server.js", () => ({
  postgres: { em },
  redis: {
    get: async () => null,
    set: async (key: string, value: string, ex?: string, seconds?: string) => {
      if (ex === "EX") kept.set(key, { value, ttl: Number(seconds) });
      return "OK";
    },
    setex: async () => "OK",
    del: async (...keys: string[]) => keys.filter((key) => kept.delete(key)).length,
    incr: async (key: string) => {
      const next = Number(kept.get(key)?.value ?? 0) + 1;
      kept.set(key, { value: String(next), ttl: kept.get(key)?.ttl ?? -1 });
      return next;
    },
    expire: async (key: string, seconds: number) => {
      const entry = kept.get(key);
      if (entry) entry.ttl = seconds;
      return entry ? 1 : 0;
    },
    ttl: async (key: string) => kept.get(key)?.ttl ?? -2,
    sadd: async (key: string, member: string) => {
      const members = new Set((kept.get(key)?.value ?? "").split(",").filter(Boolean)).add(member);
      kept.set(key, { value: [...members].join(","), ttl: kept.get(key)?.ttl ?? -1 });
      return 1;
    },
    srem: async (key: string, member: string) => {
      const entry = kept.get(key);
      if (entry) entry.value = entry.value.split(",").filter((one) => one && one !== member).join(",");
      return 1;
    },
    smembers: async (key: string) => (kept.get(key)?.value ?? "").split(",").filter(Boolean),
  },
}));
mock.module("../../utils/logger.js", () => ({
  logger: { warn: mock(() => {}), error: mock(() => {}), info: mock(() => {}), debug: mock(() => {}) },
}));

const { login } = await import("./login.js");
const { clearAllLoginFailures } = await import("../../services/auth/loginBackoff.js");

const PASSWORD = "hunter22!";
const HASH = await bcrypt.hash(PASSWORD, 4);

const saved: Record<string, string | undefined> = {};
const SWITCHES = ["ENV", "REQUIRE_DISCORD_VERIFICATION", "DISCORD_TOKEN", "SECRET_KEY"];

const run = async (password = PASSWORD, email = "player@example.com", ip = "127.0.0.1") => {
  const ctx = {
    request: { body: { email, password } },
    ip,
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
  kept.clear();
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

describe("sign-in back-off per email and address (security audit 2026-10-29, L2)", () => {
  const EMAIL = "player@example.com";
  const HOME = "127.0.0.1";
  const STRANGER = "203.0.113.9";
  const PAUSE = `login-pause:${EMAIL}|${HOME}`;
  const FAILURES = `login-failures:${EMAIL}|${HOME}`;
  const wrong = (ip = HOME, email = EMAIL) => run("not-the-password", email, ip);

  test("five wrong passwords, then a short pause that refuses even the right one", async () => {
    for (let at = 0; at < 5; at++) expect((await wrong()).status).toBe(409);

    const paused = await run();
    expect(paused.status).toBe(429);
    expect(paused.message).toContain("1 minute");
    expect(kept.get(PAUSE)?.ttl).toBe(30);
  });

  test("a stranger pausing the email does not stop the player on their own connection", async () => {
    for (let at = 0; at < 12; at++) await wrong(STRANGER);
    expect((await run(PASSWORD, EMAIL, STRANGER)).status).toBe(429);

    expect((await run(PASSWORD, EMAIL, HOME)).status).toBe(200);
    // And the player's sign-in does not lift the stranger's pause.
    expect((await run(PASSWORD, EMAIL, STRANGER)).status).toBe(429);
  });

  test("a password reset lifts the pause from every address", async () => {
    for (let at = 0; at < 5; at++) {
      await wrong(HOME);
      await wrong(STRANGER);
    }
    expect((await run(PASSWORD, EMAIL, HOME)).status).toBe(429);

    await clearAllLoginFailures(EMAIL);

    expect((await run(PASSWORD, EMAIL, HOME)).status).toBe(200);
    expect((await run(PASSWORD, EMAIL, STRANGER)).status).toBe(200);
    expect([...kept.keys()].filter((key) => key.includes(EMAIL))).toEqual([]);
  });

  test("a try during the pause is not counted, and skips the password check", async () => {
    for (let at = 0; at < 5; at++) await wrong();
    const compare = spyOn(bcrypt, "compare");
    await wrong();
    await wrong();
    expect(compare).not.toHaveBeenCalled();
    compare.mockRestore();
    expect(kept.get(FAILURES)?.value).toBe("5");
  });

  test("each wrong password after a pause doubles it, up to 15 minutes", async () => {
    const pauses: number[] = [];
    for (let at = 0; at < 12; at++) {
      await wrong();
      pauses.push(kept.get(PAUSE)?.ttl ?? 0);
      kept.delete(PAUSE); // the pause runs out
    }
    expect(pauses).toEqual([0, 0, 0, 0, 30, 60, 120, 240, 480, 900, 900, 900]);
    expect(kept.get(FAILURES)?.ttl).toBe(15 * 60);
  });

  test("the right password forgets the wrong ones from that address", async () => {
    for (let at = 0; at < 4; at++) await wrong();
    expect((await run()).status).toBe(200);
    expect(kept.has(FAILURES)).toBe(false);
    for (let at = 0; at < 4; at++) await wrong();
    expect((await run()).status).toBe(200);
  });

  test("an email with no account is paused the same way, so the pause says nothing", async () => {
    user = null as unknown as Row;
    for (let at = 0; at < 5; at++) await wrong(HOME, "nobody@example.com");
    expect((await run(PASSWORD, "nobody@example.com")).status).toBe(429);
  });

  test("one email's pause does not touch another's", async () => {
    for (let at = 0; at < 5; at++) await wrong(HOME, "other@example.com");
    expect((await run()).status).toBe(200);
  });
});
