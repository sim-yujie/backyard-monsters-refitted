import type { EntityManager } from "@mikro-orm/postgresql";

import { DELETED_PLAYER_NAME } from "../privacy/deleteAccount.js";
import { isMailModerator, moderatorsAmong } from "./modMail.js";
import { SUPPORT_SENDER, SUPPORT_SENDER_NAME, SYSTEM_SENDER, SYSTEM_SENDER_NAME } from "./systemSender.js";

/**
 * What the game's live mail check asks (`/player/mailstatus`, owner, beta 7):
 * how many messages are unread (the Mail button's badge, counted as
 * `countUnreadMessage` counts), and the newest unread one sent to the player,
 * for the pop-up: who, the subject, its first words, its thread. Asked when
 * the chat connection says mail came (`mailNudge.ts`), or every so often
 * without one. Mail from a player the player blocked is left out, as the
 * mailbox leaves it out.
 */

/** How much of a message the pop-up shows. */
export const PREVIEW_LENGTH = 60;

/** The newest unread message, as the pop-up shows it. */
export interface LatestMail {
  /** The message's own id, so the game alerts once per message. */
  id: string;
  threadid: number;
  from: number;
  name: string;
  subject: string;
  preview: string;
  /** Unix seconds. */
  time: number;
  /** 1 when the sender is on the moderators list now: the light blue Mod badge. */
  mod: 0 | 1;
  /** 1 for the game's own notice (an attack, a takeover). */
  notice: 0 | 1;
}

export interface MailStatus {
  unread: number;
  latest: LatestMail | null;
  /** 1 when the player is a moderator: their mailbox may write to anyone. */
  mod: 0 | 1;
}

/** A message's first line, cut for the pop-up. */
export const previewText = (text: string | null | undefined): string => {
  const line = (text ?? "").split(/\r?\n/).find((one) => one.trim() !== "")?.trim() ?? "";
  return line.length > PREVIEW_LENGTH ? `${line.slice(0, PREVIEW_LENGTH - 1)}…` : line;
};

/** Whose name a sender goes under. */
const senderName = (from: number, username: string | null): string => {
  if (from === SYSTEM_SENDER) return SYSTEM_SENDER_NAME;
  if (from === SUPPORT_SENDER) return SUPPORT_SENDER_NAME;
  return username ?? DELETED_PLAYER_NAME;
};

export const readMailStatus = async (
  em: EntityManager,
  userid: number,
  blockedUsers: readonly number[],
): Promise<MailStatus> => {
  const blocked = blockedUsers.filter((id) => Number.isInteger(id));
  const notBlocked = blocked.length ? `AND m.userid NOT IN (${blocked.map(() => "?").join(", ")})` : "";
  const [[count], [last], mod] = await Promise.all([
    em.execute<{ unread: number | string }[]>(
      `SELECT count(*) AS unread FROM bym.message
        WHERE (userid = ? AND user_unread = 1) OR (targetid = ? AND target_unread = 1)`,
      [userid, userid],
    ),
    em.execute<
      {
        id: string;
        threadid: number | string;
        userid: number | string;
        username: string | null;
        subject: string | null;
        message: string | null;
        updatetime: number | string;
      }[]
    >(
      `SELECT m.id, m.threadid, m.userid, u.username, m.subject, m.message, m.updatetime
         FROM bym.message m
         LEFT JOIN bym."user" u ON u.userid = m.userid
        WHERE m.targetid = ? AND m.target_unread = 1 ${notBlocked}
        ORDER BY m.updatetime DESC, m.created_at DESC
        LIMIT 1`,
      [userid, ...blocked],
    ),
    isMailModerator(em, userid),
  ]);
  let latest: LatestMail | null = null;
  if (last) {
    const from = Number(last.userid);
    const mods = from > 0 ? await moderatorsAmong(em, [from]) : new Set<number>();
    latest = {
      id: String(last.id),
      threadid: Number(last.threadid),
      from,
      name: senderName(from, last.username),
      subject: last.subject ?? "",
      preview: previewText(last.message),
      time: Number(last.updatetime) || 0,
      mod: mods.has(from) ? 1 : 0,
      notice: from === SYSTEM_SENDER ? 1 : 0,
    };
  }
  return { unread: Number(count?.unread ?? 0), latest, mod: mod ? 1 : 0 };
};
