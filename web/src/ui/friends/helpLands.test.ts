// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HelpAllSummary } from "@/game/friends/helpAll";
import type { HelpAllLine } from "./HelpAllBar";
import { helpAllFxMaker, type HelpFxStage } from "./helpAllFx";
import { HELP_LANDS_DONE_MS, HELP_LANDS_SETTLE_MS, HELP_LANDS_STAGGER_MS, HelpLandsFx } from "./helpLands";

/**
 * Help all's effect, "help lands" (owner, Review Desk 7, 15 Nov 2026): the
 * wrenches pop one after another, the bar counts 1/3 .. 3/3, then each
 * counter counts up once with one total under it, and the bar shows the
 * tools, a tick and the count.
 */

const fakeStage = (reducedMotion = false) => {
  const log: string[] = [];
  const stage = {
    hud: {
      hold: vi.fn(),
      deliver: vi.fn((key: string, amount: number, ms?: number) => log.push(`deliver ${key} ${amount} ${ms}`)),
      floatBelow: vi.fn((key: string, delta: number) => log.push(`float ${key} ${delta}`)),
      pulse: vi.fn(),
      readoutBox: vi.fn(() => null),
      releaseHeld: vi.fn(() => log.push("hud release")),
    },
    marks: {
      hold: vi.fn((ids: readonly number[]) => log.push(`hold ${ids.join(",")}`)),
      leave: vi.fn((id: number, exit?: string) => log.push(`leave ${id} ${exit ?? "-"}`)),
      release: vi.fn(() => log.push("marks release")),
    },
    bar: { setProgress: vi.fn((done: number, total: number) => log.push(`bar ${done}/${total}`)), element: document.createElement("div") },
    wrenchAt: () => null,
    reducedMotion,
  };
  return { stage: stage as unknown as HelpFxStage, raw: stage, log };
};

