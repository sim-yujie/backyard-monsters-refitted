import { describe, expect, test } from "bun:test";

import { countOnce, parseInboxAction } from "./moderationInbox.js";

describe("an inbox step, as the page sends it", () => {
  const seen = { caseId: 4, reports: 3, flagsUpTo: 90 };

  test("reads warn, pause, ban and dismiss with what the owner was shown", () => {
    expect(parseInboxAction({ action: "warn", reason: " Be nice ", ...seen })).toEqual({
      ok: true,
      value: { action: { kind: "warn", reason: "Be nice" }, seen },
    });
    expect(parseInboxAction({ action: "mute", reason: "x", hours: 24, ...seen })).toMatchObject({
      ok: true,
      value: { action: { kind: "mute", hours: 24 } },
    });
    expect(parseInboxAction({ action: "ban", reason: "x", days: null })).toEqual({
      ok: true,
      value: { action: { kind: "ban", reason: "x", days: null }, seen: { caseId: null, reports: 0, flagsUpTo: null } },
    });
    expect(parseInboxAction({ action: "dismiss", note: "  " })).toMatchObject({ ok: true, value: { action: { kind: "dismiss", note: null } } });
  });

  test("refuses a step without a reason, a length out of range, or an unknown step", () => {
    expect(parseInboxAction({ action: "warn", reason: " " })).toEqual({ ok: false, message: "Write a reason: the player sees it." });
    expect(parseInboxAction({ action: "mute", reason: "x", hours: 0 }).ok).toBe(false);
    expect(parseInboxAction({ action: "mute", reason: "x", hours: 1.5 }).ok).toBe(false);
    expect(parseInboxAction({ action: "ban", reason: "x" })).toEqual({ ok: false, message: "Pick how long the ban lasts." });
    expect(parseInboxAction({ action: "ban", reason: "x", days: 99999 }).ok).toBe(false);
    expect(parseInboxAction({ action: "kick", reason: "x" }).ok).toBe(false);
    expect(parseInboxAction(null).ok).toBe(false);
  });

  test("ignores a shown count that is not a whole number", () => {
    expect(parseInboxAction({ action: "dismiss", caseId: "4", reports: -1, flagsUpTo: 0 })).toMatchObject({
      ok: true,
      value: { seen: { caseId: null, reports: 0, flagsUpTo: null } },
    });
  });
});

describe("counting chat lines once (owner, 8 Nov 2026)", () => {
  test("a reported line the word filter also caught is one line", () => {
    expect(countOnce([1000], [1000])).toEqual({ messages: 1, alsoReported: 1, filterOnly: 0 });
  });

  test("reported lines and other caught lines add up, the shared one once", () => {
    expect(countOnce([1000, 2000, 3000], [2000, 4000])).toEqual({ messages: 4, alsoReported: 1, filterOnly: 1 });
  });

  test("nothing shared, or nothing at all", () => {
    expect(countOnce([1000], [2000])).toEqual({ messages: 2, alsoReported: 0, filterOnly: 1 });
    expect(countOnce([], [])).toEqual({ messages: 0, alsoReported: 0, filterOnly: 0 });
  });

  test("the same stamp twice is still one line", () => {
    expect(countOnce([1000, 1000], [1000, 1000])).toEqual({ messages: 1, alsoReported: 1, filterOnly: 0 });
  });
});
