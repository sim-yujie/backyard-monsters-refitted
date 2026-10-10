import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LogRecord } from "@logtape/logtape";

import { dayFileName, getDailyRotatingFileSink, pruneLogFiles, utcDay } from "./logFiles.js";

/**
 * The server's log files keep no line older than the retention limit (the
 * Privacy Policy keeps logs with IP addresses for 30 days), and together stay
 * under a size cap.
 */

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-10-10T12:00:00Z");

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bymr-logs-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Writes a file of `size` bytes, last modified at `mtime`. */
const file = (name: string, size = 10, mtime = NOW) => {
  writeFileSync(join(dir, name), "x".repeat(size));
  utimesSync(join(dir, name), new Date(mtime), new Date(mtime));
};

const names = () => readdirSync(dir).sort();

const prune = (maxAgeDays = 30, maxTotalBytes = 1_000_000) =>
  pruneLogFiles(dir, { base: "bymr", maxAgeDays, maxTotalBytes, now: NOW });

describe("pruneLogFiles", () => {
  test("a day file goes once its day began more than the limit ago", () => {
    file("bymr-2026-09-09.jsonl");
    file("bymr-2026-09-09.jsonl.1");
    file("bymr-2026-09-10.jsonl"); // began 30.5 days ago
    file("bymr-2026-09-11.jsonl"); // began 29.5 days ago: its lines are all younger than 30 days
    file("bymr-2026-10-10.jsonl");

    const { deleted, failed } = prune();

    expect(deleted.sort()).toEqual(["bymr-2026-09-09.jsonl", "bymr-2026-09-09.jsonl.1", "bymr-2026-09-10.jsonl"]);
    expect(failed).toEqual([]);
    expect(names()).toEqual(["bymr-2026-09-11.jsonl", "bymr-2026-10-10.jsonl"]);
  });

  test("files from before day files go by when they were last written", () => {
    file("bymr.jsonl", 10, NOW - 31 * DAY);
    file("bymr.jsonl.1", 10, NOW - 40 * DAY);
    file("bymr.jsonl.2", 10, NOW - 2 * DAY);

    prune();

    expect(names()).toEqual(["bymr.jsonl.2"]);
  });

  test("other files in the folder are left alone", () => {
    file("notes.txt", 10, NOW - 400 * DAY);
    file("other-2026-01-01.jsonl", 10, NOW - 400 * DAY);

    expect(prune().deleted).toEqual([]);
    expect(names()).toEqual(["notes.txt", "other-2026-01-01.jsonl"]);
  });

  test("over the size cap, the oldest go first, highest copy first, but never today's live file", () => {
    file("bymr.jsonl", 100);
    file("bymr-2026-10-08.jsonl", 100);
    file("bymr-2026-10-08.jsonl.1", 100);
    file("bymr-2026-10-09.jsonl", 100);
    file("bymr-2026-10-10.jsonl.1", 100);
    file("bymr-2026-10-10.jsonl", 500);

    const { deleted } = prune(30, 700);

    expect(deleted).toEqual(["bymr.jsonl", "bymr-2026-10-08.jsonl.1", "bymr-2026-10-08.jsonl"]);
    expect(names()).toEqual(["bymr-2026-10-09.jsonl", "bymr-2026-10-10.jsonl", "bymr-2026-10-10.jsonl.1"]);
  });

  test("today's live file stays even when it alone is over the cap", () => {
    file("bymr-2026-10-10.jsonl", 5000);
    expect(prune(30, 100).deleted).toEqual([]);
  });
});

describe("getDailyRotatingFileSink", () => {
  const record = (timestamp: number, text: string): LogRecord => ({
    category: ["bymr"],
    level: "info",
    message: [text],
    rawMessage: text,
    properties: {},
    timestamp,
  });

  test("each UTC day's lines go to that day's file, and a new day calls onNewDay", async () => {
    const days: string[] = [];
    const sink = getDailyRotatingFileSink(
      dir,
      "bymr",
      { formatter: (r) => `${r.rawMessage}\n`, maxSize: 1024 * 1024, maxFiles: 2, nonBlocking: true },
      (day) => days.push(day)
    );

    const midnight = Date.parse("2026-10-11T00:00:00Z");
    sink(record(midnight - 2000, "late"));
    sink(record(midnight - 1000, "later"));
    sink(record(midnight + 1000, "next day"));
    // Stamped before midnight but arriving after: stays in the new day's file.
    sink(record(midnight - 500, "straggler"));
    await sink[Symbol.asyncDispose]();

    expect(days).toEqual(["2026-10-10", "2026-10-11"]);
    expect(names()).toEqual(["bymr-2026-10-10.jsonl", "bymr-2026-10-11.jsonl"]);
    expect(readFileSync(join(dir, "bymr-2026-10-10.jsonl"), "utf8")).toBe("late\nlater\n");
    expect(readFileSync(join(dir, "bymr-2026-10-11.jsonl"), "utf8")).toBe("next day\nstraggler\n");
  });

  test("names", () => {
    expect(utcDay(NOW)).toBe("2026-10-10");
    expect(dayFileName("bymr", "2026-10-10")).toBe("bymr-2026-10-10.jsonl");
  });
});
