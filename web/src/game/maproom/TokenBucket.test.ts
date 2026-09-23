import { describe, expect, it } from "vitest";
import { AREA_BURST, AREA_REFILL_PER_SECOND } from "@/config";
import { TokenBucket } from "./TokenBucket";

/** A controllable clock in milliseconds. */
const clock = (start = 0) => {
  let value = start;
  return {
    now: () => value,
    advanceSeconds: (seconds: number) => {
      value += seconds * 1000;
    },
  };
};

describe("TokenBucket", () => {
  it("starts full and spends down to empty", () => {
    const time = clock();
    const bucket = new TokenBucket({ capacity: 3, refillPerSecond: 1, now: time.now });

    expect(bucket.take()).toBe(true);
    expect(bucket.take()).toBe(true);
    expect(bucket.take()).toBe(true);
    expect(bucket.take()).toBe(false);
  });

  it("refills at the configured rate and never past capacity", () => {
    const time = clock();
    const bucket = new TokenBucket({
      capacity: 3,
      refillPerSecond: 2,
      now: time.now,
      initialTokens: 0,
    });

    expect(bucket.tokens).toBe(0);

    time.advanceSeconds(0.5);
    expect(bucket.tokens).toBeCloseTo(1);

    time.advanceSeconds(100);
    expect(bucket.tokens).toBe(3);
  });

  it("reports how long a caller must wait", () => {
    const time = clock();
    const bucket = new TokenBucket({
      capacity: 10,
      refillPerSecond: 2,
      now: time.now,
      initialTokens: 0,
    });

    expect(bucket.waitSeconds()).toBeCloseTo(0.5);
    expect(bucket.waitSeconds(4)).toBeCloseTo(2);

    time.advanceSeconds(2);
    expect(bucket.waitSeconds(4)).toBe(0);
  });

  it("does not hand out tokens when the clock runs backwards", () => {
    const time = clock(10_000);
    const bucket = new TokenBucket({
      capacity: 5,
      refillPerSecond: 1,
      now: time.now,
      initialTokens: 0,
    });

    time.advanceSeconds(-5);
    expect(bucket.tokens).toBe(0);
  });

  it("drains to empty when the server disagrees with the local budget", () => {
    const bucket = new TokenBucket({ capacity: 5, refillPerSecond: 1, now: () => 0 });
    bucket.drain();
    expect(bucket.tokens).toBe(0);
  });

  /**
   * The load-bearing property. The server limits getarea to 120 per minute in a
   * fixed window, and a bucket admits at most `capacity + rate * window` in any
   * window of that length whatever its phase. This checks the configured pair
   * against the real limit with continuous demand and at several phases.
   */
  it("stays under 120 requests in any 60 second window at the configured rate", () => {
    const SERVER_LIMIT_PER_MINUTE = 120;

    for (const phaseSeconds of [0, 7.5, 23, 41.25, 59]) {
      const time = clock();
      const bucket = new TokenBucket({
        capacity: AREA_BURST,
        refillPerSecond: AREA_REFILL_PER_SECOND,
        now: time.now,
      });

      // Warm up to the requested phase with demand already saturating.
      const stamps: number[] = [];
      const stepSeconds = 0.05;
      for (let elapsed = 0; elapsed < phaseSeconds + 180; elapsed += stepSeconds) {
        while (bucket.take()) stamps.push(time.now());
        time.advanceSeconds(stepSeconds);
      }

      // Slide a 60 s window across every grant and take the worst count.
      let worst = 0;
      for (const start of stamps) {
        const count = stamps.filter(
          (stamp) => stamp >= start && stamp < start + 60_000,
        ).length;
        worst = Math.max(worst, count);
      }

      const theoreticalBound = AREA_BURST + AREA_REFILL_PER_SECOND * 60;
      expect(worst).toBeLessThanOrEqual(SERVER_LIMIT_PER_MINUTE);
      expect(worst).toBeLessThanOrEqual(theoreticalBound);
      // And the budget is actually being used, not left idle by accident. The
      // sampling step means the observed peak lands a request or two short.
      expect(worst).toBeGreaterThan(theoreticalBound - 3);
    }
  });
});
