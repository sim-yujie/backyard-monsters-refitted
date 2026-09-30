import { describe, expect, it } from "vitest";
import {
  AUTOBANK_TICK,
  OUTPOST_INCOME_WINDOW,
  autobankTicks,
  fillToCap,
} from "./autobank";

/**
 * The shared outpost income arithmetic (#207): the server pays with it
 * (`server/src/services/maproom/v2/autobank.ts`, whose own tests run the
 * server's copy) and the web client predicts with it.
 */

const T = 1_000_000;
const rate = { r1: 10, r2: 0, r3: 2, r4: 0 };

describe("autobankTicks", () => {
  it("pays whole ticks only and moves t by exactly those", () => {
    expect(autobankTicks(rate, T, T + 9)).toMatchObject({ ticks: 0, t: T });
    expect(autobankTicks(rate, T, T + 10)).toMatchObject({ ticks: 1, t: T + 10 });
    const later = autobankTicks(rate, T, T + 35);
    expect(later).toMatchObject({ ticks: 3, t: T + 30 });
    expect(later.owed).toEqual({ r1: 30, r2: 0, r3: 6, r4: 0 });
  });

  it("pays at most two days", () => {
    const now = T + OUTPOST_INCOME_WINDOW * 3;
    const { ticks, t } = autobankTicks(rate, T, now);
    expect(ticks).toBe(OUTPOST_INCOME_WINDOW / AUTOBANK_TICK);
    expect(t).toBe(now);
  });

  it("doubles the ticks up to the Production Overdrive's end", () => {
    // Five ticks, the first two inside the overdrive: 5 + 2 paid twice.
    expect(autobankTicks(rate, T, T + 50, T + 25).owed.r1).toBe(70);
    // An overdrive that ended before `t` adds nothing.
    expect(autobankTicks(rate, T, T + 50, T - 100).owed.r1).toBe(50);
  });

  it("owes nothing without a t, and counts a future t from now", () => {
    expect(autobankTicks(rate, undefined, T)).toEqual({
      owed: { r1: 0, r2: 0, r3: 0, r4: 0 },
      ticks: 0,
      t: T,
    });
    expect(autobankTicks(rate, T + 60, T)).toMatchObject({ ticks: 0, t: T });
  });
});

describe("fillToCap", () => {
  it("fills to the cap, never past it, and never takes from a pool over it", () => {
    expect(fillToCap(90, 30, 100)).toBe(100);
    expect(fillToCap(10, 30, 100)).toBe(40);
    expect(fillToCap(150, 30, 100)).toBe(150);
  });
});
