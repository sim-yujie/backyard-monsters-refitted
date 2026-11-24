import { beforeEach, describe, expect, test } from "bun:test";
import type { EntityManager } from "@mikro-orm/postgresql";

import { alertConfig, CHAT_FLAG_ALERTS_PER_HOUR, CHAT_REPORT_ALERTS_PER_HOUR } from "../../config/AlertConfig.js";
import { GLOBAL_CHAT_CHANNEL, INFERNO_CHAT_CHANNEL } from "../../config/ChatConfig.js";
import { tellChatReport, tellNewPhoto } from "./alertFacts.js";
import { HourlyCap, hourWords } from "./hourlyCap.js";
import {
  alertChatFlag,
  alertChatReport,
  alertModStep,
  alertNewPhoto,
  chatFlagText,
  chatReportText,
  hoursWords,
  modStepText,
  newPhotoText,
  resetModerationAlertCounts,
  roomWords,
  type ChatReportAlert,
  type ModStepAlert,
  type NewPhotoAlert,
} from "./moderationAlerts.js";
import type { SendTelegram } from "./telegram.js";

/** The moderation alerts (owner, 24 Nov 2026): texts, caps, summaries. Telegram is a fake. */

const config = alertConfig({ TELEGRAM_BOT_TOKEN: "t", TELEGRAM_CHAT_ID: "1", WEB_URL: "https://play.example.test" });
const off = alertConfig({ WEB_URL: "https://play.example.test" });
const NOW = Date.UTC(2026, 10, 24, 14, 20);

const recorder = () => {
  const messages: string[] = [];
  const send: SendTelegram = async (text) => {
    messages.push(text);
    return { sent: true };
  };
  return { messages, send };
};

const ban: ModStepAlert = {
  kind: "ban",
  moderator: { userid: 5, username: "ModBob" },
  player: { userid: 9, username: "Spammer" },
  length: 3,
  reason: "Advertising another server",
  lines: [
    { text: "join my server at example dot com", channel: GLOBAL_CHAT_CHANNEL },
    { text: "free shiny  there", channel: INFERNO_CHAT_CHANNEL },
  ],
  removedLines: 4,
};

describe("words", () => {
  test("rooms and lengths read as players say them", () => {
    expect(roomWords(GLOBAL_CHAT_CHANNEL)).toBe("Global");
    expect(roomWords("chat:country:ph")).toBe("country room PH");
    expect(hoursWords(1)).toBe("1 hour");
    expect(hoursWords(24)).toBe("1 day");
    expect(hoursWords(168)).toBe("7 days");
    expect(hourWords(Date.UTC(2026, 10, 24, 14))).toBe("14:00-15:00 UTC");
  });
});

describe("(a) a moderator's ban or mute", () => {
  test("says who, to whom, how long, why, the lines, the removal and the undo link", () => {
    expect(modStepText(ban, config)).toBe(
      [
        "BYMR moderator: ModBob banned Spammer for 3 days.",
        "Reason: Advertising another server",
        "Reported lines:",
        '- Global: "join my server at example dot com"',
        '- Inferno: "free shiny there"',
        "Removed 4 of their chat lines from the last hour.",
        "Undo it on the dashboard: https://play.example.test/admin#moderators",
      ].join("\n"),
    );
  });

  test("a mute without reported lines, and a name that is gone", () => {
    const mute: ModStepAlert = { ...ban, kind: "mute", length: 24, lines: [], removedLines: null, player: { userid: 9, username: null } };
    expect(modStepText(mute, config)).toBe(
      [
        "BYMR moderator: ModBob muted #9's chat for 1 day.",
        "Reason: Advertising another server",
        "Undo it on the dashboard: https://play.example.test/admin#moderators",
      ].join("\n"),
    );
  });

  test("at most three lines, the rest counted", () => {
    const many = { ...ban, lines: Array.from({ length: 5 }, (_, i) => ({ text: `line ${i}`, channel: GLOBAL_CHAT_CHANNEL })) };
    const text = modStepText(many, config);
    expect(text).toContain('- Global: "line 2"');
    expect(text).not.toContain("line 3");
    expect(text).toContain("- and 2 more");
  });

  test("goes every time when alerts are on, never when off", async () => {
    const { messages, send } = recorder();
    for (let i = 0; i < 15; i++) expect(await alertModStep(ban, { config, send })).toBe(true);
    expect(messages).toHaveLength(15);
    expect(await alertModStep(ban, { config: off, send })).toBe(false);
    expect(messages).toHaveLength(15);
  });

  test("a failed send is not thrown", async () => {
    const send: SendTelegram = async () => {
      throw new Error("down");
    };
    expect(await alertModStep(ban, { config, send })).toBe(false);
  });
});

