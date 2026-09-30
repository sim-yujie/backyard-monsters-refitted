import { describe, expect, it } from "vitest";
import { IncomePrediction, creditUpTo, outpostIncomeOf, overdriveEndOf } from "./outpostIncome";

/**
 * The outpost income prediction (#207) runs the server's payout forward with
 * the shared rule (`game/maproom/rules/autobank.ts`, tested beside it), so its
 * figures must be the ones the next answer brings.
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
