import { restoreStoredSession } from "@/api/auth";
import {
  ApiError,
  NetworkError,
  apiUrl,
  get,
  getAuthToken,
  postJson,
  send,
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

/** How real players split between the Look and sound choices, over the last `days` days. */
export interface LookTotals {
  days: number;
  /** Players whose game sent its look in the window. */
  reported: number;
  style: { modern: number; classic: number };
  music: { style: number; new: number; flash: number };
  quality: { high: number; medium: number; low: number };
  font: { game: number; clear: number; readable: number };
}

export interface StatsOverview {
  generatedAt: string;
  players: { total: number; activeToday: number; active7: number; active30: number };
  /** Missing from a server older than beta 6. */
  looks?: LookTotals;
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
  /** The Style the player's game last sent (`modern`/`classic`); null before beta 6 or on other clients. */
  look?: string | null;
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
  /** The last few who hit it, newest first. Their addresses are for this page only. */
  reporters: ErrorReporter[];
  /** Points only at code that is not the game's (an extension, an injected script). */
  thirdParty: boolean;
}

export interface ErrorReporter {
  /** Null when not signed in. */
  userid: number | null;
  username: string;
  ip: string;
  lastSeen: string;
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

/** The owner's in-game announcements (server `controllers/announcements/routes.ts`). */
export type AnnouncementStatus = "draft" | "published";

export interface AdminAnnouncement {
  id: number;
  title: string;
  body: string;
  status: AnnouncementStatus;
  startsAt: string | null;
  endsAt: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  imageIds: number[];
  /** Whether players see it now. */
  live: boolean;
  /** How many players pressed "Got it". */
  dismissals: number;
  /** The Shiny each player may claim, 0 for none. */
  shiny: number;
  /** How many players claimed the gift. */
  claims: number;
}

export interface AnnouncementLimits {
  titleMax: number;
  bodyMax: number;
  images: number;
  imageBytesMax: number;
  shinyMax: number;
}

/** What Save sends: a picture already saved by id, or a new one as a data URL. */
export interface AnnouncementForm {
  title: string;
  body: string;
  status: AnnouncementStatus;
  startsAt: string | null;
  endsAt: string | null;
  images: ({ keep: number } | { data: string })[];
  shiny: number;
}

export const fetchAnnouncements = (): Promise<
  Envelope<{ announcements: AdminAnnouncement[]; limits: AnnouncementLimits }>
> => adminGet(`${ADMIN}/announcements`);

export const saveAnnouncement = (
  id: number | null,
  form: AnnouncementForm,
): Promise<Envelope<{ announcement: AdminAnnouncement }>> =>
  id === null
    ? adminPost(`${ADMIN}/announcements`, { ...form })
    : signedIn(() => send("PUT", `${ADMIN}/announcements/${id}`, { json: { ...form } }));

export const deleteAnnouncement = (id: number): Promise<Envelope<{ id: number }>> =>
  signedIn(() => send("DELETE", `${ADMIN}/announcements/${id}`));

/** A saved picture (drafts' too), as a blob URL; the caller revokes it. */
export const fetchAnnouncementImage = async (id: number): Promise<string> => {
  const load = (): Promise<Response> => {
    const token = getAuthToken();
    return fetch(apiUrl(`${ADMIN}/announcements/images/${id}`), {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  };
  let response = await load();
  if (response.status === 404 && adoptNewerSignIn()) response = await load();
  if (!response.ok) throw new Error(`The picture could not be loaded (${response.status}).`);
  return URL.createObjectURL(await response.blob());
};

/**
 * Moderation (server `services/admin/moderation.ts`): warn, pause chat
 * (mute), ban, and lifting a ban or pause; a player's log; chat reports.
 */
export type ModerationKind = "warn" | "mute" | "unmute" | "ban" | "unban";

/** The longest reason the server keeps (`MAX_MODERATION_REASON`). */
export const MAX_MODERATION_REASON = 300;

/** One step in a player's moderation log. */
export interface ModerationEntry {
  id: number;
  action: ModerationKind;
  reason: string;
  /** A ban's or mute's end; null for good (a ban) or no end (the rest). */
  until: string | null;
  by: number;
  byName: string | null;
  chatReportId: number | null;
  /** When the player closed the pop-up (warnings and mutes). */
  seenAt: string | null;
  at: string;
}

/** A player as the moderation view shows them. */
export interface PlayerModeration {
  userid: number;
  username: string;
  lastSeenAt: string | null;
  /** The Style the player's game last sent (`modern`/`classic`); null before beta 6 or on other clients. */
  look?: string | null;
  banned: boolean;
  /** Null while `banned`: for good. */
  banUntil: string | null;
  banReason: string | null;
  /** Only while the pause lasts. */
  muteUntil: string | null;
  /** A game team account: cannot be warned, paused or banned. */
  gameTeam: boolean;
  reportsAgainst: number;
  log: ModerationEntry[];
}

/** One chat report, newest first in the list. */
export interface ChatReportView {
  id: number;
  reporter: { userid: number; username: string | null };
  reported: { userid: number; username: string | null; banned: boolean; muted: boolean };
  channel: string;
  message: string;
  /** When the line was said (ms). */
  messageTs: number;
  /** The words match the chat server's own copy of the line. */
  verified: boolean;
  reportsAgainst: number;
  /** The steps taken from this report, oldest first. */
  actions: ModerationKind[];
  at: string;
}

/** What a moderation step sends: a reason, and a ban's days (null for good) or a mute's hours. */
export interface ModerationBody {
  reason?: string;
  days?: number | null;
  hours?: number;
  chatReportId?: number;
}

/** The chat panel's sign-in: the chat server, the owner's chat token and the rooms to join. */
export interface AdminChatSession {
  server: string;
  userId: number;
  token: string;
  rooms: { channel: string; label: string }[];
}

export const fetchChatReports = (
  before?: number,
): Promise<Envelope<{ reports: ChatReportView[]; nextBefore: number | null }>> =>
  adminGet(`${ADMIN}/chatreports`, { before, limit: 30 });

export const fetchPlayerModeration = (
  id: number,
): Promise<Envelope<{ player: PlayerModeration }>> => adminGet(`${ADMIN}/players/${id}/moderation`);

export const moderatePlayer = (
  id: number,
  kind: ModerationKind,
  body: ModerationBody,
): Promise<Envelope<{ player: PlayerModeration }>> =>
  adminPost(`${ADMIN}/players/${id}/${kind}`, { ...body });

/**
 * Automatic chat flags and the chat log (server
 * `services/admin/chatWatchAdmin.ts`): lines the word filter caught, one row
 * per player, with the player's own words.
 */
export type FlagSeverity = "slur" | "swear";

/** One flagged line. */
/** How a flagged word was written: as listed, or disguised. */
export type FlagRule = "word" | "disguised";

export interface FlagLine {
  id: number;
  channel: string;
  /** The player's own words. */
  message: string;
  /** What other players saw. */
  shown: string;
  words: string[];
  severity: FlagSeverity;
  /** `word`: a listed word as typed; `disguised`: spelled to get past the filter ("fvck", "f u c k"). */
  rule: FlagRule;
  at: string;
}

/** A flagged player: open flags counted, newest lines first. */
export interface FlaggedPlayer {
  userid: number;
  username: string | null;
  banned: boolean;
  muted: boolean;
  count: number;
  slurs: number;
  /** Dismissing up to this id leaves any flag that came in since. */
  lastId: number;
  latestAt: string;
  lines: FlagLine[];
}

export type FlagSort = "latest" | "serious";

export const fetchChatFlags = (
  options: { sort?: FlagSort; slursOnly?: boolean; userid?: number; offset?: number | undefined } = {},
): Promise<Envelope<{ players: FlaggedPlayer[]; nextOffset: number | null }>> =>
  adminGet(`${ADMIN}/chatflags`, {
    sort: options.sort,
    slurs: options.slursOnly ? "1" : undefined,
    userid: options.userid,
    offset: options.offset,
    limit: 30,
  });

export const dismissChatFlags = (userid: number, upTo: number): Promise<Envelope<{ dismissed: number }>> =>
  adminPost(`${ADMIN}/chatflags/${userid}/dismiss`, { upTo });

/** One line of the chat log. */
export interface ChatLogEntry {
  id: number;
  userid: number;
  username: string | null;
  channel: string;
  message: string;
  shown: string;
  flagged: FlagSeverity | null;
  at: string;
}

export interface ChatLogQuery {
  userid?: number;
  /** A player's whole name, any case. */
  player?: string;
  /** Words in the line. */
  q?: string;
  channel?: string;
  /** Lines said at or before this time (ms). */
  until?: number;
  flagged?: boolean;
  before?: number | undefined;
}

export const fetchChatLog = (
  query: ChatLogQuery,
): Promise<Envelope<{ lines: ChatLogEntry[]; nextBefore: number | null }>> =>
  adminGet(`${ADMIN}/chatlog`, {
    userid: query.userid,
    player: query.player,
    q: query.q,
    channel: query.channel,
    until: query.until,
    flagged: query.flagged ? "1" : undefined,
    before: query.before,
    limit: 30,
  });

export const fetchChatSession = (): Promise<Envelope<AdminChatSession>> =>
  adminPost(`${ADMIN}/chat/session`, {});

/**
 * Chat report cases (server `services/admin/chatCases.ts`): every report of
 * the same line, and every reported line of a player not yet acted on, as one
 * case, with a text copy of the room around each line.
 */
export type CaseStatus = "open" | "actioned" | "dismissed";
export type CaseOutcome = "warn" | "mute" | "dismiss";

export interface SnapshotLine {
  userid: number;
  name: string | null;
  text: string;
  /** When it was said (ms). */
  at: number;
  reported?: true;
  flagged?: FlagSeverity;
}

/** `log`: the players' own words; `room`: as players saw them (starred out); `none`: no copy. */
export interface CaseSnapshot {
  source: "log" | "room" | "none";
  lines: SnapshotLine[];
}

export interface CaseMessage {
  id: number;
  channel: string;
  message: string;
  ts: number;
  verified: boolean;
  reporters: number[];
  snapshot: CaseSnapshot;
}

export interface CaseReporter {
  userid: number;
  username: string | null;
  at: string;
  first: boolean;
  late: boolean;
  award: { amount: number; at: string } | null;
}

export interface CaseHistory {
  cases: number;
  flags: number;
  warnings: number;
  mutes: number;
  bans: number;
}

export interface ChatCaseView {
  id: number;
  status: CaseStatus;
  reported: { userid: number; username: string | null; banned: boolean; muted: boolean; gameTeam: boolean };
  messages: CaseMessage[];
  reporters: CaseReporter[];
  reports: number;
  firstReportAt: string;
  lastReportAt: string;
  history: CaseHistory;
  suggest: { action: "warn" | "mute"; hours: number | null };
  closed: {
    outcome: CaseOutcome;
    hours: number | null;
    note: string | null;
    by: number;
    byName: string | null;
    at: string;
  } | null;
}

export interface CaseList {
  cases: ChatCaseView[];
  nextOffset: number | null;
  /** Open cases in all. */
  open: number;
  /** The Shiny offered each reporter, and the first one. */
  award: { each: number; first: number };
}

export type CaseActionBody =
  | { action: "warn"; reason: string }
  | { action: "mute"; reason: string; hours: number }
  | { action: "dismiss"; note?: string };

export const fetchChatCases = (status: "open" | "closed", offset?: number): Promise<Envelope<CaseList>> =>
  adminGet(`${ADMIN}/chatcases`, { status, offset, limit: 30 });

export const actOnCase = (id: number, body: CaseActionBody): Promise<Envelope<{ case: ChatCaseView }>> =>
  adminPost(`${ADMIN}/chatcases/${id}/act`, { ...body });

export type AwardFailure = "notReporter" | "noPlayer" | "noMainYard";

export const awardCaseReporters = (
  id: number,
  awards: { userid: number; amount: number }[],
): Promise<
  Envelope<{
    case: ChatCaseView;
    given: { userid: number; amount: number }[];
    already: number[];
    failed: { userid: number; reason: AwardFailure }[];
  }>
> => adminPost(`${ADMIN}/chatcases/${id}/award`, { awards });

/* ── Weekend events (`server/src/controllers/admin/weekend.ts`) ─────────── */

export type WeekendEventId = "builders" | "plunder" | "study" | "hatch";

export interface WeekendSettingsView {
  enabled: boolean;
  rotation: WeekendEventId[];
  percent: Record<WeekendEventId, number>;
  /** `YYYY-MM-DD`, a Saturday. */
  firstWeekend: string;
  utcOffsetMinutes: number;
  lengthHours: number;
  announceHours: number;
  overrides: Record<string, WeekendEventId | "skip">;
  forced: { id: WeekendEventId; since: number; until: number } | null;
}

export interface WeekendRunView {
  id: WeekendEventId;
  title: string;
  line: string;
  percent: number;
  key: string;
  startsAt: number;
  endsAt: number;
  announceAt: number;
  forced: boolean;
}

export interface WeekendPlanRowView {
  key: string;
  startsAt: number;
  rotation: WeekendEventId | null;
  override: WeekendEventId | "skip" | null;
  runs: WeekendEventId | null;
}

export interface WeekendPanelView {
  now: number;
  settings: WeekendSettingsView;
  updatedAt: number | null;
  updatedBy: number | null;
  state: { active: WeekendRunView | null; next: WeekendRunView | null };
  plan: WeekendPlanRowView[];
  /** A local `WEEKEND_FORCE` the server was started with (never in production). */
  envForced: WeekendEventId | null;
  events: { id: WeekendEventId; title: string; line: string }[];
  limits: {
    minPercent: number;
    maxPercent: number;
    minOffsetMinutes: number;
    maxOffsetMinutes: number;
    minLengthHours: number;
    maxLengthHours: number;
    maxAnnounceHours: number;
    maxForceHours: number;
  };
}

/** One change from the dashboard; the server checks every value again. */
export type WeekendChange =
  | {
      action: "settings";
      enabled?: boolean;
      rotation?: WeekendEventId[];
      percent?: Partial<Record<WeekendEventId, number>>;
      firstWeekend?: string;
      utcOffsetMinutes?: number;
      lengthHours?: number;
      announceHours?: number;
    }
  | { action: "weekend"; weekend: string; event: WeekendEventId | "skip" | null }
  | { action: "force"; event: WeekendEventId; hours: number }
  | { action: "stopForce" }
  | { action: "reset" };

export const fetchWeekend = (): Promise<Envelope<WeekendPanelView>> => adminGet(`${ADMIN}/weekend`);

export const changeWeekend = (change: WeekendChange): Promise<Envelope<WeekendPanelView>> =>
  adminPost(`${ADMIN}/weekend`, change as unknown as JsonBody);
