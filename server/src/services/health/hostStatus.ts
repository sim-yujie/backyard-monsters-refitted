import { readFile } from "node:fs/promises";
import { z } from "zod";

/**
 * Reads `status/host.json`, which `deploy/host-status.sh` writes on the server
 * itself once a minute: the machine's memory and disks, each container's state
 * and restarts, and the newest database backup. The game server sees it only
 * through a read-only mount (docker-compose.prod.yml), never the Docker socket
 * or the backups folder.
 *
 * `HOST_STATUS_FILE` names another file; the default is relative to the
 * server's folder (`/app` in the container). A missing or broken file reads
 * as null: a development machine has none, and the dashboard and alerts say so.
 */

export const DEFAULT_HOST_STATUS_FILE = "status/host.json";

const count = z.number().int().nonnegative();
const nullableCount = count.nullable();

const hostStatusSchema = z.object({
  version: z.literal(1),
  generatedAt: count,
  hostname: z.string(),
  uptimeSeconds: nullableCount,
  load: z.array(z.number().nullable()),
  memory: z.object({
    totalBytes: nullableCount,
    availableBytes: nullableCount,
    swapTotalBytes: nullableCount,
    swapFreeBytes: nullableCount,
  }),
  disks: z.array(
    z.object({
      path: z.string(),
      mount: z.string(),
      totalBytes: nullableCount,
      usedBytes: nullableCount,
      availableBytes: nullableCount,
    })
  ),
  containers: z
    .array(
      z.object({
        service: z.string(),
        state: z.string(),
        health: z.string().nullable(),
        restartCount: nullableCount,
        startedAt: z.string(),
        oomKilled: z.boolean(),
        exitCode: nullableCount,
      })
    )
    .nullable(),
  backups: z.union([
    z.object({ dir: z.string(), found: z.literal(false) }),
    z.object({
      dir: z.string(),
      found: z.literal(true),
      count,
      totalBytes: count,
      partialCount: nullableCount,
      newest: z.object({ name: z.string(), modifiedAt: nullableCount, sizeBytes: nullableCount }).nullable(),
    }),
  ]),
});

export type HostStatus = z.infer<typeof hostStatusSchema>;

/** Reads the host status file; null when there is none or it is not one. */
export type ReadHostStatus = () => Promise<HostStatus | null>;

/** Checks a host status file's contents; null when they are not one. */
export const parseHostStatus = (text: string): HostStatus | null => {
  try {
    const parsed = hostStatusSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

export const readHostStatus: ReadHostStatus = async () => {
  const file = process.env.HOST_STATUS_FILE?.trim() || DEFAULT_HOST_STATUS_FILE;
  try {
    return parseHostStatus(await readFile(file, "utf8"));
  } catch {
    return null;
  }
};
