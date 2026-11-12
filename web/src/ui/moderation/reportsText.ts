import { MOD_MUTE_LENGTHS, type FlagSeverity, type ModClosedRow, type ModLogEntry, type ModQueueRow } from "@/api/modReports";
import { countryName } from "@/game/account/countries";

/**
 * The words of the moderators' Reports window (`ReportsWindow.ts`), as the
 * approved mock-up says them (design/mod-panel-mock, owner 12 Nov 2026).
 * The owner's words: Close and Mute, never Dismiss or Restrict chat.
 */

export const REPORTS_TEXT = {
  title: "Reports",
  search: "Name or account number",
  filters: {
    all: ["All", "Everything open"],
    reports: ["Reports", "Player reports"],
    filter: ["Word filter", "Word-filter catches"],
    closed: ["Closed", "Closed cases"],
  },
  empty: {
    all: "Players others report and lines the word filter catches show up here, one row per player.",
    reports: "When a player reports a chat line, the player who said it shows up here.",
    filter: "Players whose lines only the word filter caught show up here.",
    closed: "Decisions from the last 30 days show up here.",
  },
  nothing: "Nothing needs you",
  noDecisions: "No decisions yet",
  nobody: "Nobody matches.",
  more: "Show more",
  pick: "Pick a player",
  pickWords: "Their reported lines, who reported them and their earlier warnings and mutes open here.",
  loading: "Loading…",
  failed: "Could not load. Try again in a moment.",
  back: "‹ Back",
  noOpen: "No open reports",
  noOpenWords: "Nothing is waiting for this player.",
  noCopy: "No chat copy",
  noCopyTitle: "The chat server kept no copy of this line, so its words come from the reporter's game and could not be checked.",
  noCopyNotice: (n: number) =>
    `For ${plural(n, "reported message")} the chat server kept no copy, so the words come from the reporter’s game and the chat around it is missing. That alone says nothing about what was meant.`,
  showAround: "Show the chat around it",
  noAround: "The chat log has nothing around this line.",
  history: "Previous moderation",
  noHistory: "No warnings, mutes or bans.",
  decisions: (n: number) => `Earlier decisions (last 30 days): ${n}`,
  playerReport: "Player report",
  playerReports: "Player reports",
  wordFilter: "Word filter",
  muted: "Muted",
  banned: "Banned",
  banNote: "Ban: admins only",
  actions: { close: "Close", warn: "Warn", mute: "Mute" },
  confirm: { close: "Confirm close", warn: "Confirm warn", mute: "Confirm mute" },
  cancel: "Cancel",
  ask: {
    close: (name: string) => `Close for ${name}?`,
    warn: (name: string) => `Warn ${name}?`,
    mute: (name: string) => `Mute ${name}’s chat?`,
  },
  explain: {
    close: "Nothing happens to the player and they are not told. The reports and catches are closed.",
    warn: "They see your reason in a pop-up in the game and in their mail.",
    mute: "They can still read chat but cannot write in it until it ends. They see your reason in a pop-up and in their mail.",
  },
  howLong: "How long",
  note: "Note",
  noteWho: "moderators and admins see this",
  reason: "Reason",
  reasonWho: "the player sees this",
  optional: "Optional",
  sayWhy: "Say why, in a sentence",
  defaultWarning: "Please keep chat friendly. Next time it's a ban.",
  needReason: "Write a reason: the player sees it.",
  sending: "Sending…",
} as const;

export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

const catches = (n: number): string => plural(n, "word-filter catch", "word-filter catches");

/** "3 reports and 1 word-filter catch", or "nothing open". */
export const closesWords = (row: Pick<ModQueueRow, "reports" | "filterOnlyLines">): string =>
  [row.reports ? plural(row.reports, "report") : null, row.filterOnlyLines ? catches(row.filterOnlyLines) : null]
    .filter(Boolean)
    .join(" and ") || "nothing open";

