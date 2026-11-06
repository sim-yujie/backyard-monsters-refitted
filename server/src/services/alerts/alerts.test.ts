import { describe, expect, test } from "bun:test";

import { ALERT_REMINDER_MS, alertConfig } from "../../config/AlertConfig.js";
import type { HealthSummary } from "../health/healthSummary.js";
import {
  ALERTS_OPEN_KEY,
  duration,
  findProblems,
  memoryAlertStore,
  redisAlertStore,
  runAlertRules,
  type AlertState,
  type CheckResult,
} from "./alerts.js";
import type { SendTelegram } from "./telegram.js";

/** What is a problem, and the one-message-per-problem rules. Telegram is a fake. */

const config = alertConfig({
  TELEGRAM_BOT_TOKEN: "t",
  TELEGRAM_CHAT_ID: "1",
  WEB_URL: "https://play.example.test",
});

const NOW = Date.UTC(2026, 9, 23, 12);
const HOUR = 3_600_000;

const healthy = (extra: Partial<HealthSummary> = {}): HealthSummary =>
  ({
    generatedAt: new Date(NOW).toISOString(),
    server: {} as HealthSummary["server"],
    host: { generatedAt: "", stale: false, hostname: "h", uptimeSeconds: 1, load: [], memory: {} as any, containers: [] },
    disks: [{ path: "/opt", mount: "/", totalBytes: 100, usedBytes: 50, availableBytes: 50, usedPercent: 50 }],
    disksFrom: "host",
    database: { ok: true, pingMs: 1, sizeBytes: 1 },
    redis: { ok: true, pingMs: 1, usedMemoryBytes: 1, peakMemoryBytes: 1, maxMemoryBytes: 0, evictedKeys: 0 },
    backups: { count: 3, totalBytes: 3, partialCount: 0, newest: { name: "bym-1.dump", at: "", sizeBytes: 1, ageHours: 9 } },
    responseTimes: {} as HealthSummary["responseTimes"],
    ...extra,
  }) as HealthSummary;

const keys = (result: CheckResult) => result.problems.map((problem) => problem.key);

