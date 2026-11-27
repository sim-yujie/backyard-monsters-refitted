import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Context } from "koa";

/**
 * The battle-rules stamp (owner's fix 1, Desk 8, 23 Nov 2026): an attack
 * start from a page whose rules are not the server's is refused before
 * anything is spent, a start with matching or compatible rules goes on, and a
 * save is called an old page's from the session's rules, never the save's.
 */

const info = mock((..._args: unknown[]) => {});
mock.module("../../../utils/logger.js", () => ({
  logger: { info, warn: mock(() => {}), error: mock(() => {}), debug: mock(() => {}) },
}));

const { requirePageRules, stampPlays, stampOf, startedOnOldPage, stampForLog, RULES_FIELD } = await import(
  "./rulesStamp.js"
);
const { RULES_VERSION } = await import("../../defences/rulesVersion.js");
const { newAttackSession, parseAttackSession, serialiseAttackSession } = await import("../attackSession.js");

const ctx = { ip: "127.0.0.1" } as unknown as Context;
const user = { userid: 2503, username: "yardtester" };
const OLD = "0ba3fde8701104af";
const KEPT = "3cb9cc66416d5eda";

const refusalOf = (stamp: unknown): { reason?: string; status?: number; message?: string } | null => {
  try {
    requirePageRules(ctx, user, stamp, "base/load:attack");
    return null;
  } catch (err) {
    const e = err as { data?: { reason?: string }; status?: number; message?: string };
    return { reason: e.data?.reason, status: e.status, message: e.message };
  }
};

beforeEach(() => info.mockClear());

describe("an attack start", () => {
  test("goes on with this server's rules", () => {
    expect(refusalOf(RULES_VERSION)).toBeNull();
    expect(info).not.toHaveBeenCalled();
  });

  test("is refused with New version on older rules, logged as an old page", () => {
    expect(refusalOf(OLD)).toEqual({ reason: "newVersion", status: 409, message: "New version — reload the page." });
    expect(info.mock.calls[0]![1]).toMatchObject({
      event: "attack-start-old-page",
      route: "base/load:attack",
      sent: OLD,
      ours: RULES_VERSION,
      username: "yardtester",
    });
  });

  test("is refused without a stamp: a page from before the fix sends none", () => {
    for (const stamp of [undefined, null, "", 0, {}, ["x"]]) {
      expect(refusalOf(stamp)?.reason).toBe("newVersion");
    }
    expect(info.mock.calls[0]![1]).toMatchObject({ sent: null });
  });

  test("goes on with rules listed as compatible, and only those", () => {
    expect(stampPlays(KEPT, RULES_VERSION, [KEPT])).toBe(true);
    expect(stampPlays(OLD, RULES_VERSION, [KEPT])).toBe(false);
    expect(stampPlays(RULES_VERSION, RULES_VERSION, [])).toBe(true);
    expect(stampPlays(undefined, RULES_VERSION, [KEPT])).toBe(false);
  });

  test("reads the stamp from the request body's `rules`", () => {
    expect(RULES_FIELD).toBe("rules");
    expect(stampOf({ rules: OLD, baseid: "1" })).toBe(OLD);
    expect(stampOf({ baseid: "1" })).toBeUndefined();
    expect(stampOf(undefined)).toBeUndefined();
    expect(stampForLog("a".repeat(100))).toHaveLength(32);
  });
});

describe("a save's attack, started on an old page", () => {
  test("is one whose session holds no rules (minted before the fix) or older ones", () => {
    expect(startedOnOldPage(undefined)).toBe(true);
    expect(startedOnOldPage(OLD)).toBe(true);
    expect(startedOnOldPage(RULES_VERSION)).toBe(false);
    expect(startedOnOldPage(KEPT, RULES_VERSION, [KEPT])).toBe(false);
  });

  test("every session minted now holds this server's rules, and keeps them through Redis", () => {
    const session = newAttackSession(2503, 42);
    expect(session.rules).toBe(RULES_VERSION);
    const stored = serialiseAttackSession(session);
    expect(stored.startsWith("{")).toBe(true);
    expect(parseAttackSession(stored)?.rules).toBe(RULES_VERSION);
    expect(startedOnOldPage(parseAttackSession(stored)?.rules)).toBe(false);
  });

  test("a session stored before the fix reads back with no rules: an old page's", () => {
    expect(parseAttackSession("2503:42:1700000000")?.rules).toBeUndefined();
    expect(parseAttackSession(JSON.stringify({ attackerid: 2503, attackid: 42, startedat: 1 }))?.rules).toBeUndefined();
    expect(parseAttackSession(JSON.stringify({ attackerid: 2503, attackid: 42, startedat: 1, rules: "nope" }))?.rules).toBeUndefined();
  });
});

const { requirePageStats, statsStampOf, STATS_FIELD } = await import("./rulesStamp.js");
const { ATTACK_STATS_VERSION } = await import("../../../game-data/stats/attackStatsVersion.js");

describe("the attack-stats stamp (beta 10)", () => {
  const statsRefusal = (stamp: unknown): string | null => {
    try {
      requirePageStats(ctx, user, stamp, "base/load:attack");
      return null;
    } catch (err) {
      return (err as { data?: { reason?: string } }).data?.reason ?? String(err);
    }
  };

  test("goes on with this server's table", () => {
    expect(statsRefusal(ATTACK_STATS_VERSION)).toBeNull();
  });

  test("goes on without one: a page from before the stamp is left to validateAttack", () => {
    for (const stamp of [undefined, null, ""]) expect(statsRefusal(stamp)).toBeNull();
    expect(info).not.toHaveBeenCalled();
  });

  test("refuses another release's table with New version, logged as an old page", () => {
    expect(statsRefusal("6164e7d8578cac11")).toBe("newVersion");
    expect(info.mock.calls[0]![1]).toMatchObject({
      event: "attack-start-old-page",
      reason: "stats-stamp",
      sent: "6164e7d8578cac11",
      ours: ATTACK_STATS_VERSION,
    });
    expect(statsRefusal(42)).toBe("newVersion");
  });

  test("travels as `stats`", () => {
    expect(STATS_FIELD).toBe("stats");
    expect(statsStampOf({ stats: "abc" })).toBe("abc");
    expect(statsStampOf(null)).toBeUndefined();
  });
});
