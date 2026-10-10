import { readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { LogRecord, Sink } from "@logtape/logtape";
import { getRotatingFileSink, type RotatingFileSinkOptions } from "@logtape/file";

const DAY_MS = 24 * 60 * 60 * 1000;

/** The UTC date of a moment, `YYYY-MM-DD`. */
export const utcDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** The live log file for one UTC day, e.g. `bymr-2026-10-10.jsonl`. */
export const dayFileName = (base: string, day: string): string => `${base}-${day}.jsonl`;

/** One file in the log directory that belongs to these logs. */
interface LogFile {
  name: string;
  /** The UTC day in its name; null for a file from before day files (`bymr.jsonl`, `bymr.jsonl.3`). */
  day: string | null;
  /** 0 for the live file, n for its nth rotated copy (`.n`), which is older. */
  copy: number;
  size: number;
  mtimeMs: number;
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The log files in `dir` named for `base`; anything else there is left alone. */
const listLogFiles = (dir: string, base: string): LogFile[] => {
  const dayFile = new RegExp(`^${escape(base)}-(\\d{4}-\\d{2}-\\d{2})\\.jsonl(?:\\.(\\d+))?$`);
  const legacyFile = new RegExp(`^${escape(base)}\\.jsonl(?:\\.(\\d+))?$`);
  const files: LogFile[] = [];

  for (const name of readdirSync(dir)) {
    const dayMatch = dayFile.exec(name);
    const legacyMatch = dayMatch ? null : legacyFile.exec(name);
    if (!dayMatch && !legacyMatch) continue;

    const { size, mtimeMs } = statSync(join(dir, name));
    files.push(
      dayMatch
        ? { name, day: dayMatch[1]!, copy: Number(dayMatch[2] ?? 0), size, mtimeMs }
        : { name, day: null, copy: Number(legacyMatch![1] ?? 0), size, mtimeMs }
    );
  }
  return files;
};

export interface PruneOptions {
  /** The file name's stem, `bymr` for `bymr-2026-10-10.jsonl`. */
  base: string;
  /** Files whose lines may be older than this many days are deleted. */
  maxAgeDays: number;
  /** After the age limit, the oldest files go until the rest fit in this many bytes. */
  maxTotalBytes: number;
  now: number;
}

export interface PruneResult {
  deleted: string[];
  /** Files that could not be deleted, with why. */
  failed: { name: string; error: unknown }[];
}

/**
 * Deletes old log files (the Privacy Policy keeps logs with IP addresses
 * for up to `LOG_RETENTION_DAYS`, `config/RetentionConfig.ts`).
 *
 * - Age: a day file goes once its day began `maxAgeDays` ago, so no line in
 *   it is older than the limit. A file from before day files goes once it was
 *   last written that long ago.
 * - Size: then, oldest first, files go until the rest fit in `maxTotalBytes`.
 *
 * Today's live file is never deleted: the sink holds it open.
 *
 * @returns {PruneResult} What was deleted and what could not be.
 */
export const pruneLogFiles = (dir: string, { base, maxAgeDays, maxTotalBytes, now }: PruneOptions): PruneResult => {
  const result: PruneResult = { deleted: [], failed: [] };
  const oldestKept = now - maxAgeDays * DAY_MS;
  const liveName = dayFileName(base, utcDay(now));

  const remove = (file: LogFile): boolean => {
    try {
      unlinkSync(join(dir, file.name));
      result.deleted.push(file.name);
      return true;
    } catch (error) {
      result.failed.push({ name: file.name, error });
      return false;
    }
  };

  const tooOld = (file: LogFile) =>
    file.day === null ? file.mtimeMs <= oldestKept : Date.parse(`${file.day}T00:00:00Z`) <= oldestKept;

  // Oldest first: legacy files, then by day, and within a day the highest copy first.
  const files = listLogFiles(dir, base)
    .filter((file) => file.name !== liveName)
    .sort((a, b) => {
      if (a.day !== b.day) return a.day === null ? -1 : b.day === null ? 1 : a.day < b.day ? -1 : 1;
      return b.copy - a.copy;
    });

  const kept = files.filter((file) => !(tooOld(file) && remove(file)));

  let total = kept.reduce((sum, file) => sum + file.size, 0);
  try {
    total += statSync(join(dir, liveName)).size;
  } catch {
    // No line logged today yet.
  }

  for (const file of kept) {
    if (total <= maxTotalBytes) break;
    if (remove(file)) total -= file.size;
  }

  return result;
};

/**
 * A file sink that starts a new file every UTC day (`bymr-2026-10-10.jsonl`),
 * each rotating by size like `getRotatingFileSink` (`.1` to `.n`), so a day's
 * lines can be deleted as a whole once they are old enough. `onNewDay` runs
 * when the first record of a new day arrives, once the day's file is open and
 * before that record is written; the logger prunes old files there.
 *
 * @param {string} dir - The log directory. It must exist.
 * @param {string} base - The file name's stem.
 * @param {RotatingFileSinkOptions} options - Each day's size rotation and formatting.
 * @param {(day: string) => void} onNewDay - Called with the new day, `YYYY-MM-DD`.
 * @returns {Sink & AsyncDisposable} The sink; disposing it flushes and closes the day's file.
 */
export const getDailyRotatingFileSink = (
  dir: string,
  base: string,
  options: RotatingFileSinkOptions & { nonBlocking: true },
  onNewDay: (day: string) => void
): Sink & AsyncDisposable => {
  let day: string | null = null;
  let current: (Sink & AsyncDisposable) | null = null;
  const closing = new Set<Promise<void>>();

  const close = (sink: Sink & AsyncDisposable) => {
    const done = Promise.resolve(sink[Symbol.asyncDispose]()).catch(() => {});
    closing.add(done);
    void done.finally(() => closing.delete(done));
  };

  const sink = (record: LogRecord) => {
    const recordDay = utcDay(record.timestamp);

    // Only forwards: a record stamped just before midnight but written just
    // after stays in the new day's file rather than reopening yesterday's.
    if (!current || day === null || recordDay > day) {
      const previous = current;
      day = recordDay;
      // The non-blocking overload, which TypeScript does not pick for a typed options object.
      current = getRotatingFileSink(join(dir, dayFileName(base, day)), options) as unknown as Sink & AsyncDisposable;
      if (previous) close(previous);
      // After the switch, so anything `onNewDay` logs goes to the new file.
      onNewDay(day);
    }

    current!(record);
  };

  return Object.assign(sink, {
    [Symbol.asyncDispose]: async () => {
      if (current) close(current);
      current = null;
      await Promise.all(closing);
    },
  });
};
