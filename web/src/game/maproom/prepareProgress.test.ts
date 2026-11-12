import { describe, expect, it } from "vitest";
import {
  EXPECT_MS,
  PrepareTracker,
  PENDING_DELAY_MS,
  RUNNING_CAP,
  STALL_MS,
  StallGuard,
  markPreparedThisPage,
  pendingShows,
  preparedThisPage,
  prepareShows,
  programShare,
  resetPreparedThisPage,
  type NeededProgram,
  type PendingFacts,
  type PrepareFacts,
  type WarmerView,
} from "./prepareProgress";

/** A stand-in warmer: each program by its fragment text is ready, failed, compiling since a time, or waiting. */
const fakeWarmer = () => {
  const ready = new Set<string>();
  const failed = new Set<string>();
  const started = new Map<string, number>();
  const view: WarmerView = {
    ready: (source) => ready.has(source.fragment ?? ""),
    failed: (source) => failed.has(source.fragment ?? ""),
    startedAt: (source) => started.get(source.fragment ?? "") ?? null,
  };
  return { view, ready, failed, started };
};

const program = (key: string, expectMs: number = EXPECT_MS.small): NeededProgram => ({ key, source: { fragment: key }, expectMs });

/** What Firefox's first open at High needs: the Low ground, the small ones, then the High ground. */
const firstOpenHigh = (): NeededProgram[] => [
  program("ground-low", EXPECT_MS.ground.low),
  program("borders"),
  program("clouds"),
  program("place-0"),
  program("ground-high", EXPECT_MS.ground.high),
];

describe("the Preparing map bar's progress (programs compiled, weighted by how long each takes)", () => {
  it("counts a ready or failed program as done, a waiting one as nothing, a compiling one part-way", () => {
    const { view, ready, failed, started } = fakeWarmer();
    const p = program("ground-high", 10_000);
    expect(programShare(view, p, 0)).toBe(0);
    started.set("ground-high", 1_000);
    const early = programShare(view, p, 2_000);
    const later = programShare(view, p, 11_000);
    expect(early).toBeGreaterThan(0);
    expect(later).toBeGreaterThan(early);
    // However long it takes, a program still compiling never counts as finished.
    expect(programShare(view, p, 1_000_000)).toBeLessThanOrEqual(RUNNING_CAP);
    ready.add("ground-high");
    expect(programShare(view, p, 2_000)).toBe(1);
    ready.clear();
    failed.add("ground-high");
    expect(programShare(view, p, 2_000)).toBe(1);
  });

  it("follows a Firefox first open from 0% to 100%, the High ground being most of it", () => {
    const { view, ready, started } = fakeWarmer();
    const tracker = new PrepareTracker(view);
    tracker.update(firstOpenHigh());
    expect(tracker.hadWork).toBe(true);
    expect(tracker.percent(0)).toBe(0);
    started.set("ground-low", 0);
    const compilingLow = tracker.percent(2_000);
    expect(compilingLow).toBeGreaterThan(0);
    started.delete("ground-low");
    for (const key of ["ground-low", "borders", "clouds", "place-0"]) ready.add(key);
    const smallDone = tracker.percent(5_000);
    // Low and the small ones are about a quarter: the High ground is the long wait.
    expect(smallDone).toBeGreaterThan(20);
    expect(smallDone).toBeLessThan(40);
    ready.add("ground-high");
    expect(tracker.percent(17_000)).toBe(100);
  });

  it("leaves out what was already compiled when the map opened, so it starts at 0%", () => {
    const { view, ready } = fakeWarmer();
    ready.add("borders");
    ready.add("clouds");
    const tracker = new PrepareTracker(view);
    tracker.update([program("borders"), program("clouds"), program("ground-medium", EXPECT_MS.ground.medium)]);
    expect(tracker.percent(0)).toBe(0);
  });

  it("has nothing to show when everything was ready (Chrome after the yard's warm-up, a second open)", () => {
    const { view, ready } = fakeWarmer();
    for (const p of firstOpenHigh()) ready.add(p.key);
    const tracker = new PrepareTracker(view);
    expect(tracker.tracking).toBe(false);
    tracker.update(firstOpenHigh());
    expect(tracker.tracking).toBe(true);
    expect(tracker.hadWork).toBe(false);
    expect(tracker.percent(0)).toBe(100);
  });

  it("never goes back, even when a Quality change adds a program", () => {
    const { view, ready } = fakeWarmer();
    const tracker = new PrepareTracker(view);
    tracker.update([program("borders"), program("ground-low", EXPECT_MS.ground.low)]);
    ready.add("ground-low");
    const before = tracker.percent(0);
    expect(before).toBeGreaterThan(80);
    tracker.update([program("ground-high", EXPECT_MS.ground.high)]);
    expect(tracker.percent(0)).toBe(before);
  });

  it("adds each program once, however often it is asked", () => {
    const { view, ready } = fakeWarmer();
    const tracker = new PrepareTracker(view);
    tracker.update([program("a", 1_000), program("b", 1_000)]);
    tracker.update([program("a", 1_000), program("b", 1_000)]);
    ready.add("a");
    expect(tracker.percent(0)).toBe(50);
  });
});