/** The line over Close / Warn / Mute: what the step covers. */
export const scopeWords = (row: Pick<ModQueueRow, "messages" | "reports" | "filterOnlyLines">): string =>
  `${row.messages === 1 ? "Applies to the 1 message" : `Applies to all ${plural(row.messages, "message")}`}, closes ${closesWords(row)}`;

/** A list row's sums: "2 messages · 3 reports from 2 players · 1 word-filter catch". */
export const rowWords = (row: Pick<ModQueueRow, "messages" | "reports" | "uniqueReporters" | "filterOnlyLines">): string =>
  [
    plural(row.messages, "message"),
    row.reports ? `${plural(row.reports, "report")} from ${plural(row.uniqueReporters, "player")}` : null,
    row.filterOnlyLines ? catches(row.filterOnlyLines) : null,
  ]
    .filter(Boolean)
    .join(" · ");

/** "1 hour", "1 day", "3 days", "7 days", or "N hours" for an admin's other length. */
export const muteLength = (hours: number): string =>
  MOD_MUTE_LENGTHS.find(([h]) => h === hours)?.[1] ??
  (hours % 24 === 0 ? plural(hours / 24, "day") : plural(hours, "hour"));

/** A decision as the Closed list and "Earlier decisions" say it. */
export const outcomeWords = (row: Pick<ModClosedRow, "outcome" | "hours">): string => {
  switch (row.outcome) {
    case "dismiss":
      return "Closed, no action";
    case "warn":
      return "Warned";
    case "mute":
      return row.hours ? `Muted for ${muteLength(row.hours)}` : "Muted";
    case "ban":
      return "Banned";
  }
};

/** A log entry's chip words. */
export const logWords = (action: ModLogEntry["action"]): string =>
  ({ warn: "Warning", mute: "Muted", ban: "Banned", unmute: "Unmuted", unban: "Unbanned" })[action];

/** "Slur" or "Swearing", as the dashboard says the word filter's catches. */
export const severityWords = (severity: FlagSeverity): string => (severity === "slur" ? "Slur" : "Swearing");

/** The room a line was said in: "Map Room 2", "Inferno", a country, "Alliance". */
export const roomLabel = (channel: string): string => {
  const mapRoom = /^chat:mr(\d)-global$/.exec(channel);
  if (mapRoom) return `Map Room ${mapRoom[1]}`;
  if (channel === "chat:inferno-global") return "Inferno";
  if (channel.startsWith("chat:country:")) return countryName(channel.slice("chat:country:".length));
  if (channel.startsWith("chat:alliance:")) return "Alliance";
  return channel.replace(/^chat:/, "");
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const two = (n: number): string => String(n).padStart(2, "0");

/** "09:40", in the moderator's own time. */
export const clock = (when: number | string | Date): string => {
  const date = new Date(when);
  return `${two(date.getHours())}:${two(date.getMinutes())}`;
};

/** "12 Nov 09:40", in the moderator's own time. */
export const dateTime = (when: number | string | Date): string => {
  const date = new Date(when);
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${clock(date)}`;
};

/** "now", "5m", "2h", "3d": how long ago. */
export const ago = (when: number | string | Date, now: number = Date.now()): string => {
  const minutes = Math.floor((now - new Date(when).getTime()) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
};

/** A log entry's small line: "until 13 Nov 10:00 · by Owner · seen 11 Nov". */
export const logMeta = (entry: ModLogEntry): string =>
  [
    entry.until ? `until ${dateTime(entry.until)}` : entry.action === "ban" ? "for good" : null,
    `by ${entry.byName ?? "the game team"}`,
    entry.seenAt ? `seen ${dateTime(entry.seenAt).replace(/ \d\d:\d\d$/, "")}` : "not seen yet",
  ]
    .filter(Boolean)
    .join(" · ");

/** Words for a refusal the server named but sent no words for. */
export const REFUSAL_FALLBACK: Readonly<Record<string, string>> = {
  notModerator: "Only moderators can open Reports.",
  changed: "Something new came in for this player. Look again before deciding.",
  nothingOpen: "Someone already closed this. Nothing is open for this player now.",
  longerMute: "This player's chat is already muted for longer. Warn or Close instead.",
};
