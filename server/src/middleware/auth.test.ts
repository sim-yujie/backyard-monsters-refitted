import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import JWT from "jsonwebtoken";

/**
 * The Discord age gate on attacks and Map Room moves follows the same switch
 * as the login lock (issue #213): with REQUIRE_DISCORD_VERIFICATION=true a
 * production token passes only with a Discord account at least a week old;
 * unset, every account passes, so a web sign-up can play.
 */

mock.module("../server.js", () => ({
  postgres: { em: { findOne: async () => null } },
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
mock.module("../utils/logger.js", () => ({
  logger: { warn: mock(() => {}), error: mock(() => {}), info: mock(() => {}), debug: mock(() => {}) },
}));

const { verifyJwtToken } = await import("./auth.js");

const SECRET = "test-secret";
const DISCORD_EPOCH = 1420070400000n;

/** A Discord ID minted at the given time. */
const snowflakeAt = (time: number): string => ((BigInt(time) - DISCORD_EPOCH) << 22n).toString();

const OLD_DISCORD = snowflakeAt(Date.parse("2016-01-01"));
const NEW_DISCORD = snowflakeAt(Date.now() - 60_000);

const tokenFor = (discordId: string | null) =>
  JWT.sign({ user: { email: "player@example.com", discordId, sessionType: "game" } }, SECRET);

const meets = (discordId: string | null) => verifyJwtToken(tokenFor(discordId)).user.meetsDiscordAgeCheck;

const saved: Record<string, string | undefined> = {};
const SWITCHES = ["ENV", "REQUIRE_DISCORD_VERIFICATION", "SECRET_KEY"];

beforeEach(() => {
  for (const key of SWITCHES) saved[key] = process.env[key];
  process.env.ENV = "production";
  process.env.SECRET_KEY = SECRET;
  delete process.env.REQUIRE_DISCORD_VERIFICATION;
});

afterEach(() => {
  for (const key of SWITCHES) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("verifyJwtToken's Discord age check", () => {
  test("unset: every account meets it, with or without Discord", () => {
    expect(meets(null)).toBe(true);
    expect(meets(NEW_DISCORD)).toBe(true);
    expect(meets(OLD_DISCORD)).toBe(true);
  });

  test("true: only a Discord account at least a week old meets it, as before", () => {
    process.env.REQUIRE_DISCORD_VERIFICATION = "true";
    expect(meets(null)).toBe(false);
    expect(meets(NEW_DISCORD)).toBe(false);
    expect(meets(OLD_DISCORD)).toBe(true);
  });

  test("a token signed with another key is still refused either way", () => {
    const forged = JWT.sign({ user: { email: "player@example.com", discordId: null } }, "other");
    expect(() => verifyJwtToken(forged)).toThrow();
  });
});

describe("verifyJwtToken checks the signature on every server (issue #319)", () => {
  test("a local server refuses a token signed with another key, or not signed at all", () => {
    process.env.ENV = "local";
    const forged = JWT.sign({ user: { email: "player@example.com", sessionType: "game" } }, "other");
    expect(() => verifyJwtToken(forged)).toThrow();

    const unsigned = JWT.sign({ user: { email: "player@example.com", sessionType: "game" } }, "", {
      algorithm: "none",
    });
    expect(() => verifyJwtToken(unsigned)).toThrow();
  });

  test("a local server accepts its own token, and never asks for Discord", () => {
    process.env.ENV = "local";
    process.env.REQUIRE_DISCORD_VERIFICATION = "true";
    const { user } = verifyJwtToken(tokenFor(null));
    expect(user).toMatchObject({ email: "player@example.com", sessionType: "game", meetsDiscordAgeCheck: true });
  });
});
