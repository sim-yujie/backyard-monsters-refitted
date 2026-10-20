import { createHmac } from "node:crypto";
import type { EntityManager } from "@mikro-orm/postgresql";

import { BUG_REPORTS_PER_DAY, bugReportEmail } from "../../config/BugReportConfig.js";
import { transporter } from "../../config/MailConfig.js";
import { sandboxStartAvailable } from "../../config/GameConfig.js";
import { bugReportLimitErr } from "../../errors/errors.js";
import { logger } from "../../utils/logger.js";
import { imageExtension, type BugReportImage } from "./bugReportImage.js";

/**
 * Bug reports sent from the game (`controllers/bugReports`): each is saved in
 * `bym.bug_report` (migration `20261021_CreateBugReportTable.ts`) and then
 * emailed to `BUG_REPORT_EMAIL`, with its pictures attached.
 *
 * - **Saved first.** The email goes after the row is written and without the
 *   player waiting for it; a failed email is logged and leaves `emailed_at`
 *   null, and the report stays saved.
 * - **Daily cap.** `BUG_REPORTS_PER_DAY` in any 24 hours: per account when
 *   signed in, per IP address (kept only as a keyed hash) when not.
 * - **No real email locally.** With DEV_SANDBOX on (never on production) the
 *   email goes to the server log instead, like the password reset link.
 */

/** What one report holds, as checked by the controller. */
export interface BugReportRow {
  readonly userid: number | null;
  readonly username: string | null;
  /** The email a signed-out player typed for a reply; null when signed in. */
  readonly contactEmail: string | null;
  /** `hashIp` of a signed-out player's address; null when signed in. */
  readonly ipHash: string | null;
  readonly message: string;
  readonly gameVersion: string;
  readonly screen: string;
  readonly device: string;
  readonly userAgent: string;
  readonly screenSize: string;
  readonly errors: readonly string[];
  readonly screenshot: BugReportImage | null;
  readonly picture: BugReportImage | null;
}

/** Whose reports the daily cap counts. */
export type BugReporter = { readonly userid: number } | { readonly ipHash: string };

/** The table's reads and writes, swappable in tests. */
export interface BugReportStore {
  countSince(em: EntityManager, who: BugReporter, since: Date): Promise<number>;
  insert(em: EntityManager, row: BugReportRow): Promise<number>;
  markEmailed(em: EntityManager, id: number): Promise<void>;
}

export const sqlBugReportStore: BugReportStore = {
  async countSince(em, who, since) {
    const [row] = await em.execute<{ count: string | number }[]>(
      "userid" in who
        ? `SELECT count(*) AS count FROM bym.bug_report WHERE userid = ? AND created_at > ?`
        : `SELECT count(*) AS count FROM bym.bug_report WHERE ip_hash = ? AND created_at > ?`,
      ["userid" in who ? who.userid : who.ipHash, since]
    );
    return Number(row?.count ?? 0);
  },

  async insert(em, row) {
    const [inserted] = await em.execute<{ id: string | number }[]>(
      `INSERT INTO bym.bug_report
         (userid, username, contact_email, ip_hash, message, game_version, screen, device, user_agent,
          screen_size, errors, screenshot, screenshot_type, picture, picture_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?, ?, ?, ?)
       RETURNING id`,
      [
        row.userid,
        row.username,
        row.contactEmail,
        row.ipHash,
        row.message,
        row.gameVersion,
        row.screen,
        row.device,
        row.userAgent,
        row.screenSize,
        JSON.stringify(row.errors),
        row.screenshot?.bytes ?? null,
        row.screenshot?.type ?? null,
        row.picture?.bytes ?? null,
        row.picture?.type ?? null,
      ]
    );
    return Number(inserted.id);
  },

  async markEmailed(em, id) {
    await em.execute(`UPDATE bym.bug_report SET emailed_at = now() WHERE id = ?`, [id]);
  },
};

/** A keyed hash of an IP address: the same address always counts together, but is not stored. */
export const hashIp = (ip: string, secret: string = process.env.SECRET_KEY ?? ""): string =>
  createHmac("sha256", `bug-report:${secret}`).update(ip).digest("hex");

export interface BugReportMail {
  readonly from: string;
  readonly to: string;
  readonly replyTo?: string;
  readonly subject: string;
  readonly text: string;
  readonly attachments: readonly { filename: string; content: Buffer; contentType: string }[];
}

export type SendBugReportMail = (mail: BugReportMail) => Promise<unknown>;

/** Who the email comes from when `MAIL_FROM` is not set (as for the reset email). */
const DEFAULT_MAIL_FROM = "Backyard Monsters Refitted <info@bymrefitted.com>";

/** One line of a header: no line breaks, cut to `max`. */
const oneLine = (text: string, max: number): string => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

