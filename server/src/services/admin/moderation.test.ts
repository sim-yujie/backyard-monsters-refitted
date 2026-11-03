import { describe, expect, test } from "bun:test";

import { MAX_BAN_DAYS, MAX_MODERATION_REASON, MAX_MUTE_HOURS, banText, lengthWords, parseModeration } from "./moderation.js";

/** Reading the dashboard's warn, mute and ban requests, and the words a banned player gets. */

describe("parseModeration", () => {
  test("a warning needs a reason", () => {
    expect(parseModeration("warn", { reason: "  " })).toEqual({ ok: false, message: "Write a reason: the player sees it." });
    expect(parseModeration("warn", { reason: " Be nice. ", chatReportId: 7 })).toEqual({
      ok: true,
      value: { kind: "warn", reason: "Be nice.", length: null, chatReportId: 7 },
    });
  });

  test("a ban names days, or null for good", () => {
    expect(parseModeration("ban", { reason: "Swearing" })).toMatchObject({ ok: false });
    expect(parseModeration("ban", { reason: "Swearing", days: null })).toMatchObject({ ok: true, value: { length: null } });
    expect(parseModeration("ban", { reason: "Swearing", days: 7 })).toMatchObject({ ok: true, value: { length: 7 } });
    expect(parseModeration("ban", { reason: "Swearing", days: 0 })).toMatchObject({ ok: false });
    expect(parseModeration("ban", { reason: "Swearing", days: 1.5 })).toMatchObject({ ok: false });
    expect(parseModeration("ban", { reason: "Swearing", days: MAX_BAN_DAYS + 1 })).toMatchObject({ ok: false });
    expect(parseModeration("ban", { reason: "", days: 7 })).toMatchObject({ ok: false });
  });

  test("a mute names hours", () => {
    expect(parseModeration("mute", { reason: "Spam", hours: 24 })).toMatchObject({ ok: true, value: { length: 24 } });
    expect(parseModeration("mute", { reason: "Spam" })).toMatchObject({ ok: false });
    expect(parseModeration("mute", { reason: "Spam", hours: MAX_MUTE_HOURS + 1 })).toMatchObject({ ok: false });
  });

  test("unban and unmute need no reason", () => {
    expect(parseModeration("unban", {})).toMatchObject({ ok: true, value: { reason: "" } });
    expect(parseModeration("unmute", null)).toMatchObject({ ok: true, value: { reason: "" } });
  });

  test("refuses a long reason and a bad report number", () => {
    expect(parseModeration("warn", { reason: "x".repeat(MAX_MODERATION_REASON + 1) })).toMatchObject({ ok: false });
    expect(parseModeration("warn", { reason: "ok", chatReportId: "7" })).toMatchObject({ ok: false });
  });
});

describe("the words", () => {
  test("a ban says until when and why", () => {
    expect(banText(new Date("2026-11-10T14:05:00Z"), "Swearing in chat")).toBe(
      "Your account is banned until 2026-11-10 14:05 UTC. Reason: Swearing in chat"
    );
    expect(banText(null, "Cheating")).toBe("Your account is banned for good. Reason: Cheating");
  });

  test("lengths", () => {
    expect(lengthWords(1, "hour")).toBe("1 hour");
    expect(lengthWords(3, "day")).toBe("3 days");
  });
});
