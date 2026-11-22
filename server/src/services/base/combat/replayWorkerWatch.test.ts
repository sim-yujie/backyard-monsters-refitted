import { describe, expect, mock, test } from "bun:test";

mock.module("../../../utils/logger.js", () => ({
  logger: { fatal: () => {}, error: () => {}, warn: () => {}, info: () => {}, debug: () => {} },
}));

const { brokenWorkersText, restartForBrokenWorkers } = await import("./replayWorkerWatch.js");

/**
 * Replay workers that keep failing to load alert the owner and exit the
 * process, so Docker restarts it (22 Nov 2026 outage).
 */

const BROKEN = { failures: 5, lastError: "SyntaxError: Unexpected keyword 'else'" };

describe("broken replay workers restart the server", () => {
  test("one Telegram message with the error, then exit 1", async () => {
    const sent: string[] = [];
    const exits: number[] = [];
    await restartForBrokenWorkers(BROKEN, {
      send: async (text) => {
        sent.push(text);
        return { sent: true };
      },
      exit: (code) => exits.push(code),
    });
    expect(sent).toEqual([brokenWorkersText(BROKEN)]);
    expect(sent[0]).toContain("restarting");
    expect(sent[0]).toContain("Unexpected keyword 'else'");
    expect(exits).toEqual([1]);
  });

  test("exits even when Telegram never answers", async () => {
    const exits: number[] = [];
    const started = performance.now();
    await restartForBrokenWorkers(BROKEN, {
      send: () => new Promise(() => {}),
      exit: (code) => exits.push(code),
      alertWaitMs: 50,
    });
    expect(exits).toEqual([1]);
    expect(performance.now() - started).toBeLessThan(2_000);
  });

  test("exits when the message fails or throws", async () => {
    const exits: number[] = [];
    await restartForBrokenWorkers(BROKEN, { send: async () => ({ sent: false, reason: "off" }), exit: (code) => exits.push(code) });
    await restartForBrokenWorkers(BROKEN, {
      send: async () => {
        throw new Error("network down");
      },
      exit: (code) => exits.push(code),
    });
    expect(exits).toEqual([1, 1]);
  });

  test("the message names no player and stays short", () => {
    const text = brokenWorkersText({ failures: 5, lastError: "x".repeat(1_000) });
    expect(text.length).toBeLessThan(400);
  });
});
