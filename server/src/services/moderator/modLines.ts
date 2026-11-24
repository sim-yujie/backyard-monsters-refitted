import type { EntityManager } from "@mikro-orm/postgresql";

import { ALLIANCE_CHANNEL_PREFIX } from "../../config/ChatConfig.js";
import { NEW_PLAYER_MS } from "../chat/chatFilter.js";
import type { LineRef } from "../chat/removeChatLines.js";
import { logger } from "../../utils/logger.js";
import { targetRefusal, type TargetRefusal } from "./modReports.js";

/**
 * A moderator's Remove (chat filter, owner 24 Nov 2026, removed line A): a
 * line leaves every open chat box and the room's history, name and all
 * (`chat/removeChatLines.ts`). The step is kept in `bym.chat_line_removal`
 * (who, which line, when) so the Reports window can say who removed it; the
 * line itself stays in the chat log, its flag and any report, as evidence.
 *
 * Also the facts the Reports window shows beside a new player: their main
 * yard's age ("New · 30h", {@link newHoursOf}).
 */

/** One line to remove, as the Reports window names it: room and stamp, and its id when it has one. */
export interface RemoveLineRequest {
  readonly channel: string;
  readonly ts: number;
  readonly lineId: string | null;
}

/** At most this many lines in one Remove (a new player's repeated line, grouped). */
export const MAX_REMOVE_LINES = 20;

type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

/** A public room's key: World, Map Room 3, the Inferno or a country room; never an alliance's. */
const isPublicRoom = (channel: string): boolean =>
  /^chat:[a-z0-9:_-]{1,56}$/i.test(channel) && !channel.startsWith(ALLIANCE_CHANNEL_PREFIX);

/** A JSON body's array arrives as a string (`middleware/jsonBody.ts`); either is read. */
const arrayOf = (raw: unknown): unknown[] => {
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

/** Reads `{ lines: [{ channel, ts, lineId? }] }`. */
export const parseRemoveLines = (raw: unknown): Parsed<RemoveLineRequest[]> => {
  const body = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const lines = arrayOf(body.lines);
  if (lines.length === 0) return { ok: false, message: "Pick a line to remove." };
  if (lines.length > MAX_REMOVE_LINES) return { ok: false, message: `Remove at most ${MAX_REMOVE_LINES} lines at once.` };
  const out: RemoveLineRequest[] = [];
  for (const item of lines) {
    const line = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const channel = typeof line.channel === "string" ? line.channel : "";
    const ts = typeof line.ts === "number" && Number.isSafeInteger(line.ts) && line.ts > 0 ? line.ts : null;
    const lineId = typeof line.lineId === "string" && /^[a-z0-9]{1,24}$/i.test(line.lineId) ? line.lineId : null;
    if (!isPublicRoom(channel) || ts === null) return { ok: false, message: "That line can't be removed." };
    out.push({ channel, ts, lineId });
  }
  return { ok: true, value: out };
};

/** Takes one line out of chat (`removeChatLine`); how many history entries went. */
export type RemoveLine = (channel: string, line: LineRef) => Promise<number>;

export type RemoveOutcome = { outcome: "done"; removed: number } | { outcome: TargetRefusal };

export const removeAsModerator = async (
  em: EntityManager,
  actor: number,
  userid: number,
  lines: readonly RemoveLineRequest[],
  removeLine: RemoveLine,
): Promise<RemoveOutcome> => {
  const refused = await targetRefusal(em, actor, userid);
  if (refused) {
    logger.warn(`Moderator: removing a line of user ${userid} by ${actor} refused (${refused})`);
    return { outcome: refused };
  }
  let removed = 0;
  for (const line of lines) {
    removed += await removeLine(line.channel, { userId: userid, ts: line.ts, id: line.lineId });
    await em.execute(
      `INSERT INTO bym.chat_line_removal (userid, channel, message_ts, line_id, removed_by) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT ("userid", "channel", "message_ts") DO NOTHING`,
      [userid, line.channel, line.ts, line.lineId, actor],
    );
  }
  logger.info(`Moderator: ${lines.length} chat line(s) of user ${userid} removed by ${actor} (${removed} from rooms' history)`);
  return { outcome: "done", removed };
};

/** A removed line, as the Reports window marks it. */
export interface Removal {
  readonly byName: string | null;
  readonly at: string;
}

const removalKey = (channel: string, ts: number): string => `${channel}|${ts}`;

/** The player's removed lines, by room and stamp. */
export const removalsOf = async (em: EntityManager, userid: number): Promise<Map<string, Removal>> => {
  const rows = await em.execute<{ channel: string; message_ts: string | number; by_name: string | null; created_at: Date | string }[]>(
    `SELECT r.channel, r.message_ts, u.username AS by_name, r.created_at
       FROM bym.chat_line_removal r LEFT JOIN bym."user" u ON u.userid = r.removed_by
      WHERE r.userid = ?`,
    [userid],
  );
  return new Map(
    rows.map((row) => [removalKey(row.channel, Number(row.message_ts)), { byName: row.by_name, at: new Date(row.created_at).toISOString() }]),
  );
};

export const removalOf = (removals: ReadonlyMap<string, Removal>, channel: string, ts: number): Removal | null =>
  removals.get(removalKey(channel, ts)) ?? null;

/**
 * Each player's main yard age in whole hours while it is younger than three
 * days (the chat filter's new player), for "New · 30h"; players with an
 * older yard are left out.
 */
export const newHoursOf = async (em: EntityManager, userids: readonly number[], now: Date = new Date()): Promise<Map<number, number>> => {
  if (userids.length === 0) return new Map();
  const since = new Date(now.getTime() - NEW_PLAYER_MS);
  const rows = await em.execute<{ userid: number | string; created_at: Date | string }[]>(
    `SELECT u.userid, s.created_at FROM bym."user" u JOIN bym.save s ON s.basesaveid = u.save_basesaveid
      WHERE u.userid IN (${userids.map(() => "?").join(", ")}) AND s.created_at > ?`,
    [...userids, since],
  );
  return new Map(
    rows.map((row) => [Number(row.userid), Math.max(0, Math.floor((now.getTime() - new Date(row.created_at).getTime()) / 3_600_000))]),
  );
};
