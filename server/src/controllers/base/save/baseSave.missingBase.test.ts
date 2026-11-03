import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Context } from "koa";

/**
 * A `/base/save` whose `basesaveid` names no row (live: ~350 a day, all 500s
 * with nothing logged). Each is answered as an expected refusal — `410`,
 * `reason: "baseGone"` and a `cause` — and logged at WARN with who saved what,
 * and whether an attack of theirs was still open on the row, so a lost attack
 * result shows in the logs.
 */

const ATTACKER = 77;
const ATTACK_ID = 4242;
const GONE_ID = 9;

/** The row, if any, that holds the save's `baseid` now. */
let current: Record<string, unknown> | null = null;
/** The attack session on the gone row, if one is still open. */
let session: Record<string, unknown> | null = null;
const warn = mock((..._args: unknown[]) => {});

mock.module("../../../server.js", () => ({
  postgres: {
    em: {
      populate: async (user: Record<string, unknown>) => {
        user.save = { userid: user.userid, resources: {} };
      },
      // The save's own row is gone; a lookup by `baseid` finds what holds it now.
      findOne: async (_entity: unknown, where: Record<string, unknown>) =>
        "basesaveid" in where ? null : current,
      persist: () => {},
      flush: async () => {},
    },
  },
  redis: { setex: async () => "OK", get: async () => null, del: async () => 0 },
}));

mock.module("../../../utils/logger.js", () => ({
  logger: { warn, error: mock(() => {}), info: mock(() => {}), debug: mock(() => {}) },
}));

mock.module("../../../services/base/attackSessionStore.js", () => ({
  startAttackSession: async () => {},
  readAttackSession: async (basesaveid: number) => (basesaveid === GONE_ID ? session : null),
  endAttackSession: async () => {},
}));

const { baseSave } = await import("./baseSave.js");
const { ClientSafeError } = await import("../../../middleware/clientSafeError.js");

const ctxFor = (body: Record<string, string>) =>
  ({
    authUser: { userid: ATTACKER, username: "attacker" },
    request: { body: { baseid: "1000241208", basesaveid: String(GONE_ID), ...body } },
    ip: "127.0.0.1",
    path: "/base/save",
  }) as unknown as Context;

const run = async (ctx: Context): Promise<InstanceType<typeof ClientSafeError>> => {
  try {
    await baseSave(ctx, async () => {});
  } catch (caught) {
    expect(caught).toBeInstanceOf(ClientSafeError);
    return caught as InstanceType<typeof ClientSafeError>;
  }
  throw new Error("expected a refusal");
};

/** The fields of the one WARN line the refusal wrote. */
const warned = (): Record<string, unknown> => {
  expect(warn).toHaveBeenCalledTimes(1);
  return warn.mock.calls[0]![1] as Record<string, unknown>;
};

beforeEach(() => {
  current = null;
  session = null;
  warn.mockClear();
});

describe("baseSave for a row that is gone", () => {
  test("an attack on a camp that regrew mid-attack: 410 replaced, logged as a lost attack", async () => {
    current = { basesaveid: 31, baseid: "1000241208", type: "tribe" };
    session = { attackerid: ATTACKER, attackid: ATTACK_ID, startedat: Math.floor(Date.now() / 1000) };

    const refusal = await run(ctxFor({ attackid: String(ATTACK_ID), over: "1" }));

    expect(refusal.status).toBe(410);
    expect(refusal.data).toEqual({ reason: "baseGone", cause: "replaced" });
    expect(warned()).toMatchObject({
      event: "save-base-gone",
      userid: ATTACKER,
      baseid: "1000241208",
      basesaveid: GONE_ID,
      saveType: "attack",
      cause: "replaced",
      liveAttack: true,
      nowBasesaveid: 31,
      nowType: "tribe",
    });
  });

  test("a late save for a base nobody holds any more: 410 gone, no attack lost", async () => {
    const refusal = await run(ctxFor({ attackid: String(ATTACK_ID), over: "1" }));

    expect(refusal.status).toBe(410);
    expect(refusal.data).toEqual({ reason: "baseGone", cause: "gone" });
    expect(warned()).toMatchObject({ saveType: "attack", cause: "gone", liveAttack: false, nowBasesaveid: null });
  });

  test("another player's attack session on the row is not this player's loss", async () => {
    session = { attackerid: ATTACKER + 1, attackid: ATTACK_ID, startedat: Math.floor(Date.now() / 1000) };

    await run(ctxFor({ attackid: String(ATTACK_ID) }));

    expect(warned()).toMatchObject({ liveAttack: false });
  });

  test("a save naming no row at all, for a base that is no tribe: 410 noBasesaveid", async () => {
    const refusal = await run(ctxFor({ basesaveid: "0" }));

    expect(refusal.status).toBe(410);
    expect(refusal.data).toEqual({ reason: "baseGone", cause: "noBasesaveid" });
    expect(warned()).toMatchObject({ saveType: "own", cause: "noBasesaveid", basesaveid: null });
  });
});
