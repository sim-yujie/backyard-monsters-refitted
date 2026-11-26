import { ApiError, get, postJson } from "./http";
import type { ApiEnvelope } from "./types";

/**
 * The Reports window for moderators (owner, 12 Nov 2026; server
 * `controllers/moderator/routes.ts`): the dashboard's moderation inbox in the
 * game, narrowed to Close, Warn and Mute (1 hour to 7 days).
 *
 * - `GET  /api/:apiVersion/mod/status`: whether the player is a moderator, and how many players have something open.
 * - `GET  /api/:apiVersion/mod/reports?filter=&offset=`: the list.
 * - `GET  /api/:apiVersion/mod/reports/players/:id`: one player.
 * - `GET  /api/:apiVersion/mod/reports/lines/:id/around`: the chat around an open word-filter line.
 * - `POST /api/:apiVersion/mod/reports/players/:id/act`: Close, Warn or Mute.
 */

export type ModFilter = "all" | "reports" | "filter" | "closed";
export type ModActKind = "close" | "warn" | "mute";
export type FlagSeverity = "slur" | "swear" | "sexual" | "insult" | string;

/** The mute lengths a moderator may pick, in hours, with their words. */
export const MOD_MUTE_LENGTHS: readonly (readonly [number, string])[] = [
  [1, "1 hour"],
  [24, "1 day"],
  [72, "3 days"],
  [168, "7 days"],
];

/** The longest reason or note the server takes. */
export const MAX_MOD_REASON = 300;

export interface ModPreview {
  readonly text: string;
  readonly source: "report" | "filter";
}

/** A player with something open. */
export interface ModQueueRow {
  readonly userid: number;
  readonly username: string | null;
  readonly muted: boolean;
  readonly banned: boolean;
  readonly caseId: number | null;
  /** Different chat lines open against them, each counted once. */
  readonly messages: number;
  readonly reportedMessages: number;
  readonly reports: number;
  readonly uniqueReporters: number;
  readonly filterOnlyLines: number;
  readonly slurs: number;
  readonly flagsUpTo: number | null;
  readonly oldestAt: string;
  readonly latestAt: string;
  readonly preview: ModPreview | null;
  /** Their main yard's age in hours while they are a new player (under three days): "New · 30h". Absent from older servers. */
  readonly newHours?: number | null;
  /** The chat filter's reasons on their open lines, each once. */
  readonly filterTags?: readonly FilterTag[];
}

/** Why the chat filter flagged a line (`services/chat/chatFilter.ts`). */
export type FilterTag = "newLink" | "invite" | "watched" | "hidden";

/** A decision in the Closed list. */
export interface ModClosedRow {
  readonly userid: number;
  readonly username: string | null;
  readonly closedAt: string;
  readonly closedByName: string | null;
  readonly outcome: "warn" | "mute" | "ban" | "dismiss";
  readonly hours: number | null;
  readonly note: string | null;
  readonly messages: number;
  readonly reports: number;
  readonly filterOnlyLines: number;
  readonly preview: ModPreview | null;
}

export interface ModCounts {
  readonly all: number;
  readonly reports: number;
  readonly filter: number;
  readonly closed: number;
}

export interface ModList extends ApiEnvelope {
  readonly filter: ModFilter;
  readonly players: ModQueueRow[];
  readonly closed: ModClosedRow[];
  readonly nextOffset: number | null;
  readonly counts: ModCounts;
}

/** One line of the room around a line. */
export interface AroundLine {
  readonly userid: number;
  readonly name: string | null;
  readonly text: string;
  /** When it was said (ms). */
  readonly at: number;
  readonly reported?: true;
  readonly flagged?: FlagSeverity;
}

/** One open line: reported, caught by the word filter, or both. */
export interface ModLine {
  readonly ts: number;
  readonly channel: string;
  readonly message: string;
  readonly report: {
    readonly reporters: string[];
    readonly verified: boolean;
    readonly around: AroundLine[];
  } | null;
  readonly filter: {
    readonly id: number;
    readonly severity: FlagSeverity;
    readonly rule: "word" | "disguised";
    readonly words: string[];
    readonly shown: string;
    /** The chat filter's reasons; empty for a word-filter flag. */
    readonly tags?: readonly FilterTag[];
    /** Nobody but the player saw it. */
    readonly hidden?: boolean;
    readonly yardAgeHours?: number | null;
  } | null;
  /** The chat line's id, for Remove. */
  readonly lineId?: string | null;
  /** A moderator removed it from chat. */
  readonly removed?: { readonly byName: string | null; readonly at: string } | null;
  /** The same words said again, grouped under this line: each copy, for Remove. */
  readonly copies?: readonly { readonly channel: string; readonly ts: number; readonly lineId: string | null }[];
}

