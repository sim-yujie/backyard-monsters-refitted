import { describe, expect, it } from "vitest";
import type { BaseLoadResponse } from "@/api/types";
import { TICKS_PER_SECOND } from "@/game/combat/rules";
import { AttackSession, CATCH_UP_SLICE_TICKS } from "./AttackSession";
import type { AttackTarget } from "./attackTarget";
import {
  BACKGROUND_BUDGET_MS,
  BattleWallClock,
  FRAME_BUDGET_MS,
  PUMP_INTERVAL_MS,
  STALL_MS,
} from "./battleWallClock";

/**
 * The battle does not pause in a hidden tab (owner, 4 Nov 2026): the scene
 * hands a fought battle the wall time it is owed (`battleWallClock.ts`), and
 * the session runs a long gap in budgeted slices, carrying what a budget
 * leaves to the next call (`AttackSession.catchUp`).
 */

/** A lone level 1 Cannon Tower at the origin. */
const towerYard = (): BaseLoadResponse =>
  ({
    error: 0,
    id: 1,
    baseid: "3502",
    basesaveid: 1,
    worldsize: [800, 800],
    currenttime: 1_700_000_000,
    buildingdata: { "1": { id: 1, t: 20, l: 1, X: 0, Y: 0 } },
    buildinghealthdata: {},
    resources: { r1: 1000, r2: 0, r3: 0, r4: 0 },
    attackid: 77,
  }) as unknown as BaseLoadResponse;

const target = (): AttackTarget => ({
  baseid: "3502",
  kind: "wild",
  cell: { col: 241, row: 208 },
  name: "Kozu",
  roster: {
    monsters: { C1: 3 },
    levels: {},
    champions: [],
    flingerLevel: 4,
    catapultLevel: 0,
    sources: [],
    siege: null,
    resources: null,
  },
});

/** A fake wall clock in ms; `step` is added on every read, as engine work would. */
const fakeClock = (step = 0) => {
  let at = 0;
  return {
    now: () => {
      at += step;
      return at;
    },
    wait: (ms: number) => {
      at += ms;
    },
  };
};

const running = (now?: () => number): AttackSession => {
  const session = new AttackSession({ target: target(), seed: 1, ...(now ? { now } : {}) });
  session.load(towerYard());
  session.start();
  return session;
};

describe("AttackSession catching up a long gap", () => {
  it("runs a whole gap at once with no budget, as frame by frame would", () => {
    const framed = running();
    const gapped = running();
    for (let frame = 0; frame < 30 * 60; frame += 1) framed.advance(1 / 60);
    gapped.advance(30);
    expect(gapped.state().tick).toBe(30 * TICKS_PER_SECOND);
    expect(gapped.state().tick).toBe(framed.state().tick);
    expect(gapped.state().remainingSeconds).toBe(framed.state().remainingSeconds);
  });

  it("stops at the budget and carries the rest to the next calls", () => {
    // Each read of the clock costs 1 ms, so a 3 ms budget runs only a few slices.
    const clock = fakeClock(1);
    const session = running(clock.now);
    session.advance(60, 3);
    const first = session.state().tick;
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(60 * TICKS_PER_SECOND);

    // Nothing more is owed; later calls still bring the battle to the full minute.
    let calls = 0;
    while (session.state().tick < 60 * TICKS_PER_SECOND && calls < 1000) {
      session.advance(0, 3);
      calls += 1;
    }
    expect(session.state().tick).toBe(60 * TICKS_PER_SECOND);
    expect(calls).toBeGreaterThan(1);
  });

  it("always runs at least one slice, however small the budget", () => {
    const clock = fakeClock(100);
    const session = running(clock.now);
    session.advance(10, 0);
    expect(session.state().tick).toBe(CATCH_UP_SLICE_TICKS);
  });

  it("notices the end inside a long gap within a slice of when frames would", () => {
    const framed = running();
    framed.appendFling({ x: -100, y: -100, monsters: { C1: 3 } });
    for (let frame = 0; frame < 120 * 60 && !framed.ended; frame += 1) framed.advance(1 / 60);
    expect(framed.state().endReason).toBe("exhausted");

    const gapped = running();
    gapped.appendFling({ x: -100, y: -100, monsters: { C1: 3 } });
    gapped.advance(120);
    expect(gapped.state().endReason).toBe("exhausted");
    const late = gapped.state().tick - framed.state().tick;
    expect(late).toBeGreaterThanOrEqual(0);
    expect(late).toBeLessThan(CATCH_UP_SLICE_TICKS);
  });

  it("leaves a playback to the frames' pace, one run per call", () => {
    const session = new AttackSession({ target: target(), seed: 1 });
    session.load(towerYard());
    session.playScript([], 10 * TICKS_PER_SECOND);
    session.start();
    session.advance(5, 0);
    expect(session.state().tick).toBe(5 * TICKS_PER_SECOND);
  });
});

