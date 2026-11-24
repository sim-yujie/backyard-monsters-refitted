import {
  alertConfig,
  CHAT_FLAG_ALERTS_PER_HOUR,
  CHAT_REPORT_ALERTS_PER_HOUR,
  dashboardLink,
  dashboardPlayerLink,
  NEW_PHOTO_ALERTS_PER_HOUR,
  type AlertConfig,
} from "../../config/AlertConfig.js";
import { CHANNELS, COUNTRY_CHANNEL_PREFIX, GLOBAL_CHAT_CHANNEL, INFERNO_CHAT_CHANNEL, LEGACY_MR1_CHAT_CHANNEL } from "../../config/ChatConfig.js";
import { MapRoomVersion } from "../../enums/MapRoom.js";
import { logger } from "../../utils/logger.js";
import { HourlyCap, hourWords, untilHourEnds, type CapSummary } from "./hourlyCap.js";
import { sendTelegram, type SendTelegram } from "./telegram.js";

/**
 * Telegram messages that let the owner watch moderators and chat (owner,
 * 24 Nov 2026; docs/alerts.md):
 *
 * - (a) every moderator ban and mute: who, to whom, how long, the reason,
 *   the reported lines, and the dashboard list where it can be undone;
 * - (b) each chat-filter flag, at most {@link CHAT_FLAG_ALERTS_PER_HOUR} an
 *   hour, the rest summed up when the hour ends ({@link alertChatFlag}, for
 *   the chat filter to call);
 * - (c) each player's chat report, with the reported line;
 * - (d) a brand-new account (first hour) uploading a profile photo: the
 *   name and a dashboard link, never the photo.
 *
 * These carry usernames and chat lines (the owner's choice); never an email,
 * an address or an IP hash. Each never throws and never fails the step that
 * set it off. Plain text: a player's words can never become markup.
 */

/** Where a held-back count's timer is set; tests pass their own. */
export type Schedule = (run: () => void, ms: number) => void;

const defaultSchedule: Schedule = (run, ms) => {
  const timer = setTimeout(run, ms);
  (timer as { unref?: () => void }).unref?.();
};

export interface AlertDeps {
  readonly config?: AlertConfig;
  readonly send?: SendTelegram;
  readonly now?: number;
  readonly schedule?: Schedule;
}

/** A player in a message: their name, or their number when the name is gone. */
export interface Named {
  readonly userid: number;
  readonly username: string | null;
}

const nameOf = (player: Named): string => player.username || `#${player.userid}`;

/** The longest chat line quoted in a message. */
export const QUOTE_MAX = 200;

const quote = (text: string): string => {
  const flat = text.replace(/\s+/g, " ").trim();
  return `"${flat.length > QUOTE_MAX ? `${flat.slice(0, QUOTE_MAX - 1)}…` : flat}"`;
};

/** A room's name in words: "Global", "Map Room 3", "Inferno", "country room PH". */
export const roomWords = (channel: string): string => {
  if (channel === GLOBAL_CHAT_CHANNEL) return "Global";
  if (channel === CHANNELS[MapRoomVersion.V3]) return "Map Room 3";
  if (channel === INFERNO_CHAT_CHANNEL) return "Inferno";
  if (channel === LEGACY_MR1_CHAT_CHANNEL) return "Map Room 1 (old room)";
  if (channel.startsWith(COUNTRY_CHANNEL_PREFIX)) return `country room ${channel.slice(COUNTRY_CHANNEL_PREFIX.length).toUpperCase()}`;
  return channel;
};

/** "1 hour", "1 day", "3 days". */
export const hoursWords = (hours: number): string =>
  hours % 24 === 0 ? `${hours / 24} day${hours === 24 ? "" : "s"}` : `${hours} hour${hours === 1 ? "" : "s"}`;

const join = (...lines: (string | null | undefined | false)[]): string => lines.filter(Boolean).join("\n");

const trySend = async (send: SendTelegram, text: string, what: string): Promise<boolean> => {
  try {
    const outcome = await send(text);
    if (!outcome.sent) logger.warn(`Alerts: the Telegram message for ${what} failed: ${outcome.reason}`);
    return outcome.sent;
  } catch (err) {
    logger.warn(`Alerts: the Telegram message for ${what} failed: ${err}`);
    return false;
  }
};

