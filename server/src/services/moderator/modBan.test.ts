import { describe, expect, test } from "bun:test";

import { MAX_MODERATION_REASON } from "../admin/moderation.js";
import { MOD_BAN_DAYS, parseModBan } from "./modBan.js";

/** What a moderator's ban may ask for (owner, 24 Nov 2026): 1, 3 or 7 days, with a reason. */

describe("a moderator's ban request", () => {
  test("1, 3 or 7 days with a reason; removing lines is off unless asked", () => {
    expect(MOD_BAN_DAYS).toEqual([1, 3, 7]);
    for (const days of MOD_BAN_DAYS) {
      expect(parseModBan({ days, reason: " spam " })).toEqual({ ok: true, value: { days, reason: "spam", removeLines: false } });
    }
    expect(parseModBan({ days: 3, reason: "spam", removeLines: true })).toEqual({
      ok: true,
      value: { days: 3, reason: "spam", removeLines: true },
    });
  });

  test("any other length, permanent included, is refused", () => {
    for (const days of [0, 2, 8, 30, null, "3", 3.5]) {
      expect(parseModBan({ days, reason: "spam" })).toEqual({ ok: false, message: "A ban is 1 day, 3 days or 7 days." });
    }
    expect(parseModBan({ reason: "spam" }).ok).toBe(false);
  });

  test("a reason is required and kept short", () => {
    expect(parseModBan({ days: 1 })).toEqual({ ok: false, message: "Write a reason: the player sees it." });
    expect(parseModBan({ days: 1, reason: "   " }).ok).toBe(false);
    expect(parseModBan({ days: 1, reason: "x".repeat(MAX_MODERATION_REASON + 1) }).ok).toBe(false);
    expect(parseModBan(null).ok).toBe(false);
  });

  test("removeLines must be true or false", () => {
    expect(parseModBan({ days: 1, reason: "spam", removeLines: "yes" }).ok).toBe(false);
  });
});
