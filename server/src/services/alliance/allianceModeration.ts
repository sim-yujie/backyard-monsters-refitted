import { UniqueConstraintViolationException } from "@mikro-orm/core";
import type { EntityManager, PostgreSqlDriver } from "@mikro-orm/postgresql";

import { Status } from "../../enums/StatusCodes.js";
import { Alliance } from "../../database/models/alliance.model.js";
import { User } from "../../database/models/user.model.js";
import { ClientSafeError } from "../../middleware/clientSafeError.js";
import { disconnectAllianceChat } from "../../chat/chatControl.js";
import { invalidateAllianceSight, invalidatePlayerSight } from "../maproom/sight/sightService.js";
import {
  ADMIN_RENAME_PLACEHOLDER,
  MAX_OPEN_REPORTS_PER_PLAYER,
  REPORT_REASON_MAX_LENGTH,
} from "../../config/AllianceConfig.js";
import { logger } from "../../utils/logger.js";
import { lockAlliance } from "./membership.js";
import { allianceFactorOf, noteFactorChange } from "./productionHistory.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";

/*
 * Alliance reports and admin actions (design v5 §13). A player reports an
 * alliance's name, ad or shield; the dashboard lists open reports; an admin
 * renames it to "#Alliance {id}" (its leader must pick a new name), clears its
 * ad, or disbands it. Each admin action is written to
 * `bym.alliance_admin_action` and closes the alliance's open reports.
 */

type Em = EntityManager<PostgreSqlDriver>;

export type AllianceAdminAction = "rename" | "clear_ad" | "disband";

const refusedErr = (reason: string, message: string, status = Status.FORBIDDEN) =>
  new ClientSafeError({ message, status, data: { reason }, isClientFriendly: true });

/**
 * `POST /alliance/report`: `reporter` reports alliance `allianceId`. One open
 * report per player per alliance (a second is a quiet no-op), at most
 * `MAX_OPEN_REPORTS_PER_PLAYER` open at once, never one's own alliance.
 */
export const reportAlliance = async (em: Em, reporter: User, allianceId: number, reason: string): Promise<void> => {
  if (reporter.alliance_id === allianceId) throw refusedErr("ownAlliance", "You cannot report your own alliance.");

  const alliance = await em.findOne(Alliance, { id: allianceId }, { fields: ["id", "name", "description"] });

  if (!alliance) throw refusedErr("noAlliance", "That alliance no longer exists.", Status.NOT_FOUND);

  const [open] = await em.execute<{ n: string }[]>(
    `SELECT count(*) AS n FROM bym.alliance_report WHERE reporter_id = ? AND closed_at IS NULL`,
    [reporter.userid]
  );

  if (Number(open?.n ?? 0) >= MAX_OPEN_REPORTS_PER_PLAYER) {
    throw refusedErr("tooManyReports", "You have reported enough alliances for now. Thank you!", Status.CONFLICT);
  }

  await em.execute(
    `INSERT INTO bym.alliance_report (alliance_id, alliance_name, alliance_desc, reporter_id, reason)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (alliance_id, reporter_id) WHERE closed_at IS NULL DO NOTHING`,
    [alliance.id, alliance.name, alliance.description, reporter.userid, reason.trim().slice(0, REPORT_REASON_MAX_LENGTH)]
  );
};

export interface AllianceReportRow {
  alliance_id: number;
  /** The alliance's name now, or null when it is gone. */
  name: string | null;
  description: string | null;
  member_count: number;
  /** The name and ad as the first open report saw them. */
  reported_name: string;
  reported_desc: string;
  reports: number;
  reasons: string[];
  first_at: string;
  last_at: string;
}

/** Open reports for the dashboard, one row per alliance, most reported first. */
export const listAllianceReports = async (
  em: Em,
  { offset = 0, limit = 50 }: { offset?: number; limit?: number } = {}
): Promise<AllianceReportRow[]> => {
  const rows = await em.execute<(AllianceReportRow & { member_count: string; reports: string })[]>(
    `SELECT r.alliance_id,
            a.name, a.description,
            (SELECT count(*) FROM bym."user" u WHERE u.alliance_id = r.alliance_id) AS member_count,
            (array_agg(r.alliance_name ORDER BY r.created_at))[1] AS reported_name,
            (array_agg(r.alliance_desc ORDER BY r.created_at))[1] AS reported_desc,
            count(*) AS reports,
            array_remove(array_agg(NULLIF(r.reason, '') ORDER BY r.created_at), NULL) AS reasons,
            min(r.created_at) AS first_at,
            max(r.created_at) AS last_at
       FROM bym.alliance_report r
       LEFT JOIN bym.alliance a ON a.id = r.alliance_id
      WHERE r.closed_at IS NULL
      GROUP BY r.alliance_id, a.name, a.description
      ORDER BY count(*) DESC, min(r.created_at) ASC
      OFFSET ? LIMIT ?`,
    [Math.max(0, offset), Math.min(Math.max(1, limit), 200)]
  );

  return rows.map((row) => ({ ...row, member_count: Number(row.member_count), reports: Number(row.reports) }));
};

