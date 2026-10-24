import { describe, expect, test } from "bun:test";

import { alertConfig } from "../../config/AlertConfig.js";
import type { DailySummary } from "../stats/dailyStats.js";
import { ALERTS_OPEN_KEY } from "./alerts.js";
import { dailySummaryKey, dailySummaryText, runDailySummary, RETRY_MS, type DailySummaryDeps } from "./dailySummary.js";
import type { SendTelegram, TelegramResult } from "./telegram.js";

/**
 * The daily Telegram summary with a fake Redis and a fake Telegram: what it
 * says, when it is due, and that it goes once a day however many servers check.
 */

const config = alertConfig({ TELEGRAM_BOT_TOKEN: "t", TELEGRAM_CHAT_ID: "1", WEB_URL: "https://play.example.test" });
const off = alertConfig({});

/** 23 Oct 2026, `hh:mm` UTC. */
const at = (hhmm: string): number => Date.parse(`2026-10-23T${hhmm}:00Z`);

const summary = (overrides: Partial<DailySummary> = {}): DailySummary => ({
  day: "2026-10-22",
  stat: {
    day: "2026-10-22",
    newPlayers: 5,
    totalPlayers: 1234,
    activePlayers: 120,
    activeSource: "tracked",
    attacks: 340,
    tribeRaids: 56,
    eventNewPlayers: {},
    eventPlayers: { krallen: 40, quiet: 0 },
    bugReports: 2,
    browserErrors: 12,
    serverErrors: 3,
  },
  players: { total: 1234, activeToday: 30, active7: 300, active30: 800 },
  newErrors: [{ id: 9, source: "browser", count: 7 }],
  bugReports: [
    { id: 41, text: "The tower won't fire" },
    { id: 42, text: "" },
  ],
  openBugReports: 7,
  ...overrides,
});

const fakeRedis = (open: Record<string, unknown> = {}) => {
  const strings = new Map<string, string>();
  const expiries = new Map<string, number>();
  return {
    strings,
    expiries,
    send: async (command: string, args: string[]): Promise<unknown> => {
      if (command === "SET") {
        if (strings.has(args[0]!)) return null;
        strings.set(args[0]!, args[1]!);
        return "OK";
      }
      if (command === "PEXPIRE") {
        expiries.set(args[0]!, Number(args[1]));
        return 1;
      }
      throw new Error(`unexpected ${command}`);
    },
    hgetall: async (key: string) =>
      key === ALERTS_OPEN_KEY ? Object.fromEntries(Object.entries(open).map(([k, v]) => [k, JSON.stringify(v)])) : {},
    hset: async () => 1,
    hdel: async () => 0,
  };
};

const recorder = (result: TelegramResult = { sent: true }) => {
  const sent: string[] = [];
  const send: SendTelegram = async (text) => {
    sent.push(text);
    return result;
  };
  return { sent, send };
};

describe("the daily summary's text", () => {
  test("has yesterday's numbers, the open problems and each bug report's start", () => {
    const text = dailySummaryText(summary(), [{ title: "Disk nearly full", section: "health", since: 0, lastSentAt: 0 }], config);
    expect(text.split("\n")).toEqual([
      "BYMR daily summary, Thu 22 Oct (UTC)",
      "",
      "New players: 5 (total 1,234)",
      "Active players: 120 that day, 300 in 7 days, 800 in 30 days",
      "Attacks: 340, tribe raids: 56",
      "Event players: krallen 40",
      "Errors: 12 browser, 3 server (1 new kind)",
      "Problems open (1): Disk nearly full",
      "Bug reports: 2 that day, 7 open in all",
      "#41 The tower won't fire",
      "#42 (no text)",
      "",
      "https://play.example.test/admin#bugs",
    ]);
  });

  test("says what is unknown, and how many reports did not fit", () => {
    const base = summary();
    const text = dailySummaryText(
      summary({
        stat: { ...base.stat, activePlayers: null, tribeRaids: null, eventPlayers: null, bugReports: 12 },
        newErrors: [],
        bugReports: [{ id: 1, text: "x" }],
      }),
      [],
      config
    );
    expect(text).toContain("Active players: ? that day");
    expect(text).toContain("tribe raids: ?");
    expect(text).not.toContain("Event players");
    expect(text).toContain("Errors: 12 browser, 3 server\n");
    expect(text).toContain("Problems open: none");
    expect(text).toContain("and 11 more");
  });

  test("without bug reports it links the health section", () => {
    const base = summary();
    const text = dailySummaryText(summary({ stat: { ...base.stat, bugReports: 0 }, bugReports: [] }), [], config);
    expect(text.endsWith("https://play.example.test/admin#health")).toBe(true);
  });
});

describe("sending the daily summary", () => {
  const deps = (redis: ReturnType<typeof fakeRedis>, send: SendTelegram, overrides: Partial<DailySummaryDeps> = {}): DailySummaryDeps => ({
    redis,
    send,
    config,
    summary: async (day) => summary({ day }),
    ...overrides,
  });

  test("off without Telegram settings", async () => {
    const redis = fakeRedis();
    const { sent, send } = recorder();
    expect((await runDailySummary(deps(redis, send, { config: off }), at("00:10"))).sent).toBe(false);
    expect(sent).toEqual([]);
    expect(redis.strings.size).toBe(0);
  });

  test("goes once, between 00:05 and 12:00 UTC, for yesterday", async () => {
    const redis = fakeRedis({ disk: { title: "Disk nearly full", section: "health", since: 1, lastSentAt: 1 } });
    const { sent, send } = recorder();
    const days: string[] = [];
    const d = deps(redis, send, { summary: async (day) => (days.push(day), summary({ day })) });

    expect((await runDailySummary(d, at("00:01"))).sent).toBe(false); // too early
    expect(await runDailySummary(d, at("00:05"))).toEqual({ sent: true, day: "2026-10-22" });
    expect(await runDailySummary(d, at("00:10"))).toEqual({ sent: false, day: "2026-10-22", reason: "already sent" });
    expect((await runDailySummary(d, at("13:00"))).sent).toBe(false); // too late
    expect(days).toEqual(["2026-10-22"]);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("Problems open (1): Disk nearly full");
    expect(redis.strings.has(dailySummaryKey("2026-10-22"))).toBe(true);
  });

  test("a failed send frees the day again a little later", async () => {
    const redis = fakeRedis();
    const { send } = recorder({ sent: false, reason: "Telegram answered 502" });
    const run = await runDailySummary(deps(redis, send), at("00:30"));
    expect(run).toEqual({ sent: false, day: "2026-10-22", reason: "Telegram answered 502" });
    expect(redis.expiries.get(dailySummaryKey("2026-10-22"))).toBe(RETRY_MS);
  });

  test("a summary that cannot be made is not sent, and is tried again", async () => {
    const redis = fakeRedis();
    const { sent, send } = recorder();
    const run = await runDailySummary(
      deps(redis, send, {
        summary: async () => {
          throw new Error("database down");
        },
      }),
      at("00:30")
    );
    expect(run).toEqual({ sent: false, day: "2026-10-22", reason: "database down" });
    expect(sent).toEqual([]);
    expect(redis.expiries.get(dailySummaryKey("2026-10-22"))).toBe(RETRY_MS);
  });
});
