import { describe, expect, test } from "bun:test";
import type { EntityManager } from "@mikro-orm/postgresql";
import { TruceStatus } from "../../../enums/TruceStatus.js";
import { attackedBetween, isHostile, truceRunning } from "./hostiles.js";

/**
 * The hostile rule (owner, 8 Nov 2026): an attack between the viewer and a player, either way,
 * ever, makes them hostile unless a truce is running. `attackedBetween`'s SQL is run here against
 * a stand-in that answers the UNION the way Postgres would; `hostiles.db.test.ts` runs it for real.
 */
type Log = { attacker_userid: number; defender_userid: number };

const emWith = (logs: Log[]) => {
  const calls: { sql: string; params: unknown[] }[] = [];
  const em = {
    execute: async (sql: string, params: number[]) => {
      calls.push({ sql, params });
      // params: [viewer, ...others, viewer, ...others]
      const half = params.length / 2;
      const viewer = params[0]!;
      const others = new Set(params.slice(1, half));
      const found = new Set<number>();
      for (const log of logs) {
        if (log.defender_userid === viewer && others.has(log.attacker_userid)) found.add(log.attacker_userid);
        if (log.attacker_userid === viewer && others.has(log.defender_userid)) found.add(log.defender_userid);
      }
      return [...found].map((other) => ({ other }));
    },
  } as unknown as EntityManager;
  return { em, calls };
};

const NOW = 1_800_000_000;

describe("attackedBetween", () => {
  test("counts attacks either way, however old, and nobody else", async () => {
    const { em, calls } = emWith([
      { attacker_userid: 2, defender_userid: 1 }, // 2 attacked me
      { attacker_userid: 1, defender_userid: 3 }, // I attacked 3
      { attacker_userid: 4, defender_userid: 5 }, // nothing to do with me
    ]);
    expect([...(await attackedBetween(em, 1, [1, 2, 3, 4, 5, 6]))].sort()).toEqual([2, 3]);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.sql).toContain("UNION");
    // The viewer is never asked about.
    expect(calls[0]!.params).toEqual([1, 2, 3, 4, 5, 6, 1, 2, 3, 4, 5, 6]);
  });

  test("asks nothing with no other owners or no viewer", async () => {
    const { em, calls } = emWith([]);
    expect((await attackedBetween(em, 1, [1, 1])).size).toBe(0);
    expect((await attackedBetween(em, undefined, [2])).size).toBe(0);
    expect(calls).toHaveLength(0);
  });
});

describe("isHostile", () => {
  test("an attack without a truce is hostile; no attack never is", () => {
    expect(isHostile(true, undefined, NOW)).toBe(true);
    expect(isHostile(false, undefined, NOW)).toBe(false);
  });

  test("a running truce switches it off; an ended truce or a waiting request does not", () => {
    const accepted = { trucestate: TruceStatus.ACCEPTED, expires_at: NOW + 3600 };
    expect(truceRunning(accepted, NOW)).toBe(true);
    expect(isHostile(true, accepted, NOW)).toBe(false);
    expect(isHostile(true, { trucestate: TruceStatus.ACCEPTED, expires_at: NOW - 1 }, NOW)).toBe(true);
    expect(isHostile(true, { trucestate: TruceStatus.REQUESTED }, NOW)).toBe(true);
  });
});
