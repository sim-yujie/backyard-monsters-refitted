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
const sets = new Map<string, Set<string>>();
/** Runs as a key is written, before the write: a save landing the attack meanwhile. */
let onSetex: ((key: string) => void) | null = null;
const fakeRedis = {
  get: async (key: string) => store.get(key) ?? null,
  setex: async (key: string, _ttl: number, value: string) => {
    onSetex?.(key);
    store.set(key, value);
    return "OK";
  },
  del: async (key: string) => (store.delete(key) ? 1 : 0),
  sadd: async (key: string, member: string) => {
    const set = sets.get(key) ?? new Set<string>();
    sets.set(key, set);
    set.add(member);
    return 1;
  },
  srem: async (key: string, member: string) => (sets.get(key)?.delete(member) ? 1 : 0),
  smembers: async (key: string) => [...(sets.get(key) ?? [])],
};

let row: Record<string, unknown> | null = null;

mock.module("../../server.js", () => ({
  redis: fakeRedis,
  postgres: { em: { findOne: async () => row } },
}));

const { attackCheckpoint } = await import("./attackCheckpoint.js");
const { attackCheckpointKey } = await import("../../services/base/attackCheckpoint.js");
const { attackSessionKey, serialiseAttackSession } = await import("../../services/base/attackSession.js");
const { mr1TribeSessionKey } = await import("../../services/maproom/v1/mr1TribeSession.js");
const { ROWLESS_CHECKPOINT_INDEX, readRowlessCheckpoint, rowlessCheckpointKey } = await import(
  "../../services/base/rowlessCheckpoint.js"
);
const { infernoConfig } = await import("../../config/InfernoConfig.js");

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
  sets.clear();
  onSetex = null;
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

/**
 * A yard with no row — a Map Room 1 tribe, a Descent yard, a Moloch tribe
 * (owner, 2 Nov 2026) — is named by `baseid` with `basesaveid` 0 and bound to
 * the attacker's own session for that yard.
 */
describe("attackCheckpoint on a yard with no row", () => {
  const TRIBE = "2";
  const ref = { kind: "mr1" as const, userid: ATTACKER, baseid: TRIBE };

  const startTribe = () =>
    store.set(
      mr1TribeSessionKey(ATTACKER, TRIBE),
      serialiseAttackSession({
        attackerid: ATTACKER,
        attackid: ATTACK_ID,
        startedat: Math.floor(Date.now() / 1000) - 20,
        entryHoused: { "5000": { C1: 10 } },
      })
    );

  const tribeCtx = (userid: number, events: unknown[], baseid = TRIBE, tick = 900) => {
    const ctx = ctxFor(userid, events, tick);
    Object.assign(ctx.request.body as Record<string, unknown>, { basesaveid: "0", baseid });
    return ctx;
  };

  test("keeps a Map Room 1 tribe attack's checkpoint under the attacker and the yard", async () => {
    startTribe();
    const ctx = tribeCtx(ATTACKER, [fling(400)]);
    expect(await run(ctx)).toBeNull();
    expect(ctx.body).toEqual({ error: 0, stored: true, tick: 900 });
    expect((await readRowlessCheckpoint(ref))?.checkpoint).toMatchObject({ attackid: ATTACK_ID, tick: 900 });
    expect([...(sets.get(ROWLESS_CHECKPOINT_INDEX) ?? [])]).toEqual([`mr1:${ATTACKER}:${TRIBE}`]);
  });

  test("another account, or no attack open on that yard, keeps nothing", async () => {
    startTribe();
    const caught = (await run(tribeCtx(31337, [fling(400)]))) as { data?: { reason?: string } };
    expect(caught?.data?.reason).toBe("no-session");
    store.delete(mr1TribeSessionKey(ATTACKER, TRIBE));
    expect(((await run(tribeCtx(ATTACKER, [fling(400)]))) as { data?: { reason?: string } })?.data?.reason).toBe(
      "no-session"
    );
    expect(store.has(rowlessCheckpointKey(ref))).toBe(false);
  });

  test("a base id that is no rowless yard is refused", async () => {
    startTribe();
    expect(await run(tribeCtx(ATTACKER, [fling(400)], "1000239208"))).toBeTruthy();
    expect(sets.get(ROWLESS_CHECKPOINT_INDEX)?.size ?? 0).toBe(0);
  });

  test("a Descent yard or Moloch tribe is refused while the Inferno is off", async () => {
    const saved = process.env.INFERNO_ENABLED;
    process.env.INFERNO_ENABLED = "off";
    try {
      expect(infernoConfig.enabled).toBe(false);
      expect(await run(tribeCtx(ATTACKER, [fling(400)], "201"))).toBeTruthy();
      expect(sets.get(ROWLESS_CHECKPOINT_INDEX)?.size ?? 0).toBe(0);
    } finally {
      process.env.INFERNO_ENABLED = saved;
    }
  });

  test("a checkpoint stored as the save lands the attack is dropped again, so it never lands twice", async () => {
    startTribe();
    // The save ends the session while this checkpoint is on its way (its
    // binding was read before), then drops the checkpoint it found: none yet.
    onSetex = (key) => {
      if (key === rowlessCheckpointKey(ref)) store.delete(mr1TribeSessionKey(ATTACKER, TRIBE));
    };
    const caught = (await run(tribeCtx(ATTACKER, [fling(400)]))) as { data?: { reason?: string } };
    expect(caught?.data?.reason).toBe("no-session");
    expect(store.has(rowlessCheckpointKey(ref))).toBe(false);
    expect(sets.get(ROWLESS_CHECKPOINT_INDEX)?.size ?? 0).toBe(0);
  });
});
