import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MR2_FIRST_FRAME,
  MR2_FULL_LOOK,
  MR2_PAINTED_ART,
  MR2_PAINTED_FAILED,
  MR2_VIEW_ZONES,
  OPEN_TIMEOUT_MS,
  finishOpen,
  hasMark,
  markOnce,
  markOpen,
  noteInfo,
  noteShader,
  resetOpenTiming,
  setOpenTimingSender,
  timeArea,
  timeArt,
  timeCut,
  timeSpan,
  timeSync,
} from "./openMarks";
import type { CompactRecord, OpenSummary } from "./openTimingSummary";

interface TimingWindow {
  last: OpenSummary | null;
  history: OpenSummary[];
  record: CompactRecord | null;
  current: () => OpenSummary | null;
}

const timing = (): TimingWindow => (globalThis as Record<string, unknown>)["__mr2Timing"] as TimingWindow;

let printed: ReturnType<typeof vi.fn>;

beforeEach(() => {
  resetOpenTiming();
  printed = vi.fn();
  vi.spyOn(console, "info").mockImplementation(printed);
  vi.spyOn(console, "table").mockImplementation(printed);
});

afterEach(() => {
  resetOpenTiming();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("open timing", () => {
  it("records each step once and keeps the browser marks", () => {
    markOpen({ quality: "low" });
    markOnce("mr2-own-cell");
    markOnce("mr2-own-cell");
    expect(hasMark("mr2-own-cell")).toBe(true);
    expect(performance.getEntriesByName("mr2-own-cell", "mark")).toHaveLength(1);
    const current = timing().current()!;
    expect(current.info["quality"]).toBe("low");
    expect(Object.keys(current.steps)).toEqual(["open", "own-cell"]);
  });

  it("is done without the painted look once the zones in view answered and a frame drew", () => {
    markOpen();
    markOnce(MR2_VIEW_ZONES);
    markOnce(MR2_FIRST_FRAME);
    expect(timing().last).toBeNull();
    noteInfo("painted", false);
    expect(timing().last?.reason).toBe("done");
    // The line and the table.
    expect(printed).toHaveBeenCalledTimes(2);
  });

  it("waits for the full look and the painted art when the painted look is on", () => {
    markOpen();
    noteInfo("painted", true);
    markOnce(MR2_VIEW_ZONES);
    markOnce(MR2_FIRST_FRAME);
    markOnce(MR2_FULL_LOOK);
    expect(timing().last).toBeNull();
    markOnce(MR2_PAINTED_ART);
    const last = timing().last!;
    expect(last.reason).toBe("done");
    expect(last.totalMs).toBe(last.steps["painted-art"]);
  });

  it("stops waiting for the painted look when it failed", () => {
    markOpen();
    noteInfo("painted", true);
    markOnce(MR2_VIEW_ZONES);
    markOnce(MR2_FIRST_FRAME);
    markOnce(MR2_PAINTED_FAILED);
    expect(timing().last?.reason).toBe("done");
  });

  it("summarises an open the player left, and a new open does the same for the last one", () => {
    markOpen();
    markOpen();
    expect(timing().last?.reason).toBe("left");
    expect(timing().last?.open).toBe(1);
    finishOpen("left");
    expect(timing().history.map((summary) => [summary.open, summary.type])).toEqual([
      [1, "first"],
      [2, "later"],
    ]);
    // Nothing more once finished.
    expect(finishOpen("left")).toBeNull();
    markOnce("mr2-late");
    expect(hasMark("mr2-late")).toBe(false);
  });

  it("times out with what it has", () => {
    vi.useFakeTimers();
    markOpen();
    vi.advanceTimersByTime(OPEN_TIMEOUT_MS);
    expect(timing().last?.reason).toBe("timeout");
  });

  it("times getarea calls, counting the failures", async () => {
    markOpen();
    await timeArea(async () => "zone");
    await timeArea(async () => "zone");
    await expect(timeArea(async () => Promise.reject(new Error("offline")))).rejects.toThrow("offline");
    const current = timing().current()!;
    expect(current.area).toMatchObject({ calls: 3, answered: 2, failed: 1 });
    expect(current.steps["area-first-sent"]).toBeDefined();
    expect(current.steps["area-first-answer"]).toBeDefined();
  });

  it("times spans, art, canvas cutting and shaders", async () => {
    markOpen();
    await timeSpan("account-hexshape", async () => "flat");
    await expect(timeSpan("own-yard", async () => Promise.reject(new Error("no")))).rejects.toThrow("no");
    expect(timeSync("atlas-bake", () => 7)).toBe(7);
    await timeArt("/maproom/painted/ground@4x.webp", async () => "texture");
    expect(timeCut("ground", () => "cut")).toBe("cut");
    const at = performance.now();
    noteShader({ fragment: "#define SHADER_NAME mr2-painted-ground-low-fragment" }, at, at + 10, at + 4010, true);
    const current = timing().current()!;
    expect(current.spans.map((span) => [span.name, span.ok])).toEqual([
      ["account-hexshape", true],
      ["own-yard", false],
      ["atlas-bake", true],
    ]);
    expect(current.art.map((art) => art.file)).toEqual(["ground@4x.webp"]);
    expect(current.cuts.map((cut) => cut.name)).toEqual(["ground"]);
    expect(current.shaders).toEqual([{ name: "ground-low", waitMs: 10, ms: 4000, ok: true }]);
    expect(performance.getEntriesByName("mr2:atlas-bake", "measure")).toHaveLength(1);
  });

  it("runs the timed work as it is when no open is collecting", async () => {
    expect(await timeSpan("x", async () => 1)).toBe(1);
    expect(await timeArea(async () => 2)).toBe(2);
    expect(timeSync("y", () => 3)).toBe(3);
  });

  it("sends one record per open type per page load", () => {
    const send = vi.fn();
    setOpenTimingSender(send);
    markOpen();
    finishOpen("left");
    markOpen();
    finishOpen("left");
    markOpen();
    finishOpen("left");
    expect(send.mock.calls.map(([record]) => (record as CompactRecord).open)).toEqual(["first", "later"]);
    expect(timing().record?.open).toBe("later");
  });

  it("keeps a failing sender from breaking the map", () => {
    setOpenTimingSender(() => {
      throw new Error("down");
    });
    markOpen();
    expect(() => finishOpen("left")).not.toThrow();
  });
});
