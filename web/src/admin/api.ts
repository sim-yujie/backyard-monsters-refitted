import { restoreStoredSession } from "@/api/auth";
import {
  ApiError,
  NetworkError,
  apiUrl,
  get,
  getAuthToken,
  postJson,
  type FormBody,
  type JsonBody,
} from "@/api/http";
import type { ApiEnvelope } from "@/api/types";

/**
 * The owner dashboard's server routes (docs/design/admin-dashboard-api.md).
 * Every one is behind the owner-only check: anyone else gets a plain 404,
 * the same as an unknown address, which the page shows as "Not found".
 */

const ADMIN = "/api/:apiVersion/admin";

export type TicketStatus = "new" | "working" | "fixed" | "wontfix";
export const TICKET_STATUSES: readonly TicketStatus[] = ["new", "working", "fixed", "wontfix"];

export type BugFilter = "all" | "open" | "closed";
export type ErrorSource = "browser" | "server";
export type DashboardSection = "health" | "backups" | "errors" | "bugs";

/** The most Shiny one award can give, and above how much the page asks "are you sure?". */
export const MAX_SHINY_AWARD = 10_000;
export const CONFIRM_SHINY_ABOVE = 500;
export const MAX_AWARD_REASON = 200;
/** The longest message to a player (the game's mail limit). */
export const MAX_REPLY = 580;

export interface AdminMe {
  admin: true;
  userid: number;
  username: string;
}

export interface DailyStat {
  day: string;
  newPlayers: number;
  totalPlayers: number;
  activePlayers: number | null;
  activeSource: "tracked" | "logs" | "partial" | null;
  attacks: number;
  tribeRaids: number | null;
  eventNewPlayers: Record<string, number>;
  eventPlayers: Record<string, number> | null;
  bugReports: number;
  browserErrors: number | null;
  serverErrors: number | null;
}

export interface StatsOverview {
  generatedAt: string;
  players: { total: number; activeToday: number; active7: number; active30: number };
  today: DailyStat;
  days: DailyStat[];
}

export interface BugReportSummary {
  id: number;
  createdAt: string;
  userid: number | null;
  username: string | null;
  preview: string;
  gameVersion: string;
  screen: string;
  device: string;
  hasScreenshot: boolean;
  hasPicture: boolean;
  emailed: boolean;
  status: TicketStatus;
  statusChangedAt: string | null;
  hasNotes: boolean;
  /** The player's answers in the report's mail thread not opened yet. */
  unreadReplies: number;
}

export interface TicketChange {
  at: string;
  by: number | null;
  status: { from: TicketStatus | null; to: TicketStatus } | null;
  notes: string | null;
}

/** One mail in a report's thread: the owner's (as "The game team") or the player's. */
export interface SupportMessage {
  id: string;
  from: "team" | "player";
  text: string;
  at: string;
  /** A player's answer not seen before this read. */
  unread: boolean;
}

/** Why the owner cannot write to a report's player in the game. */
export type NoReplyReason = "signedOut" | "noPlayer";

export interface ShinyAwardView {
  id: number;
  userid: number;
  username: string;
  amount: number;
  reason: string;
  /** The report it was given from, or null from the Shiny section. */
  bugReportId: number | null;
  by: number | null;
  at: string;
}

export interface PlayerMatch {
  userid: number;
  username: string;
  /** The earlier name the search matched (from an old bug report or gift), when it is not their name now. */
  formerName: string | null;
  /** A computer-run neighbour: shown, marked, after the players. */
  bot: boolean;
  lastSeenAt: string | null;
}

export type ShinyAwardRequest = {
  userid: number;
  amount: number;
  reason: string;
  bugReportId?: number;
  /** The id of this press of Give: sent again on a retry, so it gives once. */
  requestId: string;
};

