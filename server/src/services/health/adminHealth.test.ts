import { describe, expect, test } from "bun:test";

import { ALERTS_OPEN_KEY } from "../alerts/alerts.js";
import { adminHealthReport } from "./adminHealth.js";

/** The dashboard's health report: the summary, the problems found now, and the open alerts. */

const redis = (open: Record<string, string>) => ({
  send: async (command: string) => (command === "PING" ? "PONG" : "used_memory:5\r\n"),
  hgetall: async (key: string) => (key === ALERTS_OPEN_KEY ? open : {}),
  hset: async () => 1,
  hdel: async () => 1,
});

/** A disk with room, so the machine running the tests does not decide the outcome. */
const roomyDisk = async () => ({ path: "logs", mount: "/", totalBytes: 100, usedBytes: 50, availableBytes: 50, usedPercent: 50 });

describe("admin health report", () => {
  test("puts the summary, what is wrong now and what was already said together", async () => {
    const state = { title: "The server's health check has stopped", section: "health" as const, since: 1, lastSentAt: 1 };
    const report = await adminHealthReport({
      sql: async <T>() => [{ bytes: 42 }] as T[],
      redis: redis({ "host-status": JSON.stringify(state) }),
      readHostStatus: async () => null,
      containerDisk: roomyDisk,
    });
    expect(report.health.database).toMatchObject({ ok: true, sizeBytes: 42 });
    expect(report.health.redis.usedMemoryBytes).toBe(5);
    expect(report.problems.map((problem) => problem.key)).toEqual(["host-status"]);
    expect(report.unchecked).toContain("backup");
    expect(report.openAlerts).toEqual({ "host-status": state });
    expect(typeof report.telegram).toBe("boolean");
  });

  test("Redis down: still a report, with Redis's problem in it", async () => {
    const report = await adminHealthReport({
      sql: async <T>() => [{ bytes: 42 }] as T[],
      redis: {
        send: async () => {
          throw new Error("closed");
        },
        hgetall: async () => {
          throw new Error("closed");
        },
        hset: async () => 1,
        hdel: async () => 1,
      },
      readHostStatus: async () => null,
      containerDisk: roomyDisk,
    });
    expect(report.problems.map((problem) => problem.key)).toContain("redis");
    expect(report.openAlerts).toEqual({});
  });
});
