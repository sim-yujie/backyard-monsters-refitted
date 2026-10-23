import { readFile, statfs } from "node:fs/promises";

import { RULES_VERSION } from "../defences/rulesVersion.js";
import { HOST_STATUS_STALE_MS } from "../../config/AlertConfig.js";
import { readHostStatus, type HostStatus, type ReadHostStatus } from "./hostStatus.js";
import { RELEASE_VERSION, type ReleaseVersion } from "./releaseVersion.js";
import { responseTimes, type ResponseTimeSummary } from "./responseTimes.js";

/**
 * The health section of the owner's dashboard (docs/design/admin-dashboard-api.md,
 * "Health"), in one object: how long the game server has been up and which
 * version it runs, its memory, the database's size, Redis's memory, the
 * machine's disks and memory, the containers and their restarts, the newest
 * backup, and how fast requests have been answered.
 *
 * What only the machine itself can see (disks, containers, backups) comes from
 * `status/host.json` (`hostStatus.ts`); without it those parts are null, and
 * the disk falls back to what the container sees of the logs folder's disk.
 * A part that fails (the database down, say) is reported as failed; the
 * summary itself never throws, since it is what tells the owner something is
 * wrong.
 */

const iso = (ms: number): string => new Date(ms).toISOString();

const round1 = (value: number): number => Math.round(value * 10) / 10;

export interface DiskSummary {
  readonly path: string;
  readonly mount: string;
  readonly totalBytes: number | null;
  readonly usedBytes: number | null;
  readonly availableBytes: number | null;
  /** How full, 0-100, one decimal; null when the sizes are unknown. */
  readonly usedPercent: number | null;
}

export interface ContainerSummary {
  readonly service: string;
  readonly state: string;
  readonly health: string | null;
  /** Automatic restarts since the container was made (a deploy makes it afresh). */
  readonly restartCount: number | null;
  readonly startedAt: string;
  /** Docker stopped it last time for running out of memory. */
  readonly oomKilled: boolean;
  readonly exitCode: number | null;
}

export interface BackupSummary {
  readonly count: number;
  readonly totalBytes: number;
  /** Backups cut short (`.partial`), which restore.sh ignores. */
  readonly partialCount: number | null;
  readonly newest: {
    readonly name: string;
    readonly at: string | null;
    readonly sizeBytes: number | null;
    readonly ageHours: number | null;
  } | null;
}

export interface HealthSummary {
  readonly generatedAt: string;
  readonly server: {
    readonly startedAt: string;
    readonly uptimeSeconds: number;
    readonly version: ReleaseVersion;
    readonly rulesVersion: string;
    readonly runtime: string;
    readonly memory: {
      readonly rssBytes: number;
      readonly heapUsedBytes: number;
      /** The container's memory use and limit (cgroup), when it has one. */
      readonly containerUsedBytes: number | null;
      readonly containerLimitBytes: number | null;
    };
  };
  /** From `status/host.json`; null when there is none (a development machine). */
  readonly host: {
    readonly generatedAt: string;
    /** host.json is older than it should be: deploy/host-status.sh has stopped. */
    readonly stale: boolean;
    readonly hostname: string;
    readonly uptimeSeconds: number | null;
    readonly load: readonly (number | null)[];
    readonly memory: HostStatus["memory"];
    /** null when the script could not ask Docker. */
    readonly containers: readonly ContainerSummary[] | null;
  } | null;
  /** The machine's disks (host.json), or the logs folder's disk seen from the container. */
  readonly disks: readonly DiskSummary[];
  readonly disksFrom: "host" | "container" | null;
  readonly database: { readonly ok: boolean; readonly pingMs: number | null; readonly sizeBytes: number | null; readonly error?: string };
  readonly redis: {
    readonly ok: boolean;
    readonly pingMs: number | null;
    readonly usedMemoryBytes: number | null;
    readonly peakMemoryBytes: number | null;
    /** Redis's own cap; 0 means none (the container's 256M limit still applies). */
    readonly maxMemoryBytes: number | null;
    readonly error?: string;
  };
  /** null without host.json; `count: 0` when the folder holds no backup. */
  readonly backups: BackupSummary | null;
  readonly responseTimes: ResponseTimeSummary;
}

/** What the summary reads, swappable in tests. */
export interface HealthDeps {
  readonly now?: number;
  /** One SQL query (`em.execute`). */
  readonly sql: <T>(query: string) => Promise<T[]>;
  /** One raw Redis command (`redis.send`). */
  readonly redisSend: (command: string, args: string[]) => Promise<unknown>;
  readonly readHostStatus?: ReadHostStatus;
  readonly uptimeSeconds?: number;
  readonly memoryUsage?: { rss: number; heapUsed: number };
  readonly containerMemory?: () => Promise<{ used: number | null; limit: number | null }>;
  readonly containerDisk?: () => Promise<DiskSummary | null>;
  readonly responseTimes?: ResponseTimeSummary;
  readonly version?: ReleaseVersion;
}

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err)).slice(0, 300);

