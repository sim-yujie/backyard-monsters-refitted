import { beforeEach, describe, expect, test } from "bun:test";
import type { EntityManager } from "@mikro-orm/postgresql";

import { alertConfig, BUG_REPORT_ALERTS_PER_HOUR } from "../../config/AlertConfig.js";
import { submitBugReport, type BugReportRow, type BugReportStore } from "../bugReports/bugReports.js";
import { alertNewBugReport, bugReportAlertText, resetBugReportAlertCount } from "./bugReportAlert.js";
import type { SendTelegram } from "./telegram.js";

/** The Telegram message for each new bug report; Telegram is a fake. */

const config = alertConfig({ TELEGRAM_BOT_TOKEN: "t", TELEGRAM_CHAT_ID: "1", WEB_URL: "https://play.example.test" });
const NOW = Date.UTC(2026, 9, 23, 12, 30);

const row = (extra: Partial<BugReportRow> = {}): BugReportRow => ({
  userid: 7,
  username: "Bob",
  contactEmail: null,
  ipHash: null,
  message: "The map will not open",
  gameVersion: "2.0.0-beta.4",
  screen: "maproom2",
  device: "phone",
  userAgent: "test",
  screenSize: "390x844",
  errors: ["TypeError: x"],
  screenshot: null,
  picture: null,
  ...extra,
});

const recorder = () => {
  const messages: string[] = [];
  const send: SendTelegram = async (text) => {
    messages.push(text);
    return { sent: true };
  };
  return { messages, send };
};

describe("bug report alerts", () => {
  beforeEach(resetBugReportAlertCount);

  test("says only that a report came, its number and the count this hour, with the link", () => {
    expect(bugReportAlertText(12, 3, config)).toBe("BYMR: new bug report #12 (3 this hour)\nhttps://play.example.test/admin#bugs");
  });

  test("never carries the player's words, name, email or device", async () => {
    const { messages, send } = recorder();
    const report = row({ username: "SecretName", contactEmail: "someone@example.test", message: "my words here" });
    let alerted: unknown[] = [];
    await submitBugReport({} as EntityManager, report, "someone@example.test", {
      store: { countSince: async () => 0, insert: async () => 41, markEmailed: async () => {} },
      send: async () => {},
      notify: async (...args: unknown[]) => {
        alerted = args;
        return alertNewBugReport(41, { config, send, now: NOW });
      },
    });
    await Bun.sleep(0);
    expect(alerted).toEqual([41]);
    expect(messages).toEqual(["BYMR: new bug report #41 (1 this hour)\nhttps://play.example.test/admin#bugs"]);
    for (const secret of ["SecretName", "someone@", "my words", "phone", "maproom2", "TypeError"]) {
      expect(messages.join("\n")).not.toContain(secret);
    }
  });

  test("off: nothing is sent", async () => {
    const { messages, send } = recorder();
    expect(await alertNewBugReport(1, { config: alertConfig({}), send, now: NOW })).toBe(false);
    expect(messages).toEqual([]);
  });

  test("at most the hourly cap, then one 'more are coming', then quiet until the next hour", async () => {
    const { messages, send } = recorder();
    for (let id = 1; id <= BUG_REPORT_ALERTS_PER_HOUR + 5; id++) await alertNewBugReport(id, { config, send, now: NOW });
    expect(messages.length).toBe(BUG_REPORT_ALERTS_PER_HOUR + 1);
    expect(messages.at(-1)).toStartWith(`BYMR: more than ${BUG_REPORT_ALERTS_PER_HOUR} bug reports this hour`);
    await alertNewBugReport(99, { config, send, now: NOW + 60 * 60_000 });
    expect(messages.at(-1)).toStartWith("BYMR: new bug report #99 (1 this hour)");
  });

  test("a failed send or a throw never reaches the caller", async () => {
    const failing: SendTelegram = async () => ({ sent: false, reason: "down" });
    expect(await alertNewBugReport(1, { config, send: failing, now: NOW })).toBe(false);
    const throwing: SendTelegram = async () => {
      throw new Error("boom");
    };
    expect(await alertNewBugReport(2, { config, send: throwing, now: NOW })).toBe(false);
  });

  test("saving a report sends its alert, and a failing alert does not stop the save", async () => {
    const store: BugReportStore = { countSince: async () => 0, insert: async () => 55, markEmailed: async () => {} };
    const notified: number[] = [];
    const saved = await submitBugReport({} as EntityManager, row(), null, {
      store,
      send: async () => {},
      notify: async (id) => notified.push(id),
    });
    expect(saved.id).toBe(55);
    expect(notified).toEqual([55]);
    const again = await submitBugReport({} as EntityManager, row(), null, {
      store,
      send: async () => {},
      notify: async () => {
        throw new Error("telegram down");
      },
    });
    expect(again.id).toBe(55);
    expect(await again.emailed).toBe(true);
  });
});
