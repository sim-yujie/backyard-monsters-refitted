import { describe, expect, test } from "bun:test";
import type { EntityManager } from "@mikro-orm/core";
import { readOnboarding } from "../onboarding/state.js";
import { recordTribeDestroyed } from "./tribeCounter.js";

/** One row behind a stand-in transaction that records how it was read. */
const fakeEm = (row: Record<string, unknown> | null) => {
  const seen = { options: null as unknown, flushed: false };
  const em = {
    async transactional<T>(cb: (tx: unknown) => Promise<T>): Promise<T> {
      return cb({
        async findOne(_entity: unknown, _where: unknown, options: unknown) {
          seen.options = options;
          return row;
        },
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
});
