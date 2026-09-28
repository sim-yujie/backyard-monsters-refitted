import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Context } from "koa";

/**
 * `POST /worldmapv2/declinetakeover` (issue #182): the attacker turns down
 * their one chance at the outpost they destroyed, and its 8 hours of damage
 * protection start now rather than when the chance would have run out.
 */

const ATTACKER = 2505;
const OWNER = 77;
const WORLD = "world-a";
const OUTPOST = "2000240208";
const GRANT_KEY = "takeover-grant:900";

type Row = Record<string, unknown>;

const store = new Map<string, string>();
let outpost: Row;
let flushed: number;

const now = () => Math.floor(Date.now() / 1000);

const grantTo = (attackerid: number, expiresAt = now() + 600) => {
  store.set(GRANT_KEY, JSON.stringify({ attackerid, basesaveid: 900, baseid: OUTPOST, expiresAt }));
  outpost.protected = expiresAt + 8 * 3600;
};

const txEm = {
  findOne: async (_entity: unknown, where: Row) => (where.basesaveid === 900 ? outpost : null),
  persist: () => {},
  flush: async () => {
    flushed += 1;
  },
};

mock.module("../../../server.js", () => ({
  postgres: {
    em: {
      populate: async (user: Row) => {
        user.save = { worldid: WORLD };
      },
      findOne: async (_entity: unknown, where: Row) =>
        where.baseid === OUTPOST && where.world === WORLD ? { baseid: OUTPOST, save: outpost } : null,
      transactional: async (run: (em: typeof txEm) => Promise<unknown>) => run(txEm),
    },
  },
  redis: {
    get: async (key: string) => store.get(key) ?? null,
    setex: async (key: string, _ttl: number, value: string) => {
      store.set(key, value);
      return "OK";
    },
    del: async (key: string) => (store.delete(key) ? 1 : 0),
  },
}));

const { declineTakeover } = await import("./declineTakeover.js");

const run = async (userid: number, baseid = OUTPOST) => {
  const ctx = { authUser: { userid }, request: { body: { baseid } } } as unknown as Context;
  try {
    await declineTakeover(ctx, async () => {});
    return { body: ctx.body as Row, reason: undefined };
  } catch (caught) {
    return { body: undefined, reason: (caught as { data?: { reason?: string } }).data?.reason };
  }
};

beforeEach(() => {
  store.clear();
  flushed = 0;
  outpost = { basesaveid: 900, baseid: OUTPOST, userid: OWNER, saveuserid: OWNER, type: "outpost", damage: 95 };
  grantTo(ATTACKER);
});

describe("declineTakeover", () => {
  test("the holder declines: the grant ends and 8 hours of protection start now", async () => {
    const result = await run(ATTACKER);
    const until = outpost.protected as number;
    expect(until).toBeGreaterThanOrEqual(now() + 8 * 3600 - 1);
    expect(until).toBeLessThanOrEqual(now() + 8 * 3600);
    expect(result.body).toEqual({ error: 0, protectedUntil: until });
    expect(store.has(GRANT_KEY)).toBe(false);
    expect(flushed).toBe(1);
  });

  test("anyone else is refused and the grant stands", async () => {
    const before = outpost.protected;
    expect((await run(OWNER + 1)).reason).toBe("noTakeoverChance");
    expect((await run(OWNER)).reason).toBe("noTakeoverChance");
    expect(store.has(GRANT_KEY)).toBe(true);
    expect(outpost.protected).toBe(before);
    expect(flushed).toBe(0);
  });

  test("a grant that ran out cannot be declined; its protection already stands", async () => {
    grantTo(ATTACKER, now() - 1);
    const before = outpost.protected;
    expect((await run(ATTACKER)).reason).toBe("noTakeoverChance");
    expect(outpost.protected).toBe(before);
  });

  test("no grant, or no such outpost, is refused", async () => {
    store.clear();
    expect((await run(ATTACKER)).reason).toBe("noTakeoverChance");
    expect((await run(ATTACKER, "123")).reason).toBe("notFound");
  });
});