describe("finding problems", () => {
  test("a healthy server has none, and only the error check is unchecked without an error count", () => {
    expect(findProblems(healthy(), null, config)).toEqual({ problems: [], unchecked: ["errors"] });
  });

  test("a disk at the limit is nearly full; once open, it stays open until 3 points below", () => {
    const at = (usedPercent: number) => healthy({ disks: [{ ...healthy().disks[0], usedPercent, availableBytes: 2 * 1024 ** 3 }] });
    expect(keys(findProblems(at(89.9), null, config))).toEqual([]);
    const full = findProblems(at(90), null, config);
    expect(full.problems[0]).toMatchObject({ key: "disk", section: "health" });
    expect(full.problems[0].detail).toContain("90% full (2.0 GB left)");
    expect(keys(findProblems(at(87.5), null, config, new Set(["disk"])))).toEqual(["disk"]);
    expect(keys(findProblems(at(86.9), null, config, new Set(["disk"])))).toEqual([]);
  });

  test("the fullest disk counts; no disk sizes leaves the disk unchecked", () => {
    const two = healthy({
      disks: [
        { ...healthy().disks[0], mount: "/", usedPercent: 40 },
        { ...healthy().disks[0], mount: "/mnt/data", usedPercent: 95 },
      ],
    });
    expect(findProblems(two, null, config).problems[0].detail).toContain("/mnt/data");
    expect(findProblems(healthy({ disks: [] }), null, config).unchecked).toContain("disk");
  });

  test("a missed backup: too old, or none at all", () => {
    const aged = (ageHours: number) =>
      healthy({ backups: { ...healthy().backups!, newest: { ...healthy().backups!.newest!, ageHours } } });
    expect(keys(findProblems(aged(25.9), null, config))).toEqual([]);
    expect(findProblems(aged(26), null, config).problems[0]).toMatchObject({ key: "backup", section: "backups" });
    const none = findProblems(healthy({ backups: { count: 0, totalBytes: 0, partialCount: null, newest: null } }), null, config);
    expect(none.problems[0].detail).toContain("no database backup");
  });

  test("without a fresh host.json: one host-status problem, and backups unchecked", () => {
    const missing = findProblems(healthy({ host: null, backups: null }), null, config);
    expect(keys(missing)).toEqual(["host-status"]);
    expect(missing.unchecked).toContain("backup");
    const stale = findProblems(healthy({ host: { ...healthy().host!, stale: true } }), null, config);
    expect(keys(stale)).toEqual(["host-status"]);
    expect(stale.unchecked).toContain("backup");
  });

  test("the database or Redis not answering", () => {
    const result = findProblems(
      healthy({
        database: { ok: false, pingMs: null, sizeBytes: null, error: "refused" },
        redis: { ok: false, pingMs: null, usedMemoryBytes: null, peakMemoryBytes: null, maxMemoryBytes: null, evictedKeys: null, error: "closed" },
      }),
      null,
      config
    );
    expect(keys(result)).toEqual(["database", "redis"]);
    expect(result.problems[0].detail).toContain("refused");
    // Redis's memory cannot be read, so an open memory alert is neither repeated nor called fixed.
    expect(result.unchecked).toEqual(expect.arrayContaining(["redis-memory", "redis-evictions"]));
  });

  test("Redis at 75% of its cap is nearly full; once open, it stays open until 70% (security audit 2026-10-29)", () => {
    const MB = 1024 ** 2;
    const at = (usedMb: number, maxMb = 160) =>
      healthy({ redis: { ...healthy().redis, usedMemoryBytes: usedMb * MB, maxMemoryBytes: maxMb * MB } });

    expect(keys(findProblems(at(119), null, config))).toEqual([]);
    const full = findProblems(at(120), null, config);
    expect(full.problems[0]).toMatchObject({ key: "redis-memory", section: "health" });
    expect(full.problems[0].detail).toContain("120 MB of its 160 MB cap (75%)");

    expect(keys(findProblems(at(113), null, config, new Set(["redis-memory"])))).toEqual(["redis-memory"]);
    expect(keys(findProblems(at(111), null, config, new Set(["redis-memory"])))).toEqual([]);

    // No cap (a local Redis): nothing to measure against.
    expect(keys(findProblems(at(500, 0), null, config))).toEqual([]);
    // ALERT_REDIS_MEMORY_PERCENT moves the line.
    expect(keys(findProblems(at(100), null, alertConfig({ ALERT_REDIS_MEMORY_PERCENT: "60" })))).toEqual(["redis-memory"]);
  });

  test("any key Redis has dropped to save memory is a problem", () => {
    const dropped = (evictedKeys: number) => healthy({ redis: { ...healthy().redis, evictedKeys } });
    expect(keys(findProblems(dropped(0), null, config))).toEqual([]);
    const result = findProblems(dropped(42), null, config);
    expect(keys(result)).toEqual(["redis-evictions"]);
    expect(result.problems[0].detail).toContain("dropped 42 keys");
  });

  test("a jump in errors needs both the minimum and the factor over the usual", () => {
    expect(keys(findProblems(healthy(), { recent: 19, usual: 0 }, config))).toEqual([]);
    expect(keys(findProblems(healthy(), { recent: 40, usual: 10 }, config))).toEqual([]);
    const jump = findProblems(healthy(), { recent: 50, usual: 10 }, config);
    expect(jump.problems[0]).toMatchObject({ key: "errors", section: "errors" });
    expect(jump.unchecked).not.toContain("errors");
  });
});

