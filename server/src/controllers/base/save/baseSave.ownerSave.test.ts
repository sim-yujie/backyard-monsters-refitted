import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { Context } from "koa";
import type { OwnerSaveMode } from "../../../config/OwnerSaveConfig.js";

/**
 * Where `baseSave` puts the owner-save gate (issue #101): after the ownership
 * check, before the attack binding, `validateSave`, the audits and any write.
 *
 * The controller runs for real against stand-ins for the database, Redis and
 * the anticheat. `validateSave` is the first step after the gate that every
 * save reaches, so a stand-in that throws a marker there says "this save got
 * past the gate" without playing the rest of the save out; a save the gate
 * refuses never reaches it and writes nothing.
 */

const REACHED = "reached validateSave";
const OWNER = 2503;
const ATTACKER = 77;
const ATTACK_ID = 4242;

let row: Record<string, unknown> | null = null;
const persist = mock(() => {});
const flush = mock(async () => {});
const validateSave = mock(async () => {
  throw new Error(REACHED);
});

mock.module("../../../server.js", () => ({
  postgres: {
    em: {
      populate: async (user: Record<string, unknown>) => {
        user.save = { userid: user.userid, resources: {} };
      },
      findOne: async () => row,
      persist,
      flush,
    },
  },
  redis: { setex: async () => "OK", get: async () => null, del: async () => 0 },
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
  // The attacker's own session, just started, so the binding check passes.
  readAttackSession: async () => ({
    attackerid: ATTACKER,
    attackid: ATTACK_ID,
    startedat: Math.floor(Date.now() / 1000),
  }),
  endAttackSession: async () => {},
}));

const { baseSave } = await import("./baseSave.js");
const { ownerSaveConfig } = await import("../../../config/OwnerSaveConfig.js");
const { ClientSafeError } = await import("../../../middleware/clientSafeError.js");

/** The config is read once at import; the tests flip it in place. */
const setMode = (mode: OwnerSaveMode) => {
  (ownerSaveConfig as { mode: OwnerSaveMode }).mode = mode;
};
const startingMode = ownerSaveConfig.mode;

const rowOf = (type: string, attackid = 0) => ({
  basesaveid: 9,
  baseid: "1234",
  saveuserid: OWNER,
  type,
  attackid,
  savetime: 0,
  resources: {},
});

const ctxFor = (userid: number, attackid?: number) =>
  ({
    authUser: { userid, username: `u${userid}` },
    request: {
      body: {
        baseid: "1234",
        basesaveid: "9",
        ...(attackid ? { attackid: String(attackid) } : {}),
      },
    },
    ip: "127.0.0.1",
    path: "/base/save",
  }) as unknown as Context;

/** Runs the controller and hands back what it threw. */
const run = async (ctx: Context): Promise<unknown> => {
  try {
    await baseSave(ctx, async () => {});
    return null;
  } catch (caught) {
    return caught;
  }
};

beforeEach(() => {
  persist.mockClear();
  flush.mockClear();
  validateSave.mockClear();
});

afterEach(() => setMode(startingMode));

describe("baseSave owner-save gate", () => {
  test("refuse: the owner's main-yard save is refused with 409 before anything runs", async () => {
    setMode("refuse");
    row = rowOf("main");

    const caught = await run(ctxFor(OWNER));

    expect(caught).toBeInstanceOf(ClientSafeError);
    expect((caught as InstanceType<typeof ClientSafeError>).status).toBe(409);
    expect((caught as InstanceType<typeof ClientSafeError>).data).toEqual({
      reason: "ownerSaveRetired",
    });
    expect(validateSave).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
    expect(flush).not.toHaveBeenCalled();
  });

  test("allow: the owner's main-yard save goes past the gate", async () => {
    setMode("allow");
    row = rowOf("main");

    expect(((await run(ctxFor(OWNER))) as Error).message).toBe(REACHED);
    expect(validateSave).toHaveBeenCalledTimes(1);
  });

  test("refuse: an attack save on a main yard goes past the gate", async () => {
    setMode("refuse");
    row = rowOf("main", ATTACK_ID);

    expect(((await run(ctxFor(ATTACKER, ATTACK_ID))) as Error).message).toBe(REACHED);
    expect(validateSave).toHaveBeenCalledTimes(1);
  });

  test("refuse: an outpost owner save goes past the gate", async () => {
    setMode("refuse");
    row = rowOf("outpost");

    expect(((await run(ctxFor(OWNER))) as Error).message).toBe(REACHED);
    expect(validateSave).toHaveBeenCalledTimes(1);
  });
});
