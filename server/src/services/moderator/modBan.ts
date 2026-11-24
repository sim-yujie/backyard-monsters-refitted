import type { EntityManager } from "@mikro-orm/postgresql";

import { logger } from "../../utils/logger.js";
import { namesOf } from "../alerts/alertFacts.js";
import type { ModStepAlert } from "../alerts/moderationAlerts.js";
import { MAX_MODERATION_REASON, type ModerationEffects } from "../admin/moderation.js";
import { moderatePlayer } from "../admin/moderationInbox.js";
import { REMOVE_LINES_MS } from "../chat/removeChatLines.js";
import { targetRefusal, type TargetRefusal } from "./modReports.js";

/**
 * A moderator's ban (owner, 24 Nov 2026, "mod-ban-grilling"): from the
 * game's Reports window or by tapping a name in chat, so it needs nothing
 * open against the player.
 *
 * - 1, 3 or 7 days only ({@link MOD_BAN_DAYS}); longer and permanent bans
 *   stay the owner's, on the dashboard.
 * - Never on a moderator, a game team account or themselves (the mute rule).
 * - A reason is required: the player sees it when signed out and at every
 *   sign-in; the dashboard and Telegram show it too.
 * - Never shortens a ban already on: a longer or permanent one is refused
 *   (`longerBan`) under the player's row lock.
 * - The dashboard's own step (`moderatePlayer`): the player is signed out
 *   at once (game and chat), the step is in `bym.moderation_action` under
 *   the moderator's account number, and everything open against the player
 *   is closed with it.
 * - Optionally takes the player's lines of the last hour out of every
 *   world room's history (`chat/removeChatLines.ts`); `bym.chat_log` keeps them.
 */

/** Ban lengths a moderator may pick, in days. */
export const MOD_BAN_DAYS: readonly number[] = [1, 3, 7];

export interface ModBanRequest {
  readonly days: number;
  readonly reason: string;
  /** Take the player's lines of the last hour out of the chat rooms. */
  readonly removeLines: boolean;
}

type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

/** Reads `{ days: 1 | 3 | 7, reason, removeLines? }`. */
export const parseModBan = (raw: unknown): Parsed<ModBanRequest> => {
  const body = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!reason) return { ok: false, message: "Write a reason: the player sees it." };
  if (reason.length > MAX_MODERATION_REASON) return { ok: false, message: `Keep the reason to ${MAX_MODERATION_REASON} characters.` };
  if (typeof body.days !== "number" || !MOD_BAN_DAYS.includes(body.days)) {
    return { ok: false, message: "A ban is 1 day, 3 days or 7 days." };
  }
  if (body.removeLines !== undefined && typeof body.removeLines !== "boolean") {
    return { ok: false, message: "removeLines is true or false." };
  }
  return { ok: true, value: { days: body.days, reason, removeLines: body.removeLines === true } };
};

/** Takes `userid`'s lines since `since` (ms) out of the rooms; how many went. */
export type RemoveLines = (userid: number, since: number) => Promise<number>;

export type ModBanOutcome =
  | {
      outcome: "done";
      until: Date;
      actionId: number;
      /** The chat case closed with the ban, or null. */
      caseId: number | null;
      closed: { reports: number; filterLines: number };
      /** Lines taken out of the rooms; null when not asked, or when it failed. */
      removedLines: number | null;
    }
  | { outcome: TargetRefusal | "longerBan" | "noPlayer" };

export const banAsModerator = async (
  em: EntityManager,
  actor: number,
  userid: number,
  request: ModBanRequest,
  effects: ModerationEffects,
  removeLines: RemoveLines | null,
  now: Date = new Date(),
): Promise<ModBanOutcome> => {
  const refused = await targetRefusal(em, actor, userid);
  if (refused) {
    logger.warn(`Moderator: ban on user ${userid} by ${actor} refused (${refused})`);
    return { outcome: refused };
  }
  const { done, closed } = await moderatePlayer(
    em,
    userid,
    { kind: "ban", reason: request.reason, length: request.days, chatReportId: null, neverShorten: true },
    actor,
    effects,
    now,
  );
  if (done.outcome !== "done") {
    if (done.outcome === "longerBan") logger.warn(`Moderator: ban ${request.days}d on user ${userid} by ${actor} refused (a longer ban is on)`);
    return { outcome: done.outcome === "gameTeam" ? "gameTeam" : done.outcome === "longerBan" ? "longerBan" : "noPlayer" };
  }

  let removedLines: number | null = null;
  if (request.removeLines && removeLines) {
    try {
      removedLines = await removeLines(userid, now.getTime() - REMOVE_LINES_MS);
    } catch (err) {
      logger.warn(`Moderator: removing user ${userid}'s chat lines after the ban failed: ${err}`);
    }
  }
  logger.info(
    `Moderator: ban ${request.days}d user ${userid} by ${actor}` +
      `${closed ? `: ${closed.reports} reports, ${closed.filterLines} filter lines closed` : ""}` +
      `${removedLines !== null ? `, ${removedLines} chat lines removed` : ""}`,
  );
  return {
    outcome: "done",
    until: done.until!,
    actionId: done.actionId,
    caseId: closed?.caseId ?? null,
    closed: { reports: closed?.reports ?? 0, filterLines: closed?.filterLines ?? 0 },
    removedLines,
  };
};

/** The reported lines of a chat case, newest first, for the Telegram message. */
export const caseLines = async (em: EntityManager, caseId: number | null): Promise<{ text: string; channel: string }[]> => {
  if (caseId === null) return [];
  const rows = await em.execute<{ message: string; channel: string }[]>(
    `SELECT message, channel FROM bym.chat_case_message WHERE case_id = ? ORDER BY message_ts DESC LIMIT 20`,
    [caseId],
  );
  return rows.map((row) => ({ text: row.message, channel: row.channel }));
};

/** The Telegram message's facts for a moderator's ban or mute. */
export const modStepAlertOf = async (
  em: EntityManager,
  step: { kind: "ban" | "mute"; actor: number; userid: number; length: number; reason: string; caseId: number | null; removedLines: number | null },
): Promise<ModStepAlert> => {
  const names = await namesOf(em, [step.actor, step.userid]);
  return {
    kind: step.kind,
    moderator: names.get(step.actor)!,
    player: names.get(step.userid)!,
    length: step.length,
    reason: step.reason,
    lines: await caseLines(em, step.caseId),
    removedLines: step.removedLines,
  };
};
