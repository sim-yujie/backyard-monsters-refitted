import { describe, expect, test } from "bun:test";

import { retentionConfig } from "./RetentionConfig.js";

describe("retention limits (RetentionConfig.ts)", () => {
  test("defaults: logs 30 days, mail, battle records and chat reports 12 months, bug reports 6", () => {
    expect(retentionConfig({})).toEqual({
      logDays: 30,
      mailDays: 365,
      attackLogDays: 365,
      chatReportDays: 365,
      bugReportDays: 180,
    });
  });

  test("each is its own variable", () => {
    expect(
      retentionConfig({
        LOG_RETENTION_DAYS: "14",
        MAIL_RETENTION_DAYS: "90",
        ATTACK_LOG_RETENTION_DAYS: "180",
        CHAT_REPORT_RETENTION_DAYS: "730",
        BUG_REPORT_RETENTION_DAYS: "90",
      })
    ).toEqual({ logDays: 14, mailDays: 90, attackLogDays: 180, chatReportDays: 730, bugReportDays: 90 });
  });

  test("a value that is not a positive number keeps the default", () => {
    expect(retentionConfig({ LOG_RETENTION_DAYS: "0", MAIL_RETENTION_DAYS: "soon", ATTACK_LOG_RETENTION_DAYS: "-5" })).toEqual({
      logDays: 30,
      mailDays: 365,
      attackLogDays: 365,
      chatReportDays: 365,
      bugReportDays: 180,
    });
  });
});
