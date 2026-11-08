import { describe, expect, it } from "vitest";
import type { CaseMessage, ChatCaseView, FlagLine } from "./api";
import {
  closesWords,
  countEvidence,
  homeSplitWords,
  mergeEvidence,
  outcomeWords,
  reportedByWords,
  rowWords,
  scopeOf,
  scopeWords,
  sourcesOf,
} from "./evidence";

/**
 * Owner rule (8 Nov 2026): a chat line reported by players AND caught by the
 * word filter is one line, marked with both sources, never counted twice.
 */

const message = (id: number, ts: number, reporters: number[], text = `line ${id}`): CaseMessage => ({
  id,
  channel: "chat:mr2-global",
  message: text,
  ts,
  verified: true,
  reporters,
  snapshot: { source: "log", lines: [] },
});

const flag = (id: number, ts: number, text = `flag ${id}`): FlagLine => ({
  id,
  channel: "chat:mr2-global",
  message: text,
  shown: "****",
  words: ["damn"],
  severity: "swear",
  rule: "word",
  at: new Date(ts).toISOString(),
  ts,
});

const chatCase = (messages: CaseMessage[]): ChatCaseView => ({
  id: 7,
  status: "open",
  reported: { userid: 42, username: "Maze", banned: false, muted: false, gameTeam: false },
  messages,
  reporters: [
    { userid: 1, username: "Kozu", at: "2026-11-08T08:00:00Z", first: true, late: false, award: null },
    { userid: 2, username: "Twig", at: "2026-11-08T08:01:00Z", first: false, late: false, award: null },
    { userid: 3, username: null, at: "2026-11-08T08:02:00Z", first: false, late: false, award: null },
  ],
  reports: messages.reduce((n, m) => n + m.reporters.length, 0),
  firstReportAt: "2026-11-08T08:00:00Z",
  lastReportAt: "2026-11-08T08:02:00Z",
  history: { cases: 1, flags: 2, warnings: 0, mutes: 0, bans: 0 },
  suggest: { action: "warn", hours: null },
  closed: null,
});

describe("mergeEvidence", () => {
  it("shows a line both reported and caught once, with both sources", () => {
    const lines = mergeEvidence(chatCase([message(1, 1000, [1, 2]), message(2, 2000, [1, 2, 3], "both")]), [
      flag(10, 2000, "both"),
      flag(11, 3000),
    ]);
    expect(lines.map((l) => l.ts)).toEqual([3000, 2000, 1000]);
    const both = lines.find((l) => l.ts === 2000)!;
    expect(sourcesOf(both)).toEqual(["report", "filter"]);
    expect(both.reported!.reporters.map((r) => r.userid)).toEqual([1, 2, 3]);
    expect(sourcesOf(lines[0]!)).toEqual(["filter"]);
    expect(sourcesOf(lines[2]!)).toEqual(["report"]);
    expect(lines.filter((l) => l.message === "both")).toHaveLength(1);
  });

  it("counts each line once: the both-line adds its reports, never a filter catch", () => {
    const lines = mergeEvidence(chatCase([message(1, 1000, [1, 2]), message(2, 2000, [1, 2, 3])]), [flag(10, 2000), flag(11, 3000)]);
    expect(countEvidence(lines)).toEqual({ messages: 3, reports: 5, reporters: 3, both: 1, filterOnly: 1 });
  });

  it("works with only filter lines, or only a case", () => {
    expect(countEvidence(mergeEvidence(null, [flag(1, 5), flag(2, 6)]))).toEqual({ messages: 2, reports: 0, reporters: 0, both: 0, filterOnly: 2 });
    expect(countEvidence(mergeEvidence(chatCase([message(1, 5, [1])]), []))).toMatchObject({ messages: 1, reports: 1, filterOnly: 0 });
  });
});

describe("the words", () => {
  it("says what an action covers, with the both-line counted once", () => {
    // 3 lines: 2 reported (one also caught), 1 only caught; 4 reports.
    const scope = scopeOf({ messages: 3, reports: 4, filterOnlyLines: 1 });
    expect(scopeWords(scope)).toBe("Applies to all 3 messages, closes 4 reports and 1 word-filter catch");
    expect(scopeWords({ messages: 3, reports: 4, filterOnly: 0 })).toBe("Applies to all 3 messages, closes 4 reports");
    expect(scopeWords({ messages: 1, reports: 0, filterOnly: 1 })).toBe("Applies to the 1 message, closes 1 word-filter catch");
    expect(closesWords({ messages: 2, reports: 0, filterOnly: 2 })).toBe("2 word-filter catches");
  });

  it("gives a row its counts, each line once", () => {
    expect(rowWords({ messages: 3, reports: 4, uniqueReporters: 3, filterOnlyLines: 1 })).toBe(
      "3 messages · 4 reports from 3 players · 1 word-filter catch",
    );
    expect(rowWords({ messages: 2, reports: 0, uniqueReporters: 0, filterOnlyLines: 2 })).toBe("2 messages · 2 word-filter catches");
  });

  it("names the reporters", () => {
    expect(reportedByWords([{ userid: 1, username: "Kozu" }, { userid: 3, username: null }])).toBe("Reported by 2 players: Kozu, #3");
  });

  it("splits Home's players so the two parts add up to the total", () => {
    expect(homeSplitWords({ all: 5, reports: 3, filter: 2 })).toBe("3 reported by players · 2 caught by the word filter");
  });

  it("says a closed decision's outcome", () => {
    expect(outcomeWords({ outcome: "mute", hours: 72 })).toBe("Chat restricted for 3 days");
    expect(outcomeWords({ outcome: "mute", hours: 1 })).toBe("Chat restricted for 1 hour");
    expect(outcomeWords({ outcome: "dismiss", hours: null })).toBe("Dismissed");
  });
});
