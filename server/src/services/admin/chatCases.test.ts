import { describe, expect, test } from "bun:test";

import {
  DEFAULT_AWARD_REASON,
  betterSnapshot,
  linesAfter,
  parseCaseAction,
  parseCaseAward,
  suggestAction,
  windowAround,
  type Snapshot,
  type SnapshotLine,
} from "./chatCases.js";
import { chatReportAward } from "../../config/AdminConfig.js";

const line = (i: number, userid = 1): SnapshotLine => ({ userid, name: `p${userid}`, text: `line ${i}`, at: i });
const clean = { cases: 0, flags: 0, warnings: 0, mutes: 0, bans: 0 };

describe("the copy of the room", () => {
  test("keeps 10 lines in all: 7 before, the line, 2 after, marking the reported one", () => {
    const lines = Array.from({ length: 30 }, (_, i) => line(i));
    const kept = windowAround(lines, (l) => l.at === 15);
    expect(kept.map((l) => l.at)).toEqual([8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
    expect(kept.filter((l) => l.reported).map((l) => l.at)).toEqual([15]);
    expect(lines.some((l) => l.reported)).toBe(false);
  });

  test("is empty when the line is not there", () => {
    expect(windowAround([line(1)], () => false)).toEqual([]);
  });

  test("a better copy: has the line, the own words, or more lines after", () => {
    const of = (source: Snapshot["source"], after: number): Snapshot => ({
      source,
      lines: [{ ...line(0), reported: true }, ...Array.from({ length: after }, (_, i) => line(i + 1))],
    });
    const none: Snapshot = { source: "none", lines: [] };
    expect(linesAfter(of("log", 3))).toBe(3);
    expect(linesAfter(none)).toBe(-1);
    expect(betterSnapshot(none, of("room", 0))).toBe(true);
    expect(betterSnapshot(of("room", 5), of("log", 1))).toBe(true);
    expect(betterSnapshot(of("log", 1), of("room", 5))).toBe(false);
    expect(betterSnapshot(of("log", 1), of("log", 3))).toBe(true);
    expect(betterSnapshot(of("log", 3), of("log", 3))).toBe(false);
    expect(betterSnapshot(of("log", 3), none)).toBe(false);
  });
});

describe("what the page suggests", () => {
  test("one line, clean record: a warning", () => {
    expect(suggestAction(1, clean)).toEqual({ action: "warn", hours: null });
  });
  test("several lines, or filter flags: a warning with a day's pause", () => {
    expect(suggestAction(2, clean)).toEqual({ action: "mute", hours: 24 });
    expect(suggestAction(1, { ...clean, flags: 2 })).toEqual({ action: "mute", hours: 24 });
  });
  test("longer for each earlier step", () => {
    expect(suggestAction(1, { ...clean, warnings: 1 })).toEqual({ action: "mute", hours: 72 });
    expect(suggestAction(1, { ...clean, warnings: 1, mutes: 1 })).toEqual({ action: "mute", hours: 168 });
  });
});

describe("reading the owner's step", () => {
  test("warn and pause need a reason; a pause needs hours", () => {
    expect(parseCaseAction({ action: "warn", reason: "  be nice " })).toEqual({ ok: true, value: { kind: "warn", reason: "be nice" } });
    expect(parseCaseAction({ action: "warn" }).ok).toBe(false);
    expect(parseCaseAction({ action: "mute", reason: "x" }).ok).toBe(false);
    expect(parseCaseAction({ action: "mute", reason: "x", hours: 24 })).toEqual({
      ok: true,
      value: { kind: "mute", reason: "x", hours: 24 },
    });
    expect(parseCaseAction({ action: "mute", reason: "x", hours: 10_000 }).ok).toBe(false);
    expect(parseCaseAction({ action: "ban", reason: "x" }).ok).toBe(false);
  });
  test("dismiss takes an optional note", () => {
    expect(parseCaseAction({ action: "dismiss" })).toEqual({ ok: true, value: { kind: "dismiss", note: null } });
    expect(parseCaseAction({ action: "dismiss", note: "fine" })).toEqual({ ok: true, value: { kind: "dismiss", note: "fine" } });
  });
  test("an award: whole amounts, each reporter once, the default reason", () => {
    expect(parseCaseAward({ awards: [{ userid: 2, amount: 25 }] })).toEqual({
      ok: true,
      value: { awards: [{ userid: 2, amount: 25 }], reason: DEFAULT_AWARD_REASON },
    });
    expect(parseCaseAward({ awards: [] }).ok).toBe(false);
    expect(parseCaseAward({ awards: [{ userid: 2, amount: 2.5 }] }).ok).toBe(false);
    expect(parseCaseAward({ awards: [{ userid: 2, amount: 0 }] }).ok).toBe(false);
    expect(parseCaseAward({ awards: [{ userid: 2, amount: 5 }, { userid: 2, amount: 5 }] }).ok).toBe(false);
  });
  test("the starting amounts come from the server's settings", () => {
    // The owner's choice: 10 each, no first-reporter bonus.
    expect(chatReportAward({})).toEqual({ each: 10, first: 10 });
    expect(chatReportAward({ CHAT_REPORT_SHINY: "15", CHAT_REPORT_FIRST_SHINY: "nope" })).toEqual({ each: 15, first: 15 });
    expect(chatReportAward({ CHAT_REPORT_FIRST_SHINY: "30" })).toEqual({ each: 10, first: 30 });
  });
});