describe("when the Preparing map screen shows", () => {
  const compiling: PrepareFacts = {
    classic: false,
    paintedWanted: true,
    failed: false,
    fullLook: false,
    hadWork: true,
  };

  it("shows while the painted look compiles on an open that had work left", () => {
    expect(prepareShows(compiling)).toBe(true);
  });

  it("never shows in Classic", () => {
    expect(prepareShows({ ...compiling, classic: true })).toBe(false);
  });

  it("never shows when nothing was left to compile (a second open, Chrome after the warm-up)", () => {
    expect(prepareShows({ ...compiling, hadWork: false })).toBe(false);
  });

  it("goes when the full look is in", () => {
    expect(prepareShows({ ...compiling, fullLook: true })).toBe(false);
  });

  it("never shows without the painted look, or where it failed (the tiles stay)", () => {
    expect(prepareShows({ ...compiling, paintedWanted: false })).toBe(false);
    expect(prepareShows({ ...compiling, failed: true })).toBe(false);
  });
});

describe("covering the map while the look's code is on its way", () => {
  const firstOpen: PendingFacts = {
    classic: false,
    paintedWanted: true,
    failed: false,
    webGL2: true,
    preparedBefore: false,
    warmedUp: false,
    waitedMs: PENDING_DELAY_MS,
  };

  it("covers a first open after a moment, so the plain tiles are never seen", () => {
    expect(pendingShows(firstOpen)).toBe(true);
    expect(pendingShows({ ...firstOpen, waitedMs: PENDING_DELAY_MS - 1 })).toBe(false);
  });

  it("does not cover a map already prepared on this page, or warmed up in the yard", () => {
    expect(pendingShows({ ...firstOpen, preparedBefore: true })).toBe(false);
    expect(pendingShows({ ...firstOpen, warmedUp: true })).toBe(false);
  });

  it("does not cover in Classic, without the painted look, without WebGL2, or once it failed", () => {
    expect(pendingShows({ ...firstOpen, classic: true })).toBe(false);
    expect(pendingShows({ ...firstOpen, paintedWanted: false })).toBe(false);
    expect(pendingShows({ ...firstOpen, webGL2: false })).toBe(false);
    expect(pendingShows({ ...firstOpen, failed: true })).toBe(false);
  });

  it("remembers for the page that the full look came in", () => {
    resetPreparedThisPage();
    expect(preparedThisPage()).toBe(false);
    markPreparedThisPage();
    expect(preparedThisPage()).toBe(true);
    resetPreparedThisPage();
  });
});

describe("the screen never gets stuck", () => {
  it("gives up after STALL_MS without progress", () => {
    const guard = new StallGuard();
    expect(guard.check({ show: true, percent: 40 }, 0)).toBe(false);
    expect(guard.check({ show: true, percent: 40 }, STALL_MS - 1)).toBe(false);
    expect(guard.check({ show: true, percent: 40 }, STALL_MS)).toBe(true);
    // Once given up, it stays given up.
    expect(guard.check({ show: true, percent: 90 }, STALL_MS + 1)).toBe(true);
  });

  it("starts the wait again whenever the percent moves", () => {
    const guard = new StallGuard(1_000);
    guard.check({ show: true, percent: 10 }, 0);
    expect(guard.check({ show: true, percent: 11 }, 900)).toBe(false);
    expect(guard.check({ show: true, percent: 11 }, 1_800)).toBe(false);
    expect(guard.check({ show: true, percent: 11 }, 1_900)).toBe(true);
  });

  it("does not count time while hidden", () => {
    const guard = new StallGuard(1_000);
    guard.check({ show: false, percent: 0 }, 0);
    expect(guard.check({ show: false, percent: 0 }, 5_000)).toBe(false);
    expect(guard.check({ show: true, percent: 0 }, 5_000)).toBe(false);
    expect(guard.check({ show: true, percent: 0 }, 5_999)).toBe(false);
  });
});
