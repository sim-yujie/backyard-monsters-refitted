import { afterEach, describe, expect, mock, setSystemTime, test } from "bun:test";
import type { Context } from "koa";

/**
 * The server decides who is online (#271): a presence mark AND a real game
 * action in the last ten minutes, with no in-game check pending. A client
 * that only pings becomes attackable ten minutes after its last real action,
 * and a real action protects it again.
 *
 * Runs the real `/presence` controller and the real-action middleware over an
 * in-memory Redis, on a clock moved by hand.
 */

const store = new Map<string, string>();

mock.module("../../server.js", () => ({
  postgres: { em: {} },
  redis: {
    get: async (key: string) => store.get(key) ?? null,
    set: async (key: string, value: string) => {
      store.set(key, value);
      return "OK";
    },
    setex: async (key: string, _ttl: number, value: string) => {
      store.set(key, value);
      return "OK";
    },
    del: async (key: string) => (store.delete(key) ? 1 : 0),
  },
}));

const { presence } = await import("../../controllers/maproom/presence.js");
const { realActionTracker } = await import("../../middleware/realAction.js");
const { ATTACK_ONLINE_SECONDS, REAL_ACTION_WINDOW_SECONDS, isOnline, isPlayerOnline, setChallengePending } =
  await import("./online.js");
const { ONLINE_SECONDS } = await import("../bots/revenge.js");
const { seenRecently } = await import("../bots/revengeRun.js");

const USER = 2505;
const T0 = 1_900_000_000;
let clock = T0;
const at = (seconds: number) => {
  clock = seconds;
  setSystemTime(new Date(seconds * 1000));
};
const track = realActionTracker();

/** A request through the tracker, answered as `answer` says. */
const request = async (method: string, route: string, answer: { status?: number; body?: unknown } = {}) => {
  const ctx = {
    method,
    _matchedRoute: route,
    request: { body: {} },
    authUser: { userid: USER },
  } as unknown as Context;
  await track(ctx, async () => {
    ctx.status = answer.status ?? 200;
    ctx.body = answer.body ?? { error: 0 };
  });
};

const ping = async () => {
  const ctx = { method: "POST", _matchedRoute: "/api/:apiVersion/bm/presence", request: { body: {} }, authUser: { userid: USER } } as unknown as Context;
  await track(ctx, () => presence(ctx, async () => {}));
};
const upgrade = (answer?: { status?: number; body?: unknown }) =>
  request("POST", "/api/:apiVersion/bm/yard/upgrade", answer);
const online = () => isPlayerOnline(USER, clock, ATTACK_ONLINE_SECONDS);

afterEach(() => {
  store.clear();
  setSystemTime();
});

describe("a client that only pings", () => {
  test("becomes attackable 10 minutes after its last real action, and a real action protects it again", async () => {
    at(T0);
    await upgrade();
    await ping();
    expect(await online()).toBe(true);

    // Pings every 30 s, as the web client sends them, and nothing else.
    for (let t = T0 + 30; t <= T0 + REAL_ACTION_WINDOW_SECONDS; t += 30) {
      at(t);
      await ping();
      expect(await online()).toBe(true);
    }
    for (let t = T0 + REAL_ACTION_WINDOW_SECONDS + 30; t <= T0 + 3 * REAL_ACTION_WINDOW_SECONDS; t += 30) {
      at(t);
      await ping();
      expect(await online()).toBe(false);
    }

    // A real action: protected again at once, for another ten minutes.
    await upgrade();
    expect(await online()).toBe(true);
    at(clock + REAL_ACTION_WINDOW_SECONDS - 30);
    await ping();
    expect(await online()).toBe(true);
  });

  test("never online without a real action at all", async () => {
    at(T0);
    await ping();
    expect(await online()).toBe(false);
  });
});

