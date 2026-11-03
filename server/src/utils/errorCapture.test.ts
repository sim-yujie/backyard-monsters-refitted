import { beforeEach, describe, expect, test } from "bun:test";
import type { LogLevel, LogRecord } from "@logtape/logtape";

import {
  errorCaptureSink,
  errorRequestScope,
  PENDING_MAX,
  REPORTERS_KEPT,
  takeCapturedErrors,
  type RequestWho,
} from "./errorCapture.js";

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

  describe("who hit it", () => {
    test("outside a request nothing is kept about anyone", () => {
      errorCaptureSink(record("error", ["boom"]));
      expect(takeCapturedErrors().entries[0]!.reporters).toEqual([]);
    });

    test("a signed-in request keeps the account from the request and its address", async () => {
      const ctx: { ip: string; authUser?: RequestWho["authUser"] } = { ip: "203.0.113.7" };
      await errorRequestScope(ctx, async () => {
        // Signed in after the scope opened, like verifyUserAuth does.
        ctx.authUser = { userid: 42, username: "Alice" };
        await Promise.resolve();
        errorCaptureSink(record("error", ["boom"], {}, 5000));
      });
      expect(takeCapturedErrors().entries[0]!.reporters).toEqual([
        { userid: 42, username: "Alice", ip: "203.0.113.7", at: new Date(5000) },
      ]);
    });

    test("a signed-out request keeps the address and no account", async () => {
      await errorRequestScope({ ip: "198.51.100.2" }, async () => {
        errorCaptureSink(record("error", ["boom"]));
      });
      expect(takeCapturedErrors().entries[0]!.reporters).toEqual([
        { userid: null, username: "", ip: "198.51.100.2", at: new Date(1000) },
      ]);
    });

    test("one per account and address, newest first, a few at most", async () => {
      for (let i = 0; i < REPORTERS_KEPT + 2; i++) {
        await errorRequestScope({ ip: "10.0.0.1", authUser: { userid: i, username: `p${i}` } }, async () => {
          errorCaptureSink(record("error", ["boom"], {}, 1000 + i));
        });
      }
      await errorRequestScope({ ip: "10.0.0.1", authUser: { userid: 3, username: "p3" } }, async () => {
        errorCaptureSink(record("error", ["boom"], {}, 9000));
      });
      const [entry] = takeCapturedErrors().entries;
      expect(entry!.count).toBe(REPORTERS_KEPT + 3);
      expect(entry!.reporters.map((r) => r.userid)).toEqual([3, 6, 5, 4, 2]);
    });
  });
});
