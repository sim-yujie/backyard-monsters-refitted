import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { RULES_VERSION } from "../defences/rulesVersion.js";
import { healthSummary, type HealthDeps } from "./healthSummary.js";
import { parseHostStatus, type HostStatus } from "./hostStatus.js";
import { parseReleaseStamp } from "./releaseVersion.js";
import { responseTimeRecorder } from "./responseTimes.js";

/** The health summary from fakes: no database, Redis or files are touched. */

const HOST = parseHostStatus(readFileSync(new URL("./fixtures/host.json", import.meta.url), "utf8"))!;
const NOW = HOST.generatedAt * 1000 + 30_000;

const REDIS_INFO = "# Memory\r\nused_memory:1048576\r\nused_memory_human:1.00M\r\nused_memory_peak:2097152\r\nmaxmemory:0\r\n";

const deps = (extra: Partial<HealthDeps> = {}): HealthDeps => ({
  now: NOW,
  sql: async <T>() => [{ bytes: "123456789" }] as T[],
  redisSend: async (command) => (command === "PING" ? "PONG" : REDIS_INFO),
  readHostStatus: async () => HOST,
  uptimeSeconds: 3600,
  memoryUsage: { rss: 300_000_000, heapUsed: 100_000_000 },
  containerMemory: async () => ({ used: 400_000_000, limit: 2 * 1024 ** 3 }),
  containerDisk: async () => null,
  version: { release: "v2.0.0-beta.4", commit: "1a2b3c4d" },
  ...extra,
});

describe("health summary", () => {
  test("puts every part together", async () => {
    const health = await healthSummary(deps());
    expect(health.generatedAt).toBe(new Date(NOW).toISOString());
    expect(health.server).toMatchObject({
      startedAt: new Date(NOW - 3_600_000).toISOString(),
      uptimeSeconds: 3600,
      version: { release: "v2.0.0-beta.4", commit: "1a2b3c4d" },
      rulesVersion: RULES_VERSION,
      memory: { rssBytes: 300_000_000, containerLimitBytes: 2 * 1024 ** 3 },
    });
    expect(health.database).toMatchObject({ ok: true, sizeBytes: 123456789 });
    expect(health.database.pingMs).toBeGreaterThanOrEqual(0);
    expect(health.redis).toMatchObject({ ok: true, usedMemoryBytes: 1048576, peakMemoryBytes: 2097152, maxMemoryBytes: 0 });
    expect(health.host).toMatchObject({ stale: false, hostname: HOST.hostname });
    expect(health.host?.containers?.length).toBe(3);
    expect(health.disksFrom).toBe("host");
    expect(health.disks[0].usedPercent).toBeGreaterThan(0);
    expect(health.backups).toMatchObject({ count: 2, partialCount: 1, newest: { name: "bym-20261023-030000.dump", sizeBytes: 999 } });
    expect(health.backups?.newest?.ageHours).toBeGreaterThanOrEqual(0);
  });

  test("a disk's fullness is what df would say: used over used plus available", async () => {
    const host: HostStatus = {
      ...HOST,
      disks: [{ path: "/opt", mount: "/", totalBytes: 100, usedBytes: 81, availableBytes: 9 }],
    };
    const health = await healthSummary(deps({ readHostStatus: async () => host }));
    expect(health.disks[0].usedPercent).toBe(90);
  });

  test("an old host.json is stale", async () => {
    const health = await healthSummary(deps({ now: NOW + 11 * 60_000 }));
    expect(health.host?.stale).toBe(true);
  });

  test("without host.json: no host, no backups, and the logs folder's disk instead", async () => {
    const disk = { path: "logs", mount: "logs", totalBytes: 100, usedBytes: 50, availableBytes: 50, usedPercent: 50 };
    const health = await healthSummary(deps({ readHostStatus: async () => null, containerDisk: async () => disk }));
    expect(health.host).toBeNull();
    expect(health.backups).toBeNull();
    expect(health.disksFrom).toBe("container");
    expect(health.disks).toEqual([disk]);
  });

  test("a database or Redis that fails is reported, not thrown", async () => {
    const health = await healthSummary(
      deps({
        sql: async () => {
          throw new Error("connection refused");
        },
        redisSend: async () => {
          throw new Error("socket closed");
        },
        readHostStatus: async () => {
          throw new Error("unreadable");
        },
      })
    );
    expect(health.database).toEqual({ ok: false, pingMs: null, sizeBytes: null, error: "connection refused" });
    expect(health.redis).toMatchObject({ ok: false, error: "socket closed" });
    expect(health.host).toBeNull();
  });

  test("response times: the window's requests, half and 95% marks, and 5xx answers", async () => {
    const recorder = responseTimeRecorder(10);
    for (let ms = 1; ms <= 20; ms++) recorder.record(NOW - 1000, ms, ms === 20 ? 500 : 200);
    recorder.record(NOW - 60 * 60_000, 999, 200); // overwrites the oldest; outside the window anyway
    const summary = recorder.summary(NOW);
    // Only the last 10 kept, one of them an hour old.
    expect(summary).toEqual({ requests: 9, p50Ms: 16, p95Ms: 20, maxMs: 20, serverErrors: 1, windowMinutes: 15 });
    expect(responseTimeRecorder().summary(NOW)).toMatchObject({ requests: 0, p50Ms: null, maxMs: null });
  });
});

describe("release version", () => {
  test("a stamp git archive filled in", () => {
    expect(parseReleaseStamp("v2.0.0-beta.4 1a2b3c4d\n")).toEqual({ release: "v2.0.0-beta.4", commit: "1a2b3c4d" });
  });

  test("placeholders left as they are mean a checkout, not a release copy", () => {
    const stamp = readFileSync(new URL("../../config/release-stamp.txt", import.meta.url), "utf8");
    expect(stamp).toContain("$Format:%(describe:tags)$");
    expect(parseReleaseStamp(stamp)).toEqual({ release: null, commit: null });
  });

  test(".gitattributes has git archive fill the stamp in", () => {
    const attributes = readFileSync(new URL("../../../../.gitattributes", import.meta.url), "utf8");
    expect(attributes).toMatch(/^server\/src\/config\/release-stamp\.txt export-subst$/m);
  });
});