describe("the bots' revenge", () => {
  test("waits for an online player only while they play, not while they only ping", async () => {
    at(T0);
    await upgrade();
    await ping();
    expect(await seenRecently(USER, clock)).toBe(true);
    at(T0 + REAL_ACTION_WINDOW_SECONDS + 30);
    await ping();
    expect(await seenRecently(USER, clock)).toBe(false);
  });
});

describe("what records a real action", () => {
  test("a refused or failed action does not", async () => {
    at(T0);
    await ping();
    await upgrade({ status: 400, body: { error: "Not enough resources" } });
    await upgrade({ status: 200, body: { error: "Refused" } });
    expect(await online()).toBe(false);
    await upgrade({ status: 200, body: { error: 0 } });
    expect(await online()).toBe(true);
  });

  test.each([
    ["the yard's state", "POST", "/api/:apiVersion/bm/yard/state"],
    ["a yard load", "POST", "/base/load"],
    ["Map Room 1's re-read", "GET", "/api/:apiVersion/bm/maproom1"],
    ["Map Room 2's cells", "POST", "/worldmapv3/getcells"],
    ["an attack checkpoint", "POST", "/base/checkpoint"],
    ["a tip marked seen", "POST", "/api/:apiVersion/bm/yard/tips/seen"],
  ])("%s does not", async (_what, method, route) => {
    at(T0);
    await ping();
    await request(method, route);
    expect(await online()).toBe(false);
  });

  test("an attack load does; a view does not", async () => {
    at(T0);
    await ping();
    const load = async (type: string) => {
      const ctx = {
        method: "POST",
        _matchedRoute: "/base/load",
        request: { body: { type } },
        authUser: { userid: USER },
      } as unknown as Context;
      await track(ctx, async () => {
        ctx.status = 200;
        ctx.body = { error: 0 };
      });
    };
    await load("view");
    await load("build");
    expect(await online()).toBe(false);
    await load("wmattack");
    expect(await online()).toBe(true);
  });

  test("a request with no player behind it records nothing", async () => {
    at(T0);
    const ctx = { method: "POST", _matchedRoute: "/api/:apiVersion/bm/yard/upgrade", request: { body: {} } } as unknown as Context;
    await track(ctx, async () => {
      ctx.status = 200;
    });
    expect(store.size).toBe(0);
  });
});

describe("a pending in-game check (#273)", () => {
  test("makes a playing player read as offline until it is cleared", async () => {
    at(T0);
    await upgrade();
    await ping();
    await setChallengePending(USER, true);
    expect(await online()).toBe(false);
    await setChallengePending(USER, false);
    expect(await online()).toBe(true);
  });
});

describe("isOnline", () => {
  const now = T0;
  const fresh = { lastSeen: now - 10, lastAction: now - 60, challengePending: false };

  test("needs both marks, each within its window", () => {
    expect(isOnline(fresh, now, ATTACK_ONLINE_SECONDS)).toBe(true);
    expect(isOnline({ ...fresh, lastSeen: null }, now, ATTACK_ONLINE_SECONDS)).toBe(false);
    expect(isOnline({ ...fresh, lastAction: null }, now, ATTACK_ONLINE_SECONDS)).toBe(false);
    expect(isOnline({ ...fresh, lastSeen: now - 61 }, now, ATTACK_ONLINE_SECONDS)).toBe(false);
    expect(isOnline({ ...fresh, lastSeen: now - 61 }, now, ONLINE_SECONDS)).toBe(true);
    expect(isOnline({ ...fresh, lastAction: now - REAL_ACTION_WINDOW_SECONDS }, now, 60)).toBe(true);
    expect(isOnline({ ...fresh, lastAction: now - REAL_ACTION_WINDOW_SECONDS - 1 }, now, 60)).toBe(false);
    expect(isOnline({ ...fresh, challengePending: true }, now, ATTACK_ONLINE_SECONDS)).toBe(false);
  });

  test("is the owner's ten minutes", () => {
    expect(REAL_ACTION_WINDOW_SECONDS).toBe(600);
  });
});