/** A number from a cgroup file, or null ("max" or missing). */
const cgroupNumber = async (file: string): Promise<number | null> => {
  try {
    const value = Number((await readFile(file, "utf8")).trim());
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
};

/** The container's memory, from cgroup v2 (Docker on a current Linux). */
export const cgroupMemory = async (): Promise<{ used: number | null; limit: number | null }> => ({
  used: await cgroupNumber("/sys/fs/cgroup/memory.current"),
  limit: await cgroupNumber("/sys/fs/cgroup/memory.max"),
});

const percent = (used: number | null, available: number | null): number | null =>
  used !== null && available !== null && used + available > 0 ? round1((used / (used + available)) * 100) : null;

/** The disk under the logs folder, as the container sees it (a bind mount from the machine). */
export const logsDisk = async (path: string = "logs"): Promise<DiskSummary | null> => {
  try {
    const fs = await statfs(path);
    const total = fs.blocks * fs.bsize;
    const available = fs.bavail * fs.bsize;
    const used = total - fs.bfree * fs.bsize;
    return { path, mount: path, totalBytes: total, usedBytes: used, availableBytes: available, usedPercent: percent(used, available) };
  } catch {
    return null;
  }
};

/** Times one call, in milliseconds to one decimal. */
const timed = async <T>(work: () => Promise<T>): Promise<{ value: T; ms: number }> => {
  const started = performance.now();
  const value = await work();
  return { value, ms: round1(performance.now() - started) };
};

const databaseHealth = async (sql: HealthDeps["sql"]): Promise<HealthSummary["database"]> => {
  try {
    const { value, ms } = await timed(() =>
      sql<{ bytes: string | number }>("SELECT pg_database_size(current_database()) AS bytes")
    );
    return { ok: true, pingMs: ms, sizeBytes: Number(value[0]?.bytes ?? 0) };
  } catch (err) {
    return { ok: false, pingMs: null, sizeBytes: null, error: errorText(err) };
  }
};

/** One `field:value` from Redis's INFO text. */
const infoField = (info: string, field: string): number | null => {
  const match = info.match(new RegExp(`^${field}:(\\d+)\\s*$`, "m"));
  return match ? Number(match[1]) : null;
};

const redisHealth = async (send: HealthDeps["redisSend"]): Promise<HealthSummary["redis"]> => {
  try {
    const { ms } = await timed(() => send("PING", []));
    const info = String(await send("INFO", ["memory"]));
    return {
      ok: true,
      pingMs: ms,
      usedMemoryBytes: infoField(info, "used_memory"),
      peakMemoryBytes: infoField(info, "used_memory_peak"),
      maxMemoryBytes: infoField(info, "maxmemory"),
    };
  } catch (err) {
    return { ok: false, pingMs: null, usedMemoryBytes: null, peakMemoryBytes: null, maxMemoryBytes: null, error: errorText(err) };
  }
};

const backupSummary = (status: HostStatus, now: number): BackupSummary => {
  const backups = status.backups;
  if (!backups.found) return { count: 0, totalBytes: 0, partialCount: null, newest: null };
  const newest = backups.newest;
  return {
    count: backups.count,
    totalBytes: backups.totalBytes,
    partialCount: backups.partialCount,
    newest: newest && {
      name: newest.name,
      at: newest.modifiedAt === null ? null : iso(newest.modifiedAt * 1000),
      sizeBytes: newest.sizeBytes,
      ageHours: newest.modifiedAt === null ? null : round1((now - newest.modifiedAt * 1000) / 3_600_000),
    },
  };
};

/**
 * Builds the health summary.
 *
 * @param {HealthDeps} deps - The database and Redis to ask, and fakes for the rest in tests.
 * @returns {Promise<HealthSummary>} Never rejects; failed parts say so.
 */
export const healthSummary = async (deps: HealthDeps): Promise<HealthSummary> => {
  const now = deps.now ?? Date.now();
  const uptimeSeconds = deps.uptimeSeconds ?? process.uptime();
  const memory = deps.memoryUsage ?? process.memoryUsage();

  const [status, container, database, redis] = await Promise.all([
    (deps.readHostStatus ?? readHostStatus)().catch(() => null),
    (deps.containerMemory ?? cgroupMemory)().catch(() => ({ used: null, limit: null })),
    databaseHealth(deps.sql),
    redisHealth(deps.redisSend),
  ]);

  let disks: DiskSummary[] = [];
  let disksFrom: HealthSummary["disksFrom"] = null;
  if (status) {
    disks = status.disks.map((disk) => ({ ...disk, usedPercent: percent(disk.usedBytes, disk.availableBytes) }));
    disksFrom = "host";
  } else {
    const disk = await (deps.containerDisk ?? logsDisk)().catch(() => null);
    if (disk) {
      disks = [disk];
      disksFrom = "container";
    }
  }

  return {
    generatedAt: iso(now),
    server: {
      startedAt: iso(now - uptimeSeconds * 1000),
      uptimeSeconds: Math.round(uptimeSeconds),
      version: deps.version ?? RELEASE_VERSION,
      rulesVersion: RULES_VERSION,
      runtime: `bun ${typeof Bun === "undefined" ? "?" : Bun.version}`,
      memory: {
        rssBytes: memory.rss,
        heapUsedBytes: memory.heapUsed,
        containerUsedBytes: container.used,
        containerLimitBytes: container.limit,
      },
    },
    host: status && {
      generatedAt: iso(status.generatedAt * 1000),
      stale: now - status.generatedAt * 1000 > HOST_STATUS_STALE_MS,
      hostname: status.hostname,
      uptimeSeconds: status.uptimeSeconds,
      load: status.load,
      memory: status.memory,
      containers: status.containers,
    },
    disks,
    disksFrom,
    database,
    redis,
    backups: status ? backupSummary(status, now) : null,
    responseTimes: deps.responseTimes ?? responseTimes.summary(now),
  };
};
