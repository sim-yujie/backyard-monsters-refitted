import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import JWT from "jsonwebtoken";
import type { Context } from "koa";

/**
 * The maintenance switch on every request with a session (owner, 22 Nov
 * 2026): during the countdown players carry on; past the cut-off every
 * request from anyone but the owner is refused, saying why; off lets them
 * back at once with the same session.
 */

const SECRET = "test-secret";
const tokens = new Map<string, string>();
let users: Record<string, { userid: number; email: string; banned: boolean }> = {};

mock.module("../server.js", () => ({
  postgres: { em: { findOne: async (_entity: unknown, where: { email: string }) => users[where.email] ?? null } },
  redis: {
    get: async (key: string) => tokens.get(key) ?? null,
    set: async () => "OK",
  },
}));
mock.module("../utils/logger.js", () => ({
  logger: { warn: mock(() => {}), error: mock(() => {}), info: mock(() => {}), debug: mock(() => {}) },
}));

const { verifyUserAuth } = await import("./auth.js");
const { setMaintenance, MAINTENANCE_OFF } = await import("../services/admin/maintenance.js");

const OWNER = 1;
const PLAYER = 2;

const sessionFor = (email: string): string => {
  const token = JWT.sign({ user: { email, discordId: null, sessionType: "game" } }, SECRET);
  tokens.set(`user-token:game:${email}`, token);
  return token;
};

/** One request through the middleware: "ok", or the refusal's status and reason. */
const request = async (token: string) => {
  const ctx = { headers: { authorization: `Bearer ${token}` } } as unknown as Context;
  try {
    let reached = false;
    await verifyUserAuth(ctx, async () => {
      reached = true;
    });
    return reached ? "ok" : "stopped";
  } catch (caught) {
    const error = caught as { status: number; data: { reason?: string } };
    return `${error.status} ${error.data?.reason ?? ""}`.trim();
  }
};

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ["SECRET_KEY", "ADMIN_USER_IDS", "ENV"]) saved[key] = process.env[key];
  process.env.SECRET_KEY = SECRET;
  process.env.ADMIN_USER_IDS = String(OWNER);
  process.env.ENV = "local";
  tokens.clear();
  users = {
    "owner@example.com": { userid: OWNER, email: "owner@example.com", banned: false },
    "player@example.com": { userid: PLAYER, email: "player@example.com", banned: false },
  };
});

afterEach(() => {
  setMaintenance(MAINTENANCE_OFF);
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("verifyUserAuth and the maintenance switch", () => {
  test("during the countdown, players already in carry on", async () => {
    const player = sessionFor("player@example.com");
    setMaintenance({ on: true, message: "Back soon.", backAt: null, startedAt: Date.now(), cutoffAt: Date.now() + 60_000 });
    expect(await request(player)).toBe("ok");
  });

  test("past the cut-off, a player's every request is refused with the maintenance reason", async () => {
    const player = sessionFor("player@example.com");
    setMaintenance({ on: true, message: "Back soon.", backAt: null, startedAt: Date.now() - 60_000, cutoffAt: Date.now() - 1 });
    expect(await request(player)).toBe("403 maintenance");
  });

  test("past the cut-off, the owner's session is never cut", async () => {
    const owner = sessionFor("owner@example.com");
    setMaintenance({ on: true, message: "Back soon.", backAt: null, startedAt: Date.now() - 60_000, cutoffAt: Date.now() - 1 });
    expect(await request(owner)).toBe("ok");
  });

  test("the countdown reaching zero is enough: no change is needed at the cut-off", async () => {
    const player = sessionFor("player@example.com");
    const cutoffAt = Date.now() + 150;
    setMaintenance({ on: true, message: "Back soon.", backAt: null, startedAt: Date.now(), cutoffAt });
    expect(await request(player)).toBe("ok");
    await Bun.sleep(cutoffAt - Date.now() + 20);
    expect(await request(player)).toBe("403 maintenance");
  });

  test("off (even after the cut-off) lets the same session back in", async () => {
    const player = sessionFor("player@example.com");
    setMaintenance({ on: true, message: "Back soon.", backAt: null, startedAt: Date.now() - 60_000, cutoffAt: Date.now() - 1 });
    expect(await request(player)).toBe("403 maintenance");
    setMaintenance(MAINTENANCE_OFF);
    expect(await request(player)).toBe("ok");
  });

  test("a missing or stale session is still the usual sign-in failure, not maintenance", async () => {
    setMaintenance({ on: true, message: "Back soon.", backAt: null, startedAt: Date.now() - 60_000, cutoffAt: Date.now() - 1 });
    const stale = JWT.sign({ user: { email: "player@example.com", discordId: null, sessionType: "game" } }, SECRET);
    expect(await request(stale)).not.toContain("maintenance");
  });
});
