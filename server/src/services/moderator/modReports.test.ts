import { describe, expect, test } from "bun:test";

import { MOD_MAX_MUTE_HOURS, MOD_MUTE_HOURS, parseModAction } from "./modReports.js";

/**
 * What a moderator may ask for in the game's Reports window (owner, 12 Nov
 * 2026): Close, Warn, or Mute for 1 hour, 1 day, 3 days or 7 days. Never a
 * ban and never another length. The database side is `controllers/moderator/routes.db.test.ts`.
 */

const seen = { caseId: 4, reports: 2, flagsUpTo: 9 };

describe("parseModAction", () => {
  test("the four mute lengths, 7 days the longest", () => {
    expect(MOD_MUTE_HOURS).toEqual([1, 24, 72, 168]);
    expect(MOD_MAX_MUTE_HOURS).toBe(168);
    for (const hours of MOD_MUTE_HOURS) {
      const parsed = parseModAction({ action: "mute", reason: "Insults.", hours, ...seen });
      expect(parsed).toEqual({ ok: true, value: { action: { kind: "mute", reason: "Insults.", hours }, seen } });
    }
  });

  test("any other length is refused, longer or in between", () => {
    for (const hours of [0, 2, 23, 48, 169, 720, 24 * 30, -1, 1.5, "24", null]) {
      expect(parseModAction({ action: "mute", reason: "x", hours }).ok).toBe(false);
    }
  });

  test("a ban, an unmute or anything else is refused", () => {
    for (const action of ["ban", "unban", "unmute", "dismiss", "restrict", undefined]) {
      expect(parseModAction({ action, reason: "x", days: 1, hours: 1 }).ok).toBe(false);
    }
  });

  test("Warn and Mute need the reason the player sees; Close's note is optional", () => {
    expect(parseModAction({ action: "warn", reason: "  " })).toEqual({ ok: false, message: "Write a reason: the player sees it." });
    expect(parseModAction({ action: "mute", hours: 1 }).ok).toBe(false);
    expect(parseModAction({ action: "warn", reason: "x".repeat(301) }).ok).toBe(false);
    expect(parseModAction({ action: "close" })).toEqual({
      ok: true,
      value: { action: { kind: "close", note: null }, seen: { caseId: null, reports: 0, flagsUpTo: null } },
    });
    expect(parseModAction({ action: "close", note: " Banter ", ...seen })).toEqual({
      ok: true,
      value: { action: { kind: "close", note: "Banter" }, seen },
    });
  });
});