/**
 * The email for one saved report: plain text only, so nothing the player
 * typed can be read as markup, with the pictures attached.
 *
 * @param {number} id - The report's row id.
 * @param {BugReportRow} row - The report.
 * @param {string | null} replyEmail - Where a reply goes: the account's email, or the one typed.
 */
export const bugReportMail = (
  id: number,
  row: BugReportRow,
  replyEmail: string | null,
  env: Record<string, string | undefined> = process.env
): BugReportMail => {
  const who = row.userid !== null ? `${row.username ?? "(no name)"} (user ${row.userid})` : "Signed out";
  const lines = [
    `Bug report #${id}`,
    "",
    row.message,
    "",
    `Player: ${who}`,
    `Reply to: ${replyEmail ?? "(none)"}`,
    `Game version: ${row.gameVersion || "(unknown)"}`,
    `Screen: ${row.screen || "(unknown)"}`,
    `Device: ${row.device || "(unknown)"}`,
    `Screen size: ${row.screenSize || "(unknown)"}`,
    `Browser: ${row.userAgent || "(unknown)"}`,
    `Screenshot: ${row.screenshot ? "attached" : "none"}`,
    `Picture added: ${row.picture ? "attached" : "none"}`,
    "",
    row.errors.length > 0 ? `Last ${row.errors.length} game errors (oldest first):` : "Game errors: none",
    ...row.errors.map((line) => `- ${line}`),
  ];
  const attachments = [
    ...(row.screenshot
      ? [{ filename: `screenshot-${id}.${imageExtension(row.screenshot.type)}`, content: row.screenshot.bytes, contentType: row.screenshot.type }]
      : []),
    ...(row.picture
      ? [{ filename: `picture-${id}.${imageExtension(row.picture.type)}`, content: row.picture.bytes, contentType: row.picture.type }]
      : []),
  ];
  return {
    from: env.MAIL_FROM?.trim() || DEFAULT_MAIL_FROM,
    to: bugReportEmail(env),
    ...(replyEmail && { replyTo: replyEmail }),
    subject: `Bug report #${id}: ${oneLine(row.message, 60)}`,
    text: lines.join("\n"),
    attachments,
  };
};

/**
 * Sends through the game's mail server (`config/MailConfig.ts`), or, with
 * DEV_SANDBOX on, writes the email to the server log instead.
 */
export const sendBugReportMail: SendBugReportMail = async (mail) => {
  if (sandboxStartAvailable(process.env)) {
    const pictures = mail.attachments.map((one) => `${one.filename} (${one.content.length} bytes)`).join(", ");
    logger.info(
      `BugReport (dev): not emailed. To: ${mail.to} | Reply-To: ${mail.replyTo ?? "-"} | Subject: ${mail.subject} | Attachments: ${pictures || "none"}\n${mail.text}`
    );
    return;
  }
  await transporter.sendMail({ ...mail, attachments: [...mail.attachments] });
};

export interface SubmitBugReportDeps {
  readonly store?: BugReportStore;
  readonly send?: SendBugReportMail;
  readonly now?: number;
}

export interface SubmittedBugReport {
  readonly id: number;
  /** Settles once the email is sent (true) or has failed (false); never rejects. */
  readonly emailed: Promise<boolean>;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Checks the daily cap, saves the report, then emails it in the background.
 *
 * @param {EntityManager} em - A fork that outlives the request (the email's write comes later).
 * @param {BugReportRow} row - The checked report.
 * @param {string | null} replyEmail - Where a reply goes.
 * @throws {ClientSafeError} When the daily cap is reached; nothing is saved.
 */
export const submitBugReport = async (
  em: EntityManager,
  row: BugReportRow,
  replyEmail: string | null,
  { store = sqlBugReportStore, send = sendBugReportMail, now = Date.now() }: SubmitBugReportDeps = {}
): Promise<SubmittedBugReport> => {
  const who: BugReporter = row.userid !== null ? { userid: row.userid } : { ipHash: row.ipHash ?? "" };
  if ((await store.countSince(em, who, new Date(now - DAY_MS))) >= BUG_REPORTS_PER_DAY) {
    throw bugReportLimitErr(BUG_REPORTS_PER_DAY);
  }

  const id = await store.insert(em, row);

  const emailed = (async () => {
    try {
      await send(bugReportMail(id, row, replyEmail));
    } catch (err) {
      logger.error(`BugReport: email for report ${id} failed (the report is saved): ${err}`);
      return false;
    }
    try {
      await store.markEmailed(em, id);
    } catch (err) {
      logger.error(`BugReport: report ${id} was emailed but could not be marked so: ${err}`);
    }
    return true;
  })();

  return { id, emailed };
};
