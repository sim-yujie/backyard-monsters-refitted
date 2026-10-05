import { afterEach, describe, expect, test } from "bun:test";
import type { EntityManager } from "@mikro-orm/core";
import { achievementConfig } from "../../config/AchievementConfig.js";
import { readAchievements } from "../achievements/state.js";
import { readOnboarding } from "../onboarding/state.js";
import { recordTribeDestroyed } from "./tribeCounter.js";

/** One row behind a stand-in transaction that records how it was read. */
const fakeEm = (row: Record<string, unknown> | null) => {
  const seen = { options: null as unknown, flushed: false, bell: [] as unknown[] };
  const em = {
    async transactional<T>(cb: (tx: unknown) => Promise<T>): Promise<T> {
      return cb({
        async findOne(_entity: unknown, _where: unknown, options: unknown) {
          seen.options = options;
          return row;
        },
        async insertMany(_entity: unknown, rows: unknown[]) {
          seen.bell.push(...rows);
        },
        async nativeDelete() {},
        getConnection: () => ({ execute: async () => [] }),
        async flush() {
          seen.flushed = true;
        },
      });
    },
  };
  return { em: em as unknown as EntityManager, seen };
};

describe("recordTribeDestroyed (#227)", () => {
  test("counts the tribe on the main row, read under a row lock", async () => {
    const row = { basesaveid: 7, onboarding: { v: 1, guide: { state: "done" }, tips: { yard: 3 } } };
    const { em, seen } = fakeEm(row);
    await recordTribeDestroyed(em, 7, "1");
    expect(readOnboarding(row).counters.tribes.legionnaire).toBe(1);
    expect(readOnboarding(row).tips).toEqual({ yard: 3 });
    expect(seen.options).toMatchObject({ lockMode: expect.anything(), refresh: true });
    expect(seen.flushed).toBe(true);
  });

  test("an unknown base or a missing row writes nothing", async () => {
    const row = { basesaveid: 7, onboarding: null };
    const unknown = fakeEm(row);
    await recordTribeDestroyed(unknown.em, 7, "999");
    expect(row.onboarding).toBeNull();
    expect(unknown.seen.flushed).toBe(false);
    const missing = fakeEm(null);
    await recordTribeDestroyed(missing.em, 7, "1");
    expect(missing.seen.flushed).toBe(false);
  });

  describe("achievements (#204)", () => {
    const startingRewards = achievementConfig.rewards;
    afterEach(() => {
      achievementConfig.rewards = startingRewards;
    });

    /** A main row whose record is already worked out, so only the tribe's unlock shows. */
    const mainRow = () => ({
      basesaveid: 7,
      userid: 2503,
      credits: 100,
      onboarding: null,
      achievements: { v: 1, s: {}, c: {}, backfilledAt: 1 },
    });

    test("a Kozu tribe unlocks Kozu Crusher in the same transaction, owed while rewards are off", async () => {
      achievementConfig.rewards = false;
      const row = mainRow();
      const { em, seen } = fakeEm(row);
      await recordTribeDestroyed(em, 7, "11");
      expect(readOnboarding(row).counters.tribes.kozu).toBe(1);
      expect(readAchievements(row).s.wm2hall).toBe(1);
      expect(readAchievements(row).c["10"]).toMatchObject({ shiny: 10, unpaid: 1 });
      expect(row.credits).toBe(100);
      expect(seen.bell).toEqual([]);
      expect(seen.flushed).toBe(true);
    });

    test("with rewards on it is paid at once: Shiny and a bell row", async () => {
      achievementConfig.rewards = true;
      const row = mainRow();
      const { em, seen } = fakeEm(row);
      await recordTribeDestroyed(em, 7, "11");
      expect(row.credits).toBe(110);
      expect(seen.bell).toEqual([expect.objectContaining({ userid: 2503, kind: "achievement" })]);
    });

    test("another tribe counts but unlocks nothing", async () => {
      achievementConfig.rewards = true;
      const row = mainRow();
      const { em } = fakeEm(row);
      await recordTribeDestroyed(em, 7, "1");
      expect(readAchievements(row).c).toEqual({});
      expect(row.credits).toBe(100);
    });
  });
});
