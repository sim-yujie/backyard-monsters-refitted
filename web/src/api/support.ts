import { get, post } from "./http";
import type { ApiEnvelope } from "./types";

/**
 * The rare "Support the game" reminder's record on the account
 * (`server/src/controllers/support/supportReminder.ts`):
 *
 *   GET  /api/:apiVersion/bm/support/reminder           { due }: may it show now
 *   POST /api/:apiVersion/bm/support/reminder  answer   "shown" | "never"
 *
 * The server keeps the account's part of the rule (7 days apart, not in the
 * first 3 days, never after "Don't show again"); `game/support/supportReminder.ts`
 * keeps the visit's part.
 */
const REMINDER_PATH = "/api/:apiVersion/bm/support/reminder";

interface ReminderAnswer extends ApiEnvelope {
  due?: unknown;
}

/** Whether the server says the reminder may show now; false for any odd answer. */
export const fetchSupportReminderDue = async (): Promise<boolean> => {
  const response = await get<ReminderAnswer>(REMINDER_PATH);
  return response.due === true;
};

/** Records that the reminder showed, or that the player asked never to see it again. */
export const recordSupportReminder = (answer: "shown" | "never"): Promise<ApiEnvelope> =>
  post<ApiEnvelope>(REMINDER_PATH, { answer });
