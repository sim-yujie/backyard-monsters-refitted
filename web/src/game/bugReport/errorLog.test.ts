// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ERROR_LINE_MAX,
  ERROR_LOG_SIZE,
  clearErrorLog,
  describeError,
  installErrorLog,
  recentErrors,
  recordError,
} from "./errorLog";

/** The bug report's list of recent game errors, kept in memory only. */

let stop: (() => void) | null = null;

afterEach(() => {
  stop?.();
  stop = null;
  clearErrorLog();
});

describe("the error list", () => {
  it(`keeps the last ${ERROR_LOG_SIZE}, oldest first, each with its time`, () => {
    const at = new Date("2026-10-21T08:09:10Z");
    for (let i = 0; i < ERROR_LOG_SIZE + 5; i++) recordError("error", `number ${i}`, at);
    const list = recentErrors();
    expect(list).toHaveLength(ERROR_LOG_SIZE);
    expect(list[0]).toBe("08:09:10 error: number 5");
    expect(list.at(-1)).toBe(`08:09:10 error: number ${ERROR_LOG_SIZE + 4}`);
  });

  it("cuts a long entry", () => {
    recordError("error", "x".repeat(5000));
    expect(recentErrors()[0]!.length).toBe(ERROR_LINE_MAX);
    expect(recentErrors()[0]!.endsWith("…")).toBe(true);
  });

  it("hands out a copy", () => {
    recordError("error", "one");
    recentErrors().push("not kept");
    expect(recentErrors()).toHaveLength(1);
  });

  it("describes errors with the top of their stack, and other values as text", () => {
    const error = new TypeError("x is undefined");
    error.stack = "TypeError: x is undefined\n    at a (yard.ts:1:2)\n    at b (yard.ts:3:4)";
    expect(describeError(error)).toBe("TypeError: x is undefined | at a (yard.ts:1:2) | at b (yard.ts:3:4)");
    expect(describeError("plain")).toBe("plain");
    expect(describeError({ code: 5 })).toBe('{"code":5}');
    expect(describeError(undefined)).toBe("undefined");
  });
});

describe("installErrorLog", () => {
  it("hears uncaught errors, unhandled rejections and console.error, and still logs to the console", () => {
    const out = { error: vi.fn() } as unknown as Console;
    const original = out.error;
    stop = installErrorLog(window, out);

    window.dispatchEvent(new ErrorEvent("error", { message: "boom", filename: "/src/game.ts", lineno: 3, colno: 9 }));
    const rejection = new Event("unhandledrejection") as PromiseRejectionEvent;
    Object.defineProperty(rejection, "reason", { value: new Error("load failed") });
    window.dispatchEvent(rejection);
    out.error("Failed to start:", new RangeError("too far"));

    const list = recentErrors();
    expect(list).toHaveLength(3);
    expect(list[0]).toMatch(/ error: boom \(\/src\/game\.ts:3:9\)$/);
    expect(list[1]).toMatch(/ unhandled rejection: Error: load failed/);
    expect(list[2]).toMatch(/ console\.error: Failed to start: RangeError: too far/);
    expect(original).toHaveBeenCalledWith("Failed to start:", expect.any(RangeError));

    stop();
    stop = null;
    expect(out.error).toBe(original);
    window.dispatchEvent(new ErrorEvent("error", { message: "after" }));
    expect(recentErrors()).toHaveLength(3);
  });

  it("installs once", () => {
    const out = { error: vi.fn() } as unknown as Console;
    stop = installErrorLog(window, out);
    expect(installErrorLog(window, out)).toBe(stop);
    out.error("once");
    expect(recentErrors()).toHaveLength(1);
  });
});
