import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import bcrypt from "bcrypt";
import type { Context } from "koa";

/**
 * Signing out ends the session on the server (security audit 2026-10-29,
 * L4): the stored token is dropped, so a copy of the token taken before the
 * sign-out stops working at once instead of living out its 30 days.
 */

const EMAIL = "player@example.com";
const PASSWORD = "hunter22!";
const HASH = await bcrypt.hash(PASSWORD, 4);
const player = { userid: 9, username: "player", email: EMAIL, password: HASH, banned: false };

const store = new Map<string, string>();

const em = {
  global: true,
  getContext: () => em,
  findOne: async (entity: { name?: string }) => (entity?.name === "Bot" ? null : player),
  persist: () => {},
  flush: async () => {},
};

mock.module("../../server.js", () => ({
  postgres: { em },
  redis: {
    get: async (key: string) => store.get(key) ?? null,
    set: async (key: string, value: string) => {
      store.set(key, value);
      return "OK";
    },
    del: async (...keys: string[]) => keys.filter((key) => store.delete(key)).length,
    ttl: async () => -2,
    incr: async () => 1,
    expire: async () => 1,
  },
}));
mock.module("../../utils/logger.js", () => ({
  logger: { warn: mock(() => {}), error: mock(() => {}), info: mock(() => {}), debug: mock(() => {}) },
}));

const { login } = await import("./login.js");
const { logout } = await import("./logout.js");
const { verifyUserAuth } = await import("../../middleware/auth.js");

const signIn = async (sessionType: string): Promise<string> => {
  const ctx = {
    request: { body: { email: EMAIL, password: PASSWORD, sessionType } },
    ip: "127.0.0.1",
    get: () => "test",
  } as unknown as Context & { body: { token: string } };
  await login(ctx, async () => {});
  return ctx.body.token;
};

/** Runs a signed-in route with the token: its status, or the refusal's. */
const withToken = async (token: string, route: (ctx: Context) => Promise<void> = async () => {}) => {
  const ctx = { headers: { authorization: `Bearer ${token}` } } as unknown as Context;
  try {
    await verifyUserAuth(ctx, () => route(ctx));
    return ctx.status ?? 200;
  } catch (caught) {
    return (caught as { status: number }).status;
  }
};

const signOut = (token: string) => withToken(token, (ctx) => logout(ctx, async () => {}));

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ["ENV", "SECRET_KEY"]) saved[key] = process.env[key];
  process.env.ENV = "local";
  process.env.SECRET_KEY = "test-secret";
  store.clear();
});

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("signing out (security audit 2026-10-29, L4)", () => {
  test("the token stops working once signed out", async () => {
    const token = await signIn("game");
    store.set("chat-token:9", "chat");
    expect(await withToken(token)).toBe(200);

    expect(await signOut(token)).toBe(200);

    expect(await withToken(token)).toBe(401);
    expect(store.has("chat-token:9")).toBe(false);
  });

  test("signing out of the game leaves the launcher signed in", async () => {
    const game = await signIn("game");
    const launcher = await signIn("launcher");

    await signOut(game);

    expect(await withToken(game)).toBe(401);
    expect(await withToken(launcher)).toBe(200);
  });

  test("a token already replaced cannot sign out the newer one", async () => {
    const old = "not-a-real-token";
    const token = await signIn("game");

    expect(await signOut(old)).toBe(401);
    expect(await withToken(token)).toBe(200);
  });
});
