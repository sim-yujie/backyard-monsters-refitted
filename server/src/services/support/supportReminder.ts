/**
 * When the rare "Support the game" reminder may show (owner 24 Oct 2026; 4 Nov:
 * "not too intrusive"). The server keeps the account's part of the rule; the
 * web client adds the rest (30 minutes of play in this visit, only on the own
 * yard, never in an attack, replay or Bob's guided start):
 *
 * - never after "Don't show again";
 * - never in the player's first {@link SUPPORT_REMINDER.newPlayerDays} days
 *   (counted from the main yard's `createtime`);
 * - at most once every {@link SUPPORT_REMINDER.everyDays} days.
 *
 * Pure, so the tests can walk the clock. Times are Unix seconds.
 */

export const SUPPORT_REMINDER = {
  everyDays: 7,
  newPlayerDays: 3,
} as const;

const DAY = 86_400;

export interface SupportReminderRecord {
  /** When it last showed, or null if it never did. */
  readonly remindedAt: number | null;
  /** "Don't show again" was pressed. */
  readonly off: boolean;
  /** When the main yard was made; null (or 0) when unknown. */
  readonly accountStart: number | null;
}

/** Whether the reminder may show now. An account of unknown age gets none. */
export const supportReminderDue = (record: SupportReminderRecord, now: number): boolean => {
  if (record.off) return false;
  if (!record.accountStart || record.accountStart <= 0) return false;
  if (now - record.accountStart < SUPPORT_REMINDER.newPlayerDays * DAY) return false;
  if (record.remindedAt !== null && now - record.remindedAt < SUPPORT_REMINDER.everyDays * DAY) return false;
  return true;
};