describe("alert rules", () => {
  const recorder = (fail = false) => {
    const messages: string[] = [];
    const send: SendTelegram = async (text) => {
      messages.push(text);
      return fail ? { sent: false, reason: "down" } : { sent: true };
    };
    return { messages, send };
  };
  const disk = { key: "disk", title: "The server's disk is nearly full", detail: "Disk / is 91% full.", section: "health" as const };

  test("a new problem is said once, with the dashboard link, then not again", async () => {
    const store = memoryAlertStore();
    const { messages, send } = recorder();
    await runAlertRules({ problems: [disk], unchecked: [] }, { store, send, config, now: NOW });
    await runAlertRules({ problems: [disk], unchecked: [] }, { store, send, config, now: NOW + 60_000 });
    await runAlertRules({ problems: [disk], unchecked: [] }, { store, send, config, now: NOW + 11 * HOUR });
    expect(messages).toEqual([
      "BYMR problem: The server's disk is nearly full\nDisk / is 91% full.\nhttps://play.example.test/admin#health",
    ]);
  });

  test("still there after 12 hours: one reminder saying for how long", async () => {
    const store = memoryAlertStore();
    const { messages, send } = recorder();
    await runAlertRules({ problems: [disk], unchecked: [] }, { store, send, config, now: NOW });
    await runAlertRules({ problems: [disk], unchecked: [] }, { store, send, config, now: NOW + ALERT_REMINDER_MS });
    await runAlertRules({ problems: [disk], unchecked: [] }, { store, send, config, now: NOW + ALERT_REMINDER_MS + HOUR });
    expect(messages.length).toBe(2);
    expect(messages[1]).toStartWith("BYMR still a problem (for 12 h): The server's disk is nearly full");
  });

  test("once cleared: one fixed message saying how long it lasted", async () => {
    const store = memoryAlertStore();
    const { messages, send } = recorder();
    await runAlertRules({ problems: [disk], unchecked: [] }, { store, send, config, now: NOW });
    await runAlertRules({ problems: [], unchecked: [] }, { store, send, config, now: NOW + 2 * HOUR + 5 * 60_000 });
    await runAlertRules({ problems: [], unchecked: [] }, { store, send, config, now: NOW + 3 * HOUR });
    expect(messages[1]).toBe(
      "BYMR fixed: The server's disk is nearly full\nIt lasted 2 h 5 min.\nhttps://play.example.test/admin#health"
    );
    expect(messages.length).toBe(2);
    expect((await store.all()).size).toBe(0);
  });

  test("an unchecked problem is neither fixed nor repeated", async () => {
    const store = memoryAlertStore();
    const { messages, send } = recorder();
    const backup = { ...disk, key: "backup", section: "backups" as const };
    await runAlertRules({ problems: [backup], unchecked: [] }, { store, send, config, now: NOW });
    await runAlertRules({ problems: [], unchecked: ["backup"] }, { store, send, config, now: NOW + HOUR });
    expect(messages.length).toBe(1);
    expect((await store.all()).has("backup")).toBe(true);
  });

  test("a message that failed is tried again at the next check", async () => {
    const store = memoryAlertStore();
    const down = recorder(true);
    const run = await runAlertRules({ problems: [disk], unchecked: [] }, { store, send: down.send, config, now: NOW });
    expect(run.failed.length).toBe(1);
    expect((await store.all()).size).toBe(0);
    const up = recorder();
    await runAlertRules({ problems: [disk], unchecked: [] }, { store, send: up.send, config, now: NOW + 60_000 });
    expect(up.messages.length).toBe(1);
  });

  test("with no dashboard address the message has no link", async () => {
    const { messages, send } = recorder();
    await runAlertRules(
      { problems: [disk], unchecked: [] },
      { store: memoryAlertStore(), send, config: { ...config, dashboardUrl: null }, now: NOW }
    );
    expect(messages[0]).toBe("BYMR problem: The server's disk is nearly full\nDisk / is 91% full.");
  });
});

describe("the Redis store of open problems", () => {
  test("one hash field per problem; a broken one is dropped", async () => {
    const hash = new Map<string, string>();
    const store = redisAlertStore({
      hgetall: async (key) => (key === ALERTS_OPEN_KEY ? Object.fromEntries(hash) : {}),
      hset: async (_key, fields) => {
        for (const [field, value] of Object.entries(fields)) hash.set(field, value);
        return 1;
      },
      hdel: async (_key, field) => Number(hash.delete(field)),
    });
    const state: AlertState = { title: "t", section: "health", since: 1, lastSentAt: 2 };
    await store.put("disk", state);
    hash.set("broken", "{");
    expect([...(await store.all())]).toEqual([["disk", state]]);
    await store.remove("disk");
    expect(hash.has("disk")).toBe(false);
  });
});

test("durations read like a person would say them", () => {
  expect(duration(40 * 60_000)).toBe("40 min");
  expect(duration(3 * HOUR)).toBe("3 h");
  expect(duration(3 * HOUR + 5 * 60_000)).toBe("3 h 5 min");
  expect(duration(52 * HOUR)).toBe("2 days 4 h");
  expect(duration(24 * HOUR)).toBe("1 day");
});
