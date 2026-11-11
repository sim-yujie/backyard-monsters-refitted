import { describe, expect, test } from "bun:test";
import { getLogger, withConfigSync, type LogRecord, type Sink } from "@logtape/logtape";

import { loggerRoutes } from "./logger.js";

/**
 * In production, request logs (["bymr", "http"]) go to the JSON log file only,
 * not the console, so pm2's out log stops growing by about 200 MB a day
 * (upstream 96afa485a). Every other record still reaches the console. Locally
 * nothing changes. Runs the real routes through LogTape with recording sinks,
 * scoped to each test so the app's own logging setup is untouched.
 */

const SINK_IDS = ["console", "file", "errorCapture"] as const;

/** Routes one http record, one app warning and one app error; returns what each sink got. */
const route = (local: boolean, sinkIds: readonly string[] = SINK_IDS) => {
  const got: Record<string, string[]> = {};
  const sinks: Record<string, Sink> = {};
  for (const id of sinkIds) {
    got[id] = [];
    sinks[id] = (record: LogRecord) => got[id].push(`${record.category.join(".")}:${record.level}`);
  }

  withConfigSync({ sinks, loggers: loggerRoutes(local, [...sinkIds]) }, () => {
    getLogger(["bymr", "http"]).info("GET /base/load 200");
    getLogger(["bymr", "app"]).warn("careful");
    getLogger(["bymr"]).error("broken");
  });

  return got;
};

describe("logger routes", () => {
  test("production: request logs go to the file, not the console", () => {
    const got = route(false);

    expect(got.file).toContain("bymr.http:info");
    expect(got.console).not.toContain("bymr.http:info");
  });

  test("production: warnings, errors and other records still reach the console and the file", () => {
    const got = route(false);

    expect(got.console).toEqual(["bymr.app:warning", "bymr:error"]);
    expect(got.file).toEqual(["bymr.http:info", "bymr.app:warning", "bymr:error"]);
  });

  test("production: the error catcher still sees every record, request logs included", () => {
    expect(route(false).errorCapture).toEqual(["bymr.http:info", "bymr.app:warning", "bymr:error"]);
  });

  test("local: the console still shows request logs", () => {
    const got = route(true, ["console", "errorCapture"]);

    expect(got.console).toEqual(["bymr.http:info", "bymr.app:warning", "bymr:error"]);
  });

  test("local: no extra http route is added", () => {
    const categories = loggerRoutes(true, ["console"]).map((route) => route.category);

    expect(categories).not.toContainEqual(["bymr", "http"]);
  });
});