describe("(b) chat-filter flags, capped", () => {
  beforeEach(resetModerationAlertCounts);

  const flag = { userid: 9, username: "Spammer", channel: GLOBAL_CHAT_CHANNEL, text: "join   my server", why: "link to another server" };

  test("the text names the player, the room, the line, why, and links to the player", () => {
    expect(chatFlagText(flag, config)).toBe(
      [
        "BYMR chat filter: Spammer in Global",
        '"join my server"',
        "Why: link to another server",
        "https://play.example.test/admin#moderation?player=9",
      ].join("\n"),
    );
  });

  test(`${CHAT_FLAG_ALERTS_PER_HOUR} an hour; the rest are summed up when the hour ends`, async () => {
    const { messages, send } = recorder();
    const timers: { run: () => void; ms: number }[] = [];
    const schedule = (run: () => void, ms: number) => void timers.push({ run, ms });

    for (let i = 0; i < CHAT_FLAG_ALERTS_PER_HOUR + 4; i++) {
      await alertChatFlag(flag, { config, send, now: NOW + i * 1000, schedule });
    }
    expect(messages).toHaveLength(CHAT_FLAG_ALERTS_PER_HOUR);
    expect(messages.at(-1)).toContain(`(That is ${CHAT_FLAG_ALERTS_PER_HOUR} flags this hour`);
    // One timer, set by the first one held back, for just after 15:00.
    expect(timers).toHaveLength(1);
    expect(NOW + 10_000 + timers[0]!.ms).toBeGreaterThan(Date.UTC(2026, 10, 24, 15));

    timers[0]!.run();
    await Bun.sleep(1);
    expect(messages.at(-1)).toBe(
      ["BYMR chat filter: 4 more flags 14:00-15:00 UTC, not sent one by one.", "https://play.example.test/admin#moderation"].join("\n"),
    );

    // The next hour starts again, with nothing more to sum up.
    await alertChatFlag(flag, { config, send, now: Date.UTC(2026, 10, 24, 15, 5), schedule });
    expect(messages.at(-1)).toBe(chatFlagText(flag, config));
    expect(messages).toHaveLength(CHAT_FLAG_ALERTS_PER_HOUR + 2);
  });

  test("an hour whose timer never ran is summed up before the next flag", async () => {
    const { messages, send } = recorder();
    const schedule = () => {};
    for (let i = 0; i < CHAT_FLAG_ALERTS_PER_HOUR + 2; i++) await alertChatFlag(flag, { config, send, now: NOW, schedule });
    await alertChatFlag(flag, { config, send, now: NOW + 3_600_000, schedule });
    expect(messages.slice(-2)).toEqual([
      ["BYMR chat filter: 2 more flags 14:00-15:00 UTC, not sent one by one.", "https://play.example.test/admin#moderation"].join("\n"),
      chatFlagText(flag, config),
    ]);
  });

  test("nothing when alerts are off", async () => {
    const { messages, send } = recorder();
    expect(await alertChatFlag(flag, { config: off, send, now: NOW })).toBe(false);
    expect(messages).toHaveLength(0);
  });
});

