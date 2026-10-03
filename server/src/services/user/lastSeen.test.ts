import { describe, expect, test } from "bun:test";
import type { EntityManager } from "@mikro-orm/postgresql";

import { User } from "../../database/models/user.model.js";
import { LAST_SEEN_INTERVAL_MS, lastSeenIsStale, touchLastSeen } from "./lastSeen.js";

const NOW = new Date("2026-10-03T12:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);

const fakeEm = (rows = 1) => {
  const updates: { entity: unknown; where: unknown; data: unknown }[] = [];
  const em = {
    nativeUpdate: async (entity: unknown, where: unknown, data: unknown) => {
      updates.push({ entity, where, data });
      return rows;
    },
  };
  return { em: em as unknown as EntityManager, updates };
};

const player = (last_seen_at: Date | null) => ({ userid: 9, last_seen_at }) as User;

describe("user.last_seen_at (issue #235)", () => {
  test("is due when never written or an hour old", () => {
    expect(lastSeenIsStale(null, NOW)).toBe(true);
    expect(lastSeenIsStale(undefined, NOW)).toBe(true);
    expect(lastSeenIsStale(ago(LAST_SEEN_INTERVAL_MS), NOW)).toBe(true);
    expect(lastSeenIsStale(ago(LAST_SEEN_INTERVAL_MS - 1), NOW)).toBe(false);
  });

  test("a load within the hour writes nothing", async () => {
    const { em, updates } = fakeEm();
    expect(await touchLastSeen(em, player(ago(10 * 60 * 1000)), NOW)).toBe(false);
    expect(updates).toEqual([]);
  });

  test("a stale load writes now, guarded in SQL against a second writer", async () => {
    const { em, updates } = fakeEm();
    const user = player(null);
    expect(await touchLastSeen(em, user, NOW)).toBe(true);
    expect(updates).toEqual([
      {
        entity: User,
        where: {
          userid: 9,
          $or: [{ last_seen_at: null }, { last_seen_at: { $lte: ago(LAST_SEEN_INTERVAL_MS) } }],
        },
        data: { last_seen_at: NOW },
      },
    ]);
    // The loaded entity is left alone, so nothing else the request flushes changes.
    expect(user.last_seen_at).toBeNull();
  });

  test("reports no write when another load got there first", async () => {
    const { em } = fakeEm(0);
    expect(await touchLastSeen(em, player(null), NOW)).toBe(false);
  });
});