describe("BattleWallClock", () => {
  const recorder = () => {
    const calls: Array<{ seconds: number; budgetMs: number }> = [];
    return { calls, advance: (seconds: number, budgetMs: number) => calls.push({ seconds, budgetMs }) };
  };

  it("hands each frame the wall time since the last, at the frame budget", () => {
    const clock = fakeClock();
    const { calls, advance } = recorder();
    const wall = new BattleWallClock(advance, { now: clock.now, every: () => () => {} });
    wall.frame();
    clock.wait(16);
    wall.frame();
    // A frame far apart is not capped as Pixi's ticker caps it at 100 ms.
    clock.wait(2500);
    wall.frame();
    expect(calls).toEqual([
      { seconds: 0, budgetMs: FRAME_BUDGET_MS },
      { seconds: 0.016, budgetMs: FRAME_BUDGET_MS },
      { seconds: 2.5, budgetMs: FRAME_BUDGET_MS },
    ]);
  });

  it("leaves a visible tab to its frames, and runs the battle once they stop", () => {
    const clock = fakeClock();
    const { calls, advance } = recorder();
    const wall = new BattleWallClock(advance, { now: clock.now, every: () => () => {} });
    wall.frame();
    clock.wait(STALL_MS - 1);
    wall.pump();
    expect(calls).toHaveLength(1);

    clock.wait(1);
    wall.pump();
    expect(calls.at(-1)).toEqual({ seconds: STALL_MS / 1000, budgetMs: BACKGROUND_BUDGET_MS });
  });

  it("starts one timer, and stops it", () => {
    const started: number[] = [];
    let stopped = 0;
    const wall = new BattleWallClock(() => {}, {
      every: (_run, ms) => {
        started.push(ms);
        return () => {
          stopped += 1;
        };
      },
    });
    wall.start();
    wall.start();
    expect(started).toEqual([PUMP_INTERVAL_MS]);
    wall.stop();
    wall.stop();
    expect(stopped).toBe(1);
  });

  it("keeps a battle in a hidden tab going at the wall's pace", () => {
    const clock = fakeClock();
    let pump: () => void = () => {};
    const session = running();
    const wall = new BattleWallClock((seconds, budgetMs) => session.advance(seconds, budgetMs), {
      now: clock.now,
      every: (run) => {
        pump = run;
        return () => {};
      },
    });
    wall.start();
    // One visible second of frames.
    wall.frame();
    for (let frame = 0; frame < 60; frame += 1) {
      clock.wait(1000 / 60);
      wall.frame();
    }
    // The tab is hidden: no frames for 30 s, the throttled timer once a second.
    for (let second = 0; second < 30; second += 1) {
      clock.wait(1000);
      pump();
    }
    expect(session.state().elapsedSeconds).toBeCloseTo(31, 1);

    // Timers throttled to once a minute (a tab hidden for long): the frames
    // after it catch up, a frame's budget at a time.
    clock.wait(60_000);
    let frames = 0;
    while (session.state().elapsedSeconds < 91 && frames < 500) {
      wall.frame();
      frames += 1;
    }
    expect(session.state().elapsedSeconds).toBeCloseTo(91, 1);
  });

  it("brings a backgrounded attack to its end on time, so it saves inside the server's window", () => {
    const clock = fakeClock();
    let pump: () => void = () => {};
    const session = running();
    const wall = new BattleWallClock((seconds, budgetMs) => session.advance(seconds, budgetMs), {
      now: clock.now,
      every: (run) => {
        pump = run;
        return () => {};
      },
    });
    wall.start();
    wall.frame();
    // Hidden from the first second to past the countdown and its retreat grace.
    for (let second = 0; second < 7 * 60 && !session.ended; second += 1) {
      clock.wait(1000);
      pump();
    }
    expect(session.state().phase).toBe("ended");
    expect(session.state().endReason).toBe("expired");
  });
});
