import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { ALERT_LOCK_KEY, defaultErrorRateSource, runAlertCheck, setErrorRateSource, type AlertSweepDeps } from "./alertSweep.js";
import { ALERTS_OPEN_KEY } from "./alerts.js";
import type { SendTelegram } from "./telegram.js";

/**
 * One alert check end to end, with a fake Redis and a fake Telegram: the lock
 * that keeps two servers from both sending, and the open problems kept in
 * Redis between checks.
 */

const sent: string[] = [];
const send: SendTelegram = async (text) => {
  sent.push(text);
  return { sent: true };
};

const fakeRedis = () => {
  const strings = new Map<string, string>();
  const hash = new Map<string, string>();
  return {
    strings,
    hash,
    send: async (command: string, args: string[]): Promise<unknown> => {
      if (command === "SET") {
        if (strings.has(args[0])) return null;
        strings.set(args[0], args[1]);
        return "OK";
      }
      if (command === "PING") return "PONG";
      if (command === "INFO") return "used_memory:1\r\n";
      throw new Error(`unexpected ${command}`);
    },
    hgetall: async (key: string) => (key === ALERTS_OPEN_KEY ? Object.fromEntries(hash) : {}),
    hset: async (_key: string, fields: Record<string, string>) => {
      for (const [field, value] of Object.entries(fields)) hash.set(field, value);
      return 1;
    },
    hdel: async (_key: string, field: string) => Number(hash.delete(field)),
  };
};

/** One check with no host.json. */
const check = (redis: AlertSweepDeps["redis"], sql: AlertSweepDeps["sql"], now?: number) =>
  runAlertCheck({ redis, sql, send, readHostStatus: async () => null }, now);

const down: AlertSweepDeps["sql"] = async () => {
  throw new Error("connection refused");
};
const up: AlertSweepDeps["sql"] = async <T>() => [{ bytes: 1 }] as T[];

describe("the alert check", () => {
  const saved = { ...process.env };

  beforeEach(() => {
    sent.length = 0;
    process.env.TELEGRAM_BOT_TOKEN = "t";
    process.env.TELEGRAM_CHAT_ID = "1";
    process.env.WEB_URL = "https://play.example.test";
  });

  afterEach(() => {
    for (const key of ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "WEB_URL"]) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    setErrorRateSource(defaultErrorRateSource);
  });

  test("off without Telegram settings: does nothing at all", async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    const redis = fakeRedis();
    expect(await check(redis, up)).toBeNull();
    expect(redis.strings.size).toBe(0);
    expect(sent).toEqual([]);
  });

  test("says each problem once, keeps it open in Redis, and skips while another server holds the lock", async () => {
    const redis = fakeRedis();
    const run = await check(redis, down, 1000);
    expect(run?.sent.length).toBe(2); // the database, and no host.json
    expect(sent.map((text) => text.split("\n")[0])).toEqual([
      "BYMR problem: The database is not answering",
      "BYMR problem: The server's health check has stopped",
    ]);
    expect([...redis.hash.keys()].sort()).toEqual(["database", "host-status"]);
    expect(redis.strings.has(ALERT_LOCK_KEY)).toBe(true);

    // The lock is still held: this check does nothing.
    expect(await check(redis, down, 2000)).toBeNull();

    // Lock lapsed; the database is back.
    redis.strings.delete(ALERT_LOCK_KEY);
    await check(redis, up, 61_000);
    expect(sent.at(-1)?.split("\n")[0]).toBe("BYMR fixed: The database is not answering");
    expect([...redis.hash.keys()]).toEqual(["host-status"]);
  });

  test("reads the error count once a source is set", async () => {
    const redis = fakeRedis();
    setErrorRateSource(async () => ({ recent: 500, usual: 2 }));
    await check(redis, up, 1000);
    const jump = sent.find((text) => text.startsWith("BYMR problem: Sudden jump in server errors"));
    expect(jump).toContain("https://play.example.test/admin#errors");
  });
});
