// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ClientErrorBatch, ClientErrorSendResult } from "@/api/clientErrors";
import { BATCH_MAX, BATCHES_MAX, FIRST_SEND_DELAY_MS, SEND_GAP_MS, installErrorReporter, isNoise } from "./errorReporter";

/** The game's own error sender, for the owner's dashboard. */

let stop: (() => void) | null = null;

afterEach(() => {
  stop?.();
  stop = null;
  vi.useRealTimers();
});

const setUp = (answer: ClientErrorSendResult = "sent", signedIn = true) => {
  vi.useFakeTimers();
  const target = new EventTarget() as unknown as Window;
  const sent: { batch: ClientErrorBatch; signedIn: boolean }[] = [];
  stop = installErrorReporter(target, {
    send: async (batch, isSignedIn) => {
      sent.push({ batch, signedIn: isSignedIn });
      return answer;
    },
    signedIn: () => signedIn,
    context: () => ({ gameVersion: "2.0.0-beta.4", screen: "yard" }),
    now: () => Date.now(),
    setTimer: (run, ms) => setTimeout(run, ms),
    clearTimer: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
  });
  const error = (message: string, filename = "https://play.test/static/index-abc.js", error?: unknown) =>
    target.dispatchEvent(new ErrorEvent("error", { message, filename, lineno: 1, colno: 20, error }));
  const rejection = (reason: unknown) => {
    const event = new Event("unhandledrejection") as Event & { reason: unknown };
    event.reason = reason;
    target.dispatchEvent(event);
  };
  return { sent, error, rejection };
};

describe("the error sender", () => {
  it("waits a few seconds, then sends one batch with repeats counted", async () => {
    const { sent, error, rejection } = setUp();
    error("boom", undefined, new TypeError("x is undefined"));
    error("boom", undefined, new TypeError("x is undefined"));
    rejection(new Error("load failed"));
    await vi.advanceTimersByTimeAsync(FIRST_SEND_DELAY_MS - 1);
    expect(sent).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.signedIn).toBe(true);
    expect(sent[0]!.batch).toMatchObject({ gameVersion: "2.0.0-beta.4", screen: "yard" });
    expect(sent[0]!.batch.errors).toEqual([
      expect.objectContaining({ kind: "error", message: "TypeError: x is undefined", place: "https://play.test/static/index-abc.js:1:20", count: 2 }),
      expect.objectContaining({ kind: "rejection", message: "Error: load failed", place: "", count: 1 }),
    ]);
    expect(sent[0]!.batch.errors[0]!.stack).toContain("TypeError");
  });

  it("skips extensions, other sites' scripts and ResizeObserver warnings", async () => {
    const { sent, error } = setUp();
    error("Script error.", "");
    error("ResizeObserver loop completed with undelivered notifications.");
    error("bad", "chrome-extension://abcdef/content.js");
    await vi.advanceTimersByTimeAsync(SEND_GAP_MS * 2);
    expect(sent).toHaveLength(0);
    expect(isNoise("x", "", "at f (moz-extension://1/a.js:1:1)")).toBe(true);
    expect(isNoise("TypeError: x", "/static/a.js", "")).toBe(false);
  });

  it(`sends at most ${BATCH_MAX} kinds a batch, and batches at least ${SEND_GAP_MS / 1000} s apart`, async () => {
    const { sent, error } = setUp();
    for (let i = 0; i < BATCH_MAX + 3; i++) error(`kind ${"x".repeat(i)}`);
    await vi.advanceTimersByTimeAsync(FIRST_SEND_DELAY_MS);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.batch.errors).toHaveLength(BATCH_MAX);
    await vi.advanceTimersByTimeAsync(SEND_GAP_MS - FIRST_SEND_DELAY_MS - 1);
    expect(sent).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(FIRST_SEND_DELAY_MS + 1);
    expect(sent).toHaveLength(2);
    expect(sent[1]!.batch.errors).toHaveLength(3);
  });

  it(`stops after ${BATCHES_MAX} batches in one page load`, async () => {
    const { sent, error } = setUp();
    for (let round = 0; round < BATCHES_MAX + 2; round++) {
      error(`round ${"x".repeat(round)}`);
      await vi.advanceTimersByTimeAsync(SEND_GAP_MS);
    }
    expect(sent).toHaveLength(BATCHES_MAX);
  });

  it("stops at once when the server says so", async () => {
    const { sent, error } = setUp("stop", false);
    error("one");
    await vi.advanceTimersByTimeAsync(FIRST_SEND_DELAY_MS);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.signedIn).toBe(false);
    error("two");
    await vi.advanceTimersByTimeAsync(SEND_GAP_MS * 3);
    expect(sent).toHaveLength(1);
  });

  it("stops listening when uninstalled", async () => {
    const { sent, error } = setUp();
    stop!();
    stop = null;
    error("after");
    await vi.advanceTimersByTimeAsync(SEND_GAP_MS);
    expect(sent).toHaveLength(0);
  });
});
