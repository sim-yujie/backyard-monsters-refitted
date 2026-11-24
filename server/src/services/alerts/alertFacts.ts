import type { EntityManager } from "@mikro-orm/postgresql";

import { alertConfig, NEW_ACCOUNT_PHOTO_MS } from "../../config/AlertConfig.js";
import { logger } from "../../utils/logger.js";
import { alertChatReport, alertNewPhoto, type ChatReportAlert, type Named, type NewPhotoAlert } from "./moderationAlerts.js";

/**
 * What the moderation alerts (`moderationAlerts.ts`) read from the database
 * before they are said, and the two hooks the chat report and the photo
 * upload call. Each hook returns at once when Telegram alerts are off (no
 * database read), and never throws: the report or upload is done whatever
 * happens here.
 */

/** Players' names by account number (a name that is gone is null). */
export const namesOf = async (em: EntityManager, ids: readonly number[]): Promise<Map<number, Named>> => {
  const unique = [...new Set(ids)];
  const rows = unique.length
    ? await em.execute<{ userid: number; username: string | null }[]>(
        `SELECT userid, username FROM bym."user" WHERE userid IN (${unique.map(() => "?").join(", ")})`,
        unique,
      )
    : [];
  const names = new Map<number, Named>(unique.map((id) => [id, { userid: id, username: null }]));
  for (const row of rows) names.set(Number(row.userid), { userid: Number(row.userid), username: row.username });
  return names;
};

/**
 * When the account joined: its main yard's creation, or when it agreed to
 * the terms, whichever came first (the dashboard's "new players",
 * `services/stats/dailyStats.ts`). Null when neither is known.
 */
export const joinedAt = async (em: EntityManager, userid: number): Promise<{ username: string | null; joined: Date | null } | null> => {
  const [row] = await em.execute<{ username: string | null; joined: Date | string | null }[]>(
    `SELECT u.username, LEAST(s.created_at, u.terms_accepted_at) AS joined
       FROM bym."user" u
       LEFT JOIN bym.save s ON s.userid = u.userid AND s.type = 'main'
      WHERE u.userid = ?`,
    [userid],
  );
  if (!row) return null;
  return { username: row.username, joined: row.joined ? new Date(row.joined) : null };
};

/** Says a stored chat report (c). `alert` is for tests. */
export const tellChatReport = async (
  em: EntityManager,
  report: { reporter: number; reported: number; channel: string; text: string; verified: boolean },
  alert?: (report: ChatReportAlert) => Promise<unknown>,
): Promise<void> => {
  if (!alert && !alertConfig().telegram) return;
  try {
    const names = await namesOf(em, [report.reporter, report.reported]);
    await (alert ?? alertChatReport)({
      reporter: names.get(report.reporter)!,
      reported: names.get(report.reported)!,
      channel: report.channel,
      text: report.text,
      verified: report.verified,
    });
  } catch (err) {
    logger.warn(`Alerts: the chat report on user ${report.reported} was not said: ${err}`);
  }
};

/** Says a profile photo upload (d) when the account joined less than an hour ago. `alert` is for tests. */
export const tellNewPhoto = async (
  em: EntityManager,
  userid: number,
  now: Date,
  alert?: (upload: NewPhotoAlert) => Promise<unknown>,
): Promise<void> => {
  if (!alert && !alertConfig().telegram) return;
  try {
    const account = await joinedAt(em, userid);
    if (!account?.joined) return;
    const age = now.getTime() - account.joined.getTime();
    if (age < 0 || age > NEW_ACCOUNT_PHOTO_MS) return;
    await (alert ?? alertNewPhoto)({ userid, username: account.username, age });
  } catch (err) {
    logger.warn(`Alerts: the new photo of user ${userid} was not said: ${err}`);
  }
};
