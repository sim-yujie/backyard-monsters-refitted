import { describe, expect, test } from "bun:test";

import { SupportReminderAnswerSchema } from "../../controllers/support/supportReminder.js";
import { SUPPORT_REMINDER, supportReminderDue } from "./supportReminder.js";

const DAY = 86_400;
const NOW = Date.UTC(2030, 0, 10) / 1000;
const OLD_ACCOUNT = NOW - 30 * DAY;

describe("supportReminderDue", () => {
  test("an account older than the new-player days that was never reminded is due", () => {
    expect(supportReminderDue({ remindedAt: null, off: false, accountStart: OLD_ACCOUNT }, NOW)).toBe(true);
  });

  test("never after Don't show again", () => {
    expect(supportReminderDue({ remindedAt: null, off: true, accountStart: OLD_ACCOUNT }, NOW)).toBe(false);
  });

  test("never in the player's first days", () => {
    const young = NOW - (SUPPORT_REMINDER.newPlayerDays * DAY - 60);
    expect(supportReminderDue({ remindedAt: null, off: false, accountStart: young }, NOW)).toBe(false);
    const justOld = NOW - SUPPORT_REMINDER.newPlayerDays * DAY;
    expect(supportReminderDue({ remindedAt: null, off: false, accountStart: justOld }, NOW)).toBe(true);
  });

  test("at most once every 7 days", () => {
    const sixDaysAgo = NOW - 6 * DAY;
    expect(supportReminderDue({ remindedAt: sixDaysAgo, off: false, accountStart: OLD_ACCOUNT }, NOW)).toBe(false);
    const weekAgo = NOW - SUPPORT_REMINDER.everyDays * DAY;
    expect(supportReminderDue({ remindedAt: weekAgo, off: false, accountStart: OLD_ACCOUNT }, NOW)).toBe(true);
  });

  test("an account of unknown age gets none", () => {
    expect(supportReminderDue({ remindedAt: null, off: false, accountStart: null }, NOW)).toBe(false);
    expect(supportReminderDue({ remindedAt: null, off: false, accountStart: 0 }, NOW)).toBe(false);
  });
});

describe("POST /bm/support/reminder body", () => {
  test("takes shown and never only", () => {
    expect(SupportReminderAnswerSchema.parse({ answer: "shown" }).answer).toBe("shown");
    expect(SupportReminderAnswerSchema.parse({ answer: "never" }).answer).toBe("never");
    expect(() => SupportReminderAnswerSchema.parse({ answer: "later" })).toThrow();
    expect(() => SupportReminderAnswerSchema.parse({})).toThrow();
  });
});
