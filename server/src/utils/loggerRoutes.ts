import type { LoggerConfig } from "@logtape/logtape";

/*
 * Kept apart from logger.ts so tests can import it: about 30 test files
 * replace "./logger.js" with mock.module, and Bun keeps that mock for every
 * later file, so an export read from logger.ts itself goes missing there.
 */

/**
 * Which sinks each category writes to.
 *
 * - ["bymr"]: the application logger, debug and above, to every sink. Its
 *   hierarchy includes ["bymr", "http"], the request logs.
 * - ["bymr", "http"] (production only): request logs go to the JSON file only,
 *   not the console, so pm2's out log stops growing by about 200 MB a day
 *   (upstream 96afa485a). The file keeps every request for jq; errors,
 *   warnings and startup lines still reach the console. errorCapture stays in
 *   case an error is ever logged under this category. Locally the console
 *   keeps showing requests.
 * - ["logtape", "meta"]: LogTape's own meta-logging, warnings and above only,
 *   to avoid noise unless the logging system itself has a problem.
 */
export const loggerRoutes = (local: boolean, sinkIds: string[]): LoggerConfig<string, string>[] => [
  {
    category: ["bymr"],
    lowestLevel: "debug",
    sinks: sinkIds,
  },
  ...(local
    ? []
    : [
        {
          category: ["bymr", "http"],
          lowestLevel: "debug" as const,
          sinks: sinkIds.filter((id) => id !== "console"),
          parentSinks: "override" as const,
        },
      ]),
  {
    category: ["logtape", "meta"],
    lowestLevel: "warning",
    sinks: ["console"],
  },
];
