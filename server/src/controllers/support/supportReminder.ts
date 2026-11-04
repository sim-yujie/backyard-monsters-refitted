import type { EntityManager } from "@mikro-orm/postgresql";
import z from "zod";

import { supportReminderDue, type SupportReminderRecord } from "../../services/support/supportReminder.js";
import { logger } from "../../utils/logger.js";

/**
 * The "Support the game" reminder's record on the account
 * (`services/support/supportReminder.ts` has the rule):
 *
 * - `GET /bm/support/reminder` answers `{ due }`: may the reminder show now.
 * - `POST /bm/support/reminder { answer }`: `"shown"` when it showed (the
 *   7-day wait starts; "Maybe later" needs nothing more), `"never"` for
 *   "Don't show again".
 *
 * The columns are `bym.user.support_reminded_at` and `support_reminder_off`
 * (migration `20261107_AddSupportReminderToUser.ts`), in raw SQL. Forgiving:
 * a record that cannot be read answers `due: false`, so a database hiccup
 * never shows the reminder more often.
 */

export const SupportReminderAnswerSchema = z.object({
  answer: z.enum(["shown", "never"]),
});

interface ReminderRow {
  support_reminded_at: Date | string | null;
  support_reminder_off: boolean | null;
  createtime: number | string | null;
}

const toSeconds = (value: Date | string | null): number | null => {
  if (value === null) return null;
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
};

/** The account's record, or null when it cannot be read. */
export const readSupportReminder = async (em: EntityManager, userid: number): Promise<SupportReminderRecord | null> => {
  try {
    const [row] = await em.execute<ReminderRow[]>(
      `SELECT u.support_reminded_at, u.support_reminder_off, s.createtime
         FROM bym."user" u
         LEFT JOIN bym.save s ON u.save_basesaveid = s.basesaveid AND s.type = 'main'
        WHERE u.userid = ?`,
      [userid]
    );
    if (!row) return null;
    const start = row.createtime === null ? null : Number(row.createtime);
    return {
      remindedAt: toSeconds(row.support_reminded_at),
      off: row.support_reminder_off === true,
      accountStart: start !== null && Number.isFinite(start) ? start : null,
    };
  } catch (error) {
    logger.warn("Could not read the support reminder for {userid}: {error}", { userid, error: String(error) });
    return null;
  }
};

/** `GET /bm/support/reminder`. `now` in Unix seconds. */
export const supportReminderAnswer = async (
  em: EntityManager,
  userid: number,
  now: number
): Promise<{ error: 0; due: boolean }> => {
  const record = await readSupportReminder(em, userid);
  return { error: 0, due: record !== null && supportReminderDue(record, now) };
};

/** `POST /bm/support/reminder`. */
export const supportReminderSeenAnswer = async (
  em: EntityManager,
  userid: number,
  body: unknown
): Promise<{ error: 0; answer: "shown" | "never" }> => {
  const { answer } = SupportReminderAnswerSchema.parse(body);
  if (answer === "never") {
    await em.execute(`UPDATE bym."user" SET support_reminder_off = true WHERE userid = ?`, [userid]);
  } else {
    await em.execute(`UPDATE bym."user" SET support_reminded_at = now() WHERE userid = ?`, [userid]);
  }
  return { error: 0, answer };
};
