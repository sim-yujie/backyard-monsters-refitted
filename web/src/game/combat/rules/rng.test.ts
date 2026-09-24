import { describe, expect, it } from "vitest";
import { mulberry32, seedFrom } from "./rng.js";

/**
 * The battle's random stream.
 *
 * Two properties matter and nothing else does. The sequence must be *fixed*,
 * because the golden replays commit digests that depend on every draw in order
 * (`docs/design/server-combat.md` §3.4 rule 2); and it must be *uniform enough*
 * that a loot pick or a scatter choice is not quietly biased. The first is
 * asserted against a recorded sequence, the second over 60,000 draws.
 */

describe("mulberry32", () => {
  it("gives the recorded sequence for seed 1", () => {
    const rng = mulberry32(1);
    expect([rng.next(), rng.next(), rng.next(), rng.next(), rng.next()]).toEqual([
      2693262067, 11749833, 2265367787, 4213581821, 4159151403,
    ]);
  });

  it("turns those into floats in [0, 1)", () => {
    const rng = mulberry32(1);
    expect(rng.float()).toBeCloseTo(0.6270739405881613, 15);
    expect(rng.float()).toBeCloseTo(0.002735721180215478, 15);
    expect(rng.float()).toBeCloseTo(0.5274470399599522, 15);
  });

  it("treats 0 as a seed rather than an error", () => {
    expect(mulberry32(0).next()).toBe(1144304738);
  });

  it("gives two generators on one seed the same stream", () => {
    const one = mulberry32(4242);
    const other = mulberry32(4242);
    for (let draw = 0; draw < 100; draw += 1) expect(one.next()).toBe(other.next());
  });

  it("wraps a fractional or non-finite seed rather than refusing it", () => {
    // The seed arrives off the wire; a battle that threw on a bad one would be
    // worse than a battle that ran on a well-defined substitute.
    expect(mulberry32(1.9).next()).toBe(mulberry32(1).next());
    expect(mulberry32(Number.NaN).next()).toBe(mulberry32(0).next());
  });

  it("draws int(6) uniformly within 2% over 60,000 draws", () => {
    const rng = mulberry32(12345);
    const buckets = [0, 0, 0, 0, 0, 0];
    for (let draw = 0; draw < 60000; draw += 1) {
      const value = rng.int(6);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(6);
      buckets[value] = (buckets[value] ?? 0) + 1;
    }
    for (const count of buckets) expect(Math.abs(count - 10000)).toBeLessThan(200);
  });

  it("returns 0 for a bound of one or less, which is the empty pick", () => {
    const rng = mulberry32(9);
    expect(rng.int(1)).toBe(0);
    expect(rng.int(0)).toBe(0);
    expect(rng.int(-3)).toBe(0);
  });

  it("counts its draws, which is the cheapest divergence tripwire there is", () => {
    const rng = mulberry32(5);
    expect(rng.count()).toBe(0);
    rng.float();
    rng.int(4);
    expect(rng.count()).toBe(2);
    // The state moves with the stream, so a checkpoint that folds it in catches
    // a divergence that has not yet moved anything on the field.
    expect(rng.state()).not.toBe(mulberry32(5).state());
  });
});

describe("seedFrom", () => {
  it("turns a name into a stable 32-bit seed", () => {
    expect(seedFrom("pokey-rush")).toBe(2813636880);
    expect(seedFrom("pokey-rush")).toBe(seedFrom("pokey-rush"));
    expect(seedFrom("pokey-rush")).not.toBe(seedFrom("pokey-rusi"));
  });
});
