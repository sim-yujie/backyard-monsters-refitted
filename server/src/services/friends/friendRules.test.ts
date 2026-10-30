import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  askAgainAt,
  blockedIdsOf,
  escapeLike,
  FRIEND_LIMITS,
  lapseCutoff,
  lapsesAt,
  onlineStatusOf,
  secondsOf,
  utcDayStart,
} from "./friendRules.js";

/**
 * The friends limits and small rules (issue #368, `docs/design/friends.md`
 * §6.2, §7 and the owner's approved answers to §10), and the shape of the
 * migration and routes, without a database.
 */

const DAY = 24 * 60 * 60;
const T0 = Math.floor(Date.UTC(2026, 9, 19, 12, 30) / 1000);

describe("friends rules", () => {
  test("the limits the owner approved", () => {
    expect(FRIEND_LIMITS).toEqual({
      maxFriends: 100,
      maxOpenRequests: 30,
      maxRequestsPerDay: 30,
      requestLapseDays: 14,
      declineWaitDays: 7,
      friendshipAgeHours: 12,
      dailyHelps: 20,
    });
  });

  test("days turn over at 00:00 UTC; lapse and the wait after a decline", () => {
    expect(utcDayStart(T0)).toBe(Date.UTC(2026, 9, 19) / 1000);
    expect(utcDayStart(Date.UTC(2026, 9, 19) / 1000)).toBe(Date.UTC(2026, 9, 19) / 1000);
    expect(lapseCutoff(T0)).toBe(T0 - 14 * DAY);
    expect(lapsesAt(T0)).toBe(T0 + 14 * DAY);
    expect(askAgainAt(T0)).toBe(T0 + 7 * DAY);
  });

  test("online status: hidden, online, today, week, away", () => {
    expect(onlineStatusOf(true, true, T0, T0)).toBeNull();
    expect(onlineStatusOf(false, true, null, T0)).toBe("online");
    expect(onlineStatusOf(false, false, T0 - DAY + 1, T0)).toBe("today");
    expect(onlineStatusOf(false, false, T0 - DAY, T0)).toBe("week");
    expect(onlineStatusOf(false, false, T0 - 7 * DAY + 1, T0)).toBe("week");
    expect(onlineStatusOf(false, false, T0 - 7 * DAY, T0)).toBe("away");
    expect(onlineStatusOf(false, false, null, T0)).toBe("away");
  });

  test("small readers: timestamps, block lists and LIKE text", () => {
    expect(secondsOf(new Date(T0 * 1000 + 999))).toBe(T0);
    expect(secondsOf(new Date(T0 * 1000).toISOString())).toBe(T0);
    // timestamptz text in any zone is the same instant (12:30 UTC is 20:30 in Singapore).
    expect(secondsOf("2026-10-19 20:30:00+08")).toBe(T0);
    expect(secondsOf(null)).toBeNull();
    expect(blockedIdsOf([3, "4", "x", 5.5])).toEqual([3, 4]);
    expect(blockedIdsOf(null)).toEqual([]);
    expect(escapeLike("a_b%c\\d")).toBe("a\\_b\\%c\\\\d");
  });
});

describe("friends migration and routes", () => {
  const migration = readFileSync(new URL("../../database/migrations/20261019_CreateFriendTables.ts", import.meta.url), "utf8");
  const routes = readFileSync(new URL("../../controllers/friends/routes.ts", import.meta.url), "utf8");
  const appRoutes = readFileSync(new URL("../../app.routes.ts", import.meta.url), "utf8");

  test("the migration only adds things, and has the pending-pair index", () => {
    expect(migration.replace(/ON DELETE CASCADE/gi, "")).not.toMatch(/\bDROP\b|\bDELETE\b|\bTRUNCATE\b/i);
    for (const statement of migration.match(/CREATE (UNIQUE )?(TABLE|INDEX) [A-Z ]*"/g) ?? []) {
      expect(statement).toContain("IF NOT EXISTS");
    }
    expect(migration).toContain(`"friend_request_one_pending" ON "bym"."friend_request" ("from_userid", "to_userid") WHERE "status" = 'pending'`);
    expect(migration).toContain(`PRIMARY KEY ("userid", "friend_userid")`);
    expect(migration).toContain(`ADD COLUMN IF NOT EXISTS "hide_online" boolean NOT NULL DEFAULT false`);
    expect(migration).toContain(`ADD COLUMN IF NOT EXISTS "friend_requests_off" boolean NOT NULL DEFAULT false`);
  });

  test("every WP1 route is in routes.ts, mounted once from app.routes.ts", () => {
    for (const [method, path] of [
      ["get", "/bm/friends`"],
      ["get", "/bm/friends/requests`"],
      ["post", "/bm/friends/request`"],
      ["post", "/bm/friends/request/answer`"],
      ["post", "/bm/friends/request/cancel`"],
      ["post", "/bm/friends/remove`"],
      ["get", "/bm/friends/search`"],
      ["get", "/bm/friends/suggestions`"],
      ["get", "/player/blocked`"],
      ["post", "/player/block`"],
      ["post", "/player/unblock`"],
      ["post", "/bm/friends/help`"],
    ]) {
      const line = `router.${method}(\`\${api}${path}`;
      expect([line, routes.includes(line)]).toEqual([line, true]);
    }
    expect(appRoutes.match(/mountFriendsRoutes\(router\);/g)).toHaveLength(1);
  });

  test("every friends route checks the login, then the account's status", () => {
    const mounts = routes.match(/router\.(get|post)\([^\n]*/g) ?? [];
    // WP1's eleven and WP6's help route; later packages add more.
    expect(mounts.length).toBeGreaterThanOrEqual(12);
    for (const mount of mounts) expect(mount).toContain("apiVersion, verifyUserAuth, verifyAccountStatus,");
  });
});