const reward = { r1: 100, r2: 100, r3: 100, r4: 100 };
const summary = (over: Partial<HelpAllSummary> = {}): HelpAllSummary => ({
  helped: 3,
  secondsSaved: 3600,
  reward: { r1: 300, r2: 300, r3: 300, r4: 300 },
  skipped: 0,
  stoppedBy: null,
  ...over,
});
const line: HelpAllLine = { text: "Helped 3", full: "Helped 3", kind: "thanks" };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("HelpLandsFx", () => {
  it("is what Help all plays, with no switch", () => {
    const { stage } = fakeStage();
    expect(helpAllFxMaker()?.(stage)).toBeInstanceOf(HelpLandsFx);
  });

  it("pops each wrench in turn, counts the bar on, then counts every counter up once with one total", async () => {
    const { stage, raw, log } = fakeStage();
    const fx = new HelpLandsFx(stage);
    fx.start([1, 2, 3]);
    expect(log).toEqual(["hold 1,2,3", "bar 0/3"]);
    // All three land at once, as the server answers fast.
    fx.helped({ id: 1, secondsSaved: 1200, reward });
    fx.helped({ id: 2, secondsSaved: 1200, reward });
    fx.helped({ id: 3, secondsSaved: 1200, reward });
    const result = fx.done(summary(), line);
    await vi.advanceTimersByTimeAsync(0);
    expect(log.slice(2)).toEqual(["bar 1/3", "leave 1 pop"]);
    await vi.advanceTimersByTimeAsync(HELP_LANDS_STAGGER_MS);
    expect(log.slice(4)).toEqual(["bar 2/3", "leave 2 pop"]);
    await vi.advanceTimersByTimeAsync(HELP_LANDS_STAGGER_MS);
    expect(log.slice(6)).toEqual(["bar 3/3", "leave 3 pop"]);
    // Nothing reaches the counters until the last tag has read.
    expect(raw.hud.deliver).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(HELP_LANDS_SETTLE_MS);
    const played = await result;
    expect(raw.hud.deliver.mock.calls).toEqual([
      ["r1", 300, 420],
      ["r2", 300, 420],
      ["r3", 300, 420],
      ["r4", 300, 420],
    ]);
    expect(raw.hud.floatBelow.mock.calls).toEqual([
      ["r1", 300],
      ["r2", 300],
      ["r3", 300],
      ["r4", 300],
    ]);
    expect(raw.hud.pulse).toHaveBeenCalledTimes(4);
    expect(raw.marks.release).toHaveBeenCalledTimes(1);
    // The bar: the tools, a tick and "3" for 1.1 s; the words stay for a screen reader.
    expect(played?.ms).toBe(HELP_LANDS_DONE_MS);
    expect(played?.text).toBe("Helped 3");
    expect(played?.node?.querySelector("img.game-icon--tools")).not.toBeNull();
    expect(played?.node?.querySelector(".help-all-done__tick")?.textContent).toBe("✔");
    expect(played?.node?.querySelector(".help-all-done__count")?.textContent).toBe("3");
  });

  it("lets a refused help's wrench go and still counts the bar on", async () => {
    const { stage, log } = fakeStage();
    const fx = new HelpLandsFx(stage);
    fx.start([1, 2]);
    fx.missed(1);
    fx.helped({ id: 2, secondsSaved: 60, reward });
    const result = fx.done(summary({ helped: 1, skipped: 1 }), line);
    await vi.advanceTimersByTimeAsync(HELP_LANDS_STAGGER_MS + HELP_LANDS_SETTLE_MS);
    expect((await result)?.node?.querySelector(".help-all-done__count")?.textContent).toBe("1");
    expect(log).toContain("leave 1 -");
    expect(log).toContain("bar 1/2");
    expect(log).toContain("leave 2 pop");
    expect(log).toContain("bar 2/2");
  });

  it("keeps the scene's words after a stop or when nothing was helped", async () => {
    for (const ended of [summary({ helped: 1, stoppedBy: "Signed out" }), summary({ helped: 0, reward: {} })]) {
      const { stage, raw } = fakeStage();
      const fx = new HelpLandsFx(stage);
      fx.start([1]);
      if (ended.helped > 0) fx.helped({ id: 1, secondsSaved: 60, reward });
      else fx.missed(1);
      const result = fx.done(ended, line);
      await vi.advanceTimersByTimeAsync(HELP_LANDS_SETTLE_MS);
      expect(await result).toBeNull();
      // What did land still reaches the counters.
      expect(raw.hud.deliver).toHaveBeenCalledTimes(ended.helped > 0 ? 4 : 0);
      expect(raw.marks.release).toHaveBeenCalled();
    }
  });

  it("counts straight in with reduced motion", async () => {
    const { stage, raw } = fakeStage(true);
    const fx = new HelpLandsFx(stage);
    fx.start([1]);
    fx.helped({ id: 1, secondsSaved: 60, reward: { r1: 50 } });
    const result = fx.done(summary({ helped: 1, reward: { r1: 50 } }), line);
    await vi.advanceTimersByTimeAsync(HELP_LANDS_SETTLE_MS);
    await result;
    expect(raw.hud.deliver.mock.calls).toEqual([["r1", 50, 0]]);
    expect(raw.hud.floatBelow.mock.calls).toEqual([["r1", 50]]);
  });

  it("on leaving the yard mid-way, shows every held amount and lets every wrench go at once", async () => {
    const { stage, raw } = fakeStage();
    const fx = new HelpLandsFx(stage);
    fx.start([1, 2, 3]);
    fx.helped({ id: 1, secondsSaved: 60, reward });
    fx.helped({ id: 2, secondsSaved: 60, reward });
    const result = fx.done(summary({ helped: 2 }), line);
    await vi.advanceTimersByTimeAsync(0);
    fx.cancel();
    expect(raw.hud.releaseHeld).toHaveBeenCalledTimes(1);
    expect(raw.marks.release).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await result).toBeNull();
    // The second wrench never popped and nothing counted up after the cancel.
    expect(raw.marks.leave).toHaveBeenCalledTimes(1);
    expect(raw.hud.deliver).not.toHaveBeenCalled();
  });
});
