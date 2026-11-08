import type {
  CaseMessage,
  CaseReporter,
  ChatCaseView,
  ClosedDecision,
  FlagLine,
  InboxList,
  InboxPlayer,
} from "./api";
import { plural } from "./format";

/**
 * One player's evidence for the Moderation page, as plain data (owner rule,
 * 8 Nov 2026): a chat line that players reported AND the word filter caught
 * is ONE line, marked with both sources, and is never counted twice: not in
 * the list's counts, not on Home, not in "closes N reports". A line is the
 * same line when chat stamped it with the same time (`ts`), which is how the
 * server matches them too (`services/admin/moderationInbox.ts`).
 */

export type EvidenceSource = "report" | "filter";

/** One chat line the player said, with every source that brought it here. */
export interface EvidenceLine {
  ts: number;
  channel: string;
  /** The player's own words. */
  message: string;
  /** Players reported it: the case's copy of the line and who reported it. */
  reported: { message: CaseMessage; reporters: CaseReporter[] } | null;
  /** The word filter caught it. */
  filter: FlagLine | null;
}

/** Every source of a line, reports first. */
export const sourcesOf = (line: EvidenceLine): EvidenceSource[] =>
  [line.reported ? "report" : null, line.filter ? "filter" : null].filter((s): s is EvidenceSource => s !== null);

/**
 * The case's reported lines and the word filter's lines as one list, newest
 * first: a line in both is one entry with both sources.
 */
export const mergeEvidence = (chatCase: ChatCaseView | null, flags: readonly FlagLine[]): EvidenceLine[] => {
  const byTs = new Map<number, EvidenceLine>();
  for (const message of chatCase?.messages ?? []) {
    const reporters = (chatCase?.reporters ?? []).filter((r) => message.reporters.includes(r.userid));
    byTs.set(message.ts, {
      ts: message.ts,
      channel: message.channel,
      message: message.message,
      reported: { message, reporters },
      filter: null,
    });
  }
  for (const flag of flags) {
    const same = byTs.get(flag.ts);
    if (same) {
      // A line is caught once; should it come twice, the first (newest) stays.
      if (!same.filter) same.filter = flag;
      continue;
    }
    byTs.set(flag.ts, { ts: flag.ts, channel: flag.channel, message: flag.message, reported: null, filter: flag });
  }
  return [...byTs.values()].sort((a, b) => b.ts - a.ts);
};

/** What a list of lines adds up to, each line counted once. */
export interface EvidenceCounts {
  /** Different lines. */
  messages: number;
  /** Reports of the reported lines (one per reporter per line). */
  reports: number;
  /** Different players who reported. */
  reporters: number;
  /** Lines both reported and caught: already in `messages`, never added again. */
  both: number;
  /** Lines only the word filter caught. */
  filterOnly: number;
}

export const countEvidence = (lines: readonly EvidenceLine[]): EvidenceCounts => {
  const reporters = new Set<number>();
  let reports = 0;
  let both = 0;
  let filterOnly = 0;
  for (const line of lines) {
    if (line.reported) {
      reports += line.reported.message.reporters.length;
      for (const id of line.reported.message.reporters) reporters.add(id);
      if (line.filter) both += 1;
    } else if (line.filter) {
      filterOnly += 1;
    }
  }
  return { messages: lines.length, reports, reporters: reporters.size, both, filterOnly };
};

/** What an action covers, before it is sent: lines, reports, and the filter's own catches. */
export interface Scope {
  messages: number;
  reports: number;
  filterOnly: number;
}

/** A queue row's (or a Closed decision's) scope, as the server counted it: each line once. */
export const scopeOf = (row: Pick<InboxPlayer, "messages" | "reports" | "filterOnlyLines">): Scope => ({
  messages: row.messages,
  reports: row.reports,
  filterOnly: row.filterOnlyLines,
});

const catches = (n: number): string => plural(n, "word-filter catch", "word-filter catches");

/** "4 reports and 1 word-filter catch": what closing closes. */
export const closesWords = (scope: Scope): string => {
  const parts = [scope.reports ? plural(scope.reports, "report") : null, scope.filterOnly ? catches(scope.filterOnly) : null].filter(
    (p): p is string => p !== null,
  );
  return parts.length ? parts.join(" and ") : "nothing open";
};

/** The action bar's line: "Applies to all 3 messages, closes 4 reports". */
export const scopeWords = (scope: Scope): string => {
  const lines = scope.messages === 1 ? "Applies to the 1 message" : `Applies to all ${plural(scope.messages, "message")}`;
  return `${lines}, closes ${closesWords(scope)}`;
};

/** A queue row's counts: "3 messages · 4 reports from 3 players · 1 word-filter catch". */
export const rowWords = (row: Pick<InboxPlayer, "messages" | "reports" | "uniqueReporters" | "filterOnlyLines">): string =>
  [
    plural(row.messages, "message"),
    row.reports ? `${plural(row.reports, "report")} from ${plural(row.uniqueReporters, "player")}` : null,
    row.filterOnlyLines ? catches(row.filterOnlyLines) : null,
  ]
    .filter(Boolean)
    .join(" · ");

/** "Reported by 2 players: Kozu, Maze". */
export const reportedByWords = (reporters: readonly Pick<CaseReporter, "userid" | "username">[]): string =>
  `Reported by ${plural(reporters.length, "player")}: ${reporters.map((r) => r.username ?? `#${r.userid}`).join(", ")}`;

/**
 * Home's split of the players waiting: each player is in exactly one of the
 * two (reported if anyone reported them, else caught by the filter), so the
 * two always add up to the total.
 */
export const homeSplitWords = (counts: InboxList["counts"]): string =>
  `${count0(counts.reports)} reported by players · ${count0(counts.filter)} caught by the word filter`;

const count0 = (n: number): string => String(Math.max(0, n));

/** A Closed decision's outcome in words. */
export const outcomeWords = (decision: Pick<ClosedDecision, "outcome" | "hours">): string => {
  if (decision.outcome === "warn") return "Warned";
  if (decision.outcome === "mute") return decision.hours ? `Chat restricted for ${lengthWords(decision.hours)}` : "Chat restricted";
  if (decision.outcome === "ban") return "Banned";
  return "Dismissed";
};

/** "1 hour", "1 day", "3 days". */
export const lengthWords = (hours: number): string =>
  hours % 24 === 0 ? plural(hours / 24, "day") : plural(hours, "hour");
