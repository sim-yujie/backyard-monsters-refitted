import { afterEach, describe, expect, test } from "bun:test";

import {
  ACTIVITY_TTL_SECONDS,
  noteActivePlayer,
  noteErrors,
  noteEventPlayer,
  noteTribeRaid,
  redisActivityRecorder,
  setActivityRecorder,
  type ActivityRedis,
} from "./activity.js";

/** The Redis commands the recorder sends, in memory. */
const fakeRedis = () => {
  const sets = new Map<string, Set<string>>();
  const counters = new Map<string, number>();
  const expiries = new Map<string, number>();
  const redis: ActivityRedis = {
    sadd: async (key, ...members) => {
      const set = sets.get(key) ?? new Set();
      sets.set(key, set);
      const before = set.size;
      for (const member of members) set.add(member);
      return set.size - before;
    },
    smembers: async (key) => [...(sets.get(key) ?? [])],
    incrby: async (key, by) => {
      const total = (counters.get(key) ?? 0) + by;
      counters.set(key, total);
      return total;
    },
    get: async (key) => (counters.has(key) ? String(counters.get(key)) : null),
    expire: async (key, seconds) => {
      expiries.set(key, seconds);
      return 1;
    },
  };
  return { redis, sets, counters, expiries };
};

const NOW = Date.parse("2026-10-23T23:59:00Z");
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("the day-by-day record (activity.ts)", () => {
  afterEach(() => setActivityRecorder(null));

  test("with no recorder installed, notes do nothing", () => {
    expect(() => noteActivePlayer(1, NOW)).not.toThrow();
    expect(() => noteTribeRaid(NOW)).not.toThrow();
  });

  test("players, event players, raids and errors land in their UTC day's keys, each with an expiry", async () => {
    const store = fakeRedis();
    setActivityRecorder(redisActivityRecorder(store.redis));

    noteActivePlayer(5, NOW);
    noteActivePlayer(5, NOW);
    noteActivePlayer(6, NOW + 2 * 60 * 1000);
    noteEventPlayer("halloween-2026", 5, NOW);
    noteTribeRaid(NOW);
    noteTribeRaid(NOW);
    noteErrors("browser", 4, NOW);
    noteErrors("server", 0, NOW);
    await settle();

    expect([...store.sets.get("stats:active:2026-10-23")!]).toEqual(["5"]);
    expect([...store.sets.get("stats:active:2026-10-24")!]).toEqual(["6"]);
    expect([...store.sets.get("stats:event:2026-10-23:halloween-2026")!]).toEqual(["5"]);
    expect([...store.sets.get("stats:eventids:2026-10-23")!]).toEqual(["halloween-2026"]);
    expect(store.counters.get("stats:raids:2026-10-23")).toBe(2);
    expect(store.counters.get("stats:errors:2026-10-23:browser")).toBe(4);
    expect(store.counters.has("stats:errors:2026-10-23:server")).toBe(false);
    expect(store.expiries.get("stats:active:2026-10-23")).toBe(ACTIVITY_TTL_SECONDS);
    expect(store.expiries.get("stats:raids:2026-10-23")).toBe(ACTIVITY_TTL_SECONDS);
  });

  test("a failed write is reported to the failure hook and never thrown", async () => {
    const failures: unknown[] = [];
    const broken = { ...fakeRedis().redis, sadd: async () => Promise.reject(new Error("down")) };
    setActivityRecorder(redisActivityRecorder(broken), (err) => failures.push(err));
    expect(() => noteActivePlayer(1, NOW)).not.toThrow();
    await settle();
    expect(failures).toHaveLength(1);
  });
});
