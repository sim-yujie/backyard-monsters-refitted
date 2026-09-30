import { describe, expect, it } from "vitest";
import {
  AUTOBANK_TICK,
  IncomePrediction,
  OUTPOST_INCOME_WINDOW,
  creditUpTo,
  incomeTicks,
  outpostIncomeOf,
  overdriveEndOf,
} from "./outpostIncome";

/**
 * The outpost income prediction (#207) runs the server's `autobankTicks` and
 * credit clamp forward (`server/src/services/maproom/v2/autobank.ts`,
 * `credit.ts`), so its figures must be the ones the next answer brings.
 */

const T = 1_000_000;

describe("outpostIncomeOf", () => {
  it("sums every outpost's rate and keeps t", () => {
    const income = outpostIncomeOf({
      t: T,
      b2000242209: { r1: 10, r2: 20, r3: 0, r4: 5 },
      b2000242210: { r1: 1, r2: 1, r3: 1, r4: 1 },
    });
    expect(income).toEqual({ t: T, rate: { r1: 11, r2: 21, r3: 1, r4: 6 } });
  });

  it("reads only b<baseid> entries", () => {
    const income = outpostIncomeOf({ t: T, b1: { r1: 3 }, height: { r1: 99 }, bx: { r1: 99 } });
    expect(income?.rate).toEqual({ r1: 3, r2: 0, r3: 0, r4: 0 });
  });

  it("is null with no t, no outposts, or no income", () => {
    expect(outpostIncomeOf(undefined)).toBeNull();
    expect(outpostIncomeOf({ b1: { r1: 3 } })).toBeNull();
    expect(outpostIncomeOf({ t: T })).toBeNull();
    expect(outpostIncomeOf({ t: T, b1: { r1: 0, r2: 0, r3: 0, r4: 0 } })).toBeNull();
  });
});

describe("incomeTicks", () => {
  const income = { t: T, rate: { r1: 10, r2: 0, r3: 2, r4: 0 } };

  it("pays whole ticks only and moves t by exactly those", () => {
    expect(incomeTicks(income, T + 9)).toMatchObject({ ticks: 0, t: T });
    expect(incomeTicks(income, T + 10)).toMatchObject({ ticks: 1, t: T + 10 });
    const later = incomeTicks(income, T + 35);
    expect(later).toMatchObject({ ticks: 3, t: T + 30 });
    expect(later.owed).toEqual({ r1: 30, r2: 0, r3: 6, r4: 0 });
  });

  it("pays at most two days", () => {
    const now = T + OUTPOST_INCOME_WINDOW * 3;
    const { ticks, t } = incomeTicks(income, now);
    expect(ticks).toBe(OUTPOST_INCOME_WINDOW / AUTOBANK_TICK);
    expect(t).toBe(now);
  });

  it("doubles the ticks up to the Production Overdrive's end", () => {
    // Five ticks, the first two inside the overdrive: 5 + 2 paid twice.
    expect(incomeTicks(income, T + 50, T + 25).owed.r1).toBe(70);
    // An overdrive that ended before `t` adds nothing.
    expect(incomeTicks(income, T + 50, T - 100).owed.r1).toBe(50);
  });
});

describe("creditUpTo", () => {
  it("fills to the cap, never past it, and never takes from a pool over it", () => {
    const pool = creditUpTo(
      { r1: 90, r2: 150, r3: 0, r4: 0, r1max: 7 },
      { r1: 30, r2: 30, r3: 30, r4: 0 },
      100,
    );
    expect(pool).toEqual({ r1: 100, r2: 150, r3: 30, r4: 0, r1max: 7 });
  });
});

describe("overdriveEndOf", () => {
  it("reads storedata.POD.e", () => {
    expect(overdriveEndOf({ storedata: { POD: { e: T + 5 } } })).toBe(T + 5);
    expect(overdriveEndOf({ storedata: {} })).toBeUndefined();
    expect(overdriveEndOf({})).toBeUndefined();
  });
});

describe("IncomePrediction", () => {
  const load = { t: T - 3, b7: { r1: 10, r2: 0, r3: 0, r4: 0 } };

  it("answers only when the tick count moves", () => {
    const prediction = new IncomePrediction(load, { r1: 1000 });
    expect(prediction.active).toBe(true);
    expect(prediction.next(T, 1e6)).toEqual({ r1: 1000 });
    expect(prediction.next(T + 6, 1e6)).toBeNull();
    expect(prediction.next(T + 7, 1e6)).toEqual({ r1: 1010 });
    expect(prediction.next(T + 8, 1e6)).toBeNull();
    expect(prediction.next(T + 27, 1e6)).toEqual({ r1: 1030 });
  });

  it("starts again from where a server answer paid up to", () => {
    const prediction = new IncomePrediction(load, { r1: 1000 });
    prediction.next(T + 17, 1e6);
    // The server paid two ticks at T + 20 (up to T + 17) and spent 500.
    prediction.settle({ r1: 520 }, T + 20);
    expect(prediction.next(T + 26, 1e6)).toBeNull();
    expect(prediction.next(T + 27, 1e6)).toEqual({ r1: 530 });
  });

  it("puts the ticks since t back on a pool from a route that pays none", () => {
    const prediction = new IncomePrediction(load, { r1: 1000 });
    prediction.next(T + 17, 1e6);
    prediction.rebase({ r1: 400 });
    expect(prediction.next(T + 17, 1e6)).toEqual({ r1: 420 });
  });

  it("predicts nothing without outposts", () => {
    const prediction = new IncomePrediction({ t: T }, { r1: 1000 });
    expect(prediction.active).toBe(false);
    expect(prediction.next(T + 100, 1e6)).toBeNull();
  });
});
