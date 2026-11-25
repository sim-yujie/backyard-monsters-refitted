import { describe, expect, it } from "vitest";

import { habitAttacks } from "./championBrain";

describe("habitAttacks: the attacks fought in its Modes", () => {
  it("sums the three Mode counts, never the count of every attack", () => {
    // Reze on live: 1,174 attacks in all, 137 of them in its Modes.
    const hs = { n: 1174, off: { n: 100, u: {} }, hyb: { n: 30, u: {} }, def: { n: 7, u: {} } };
    expect(habitAttacks({ hs })).toBe(137);
    expect(habitAttacks({ hs: { n: 9, def: { n: 2, u: {} } } })).toBe(2);
  });

  it("is 0 with no Mode attacks yet, whatever the old brain counted", () => {
    expect(habitAttacks({})).toBe(0);
    expect(habitAttacks({ hs: { n: 40 } })).toBe(0);
    expect(habitAttacks({ hs: "junk" })).toBe(0);
  });
});