describe("(c) chat reports", () => {
  beforeEach(resetModerationAlertCounts);

  const report: ChatReportAlert = {
    reporter: { userid: 3, username: "Alice" },
    reported: { userid: 9, username: "Spammer" },
    channel: GLOBAL_CHAT_CHANNEL,
    text: "you are all noobs",
    verified: true,
  };

  test("says who reported whom, where, the line, and links to the player", () => {
    expect(chatReportText(report, config)).toBe(
      [
        "BYMR chat report: Alice reported Spammer in Global",
        '"you are all noobs"',
        "https://play.example.test/admin#moderation?player=9",
      ].join("\n"),
    );
    expect(chatReportText({ ...report, verified: false }, config)).toContain(
      `"you are all noobs" (the reporter's copy: the line had left the room)`,
    );
  });

  test(`at most ${CHAT_REPORT_ALERTS_PER_HOUR} an hour`, async () => {
    const { messages, send } = recorder();
    for (let i = 0; i < CHAT_REPORT_ALERTS_PER_HOUR + 5; i++) await alertChatReport(report, { config, send, now: NOW, schedule: () => {} });
    expect(messages).toHaveLength(CHAT_REPORT_ALERTS_PER_HOUR);
  });

  test("the hook reads the names, and does nothing (no database) when alerts are off", async () => {
    const queries: unknown[][] = [];
    const em = {
      execute: async (_sql: string, params: unknown[]) => {
        queries.push(params);
        return [
          { userid: 3, username: "Alice" },
          { userid: 9, username: "Spammer" },
        ];
      },
    } as unknown as EntityManager;
    const said: ChatReportAlert[] = [];
    await tellChatReport(em, { reporter: 3, reported: 9, channel: GLOBAL_CHAT_CHANNEL, text: "x", verified: true }, async (r) => said.push(r));
    expect(said).toEqual([{ ...report, text: "x" }]);

    const saved = { token: process.env.TELEGRAM_BOT_TOKEN, chat: process.env.TELEGRAM_CHAT_ID };
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
    try {
      queries.length = 0;
      await tellChatReport(em, { reporter: 3, reported: 9, channel: GLOBAL_CHAT_CHANNEL, text: "x", verified: true });
      expect(queries).toHaveLength(0);
    } finally {
      if (saved.token !== undefined) process.env.TELEGRAM_BOT_TOKEN = saved.token;
      if (saved.chat !== undefined) process.env.TELEGRAM_CHAT_ID = saved.chat;
    }
  });
});

describe("(d) a new account's photo", () => {
  beforeEach(resetModerationAlertCounts);

  test("names the player and how new they are, links to them, and never carries the photo", () => {
    const text = newPhotoText({ userid: 9, username: "NewGuy", age: 12 * 60_000 }, config);
    expect(text).toBe(
      [
        "BYMR new account photo: NewGuy (joined 12 minutes ago) uploaded a profile photo.",
        "https://play.example.test/admin#moderation?player=9",
      ].join("\n"),
    );
    expect(text).not.toContain("photos/");
  });

  test("at most 10 an hour", async () => {
    const { messages, send } = recorder();
    for (let i = 0; i < 12; i++) await alertNewPhoto({ userid: i, username: `n${i}`, age: 60_000 }, { config, send, now: NOW, schedule: () => {} });
    expect(messages).toHaveLength(10);
  });

  const emJoined = (joined: Date | null) =>
    ({ execute: async () => [{ username: "NewGuy", joined }] }) as unknown as EntityManager;

  test("the hook says only accounts that joined in the last hour", async () => {
    const said: NewPhotoAlert[] = [];
    const alert = async (u: NewPhotoAlert) => void said.push(u);
    const now = new Date(NOW);
    await tellNewPhoto(emJoined(new Date(NOW - 20 * 60_000)), 9, now, alert);
    await tellNewPhoto(emJoined(new Date(NOW - 61 * 60_000)), 9, now, alert);
    await tellNewPhoto(emJoined(null), 9, now, alert);
    expect(said).toEqual([{ userid: 9, username: "NewGuy", age: 20 * 60_000 }]);
  });
});

describe("the hourly cap", () => {
  test("sends N, holds the rest, and gives the count once", () => {
    const cap = new HourlyCap(2);
    expect(cap.take(NOW)).toMatchObject({ send: true, last: false });
    expect(cap.take(NOW)).toMatchObject({ send: true, last: true });
    expect(cap.take(NOW)).toMatchObject({ send: false, startSummary: true });
    expect(cap.take(NOW)).toMatchObject({ send: false, startSummary: false });
    expect(cap.summary(NOW)).toBeNull();
    expect(cap.summary(NOW + 3_600_000)).toEqual({ count: 2, from: Date.UTC(2026, 10, 24, 14) });
    expect(cap.summary(NOW + 3_600_000)).toBeNull();
  });
});