const senderOf = (deps: AlertDeps, config: AlertConfig): SendTelegram =>
  deps.send ?? ((message: string) => sendTelegram(message, { config }));

// ---------------------------------------------------------------- (a)

/** One moderator ban or mute. */
export interface ModStepAlert {
  readonly kind: "ban" | "mute";
  readonly moderator: Named;
  readonly player: Named;
  /** A ban's days, or a mute's hours. */
  readonly length: number;
  readonly reason: string;
  /** The reported lines closed with it, newest first. */
  readonly lines: readonly { readonly text: string; readonly channel: string }[];
  /** Lines taken out of the rooms (ban with "remove lines"), or null when not asked. */
  readonly removedLines: number | null;
}

/** At most this many reported lines in one message. */
export const MOD_STEP_LINES = 3;

export const modStepText = (step: ModStepAlert, config: AlertConfig): string => {
  const what =
    step.kind === "ban"
      ? `banned ${nameOf(step.player)} for ${hoursWords(step.length * 24)}`
      : `muted ${nameOf(step.player)}'s chat for ${hoursWords(step.length)}`;
  const shown = step.lines.slice(0, MOD_STEP_LINES);
  const more = step.lines.length - shown.length;
  const link = dashboardLink("moderators", config);
  return join(
    `BYMR moderator: ${nameOf(step.moderator)} ${what}.`,
    `Reason: ${step.reason.replace(/\s+/g, " ").trim()}`,
    shown.length > 0 && "Reported lines:",
    ...shown.map((line) => `- ${roomWords(line.channel)}: ${quote(line.text)}`),
    more > 0 && `- and ${more} more`,
    step.removedLines !== null && `Removed ${step.removedLines} of their chat line${step.removedLines === 1 ? "" : "s"} from the last hour.`,
    link && `Undo it on the dashboard: ${link}`,
  );
};

/** Says one moderator ban or mute. Not capped: every one is said. */
export const alertModStep = async (step: ModStepAlert, deps: AlertDeps = {}): Promise<boolean> => {
  const config = deps.config ?? alertConfig();
  if (!config.telegram) return false;
  return trySend(senderOf(deps, config), modStepText(step, config), `the ${step.kind} of user ${step.player.userid}`);
};

// ------------------------------------------------- capped kinds (b-d)

interface CappedKind {
  readonly cap: HourlyCap;
  /** Added to the hour's last message. */
  readonly lastWords: string;
  readonly summary: (held: CapSummary, config: AlertConfig) => string;
}

/** Sends one capped message, the ended hour's summary first, and starts the summary's timer when it holds one back. */
const sendCapped = async (kind: CappedKind, text: (config: AlertConfig) => string, what: string, deps: AlertDeps): Promise<boolean> => {
  const config = deps.config ?? alertConfig();
  if (!config.telegram) return false;
  const send = senderOf(deps, config);
  const now = deps.now ?? Date.now();
  const turn = kind.cap.take(now);
  if (turn.missed) await trySend(send, kind.summary(turn.missed, config), `${what} (summary)`);
  if (turn.startSummary) {
    const at = now + untilHourEnds(now);
    (deps.schedule ?? defaultSchedule)(() => {
      const held = kind.cap.summary(at);
      if (held) void trySend(send, kind.summary(held, config), `${what} (summary)`);
    }, at - now);
  }
  if (!turn.send) return false;
  const body = text(config);
  return trySend(send, turn.last ? `${body}\n${kind.lastWords}` : body, what);
};

const lastWords = (perHour: number, plural: string) =>
  `(That is ${perHour} ${plural} this hour: the rest of this hour are counted and summed up when it ends.)`;

// ---------------------------------------------------------------- (b)

/** One line the chat filter flagged (the filter's own words for why). */
export interface ChatFlagAlert extends Named {
  readonly channel: string;
  readonly text: string;
  /** Why the filter flagged it, in a few words ("link to another server"). */
  readonly why: string;
}

const chatFlags: CappedKind = {
  cap: new HourlyCap(CHAT_FLAG_ALERTS_PER_HOUR),
  lastWords: lastWords(CHAT_FLAG_ALERTS_PER_HOUR, "flags"),
  summary: (held, config) =>
    join(
      `BYMR chat filter: ${held.count} more flag${held.count === 1 ? "" : "s"} ${hourWords(held.from)}, not sent one by one.`,
      dashboardLink("moderation", config),
    ),
};