export interface BugReportDetail extends Omit<BugReportSummary, "preview" | "unreadReplies"> {
  message: string;
  contactEmail: string | null;
  userAgent: string;
  browser: string;
  screenSize: string;
  errors: string[];
  screenshotType: string | null;
  pictureType: string | null;
  emailedAt: string | null;
  ownerNotes: string;
  notesChangedAt: string | null;
  changes: TicketChange[];
  thread: SupportMessage[];
  cannotReply: NoReplyReason | null;
  awards: ShinyAwardView[];
}

export interface ErrorGroup {
  id: number;
  source: ErrorSource;
  message: string;
  place: string;
  stack: string;
  count: number;
  firstSeen: string;
  lastSeen: string;
  gameVersion: string;
  screen: string;
  userids: number[];
}

export interface ErrorTotals {
  browser: { kinds: number; occurrences: number };
  server: { kinds: number; occurrences: number };
}

export interface Problem {
  key: string;
  title: string;
  detail: string;
  section: DashboardSection;
}

export interface Container {
  service: string;
  state: string;
  health: string | null;
  restartCount: number | null;
  startedAt: string;
  oomKilled: boolean;
  exitCode: number | null;
}

export interface Disk {
  path: string;
  mount: string;
  totalBytes: number | null;
  usedBytes: number | null;
  availableBytes: number | null;
  usedPercent: number | null;
}

export interface HealthSummary {
  generatedAt: string;
  server: {
    startedAt: string;
    uptimeSeconds: number;
    version: { release: string | null; commit: string | null };
    rulesVersion: string;
    runtime: string;
    memory: {
      rssBytes: number;
      heapUsedBytes: number;
      containerUsedBytes: number | null;
      containerLimitBytes: number | null;
    };
  };
  host: null | {
    generatedAt: string;
    stale: boolean;
    hostname: string;
    uptimeSeconds: number | null;
    load: (number | null)[];
    memory: {
      totalBytes: number | null;
      availableBytes: number | null;
      swapTotalBytes: number | null;
      swapFreeBytes: number | null;
    };
    containers: Container[] | null;
  };
  disks: Disk[];
  disksFrom: "host" | "container" | null;
  database: { ok: boolean; pingMs: number | null; sizeBytes: number | null; error?: string };
  redis: {
    ok: boolean;
    pingMs: number | null;
    usedMemoryBytes: number | null;
    peakMemoryBytes: number | null;
    maxMemoryBytes: number | null;
    error?: string;
  };
  backups: null | {
    count: number;
    totalBytes: number;
    partialCount: number | null;
    newest: null | {
      name: string;
      at: string | null;
      sizeBytes: number | null;
      ageHours: number | null;
    };
  };
  responseTimes: {
    requests: number;
    p50Ms: number | null;
    p95Ms: number | null;
    maxMs: number | null;
    serverErrors: number;
    windowMinutes: number;
  };
}

export interface AdminHealthReport {
  health: HealthSummary;
  problems: Problem[];
  unchecked: string[];
  openAlerts: Record<
    string,
    { title: string; section: string; since: number; lastSentAt: number }
  >;
  telegram: boolean;
}

type Envelope<T> = ApiEnvelope & T;

/** Whether a failed request was the owner-only check saying no (or no such route). */
export const isNotFound = (err: unknown): boolean =>
  err instanceof ApiError && (err.status === 404 || err.status === 401 || err.status === 403);

/**
 * What a failed dashboard request means for the owner. The owner-only check
 * answers a sign-in it no longer accepts with the same 404 as anyone else, so
 * a refusal from a server that answered is "signedOut", never "the server is
 * down"; only no answer at all, or a 5xx (the server or the proxy in front of
 * it failing), is "unreachable".
 */
export type Failure = "signedOut" | "unreachable" | "other";

export const failureKind = (err: unknown): Failure => {
  if (isNotFound(err)) return "signedOut";
  if (err instanceof NetworkError || (err instanceof ApiError && err.status >= 500)) {
    return "unreachable";
  }
  return "other";
};

