import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { MAX_ATTACK_PAGE, parseAttackLogQuery, rangeStart } from "./attackLogAdmin.js";

/** Reading the Attack log page's query, and where each range starts. */

describe("parseAttackLogQuery", () => {
  test("defaults: both sides, the last 7 days, 50 rows, the newest page", () => {
    expect(parseAttackLogQuery("12", {})).toEqual({
      ok: true,
      value: { userid: 12, side: "both", range: "7d", limit: 50, before: null },
    });
  });

  test("reads the side, range and limit, and caps the limit", () => {
    expect(parseAttackLogQuery("12", { side: "made", range: "24h", limit: "10" })).toMatchObject({
      ok: true,
      value: { side: "made", range: "24h", limit: 10 },
    });
    expect(parseAttackLogQuery("12", { side: "received", range: "all", limit: "5000" })).toMatchObject({
      ok: true,
      value: { side: "received", range: "all", limit: MAX_ATTACK_PAGE },
    });
    expect(parseAttackLogQuery("12", { limit: "0" })).toMatchObject({ ok: true, value: { limit: 1 } });
  });

  test("an unknown side or range falls back to the defaults", () => {
    expect(parseAttackLogQuery("12", { side: "DROP TABLE", range: ["30d", "x"] })).toMatchObject({
      ok: true,
      value: { side: "both", range: "30d" },
    });
  });

  test("refuses a player number that is not one", () => {
    for (const id of ["0", "-3", "abc", "1.5", ""]) expect(parseAttackLogQuery(id, {})).toMatchObject({ ok: false });
  });

  test("a page cursor needs both an exact time and a row id", () => {
    expect(parseAttackLogQuery("12", { beforeTime: "2026-11-08T10:00:00.123456Z", beforeId: "77" })).toMatchObject({
      ok: true,
      value: { before: { time: "2026-11-08T10:00:00.123456Z", id: 77 } },
    });
    expect(parseAttackLogQuery("12", { beforeTime: "2026-11-08T10:00:00Z" })).toMatchObject({ ok: false });
    expect(parseAttackLogQuery("12", { beforeId: "77" })).toMatchObject({ ok: false });
    expect(parseAttackLogQuery("12", { beforeTime: "yesterday", beforeId: "77" })).toMatchObject({ ok: false });
    expect(parseAttackLogQuery("12", { beforeTime: "2026-11-08 10:00:00'; --", beforeId: "77" })).toMatchObject({
      ok: false,
    });
  });
});

describe("rangeStart", () => {
  const now = new Date("2026-11-08T12:00:00Z");

  test("counts back from now", () => {
    expect(rangeStart("24h", now, 365).toISOString()).toBe("2026-11-07T12:00:00.000Z");
    expect(rangeStart("7d", now, 365).toISOString()).toBe("2026-11-01T12:00:00.000Z");
    expect(rangeStart("30d", now, 365).toISOString()).toBe("2026-10-09T12:00:00.000Z");
  });

  test("'all' goes back as far as logs are kept", () => {
    expect(rangeStart("all", now, 365).toISOString()).toBe("2025-11-08T12:00:00.000Z");
    expect(rangeStart("all", now, 10).toISOString()).toBe("2026-10-29T12:00:00.000Z");
  });
});

describe("the dashboard route (controllers/admin/routes.ts)", () => {
  // Importing routes.ts boots the server, so this reads its source, like routes.test.ts.
  const source = readFileSync(join(import.meta.dir, "../../controllers/admin/routes.ts"), "utf8");
  const routes = [...source.matchAll(/router\.(get|post|put|patch|delete)\(`\$\{admin\}([^`]*\/attacks[^`]*)`,([^\n]*)/g)];

  test("is one read-only GET behind the owner-only check", () => {
    expect(routes.map(([, method, path]) => `${method!.toUpperCase()} ${path}`)).toEqual(["GET /players/:id/attacks"]);
    expect(routes[0]![3]).toContain("apiVersion, adminOnly,");
  });
});
