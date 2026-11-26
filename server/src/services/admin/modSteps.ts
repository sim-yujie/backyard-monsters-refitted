import type { EntityManager } from "@mikro-orm/postgresql";

import { adminUserIds } from "../../config/AdminConfig.js";

/**
 * The dashboard's list of moderators' bans and mutes (owner, 24 Nov 2026):
 * every `ban` and `mute` in `bym.moderation_action` done by an account that
 * is not a game team account (`ADMIN_USER_IDS`), so a moderator removed
 * since still shows. Newest first, with what became of each:
 *
 * - `on`: still in force;
 * - `ended`: ran out;
 * - `undone`: lifted later (an unban or unmute), by whom;
 * - `permanent`: a later ban for good (Make permanent);
 * - `replaced`: a later ban or mute (by anyone) took its place.
 *
 * The page's Undo and Make permanent are the dashboard's own player steps
 * (`POST admin/players/:id/unban|unmute|ban`), so they land in the log too.
 */

export type ModStepState = "on" | "ended" | "undone" | "permanent" | "replaced";

export interface ModStepRow {
  id: number;
  userid: number;
  username: string | null;
  moderatorId: number;
  moderatorName: string | null;
  kind: "ban" | "mute";
  reason: string;
  /** A ban's days or a mute's hours, from the step's own times. */
  length: number;
  until: string | null;
  at: string;
  state: ModStepState;
  /** Who undid it, made it permanent or replaced it, and when. */
  laterByName: string | null;
  laterAt: string | null;
}

export interface ModStepList {
  steps: ModStepRow[];
  nextOffset: number | null;
}

export const MOD_STEPS_PAGE = 30;

interface Row {
  id: string | number;
  userid: number;
  username: string | null;
  admin_id: number;
  moderator_name: string | null;
  action: "ban" | "mute";
  reason: string | null;
  until: Date | string | null;
  created_at: Date | string;
  banned: boolean | null;
  ban_until: Date | string | null;
  mute_until: Date | string | null;
  later_action: "ban" | "unban" | "mute" | "unmute" | null;
  later_until: Date | string | null;
  later_by_name: string | null;
  later_at: Date | string | null;
}

const iso = (value: Date | string | null): string | null => (value ? new Date(value).toISOString() : null);

/** What became of one step (see the module comment). */
export const stepState = (row: Row, now: Date): ModStepState => {
  if (row.later_action === "unban" || row.later_action === "unmute") return "undone";
  if (row.later_action === "ban" && row.later_until === null) return "permanent";
  if (row.later_action) return "replaced";
  if (row.action === "ban") {
    const until = row.ban_until ? new Date(row.ban_until) : null;
    return row.banned && (until === null || until > now) ? "on" : "ended";
  }
  return row.mute_until && new Date(row.mute_until) > now ? "on" : "ended";
};

export const listModSteps = async (
  em: EntityManager,
  options: { offset?: number; limit?: number } = {},
  now: Date = new Date(),
): Promise<ModStepList> => {
  const limit = Math.min(Math.max(options.limit ?? MOD_STEPS_PAGE, 1), 100);
  const offset = Math.max(options.offset ?? 0, 0);
  const team = [...adminUserIds()];
  const notTeam = team.length ? `AND a.admin_id NOT IN (${team.map(() => "?").join(", ")})` : "";
  const rows = await em.execute<Row[]>(
    `SELECT a.id, a.userid, u.username, a.admin_id, m.username AS moderator_name, a.action, a.reason, a.until, a.created_at,
            u.banned, u.ban_until, u.mute_until,
            n.action AS later_action, n.until AS later_until, n.by_name AS later_by_name, n.created_at AS later_at
       FROM bym.moderation_action a
       LEFT JOIN bym."user" u ON u.userid = a.userid
       LEFT JOIN bym."user" m ON m.userid = a.admin_id
       LEFT JOIN LATERAL (
         SELECT l.action, l.until, lu.username AS by_name, l.created_at
           FROM bym.moderation_action l
           LEFT JOIN bym."user" lu ON lu.userid = l.admin_id
          WHERE l.userid = a.userid AND l.id > a.id
            AND ((a.action = 'ban' AND l.action IN ('ban', 'unban')) OR (a.action = 'mute' AND l.action IN ('mute', 'unmute')))
          ORDER BY l.id
          LIMIT 1
       ) n ON true
      WHERE a.action IN ('ban', 'mute') ${notTeam}
      ORDER BY a.id DESC
      LIMIT ? OFFSET ?`,
    [...team, limit + 1, offset],
  );
  const steps = rows.slice(0, limit).map((row): ModStepRow => {
    const at = new Date(row.created_at);
    const span = row.until ? new Date(row.until).getTime() - at.getTime() : 0;
    return {
      id: Number(row.id),
      userid: Number(row.userid),
      username: row.username,
      moderatorId: Number(row.admin_id),
      moderatorName: row.moderator_name,
      kind: row.action,
      reason: row.reason ?? "",
      length: Math.max(1, Math.round(span / (row.action === "ban" ? 86_400_000 : 3_600_000))),
      until: iso(row.until),
      at: at.toISOString(),
      state: stepState(row, now),
      laterByName: row.later_by_name,
      laterAt: iso(row.later_at),
    };
  });
  return { steps, nextOffset: rows.length > limit ? offset + limit : null };
};