/**
 * Takes up a newer game sign-in saved in this browser. The dashboard has no
 * sign-in of its own: it sends the game's token, and the server keeps only
 * the newest one per account, so the game opening (which signs in again, here
 * or on another device) ends the token the dashboard started with. True when
 * the saved token is not the one in use, so a refused request is worth one
 * more try with it.
 */
export const adoptNewerSignIn = (): boolean => {
  const before = getAuthToken();
  const session = restoreStoredSession();
  return session !== null && session.token !== before;
};

/** Sends a request, and once more if it was refused and a newer sign-in was found. */
const signedIn = async <T>(request: () => Promise<T>): Promise<T> => {
  try {
    return await request();
  } catch (err) {
    if (isNotFound(err) && adoptNewerSignIn()) return request();
    throw err;
  }
};

const adminGet = <T extends ApiEnvelope>(path: string, query?: FormBody): Promise<T> =>
  signedIn(() => get<T>(path, query));

const adminPost = <T extends ApiEnvelope>(path: string, body: JsonBody): Promise<T> =>
  signedIn(() => postJson<T>(path, body));

export const fetchMe = (): Promise<Envelope<AdminMe>> => adminGet(`${ADMIN}/me`);

export const fetchOverview = (days: number): Promise<Envelope<StatsOverview>> =>
  adminGet(`${ADMIN}/stats/overview`, { days });

export const fetchHealth = (): Promise<Envelope<AdminHealthReport>> => adminGet(`${ADMIN}/health`);

export const fetchBugReports = (
  filter: BugFilter | TicketStatus,
  before?: number,
): Promise<Envelope<{ reports: BugReportSummary[]; nextBefore: number | null }>> =>
  adminGet(`${ADMIN}/bugreports`, { filter, before, limit: 30 });

export const fetchBugReport = (id: number): Promise<Envelope<{ report: BugReportDetail }>> =>
  adminGet(`${ADMIN}/bugreports/${id}`);

export const updateTicket = (
  id: number,
  update: { status?: TicketStatus; notes?: string },
): Promise<Envelope<{ report: BugReportDetail }>> =>
  adminPost(`${ADMIN}/bugreports/${id}/ticket`, update);

/** Writes to the report's player in the game's mail, as "The game team". */
export const replyToReport = (
  id: number,
  message: string,
): Promise<Envelope<{ report: BugReportDetail }>> =>
  adminPost(`${ADMIN}/bugreports/${id}/reply`, { message });

export const searchPlayers = (q: string): Promise<Envelope<{ players: PlayerMatch[] }>> =>
  adminGet(`${ADMIN}/players`, { q });

export const fetchShinyAwards = (
  before?: number,
): Promise<
  Envelope<{
    awards: ShinyAwardView[];
    nextBefore: number | null;
    total: { awards: number; shiny: number };
  }>
> => adminGet(`${ADMIN}/shiny`, { before, limit: 30 });

export const giveShiny = (
  award: ShinyAwardRequest,
): Promise<Envelope<{ award: ShinyAwardView; already: boolean; report?: BugReportDetail }>> =>
  adminPost(`${ADMIN}/shiny`, award);

export const fetchErrors = (
  source: ErrorSource | "all",
  sort: "last" | "count",
): Promise<Envelope<{ groups: ErrorGroup[]; totals: ErrorTotals }>> =>
  adminGet(`${ADMIN}/errors`, { source: source === "all" ? undefined : source, sort, limit: 100 });

/**
 * A bug report's screenshot or added picture, as a blob URL: an `<img src>`
 * cannot send the sign-in header. The caller revokes it when done.
 */
export const fetchReportImage = async (
  id: number,
  which: "screenshot" | "picture",
): Promise<string> => {
  const load = (): Promise<Response> => {
    const token = getAuthToken();
    return fetch(apiUrl(`${ADMIN}/bugreports/${id}/${which}`), {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  };
  let response = await load();
  if (response.status === 404 && adoptNewerSignIn()) response = await load();
  if (!response.ok) throw new Error(`The ${which} could not be loaded (${response.status}).`);
  return URL.createObjectURL(await response.blob());
};
