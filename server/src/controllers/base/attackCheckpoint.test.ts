import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Context } from "koa";

/**
 * `POST /base/checkpoint` (issue #138): bound like the attack save, kept only
 * when it adds to the record, and nothing kept for an attack with no drop.
 */

const ATTACKER = 2503;
const OWNER = 1;
const ATTACK_ID = 4242;
const BASESAVEID = 77;

const store = new Map<string, string>();
const fakeRedis = {
  get: async (key: string) => store.get(key) ?? null,
  setex: async (key: string, _ttl: number, value: string) => {
    store.set(key, value);
    return "OK";
  },
  del: async (key: string) => (store.delete(key) ? 1 : 0),
  sadd: async () => 1,
  srem: async () => 1,
  smembers: async () => [],
};

let row: Record<string, unknown> | null = null;

mock.module("../../server.js", () => ({
  redis: fakeRedis,
  postgres: { em: { findOne: async () => row } },
}));

const { attackCheckpoint } = await import("./attackCheckpoint.js");
const { attackCheckpointKey } = await import("../../services/base/attackCheckpoint.js");
const { attackSessionKey } = await import("../../services/base/attackSession.js");

const fling = (t: number) => ({ kind: "fling", t, x: -600, y: 100, r: 100, monsters: { C1: 10 } });

const ctxFor = (userid: number, events: unknown[], tick = 900) =>
  ({
    authUser: { userid, username: `u${userid}` },
    request: {
      body: {
        basesaveid: String(BASESAVEID),
        attackid: String(ATTACK_ID),
        tick: String(tick),
        flinglog: JSON.stringify({ v: 1, seed: 5, events }),
        sources: JSON.stringify(["1000239208"]),
      },
    },
    ip: "127.0.0.1",
  }) as unknown as Context & { body: Record<string, unknown> };

const run = async (ctx: Context): Promise<unknown> => {
  try {
    await attackCheckpoint(ctx);
    return null;
  } catch (caught) {
    return caught;
  }
};

const stored = () => {
  const raw = store.get(attackCheckpointKey(BASESAVEID));
  return raw ? JSON.parse(raw) : null;
};

beforeEach(() => {
  store.clear();
  row = { basesaveid: BASESAVEID, attackid: ATTACK_ID, saveuserid: OWNER };
  store.set(attackSessionKey(BASESAVEID), `${ATTACKER}:${ATTACK_ID}:${Math.floor(Date.now() / 1000) - 20}`);
});

describe("attackCheckpoint", () => {
  test("keeps the attacker's checkpoint", async () => {
    const ctx = ctxFor(ATTACKER, [fling(400)]);
    expect(await run(ctx)).toBeNull();
    expect(ctx.body).toEqual({ error: 0, stored: true, tick: 900 });
    expect(stored()).toMatchObject({ attackerid: ATTACKER, defenderid: OWNER, attackid: ATTACK_ID, tick: 900 });
  });

  test("keeps nothing for an attack with no drop (#79)", async () => {
    const ctx = ctxFor(ATTACKER, []);
    expect(await run(ctx)).toBeNull();
    expect(ctx.body).toEqual({ error: 0, stored: false });
    expect(stored()).toBeNull();
  });

  test("another account cannot checkpoint someone else's attack", async () => {
    const caught = (await run(ctxFor(31337, [fling(400)]))) as { data?: { reason?: string } };
    expect(caught?.data?.reason).toBe("wrong-attacker");
    expect(stored()).toBeNull();
  });

  test("an attack whose session has ended takes no checkpoint", async () => {
    store.delete(attackSessionKey(BASESAVEID));
    const caught = (await run(ctxFor(ATTACKER, [fling(400)]))) as { data?: { reason?: string } };
    expect(caught?.data?.reason).toBe("no-session");
  });

  test("a checkpoint cannot take a drop back out of the record", async () => {
    await run(ctxFor(ATTACKER, [fling(400), fling(800)], 1000));
    const caught = (await run(ctxFor(ATTACKER, [fling(400)], 1200))) as { data?: { reason?: string } };
    expect(caught?.data?.reason).toBe("rewound");
    expect(stored().flinglog.events).toHaveLength(2);
  });

  test("a row no longer under attack refuses it", async () => {
    row = { basesaveid: BASESAVEID, attackid: 0, saveuserid: OWNER };
    expect(await run(ctxFor(ATTACKER, [fling(400)]))).toBeTruthy();
    expect(stored()).toBeNull();
  });
});
