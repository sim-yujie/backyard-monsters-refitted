import { describe, expect, test } from "bun:test";
import { REPEAT_FEE_BANDS, repeatFeeFor } from "./repeatFee.js";

describe("Repeat attack's putty fee (owner, 20 Nov 2026)", () => {
  test("the owner's table (second version), by the camp's level", () => {
    const cases: [number, number][] = [
      [25, 2_000_000],
      [29, 2_000_000],
      [30, 2_500_000],
      [34, 2_500_000],
      [35, 3_000_000],
      [39, 3_000_000],
      [40, 3_500_000],
      [44, 3_500_000],
    ];
    for (const [level, putty] of cases) expect(repeatFeeFor(level), `level ${level}`).toBe(putty);
  });

  test("a level no band covers has no fee, so it is never repeated for free", () => {
    for (const level of [0, 24, 45, 50, Number.NaN]) expect(repeatFeeFor(level), `level ${level}`).toBeNull();
  });

  test("the bands cover every Map Room 2 camp level, 25 to 44, once each", () => {
    for (let level = 25; level <= 44; level++) {
      expect(REPEAT_FEE_BANDS.filter((band) => level >= band.from && level <= band.to)).toHaveLength(1);
    }
  });
});