export interface ModLogEntry {
  readonly action: "warn" | "mute" | "ban" | "unmute" | "unban";
  readonly reason: string;
  readonly until: string | null;
  readonly byName: string | null;
  readonly seenAt: string | null;
  readonly at: string;
}

export interface ModPlayer {
  readonly userid: number;
  readonly username: string;
  readonly lastSeenAt: string | null;
  readonly muteUntil: string | null;
  readonly banned: boolean;
  readonly open: ModQueueRow | null;
  /** Newest first. */
  readonly lines: ModLine[];
  readonly log: ModLogEntry[];
  readonly decisions: ModClosedRow[];
  /** Their main yard's age in hours while they are a new player. */
  readonly newHours?: number | null;
}

export interface ModActBody {
  readonly action: ModActKind;
  readonly reason?: string;
  readonly note?: string;
  readonly hours?: number;
  /** What the window showed: a newer report is refused as changed. */
  readonly caseId: number | null;
  readonly reports: number;
  readonly flagsUpTo: number | null;
}

export interface ModActResult extends ApiEnvelope {
  readonly closed: { readonly reports: number; readonly filterLines: number; readonly filterOnlyLines: number };
  /** What is still open (newer lines), or null. */
  readonly player: ModQueueRow | null;
}

export interface ModStatus {
  readonly moderator: boolean;
  readonly open: number;
  /** Ban lengths a moderator may pick, in days (1, 3, 7). */
  readonly banDays?: readonly number[];
}

/** A moderator's ban (`POST /mod/players/:id/ban`): 1, 3 or 7 days, a reason the player sees. */
export interface ModBanBody {
  readonly days: number;
  readonly reason: string;
  /** Also take their chat lines of the last hour out of the rooms. */
  readonly removeLines: boolean;
}

export interface ModBanResult extends ApiEnvelope {
  readonly until: string;
  readonly closed: { readonly reports: number; readonly filterLines: number };
  readonly removedLines: number | null;
}

/** Ban lengths when the server does not say. */
export const MOD_BAN_DAYS: readonly number[] = [1, 3, 7];

/** A line to remove: its room and stamp, and its id when known. */
export interface ModRemoveLine {
  readonly channel: string;
  readonly ts: number;
  readonly lineId: string | null;
}

/** The routes, so a test can stand in for the server. */
export interface ModReportsApi {
  status(): Promise<ModStatus>;
  list(filter: ModFilter, offset?: number): Promise<ModList>;
  player(userid: number): Promise<ModPlayer>;
  around(flagId: number): Promise<AroundLine[]>;
  act(userid: number, body: ModActBody): Promise<ModActResult>;
  ban(userid: number, body: ModBanBody): Promise<ModBanResult>;
  removeLines(userid: number, lines: readonly ModRemoveLine[]): Promise<{ removed: number }>;
}

/** Why the server refused, from its `reason` (e.g. `changed`, `moderator`), or null. */
export const refusalReason = (caught: unknown): string | null => {
  if (!(caught instanceof ApiError)) return null;
  const reason = (caught.body as { reason?: unknown } | null | undefined)?.reason;
  return typeof reason === "string" ? reason : null;
};

export const modReportsApi: ModReportsApi = {
  async status() {
    const answer = await get<ApiEnvelope & { moderator?: number; open?: number; banDays?: unknown }>("/api/:apiVersion/mod/status");
    const banDays = Array.isArray(answer.banDays) ? answer.banDays.map(Number).filter((d) => Number.isInteger(d) && d > 0) : [];
    return { moderator: Number(answer.moderator) === 1, open: Number(answer.open ?? 0) || 0, ...(banDays.length ? { banDays } : {}) };
  },
  list: (filter, offset) =>
    get<ModList>("/api/:apiVersion/mod/reports", { filter, ...(offset ? { offset } : {}) }),
  async player(userid) {
    return (await get<ApiEnvelope & { player: ModPlayer }>(`/api/:apiVersion/mod/reports/players/${userid}`)).player;
  },
  async around(flagId) {
    return (await get<ApiEnvelope & { lines: AroundLine[] }>(`/api/:apiVersion/mod/reports/lines/${flagId}/around`)).lines;
  },
  act: (userid, body) =>
    postJson<ModActResult>(`/api/:apiVersion/mod/reports/players/${userid}/act`, { ...body }),
  ban: (userid, body) => postJson<ModBanResult>(`/api/:apiVersion/mod/players/${userid}/ban`, { ...body }),
  async removeLines(userid, lines) {
    const answer = await postJson<ApiEnvelope & { removed?: number }>(`/api/:apiVersion/mod/players/${userid}/lines/remove`, {
      lines: lines.map((line) => ({ channel: line.channel, ts: line.ts, ...(line.lineId ? { lineId: line.lineId } : {}) })),
    });
    return { removed: Number(answer.removed ?? 0) || 0 };
  },
};
