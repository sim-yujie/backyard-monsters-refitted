import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setAuthToken } from "@/api/http";
import { finishOpen, markOpen, resetOpenTiming } from "@/game/maproom/openMarks";
import type { CompactRecord } from "@/game/maproom/openTimingSummary";
import { connectMr2TimingReport, sendMr2Timing } from "./mr2TimingReport";

/** Map Room 2 open timings reach the server: once per open type per page load, never breaking the map. */

beforeEach(() => {
  resetOpenTiming();
  setAuthToken("token");
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "table").mockImplementation(() => {});
});

afterEach(() => {
  resetOpenTiming();
  setAuthToken(null);
  vi.restoreAllMocks();
});

const open = (): void => {
  markOpen({ quality: "high", classic: false });
  finishOpen("left");
};

describe("connectMr2TimingReport", () => {
  it("posts the first open's record once, to /clienttiming", () => {
    const post = vi.fn(async () => ({ error: 0 }));
    connectMr2TimingReport(post);
    open();
    expect(post).toHaveBeenCalledTimes(1);
    const [path, body] = post.mock.calls[0] as unknown as [string, { record: CompactRecord; gameVersion: string }];
    expect(path).toBe("/api/:apiVersion/clienttiming");
    expect(body.record.v).toBe(1);
    expect(body.record.open).toBe("first");
    expect(body.record.info["quality"]).toBe("high");
    expect(typeof body.gameVersion).toBe("string");
  });

  it("sends at most one first and one later open a page load, even when connected on every open", () => {
    const post = vi.fn(async () => ({ error: 0 }));
    for (let i = 0; i < 4; i++) {
      connectMr2TimingReport(post);
      open();
    }
    expect(post.mock.calls.map((call) => (call as unknown as [string, { record: CompactRecord }])[1].record.open)).toEqual([
      "first",
      "later",
    ]);
  });

  it("sends nothing when signed out", () => {
    setAuthToken(null);
    const post = vi.fn(async () => ({ error: 0 }));
    connectMr2TimingReport(post);
    open();
    expect(post).not.toHaveBeenCalled();
  });

  it("a failed or throwing send never reaches the map", async () => {
    const rejecting = vi.fn(() => Promise.reject(new Error("offline")));
    connectMr2TimingReport(rejecting);
    expect(() => open()).not.toThrow();
    await Promise.resolve();
    expect(rejecting).toHaveBeenCalledTimes(1);

    const throwing = vi.fn(() => {
      throw new Error("boom");
    });
    expect(() => sendMr2Timing({ v: 1 } as unknown as CompactRecord, throwing)).not.toThrow();
  });
});
