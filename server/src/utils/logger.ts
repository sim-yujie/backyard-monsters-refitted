import { AsyncLocalStorage } from "node:async_hooks";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  configure,
  getConsoleSink,
  getJsonLinesFormatter,
  getLogger,
  type Sink,
} from "@logtape/logtape";
import { getPrettyFormatter } from "@logtape/pretty";
import { Env } from "../enums/Env.js";
import { retentionConfig } from "../config/RetentionConfig.js";
import { getDailyRotatingFileSink, pruneLogFiles } from "./logFiles.js";

/**
 * Directory for the JSON log files in production: server/logs, resolved from this
 * file rather than the working directory, so it doesn't depend on where pm2 was
 * started. The file sink does not create it.
 */
const LOG_DIR = fileURLToPath(new URL("../../logs", import.meta.url));

const isLocal = process.env.ENV === Env.LOCAL;

if (!isLocal) mkdirSync(LOG_DIR, { recursive: true });

/** The log files' name stem: `logs/bymr-2026-10-10.jsonl`. */
const LOG_BASE = "bymr";

/** The most the log files may hold together once old days are pruned. */
const LOG_MAX_TOTAL_BYTES = 1024 * 1024 * 1024;

/**
 * Deletes log files older than `LOG_RETENTION_DAYS`, then the oldest until the
 * rest fit in {@link LOG_MAX_TOTAL_BYTES} (`utils/logFiles.ts`). What it did is
 * logged on the next tick, not from inside the file sink that calls it.
 */
const pruneOldLogs = () => {
  const { deleted, failed } = pruneLogFiles(LOG_DIR, {
    base: LOG_BASE,
    maxAgeDays: retentionConfig().logDays,
    maxTotalBytes: LOG_MAX_TOTAL_BYTES,
    now: Date.now(),
  });
  if (!deleted.length && !failed.length) return;

  setTimeout(() => {
    if (deleted.length) logger.info("Deleted old log files: {files}", { files: deleted.join(", ") });
    for (const { name, error } of failed) logger.warn("Could not delete old log file {name}: {error}", { name, error });
  }, 0);
};

/**
 * Sinks for the current environment.
 *
 * - console: @logtape/pretty everywhere. Locally it also prints each record's
 *   properties. In production it prints one line per record with no word wrap
 *   (pm2 is not a terminal), which is what `pm2 logs` shows. It stays blocking
 *   so a record logged just before process.exit() is never lost.
 * - file (production only): every record as JSON Lines, message kept as its
 *   template, for querying with jq. A new file starts every UTC day
 *   (`bymr-2026-10-10.jsonl`) and rotates at 100 MB, keeping 9 rotated copies
 *   (.1 to .9). When a day starts, and on the first line after boot, the file
 *   sink runs {@link pruneOldLogs}:
 *   days older than `LOG_RETENTION_DAYS` go (30 by default, the Privacy
 *   Policy's limit for logs with IP addresses), then the oldest files until
 *   the rest fit in 1 GB. It is non-blocking, so writes are buffered and
 *   flushed off the request path.
 */
const sinks: Record<string, Sink> = isLocal
  ? {
      console: getConsoleSink({ formatter: getPrettyFormatter({ properties: true }) }),
    }
  : {
      console: getConsoleSink({
        formatter: getPrettyFormatter({
          timestamp: "date-time",
          categorySeparator: ".",
          categoryWidth: 10,
          properties: false,
          wordWrap: false,
        }),
      }),
      file: getDailyRotatingFileSink(
        LOG_DIR,
        LOG_BASE,
        {
          formatter: getJsonLinesFormatter({ message: "template" }),
          maxSize: 100 * 1024 * 1024,
          maxFiles: 9,
          nonBlocking: true,
        },
        pruneOldLogs
      ),
    };

/**
 * Configure LogTape logging for the application.
 *
 * Enables implicit contexts through AsyncLocalStorage, which the request
 * logging middleware uses to attach requestId, remoteAddr and userAgent to
 * every record emitted while a request is handled.
 *
 * This configuration is executed eagerly at startup and must
 * complete before any logger is used.
 */
await configure({
  contextLocalStorage: new AsyncLocalStorage(),
  sinks,
  loggers: [
    {
      /**
       * Primary application logger.
       *
       * Category hierarchy: ["bymr", ...], including ["bymr", "http"] for
       * request logs. Logs everything from debug and above.
       */
      category: ["bymr"],
      lowestLevel: "debug",
      sinks: Object.keys(sinks),
    },
    {
      /**
       * Internal LogTape meta-logging.
       *
       * Reduced verbosity to avoid noise unless warnings
       * or errors occur within the logging system itself.
       */
      category: ["logtape", "meta"],
      lowestLevel: "warning",
      sinks: ["console"],
    },
  ],
});

/**
 * Root application logger.
 */
export const logger = getLogger(["bymr"]);