/** Closes every open report on `allianceId` with `outcome`; returns how many. */
const closeReports = async (em: Em, allianceId: number, adminId: number, outcome: string): Promise<number> => {
  const closed = await em.execute<{ id: number }[]>(
    `UPDATE bym.alliance_report SET closed_at = now(), closed_by = ?, outcome = ?
      WHERE alliance_id = ? AND closed_at IS NULL RETURNING id`,
    [adminId, outcome, allianceId]
  );

  return closed.length;
};

/** Dismisses the open reports on an alliance with no action taken. */
export const dismissAllianceReports = (em: Em, allianceId: number, adminId: number): Promise<number> =>
  closeReports(em, allianceId, adminId, "dismissed");

const logAction = async (
  em: Em,
  alliance: { id: number; name: string },
  adminId: number,
  action: AllianceAdminAction,
  detail = ""
) => {
  await em.execute(
    `INSERT INTO bym.alliance_admin_action (alliance_id, alliance_name, admin_id, action, detail) VALUES (?, ?, ?, ?, ?)`,
    [alliance.id, alliance.name, adminId, action, detail]
  );
  logger.info(`Alliance admin action: ${action} on alliance ${alliance.id} by admin ${adminId}`);
};

export type AdminActionOutcome =
  | { outcome: "done"; closed: number }
  | { outcome: "noAlliance" }
  | { outcome: "nameTaken"; name: string };

/** The name an admin rename gives: "#Alliance {id}". */
export const adminPlaceholderName = (id: number) => ADMIN_RENAME_PLACEHOLDER.replace("{id}", String(id));

/**
 * An admin action on an alliance: rename to "#Alliance {id}" (the leader may
 * then rename at once), clear the ad, or disband. A disband frees every
 * member without the 24-hour re-join wait: they did nothing wrong.
 *
 * Players cannot choose the placeholder name, but an old alliance might
 * already hold it: the rename then answers `nameTaken` and changes nothing,
 * rather than failing as a server error.
 */
export const adminAllianceAction = async (
  em: Em,
  allianceId: number,
  adminId: number,
  action: AllianceAdminAction
): Promise<AdminActionOutcome> => {
  const transaction = em.transactional(async (tx) => {
    if (!(await lockAlliance(tx, allianceId))) return null;

    const [alliance] = await tx.execute<{ id: number; name: string; description: string }[]>(
      `SELECT id, name, description FROM bym.alliance WHERE id = ?`,
      [allianceId]
    );

    if (!alliance) return null;

    let members: number[] = [];

    if (action === "rename") {
      const name = adminPlaceholderName(allianceId);
      await tx.nativeUpdate(Alliance, { id: allianceId }, { name, must_rename: true });
      await logAction(tx, alliance, adminId, action, `${alliance.name} -> ${name}`);
    } else if (action === "clear_ad") {
      await tx.nativeUpdate(Alliance, { id: allianceId }, { description: "" });
      await logAction(tx, alliance, adminId, action, alliance.description);
    } else {
      // Every member's production bonus ends now: time before it stays paid
      // at the alliance's factor (`productionHistory.ts`).
      await noteFactorChange(tx, { allianceId }, await allianceFactorOf(tx, allianceId), 1, getCurrentDateTime());
      const rows = await tx.execute<{ userid: number }[]>(
        `UPDATE bym."user" SET alliance_id = NULL, alliance_role = NULL, alliance_joined_at = NULL
          WHERE alliance_id = ? RETURNING userid`,
        [allianceId]
      );
      members = rows.map((row) => Number(row.userid));
      await tx.nativeDelete(Alliance, { id: allianceId });
      await logAction(tx, alliance, adminId, action, `${members.length} members`);
    }

    const closed = await closeReports(tx, allianceId, adminId, action);

    return { closed, members };
  });

  let result: Awaited<typeof transaction>;

  try {
    result = await transaction;
  } catch (error) {
    if (action === "rename" && error instanceof UniqueConstraintViolationException) {
      return { outcome: "nameTaken", name: adminPlaceholderName(allianceId) };
    }
    throw error;
  }

  if (!result) return { outcome: "noAlliance" };

  if (action === "disband") {
    await Promise.all([
      invalidateAllianceSight(allianceId),
      ...result.members.map((userid) => invalidatePlayerSight(userid)),
      ...result.members.map((userid) => disconnectAllianceChat(userid)),
    ]);
  }

  return { outcome: "done", closed: result.closed };
};

/** The admin log for one alliance, newest first. */
export const allianceAdminLog = (em: Em, allianceId: number) =>
  em.execute<{ id: number; alliance_name: string; admin_id: number; action: string; detail: string; created_at: string }[]>(
    `SELECT id, alliance_name, admin_id, action, detail, created_at FROM bym.alliance_admin_action
      WHERE alliance_id = ? ORDER BY created_at DESC, id DESC LIMIT 50`,
    [allianceId]
  );
