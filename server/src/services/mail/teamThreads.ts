import type { EntityManager } from "@mikro-orm/postgresql";

import { SUPPORT_SENDER } from "./systemSender.js";

/**
 * Whether `userid` may answer the team in `threadid`: only in a thread that
 * belongs to one of their own bug reports. A notice (a Shiny gift with no
 * report) and a thread they started to the team themselves cannot be answered.
 */
export const mayAnswerTeam = async (em: EntityManager, userid: number, threadid: number): Promise<boolean> => {
  if (!Number.isSafeInteger(threadid) || threadid < 1) return false;
  const [row] = await em.execute<{ found: number }[]>(
    `SELECT 1 AS found FROM bym.bug_report r
       JOIN bym.thread t ON t.threadid = r.mail_thread_id
      WHERE r.mail_thread_id = ? AND r.userid = ? AND t.userid = ? AND t.targetid = ?
      LIMIT 1`,
    [threadid, userid, SUPPORT_SENDER, userid]
  );
  return Boolean(row);
};
