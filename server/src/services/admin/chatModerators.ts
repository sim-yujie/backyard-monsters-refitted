import type { EntityManager } from "@mikro-orm/postgresql";

import { isAdminUser } from "../../config/AdminConfig.js";
import { logger } from "../../utils/logger.js";

/**
 * Chat moderators (owner, 7 Nov 2026): players the owner adds on the
 * dashboard's Moderators list. In chat their lines carry a blue [Mod] badge
 * (`chat/chatModerators.ts`); they get no other powers and no dashboard.
 *
 * Kept in `bym.chat_moderator` (migration `20261109_AddChatModerators.ts`).
 * A change takes effect at once: the route tells the chat gateway to read
 * the list again ({@link ModeratorEffects}). Each add and remove is in the
 * server log, like the other dashboard actions.
 */

/** One moderator as the dashboard lists them. */
export interface ModeratorView {
  userid: number;
  username: string;
  /** Who added them, and their name now (null when that account is gone). */
  addedBy: number;
  addedByName: string | null;
  addedAt: string;
}

/** What a change asks for outside the database: the chat gateway reads the list again. */
export interface ModeratorEffects {
  changed(): Promise<void>;
}

type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

/** The longest thing the add box takes: a username is at most 12 characters, an account number 9 digits. */
const MAX_PLAYER_TEXT = 40;

/**
 * Reads the add box: `{ player }`, a player's name or account number
 * (`2503` or `#2503`). A name is matched whole, ignoring case.
 */
export const parseModeratorAdd = (raw: unknown): Parsed<{ player: string }> => {
  const body = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const player = typeof body.player === "string" ? body.player.trim() : "";
  if (player === "") return { ok: false, message: "Type a player's name or account number." };
  if (player.length > MAX_PLAYER_TEXT) return { ok: false, message: "That is too long for a player's name." };
  return { ok: true, value: { player } };
};

const asNumber = (text: string): number | null => {
  const match = /^#?(\d{1,9})$/.exec(text);
  return match ? Number(match[1]) : null;
};

/** The account numbers on the list, for the chat gateway. */
export const readModeratorIds = async (em: EntityManager): Promise<number[]> => {
  const rows = await em.execute<{ userid: number | string }[]>(`SELECT userid FROM bym.chat_moderator`);
  return rows.map((row) => Number(row.userid));
};

/** Everyone on the list, by name. */
export const listModerators = async (em: EntityManager): Promise<ModeratorView[]> => {
  const rows = await em.execute<
    { userid: number | string; username: string; added_by: number | string; added_by_name: string | null; created_at: Date | string }[]
  >(
    `SELECT m.userid, u.username, m.added_by, a.username AS added_by_name, m.created_at
       FROM bym.chat_moderator m
       JOIN bym."user" u ON u.userid = m.userid
       LEFT JOIN bym."user" a ON a.userid = m.added_by
      ORDER BY lower(u.username), m.userid`,
  );
  return rows.map((row) => ({
    userid: Number(row.userid),
    username: row.username,
    addedBy: Number(row.added_by),
    addedByName: row.added_by_name,
    addedAt: new Date(row.created_at).toISOString(),
  }));
};

export type AddModeratorOutcome =
  | { outcome: "added"; moderator: ModeratorView }
  | { outcome: "noPlayer" | "gameTeam" | "already"; username?: string };

/**
 * Adds the player named `player` (a name or account number). Refused when
 * there is no such player, when it is a game team account (it already shows
 * GM, which wins over Mod), or when they are on the list already.
 */
export const addModerator = async (
  em: EntityManager,
  player: string,
  adminId: number,
  effects: ModeratorEffects,
  now: Date = new Date(),
): Promise<AddModeratorOutcome> => {
  const number = asNumber(player);
  const [target] = await em.execute<{ userid: number | string; username: string }[]>(
    number !== null
      ? `SELECT userid, username FROM bym."user" WHERE userid = ? OR lower(username) = lower(?) ORDER BY (userid = ?) DESC LIMIT 1`
      : `SELECT userid, username FROM bym."user" WHERE lower(username) = lower(?) LIMIT 1`,
    number !== null ? [number, player, number] : [player],
  );
  if (!target) return { outcome: "noPlayer" };
  const userid = Number(target.userid);
  if (isAdminUser(userid)) return { outcome: "gameTeam", username: target.username };

  const inserted = await em.execute<{ userid: number | string }[]>(
    `INSERT INTO bym.chat_moderator (userid, added_by, created_at) VALUES (?, ?, ?)
       ON CONFLICT (userid) DO NOTHING RETURNING userid`,
    [userid, adminId, now],
  );
  if (inserted.length === 0) return { outcome: "already", username: target.username };

  logger.info(`Dashboard: mod add user ${userid} by ${adminId}`);
  await effects.changed();
  const moderator = (await listModerators(em)).find((m) => m.userid === userid);
  return { outcome: "added", moderator: moderator! };
};

/** Takes `userid` off the list; false when they were not on it. */
export const removeModerator = async (
  em: EntityManager,
  userid: number,
  adminId: number,
  effects: ModeratorEffects,
): Promise<boolean> => {
  const removed = await em.execute<{ userid: number | string }[]>(
    `DELETE FROM bym.chat_moderator WHERE userid = ? RETURNING userid`,
    [userid],
  );
  if (removed.length === 0) return false;
  logger.info(`Dashboard: mod remove user ${userid} by ${adminId}`);
  await effects.changed();
  return true;
};
