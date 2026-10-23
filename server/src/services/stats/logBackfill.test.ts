import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { daysWithLogFiles, readLogDays } from "./logBackfill.js";

const line = (at: string, properties: Record<string, unknown>) =>
  JSON.stringify({ "@timestamp": at, level: "INFO", message: "x", properties });

describe("rebuilding daily numbers from log files (logBackfill.ts)", () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "bymr-logbackfill-"));
    writeFileSync(
      join(dir, "bymr-2026-10-20.jsonl"),
      [
        line("2026-10-20T01:00:00Z", { event: "login", userid: 5 }),
        line("2026-10-20T02:00:00Z", { event: "login", userid: 5 }),
        line("2026-10-20T03:00:00Z", { event: "login", userid: 6 }),
        line("2026-10-20T03:30:00Z", { event: "login", userid: "nope" }),
        line("2026-10-20T04:00:00Z", { event: "wild-raid", userid: 5, id: "r1" }),
        // A repeated finish logs the same landing again.
        line("2026-10-20T04:00:05Z", { event: "wild-raid", userid: 5, id: "r1" }),
        line("2026-10-20T05:00:00Z", { event: "wild-raid", userid: 6, id: "r1" }),
        line("2026-10-20T06:00:00Z", { event: "other", userid: 9 }),
        "not json at all",
      ].join("\n")
    );
    // A rotated copy of the same day, with a login that crossed into the next day.
    writeFileSync(
      join(dir, "bymr-2026-10-20.jsonl.1"),
      [line("2026-10-20T07:00:00Z", { event: "login", userid: 7 }), line("2026-10-21T00:00:01Z", { event: "login", userid: 8 })].join(
        "\n"
      )
    );
    writeFileSync(join(dir, "bymr-2026-10-22.jsonl"), "");
    writeFileSync(join(dir, "other-2026-10-21.jsonl"), line("2026-10-21T01:00:00Z", { event: "login", userid: 1 }));
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test("finds which wanted days have a file", () => {
    expect([...daysWithLogFiles(dir, "bymr", ["2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23"])].sort()).toEqual([
      "2026-10-20",
      "2026-10-22",
    ]);
    expect(daysWithLogFiles(join(dir, "missing"), "bymr", ["2026-10-20"]).size).toBe(0);
  });

  test("counts each player's sign-in once and each raid once, on its own day", async () => {
    const days = await readLogDays(dir, "bymr", ["2026-10-20", "2026-10-21", "2026-10-22"]);
    expect([...days.keys()].sort()).toEqual(["2026-10-20", "2026-10-22"]);
    expect([...days.get("2026-10-20")!.logins].sort()).toEqual([5, 6, 7]);
    expect(days.get("2026-10-20")!.raids).toBe(2);
    // A file for the day that is empty: a quiet day, not a missing one.
    expect(days.get("2026-10-22")).toEqual({ logins: new Set(), raids: 0 });
  });
});
