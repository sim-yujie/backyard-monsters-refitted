import { afterEach, beforeEach, describe, expect, mock, setSystemTime, test } from "bun:test";
import bcrypt from "bcrypt";
import type { Context } from "koa";

/**
 * Why the owner's dashboard can go from working to "Not Found" while the
 * server is up (26 Oct): the dashboard has no sign-in of its own, it sends the
 * game's token from this browser. The server keeps one token per account and
 * session type (`services/auth/sessions.ts`), and every game sign-in mints a
 * new one, the token re-login the game does each time it opens included. So
 * opening the game anywhere ends the token the dashboard holds, and the
 * owner-only check (`adminGuard.ts`) answers that token 404, as it answers
 * anyone it does not let in. The token itself lasts 30 days.
 */

const EMAIL = "owner@example.com";
const PASSWORD = "hunter22!";
const HASH = await bcrypt.hash(PASSWORD, 4);
const owner = { userid: 5, username: "owner", email: EMAIL, password: HASH, banned: false };

const store = new Map<string, string>();

const em = {
  global: true,
  getContext: () => em,
  findOne: async (entity: { name?: string }) => (entity?.name === "Bot" ? null : owner),
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
    // The sign-in back-off (`services/auth/loginBackoff.ts`): no pause.
    ttl: async () => -2,
    incr: async () => 1,
    expire: async () => 1,
    del: async () => 0,
  },
}));
mock.module("../../utils/logger.js", () => ({
  logger: { warn: mock(() => {}), error: mock(() => {}), info: mock(() => {}), debug: mock(() => {}) },
}));

const { login } = await import("../../controllers/auth/login.js");
const { verifyUserAuth } = await import("../../middleware/auth.js");
const { makeAdminGuard } = await import("./adminGuard.js");

const guard = makeAdminGuard(verifyUserAuth, (userid) => userid === owner.userid);

/** Signs in to the game the way the client does: a password, or the stored token. */
const signIn = async (body: Record<string, string>): Promise<string> => {
  const ctx = {
    request: { body: { sessionType: "game", ...body } },
    ip: "127.0.0.1",
    get: () => "test",
  } as unknown as Context & { body: { token: string } };
  await login(ctx, async () => {});
  return ctx.body.token;
};

/** Asks for the dashboard's health with a token; the status the owner's browser gets. */
const health = async (token: string): Promise<number> => {
  const ctx = { method: "GET", path: "/api/v1/admin/health", headers: { authorization: `Bearer ${token}` } } as unknown as Context;
  await guard(ctx, async () => {
    ctx.status = 200;
  });
  return ctx.status;
};

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ["ENV", "SECRET_KEY", "SESSION_LIFETIME"]) saved[key] = process.env[key];
  process.env.ENV = "local";
  process.env.SECRET_KEY = "test-secret";
  delete process.env.SESSION_LIFETIME;
  store.clear();
  setSystemTime(new Date("2026-10-26T14:20:00Z"));
});

afterEach(() => {
  setSystemTime();
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("the dashboard's sign-in (26 Oct: health went from 200 to 404)", () => {
  test("opening the game again ends the token the dashboard holds, and the dashboard then gets 404", async () => {
    const dashboardToken = await signIn({ email: EMAIL, password: PASSWORD });
    expect(await health(dashboardToken)).toBe(200);

    // Two minutes later the game opens in another tab and signs in with the stored token.
    setSystemTime(new Date("2026-10-26T14:22:00Z"));
    const gameToken = await signIn({ token: dashboardToken });
    expect(gameToken).not.toBe(dashboardToken);

    expect(await health(dashboardToken)).toBe(404);
    // The newest token, which the game saved in this browser, still gets in.
    expect(await health(gameToken)).toBe(200);
  });

  test("a password sign-in elsewhere does the same", async () => {
    const dashboardToken = await signIn({ email: EMAIL, password: PASSWORD });
    setSystemTime(new Date("2026-10-26T14:22:00Z"));
    await signIn({ email: EMAIL, password: PASSWORD });
    expect(await health(dashboardToken)).toBe(404);
  });

  test("the token is not what runs out: one left alone still works 29 days later", async () => {
    const dashboardToken = await signIn({ email: EMAIL, password: PASSWORD });
    setSystemTime(new Date("2026-11-24T14:20:00Z"));
    expect(await health(dashboardToken)).toBe(200);
    setSystemTime(new Date("2026-11-26T14:20:00Z"));
    expect(await health(dashboardToken)).toBe(404);
  });
});
