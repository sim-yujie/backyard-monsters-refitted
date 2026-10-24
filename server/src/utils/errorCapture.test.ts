import { beforeEach, describe, expect, test } from "bun:test";
import type { LogLevel, LogRecord } from "@logtape/logtape";

import { errorCaptureSink, PENDING_MAX, takeCapturedErrors } from "./errorCapture.js";

const record = (level: LogLevel, message: unknown[], properties: Record<string, unknown> = {}, timestamp = 1000): LogRecord =>
  ({
    category: ["bymr", "app"],
    level,
    message,
    rawMessage: "",
    timestamp,
    properties,
  }) as unknown as LogRecord;

describe("the logger's error catcher (errorCapture.ts)", () => {
  beforeEach(() => {
    takeCapturedErrors();
  });

  test("keeps error and fatal records only", () => {
    errorCaptureSink(record("info", ["hello"]));
    errorCaptureSink(record("warning", ["careful"]));
    errorCaptureSink(record("error", ["broke"]));
    errorCaptureSink(record("fatal", ["very broke"]));
    const { entries, dropped } = takeCapturedErrors();
    expect(entries.map((entry) => entry.message).sort()).toEqual(["broke", "very broke"]);
    expect(dropped).toBe(0);
    expect(takeCapturedErrors().entries).toEqual([]);
  });

  test("one entry per kind, counted, with the latest time; values filled in and cleaned", () => {
    const err = new Error("save 12 failed for a@b.com");
    errorCaptureSink(record("error", ["Save failed: ", err, ""], { method: "POST", path: "/api/v1/bm/base/save" }, 1000));
    errorCaptureSink(
      record("error", ["Save failed: ", new Error("save 99 failed for c@d.com"), ""], { method: "POST", path: "/api/v1/bm/base/save" }, 2000)
    );
    const { entries } = takeCapturedErrors();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      message: "Save failed: Error: save 12 failed for [email]",
      place: "POST /api/v1/bm/base/save",
      count: 2,
      at: 2000,
    });
    expect(entries[0]!.stack).toContain("save 12 failed");
  });

  test("a record without a route is placed by its category", () => {
    errorCaptureSink(record("error", ["boom"]));
    expect(takeCapturedErrors().entries[0]!.place).toBe("bymr.app");
  });

  test("past the cap, new kinds are only counted", () => {
    for (let i = 0; i < PENDING_MAX + 3; i++) errorCaptureSink(record("error", [`kind ${"x".repeat(i)}`]));
    const { entries, dropped } = takeCapturedErrors();
    expect(entries).toHaveLength(PENDING_MAX);
    expect(dropped).toBe(3);
  });
});
