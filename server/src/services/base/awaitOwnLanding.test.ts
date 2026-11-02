import { beforeEach, describe, expect, mock, test } from "bun:test";

/**
 * A yard load waits for the player's own attack that is landing right now
 * (owner, 2 Nov 2026): a reload mid-battle sends the save as the page goes,
 * and the reloaded page's yard must not be read before that save has written
 * it, or the player sees their attack undone.
 */

const store = new Map<string, string>();
const sets = new Map<string, Set<string>>();
const fakeRedis = {
  get: async (key: string) => store.get(key) ?? null,
  smembers: async (key: string) => [...(sets.get(key) ?? [])],
};

mock.module("../../server.js", () => ({ redis: fakeRedis, postgres: {} }));

const { awaitOwnLanding, ownLandingLocks } = await import("./awaitOwnLanding.js");
const { attackFinalLockKey } = await import("./attackCheckpoint.js");
const { attackerSessionKey } = await import("./attackSession.js");
const { descentFinalLockKey } = await import("../inferno/descentSession.js");
const { infernoTribeFinalLockKey } = await import("../inferno/infernoTribeSession.js");
const { mr1TribeFinalLockKey } = await import("../maproom/v1/mr1TribeSession.js");
const { MR1_TRIBE_IDS } = await import("../../game-data/tribes/v1/index.js");

const PLAYER = 2503;
const ROW = 3367;

/** A clock the fake sleep moves on, and a hook run after each sleep. */
let clock = 0;
let afterSleep: (() => void) | null = null;
const deps = {
  now: () => clock,
  sleep: async (ms: number) => {
    clock += ms;
    afterSleep?.();
  },
};

beforeEach(() => {
  store.clear();
  sets.clear();
  clock = 0;
  afterSleep = null;
});

describe("ownLandingLocks", () => {
  test("names the session's row and every row-less attack kind", async () => {
    store.set(attackerSessionKey(PLAYER), String(ROW));
    const keys = await ownLandingLocks(PLAYER);
    expect(keys).toContain(attackFinalLockKey(ROW));
    expect(keys).toContain(descentFinalLockKey(PLAYER));
    expect(keys).toContain(infernoTribeFinalLockKey(PLAYER));
    const tribe = String([...MR1_TRIBE_IDS][0]);
    expect(keys).toContain(mr1TribeFinalLockKey(PLAYER, tribe));
  });

  test("with no attack session, names no Map Room 2 row", async () => {
    const keys = await ownLandingLocks(PLAYER);
    expect(keys.some((key) => key === attackFinalLockKey(ROW))).toBe(false);
  });
});

describe("awaitOwnLanding", () => {
  test("does not wait when nothing of the player's is landing", async () => {
    store.set(attackerSessionKey(PLAYER), String(ROW));
    expect(await awaitOwnLanding(PLAYER, deps)).toBe(false);
    expect(clock).toBe(0);
  });

  test("waits for the Map Room 2 save sent as the page went, until it lets go", async () => {
    store.set(attackerSessionKey(PLAYER), String(ROW));
    store.set(attackFinalLockKey(ROW), "1");
    afterSleep = () => {
      if (clock >= 700) store.delete(attackFinalLockKey(ROW));
    };
    expect(await awaitOwnLanding(PLAYER, deps)).toBe(true);
    expect(clock).toBe(700);
  });

  test("waits for a Descent save as well", async () => {
    store.set(descentFinalLockKey(PLAYER), "1");
    afterSleep = () => {
      if (clock >= 300) store.delete(descentFinalLockKey(PLAYER));
    };
    expect(await awaitOwnLanding(PLAYER, deps)).toBe(true);
    expect(clock).toBe(300);
  });

  test("never waits longer than its limit", async () => {
    store.set(infernoTribeFinalLockKey(PLAYER), "1");
    expect(await awaitOwnLanding(PLAYER, { ...deps, waitMs: 1000, pollMs: 100 })).toBe(true);
    expect(clock).toBe(1000);
  });

  test("another player's landing is not waited for", async () => {
    store.set(attackerSessionKey(PLAYER), String(ROW));
    store.set(descentFinalLockKey(PLAYER + 1), "1");
    store.set(attackFinalLockKey(ROW + 1), "1");
    expect(await awaitOwnLanding(PLAYER, deps)).toBe(false);
  });
});
