import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Context } from "koa";

/**
 * An attack's result lands once (issue #138). The save that ends an attack
 * takes the same lock as the server finishing an abandoned one, so a copy of
 * that save sent again as the page closes — or a save racing the server — is
 * refused before anything runs. `validateSave` is the first step after the
 * lock; a stand-in that throws a marker there says "got past the lock".
 */

const REACHED = "reached validateSave";
const OWNER = 1;
const ATTACKER = 2503;
const ATTACK_ID = 4242;

const store = new Map<string, string>();
const validateSave = mock(async () => {
  throw new Error(REACHED);
});

mock.module("../../../server.js", () => ({
  postgres: {
    em: {
      populate: async (user: Record<string, unknown>) => {
        user.save = { userid: user.userid, resources: {} };
      },
      findOne: async () => ({
        basesaveid: 9,
        baseid: "1234",
        saveuserid: OWNER,
        type: "tribe",
        attackid: ATTACK_ID,
        savetime: 0,
        resources: {},
      }),
      persist: () => {},
      flush: async () => {},
    },
  },
  redis: {
    get: async (key: string) => store.get(key) ?? null,
    setex: async () => "OK",
    set: async (key: string, value: string, ...options: string[]) => {
      if (options.includes("NX") && store.has(key)) return null;
      store.set(key, value);
      return "OK";
    },
    del: async (key: string) => (store.delete(key) ? 1 : 0),
    srem: async () => 0,
  },
}));

mock.module("../../../utils/logger.js", () => ({
  logger: { warn: mock(() => {}), error: mock(() => {}), info: mock(() => {}), debug: mock(() => {}) },
}));

mock.module("../../../scripts/anticheat/anticheat.js", () => ({
  initAnticheat: async () => {},
  validateSave,
}));

mock.module("../../../services/base/attackSessionStore.js", () => ({
  startAttackSession: async () => {},
  readAttackSession: async () => ({
    attackerid: ATTACKER,
    attackid: ATTACK_ID,
    startedat: Math.floor(Date.now() / 1000),
  }),
  endAttackSession: async () => {},
}));

const { baseSave } = await import("./baseSave.js");
const { attackFinalLockKey } = await import("../../../services/base/attackCheckpoint.js");

const ctxFor = (over?: string) =>
  ({
    authUser: { userid: ATTACKER, username: "attacker" },
    request: {
      body: { baseid: "1234", basesaveid: "9", attackid: String(ATTACK_ID), ...(over ? { over } : {}) },
    },
    ip: "127.0.0.1",
    path: "/base/save",
  }) as unknown as Context;

const run = async (ctx: Context): Promise<unknown> => {
  try {
    await baseSave(ctx, async () => {});
    return null;
  } catch (caught) {
    return caught;
  }
};

beforeEach(() => {
  store.clear();
  validateSave.mockClear();
});

describe("baseSave final lock", () => {
  test("the save that ends an attack holds the lock while it runs, and lets go", async () => {
    const caught = (await run(ctxFor("1"))) as Error;
    expect(caught.message).toBe(REACHED);
    expect(store.has(attackFinalLockKey(9))).toBe(false);
  });

  test("a second copy while the first is landing is refused before anything runs", async () => {
    store.set(attackFinalLockKey(9), "1");
    const caught = (await run(ctxFor("1"))) as { data?: { reason?: string } };
    expect(caught.data?.reason).toBe("finalising");
    expect(validateSave).not.toHaveBeenCalled();
    // The holder's lock is not the refused save's to release.
    expect(store.has(attackFinalLockKey(9))).toBe(true);
  });

  test("a save that does not end the attack takes no lock", async () => {
    store.set(attackFinalLockKey(9), "1");
    const caught = (await run(ctxFor())) as Error;
    expect(caught.message).toBe(REACHED);
  });
});