export const chatFlagText = (flag: ChatFlagAlert, config: AlertConfig): string =>
  join(
    `BYMR chat filter: ${nameOf(flag)} in ${roomWords(flag.channel)}`,
    quote(flag.text),
    `Why: ${flag.why}`,
    dashboardPlayerLink(flag.userid, config),
  );

/**
 * Says one chat-filter flag: at most {@link CHAT_FLAG_ALERTS_PER_HOUR} an
 * hour; the rest are counted and one message sums them up when the hour ends.
 * For the chat filter (not built yet) to call; never throws.
 *
 * @returns {Promise<boolean>} Whether a message about this flag went.
 */
export const alertChatFlag = (flag: ChatFlagAlert, deps: AlertDeps = {}): Promise<boolean> =>
  sendCapped(chatFlags, (config) => chatFlagText(flag, config), `the chat flag on user ${flag.userid}`, deps);

// ---------------------------------------------------------------- (c)

/** One stored chat report. */
export interface ChatReportAlert {
  readonly reporter: Named;
  readonly reported: Named;
  readonly channel: string;
  /** The server's copy of the line, or the reporter's when the line had left the room. */
  readonly text: string;
  readonly verified: boolean;
}

const chatReports: CappedKind = {
  cap: new HourlyCap(CHAT_REPORT_ALERTS_PER_HOUR),
  lastWords: lastWords(CHAT_REPORT_ALERTS_PER_HOUR, "reports"),
  summary: (held, config) =>
    join(
      `BYMR chat reports: ${held.count} more report${held.count === 1 ? "" : "s"} ${hourWords(held.from)}, not sent one by one.`,
      dashboardLink("moderation", config),
    ),
};

export const chatReportText = (report: ChatReportAlert, config: AlertConfig): string =>
  join(
    `BYMR chat report: ${nameOf(report.reporter)} reported ${nameOf(report.reported)} in ${roomWords(report.channel)}`,
    report.verified ? quote(report.text) : `${quote(report.text)} (the reporter's copy: the line had left the room)`,
    dashboardPlayerLink(report.reported.userid, config),
  );

/** Says one player's chat report (at most {@link CHAT_REPORT_ALERTS_PER_HOUR} an hour). */
export const alertChatReport = (report: ChatReportAlert, deps: AlertDeps = {}): Promise<boolean> =>
  sendCapped(chatReports, (config) => chatReportText(report, config), `the chat report on user ${report.reported.userid}`, deps);

// ---------------------------------------------------------------- (d)

/** A new account's photo upload. */
export interface NewPhotoAlert extends Named {
  /** How long ago the account joined (ms). */
  readonly age: number;
}

const newPhotos: CappedKind = {
  cap: new HourlyCap(NEW_PHOTO_ALERTS_PER_HOUR),
  lastWords: lastWords(NEW_PHOTO_ALERTS_PER_HOUR, "new-account photos"),
  summary: (held, config) =>
    join(
      `BYMR new account photos: ${held.count} more ${hourWords(held.from)}, not sent one by one.`,
      dashboardLink("moderation", config),
    ),
};

export const newPhotoText = (upload: NewPhotoAlert, config: AlertConfig): string => {
  const minutes = Math.max(1, Math.round(upload.age / 60_000));
  return join(
    `BYMR new account photo: ${nameOf(upload)} (joined ${minutes} minute${minutes === 1 ? "" : "s"} ago) uploaded a profile photo.`,
    dashboardPlayerLink(upload.userid, config),
  );
};

/** Says a brand-new account's photo upload; never the photo (at most {@link NEW_PHOTO_ALERTS_PER_HOUR} an hour). */
export const alertNewPhoto = (upload: NewPhotoAlert, deps: AlertDeps = {}): Promise<boolean> =>
  sendCapped(newPhotos, (config) => newPhotoText(upload, config), `the new photo of user ${upload.userid}`, deps);

/** For tests: forget every hour's count. */
export const resetModerationAlertCounts = (): void => {
  chatFlags.cap.reset();
  chatReports.cap.reset();
  newPhotos.cap.reset();
};
