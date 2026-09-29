import { describe, expect, it } from "vitest";
import { storedCount, storedDecorations, storedLevel } from "./decorStorage";

/** Decoration storage as `researchdata` holds it (§8.3, #128). */

describe("decoration storage", () => {
  const researchdata = { b28: 3, b121: 1, bl121: 4, b131: 2, b20: 7, b30: 0, bl28: 9, b: 1, other: "x" };

  it("counts a type, whole and never negative", () => {
    expect(storedCount(researchdata, 28)).toBe(3);
    expect(storedCount(researchdata, 29)).toBe(0);
    expect(storedCount({ b28: -2 }, 28)).toBe(0);
    expect(storedCount({ b28: "2.7" }, 28)).toBe(2);
    expect(storedCount(null, 28)).toBe(0);
  });

  it("a totem comes back at its stored level, else 1; anything else at 1", () => {
    expect(storedLevel(researchdata, 121)).toBe(4);
    expect(storedLevel(researchdata, 131)).toBe(1);
    expect(storedLevel(researchdata, 28)).toBe(1);
  });

  it("lists every stored decoration type, lowest first, and nothing else", () => {
    expect(storedDecorations(researchdata)).toEqual([
      { type: 28, count: 3, level: 1 },
      { type: 121, count: 1, level: 4 },
      { type: 131, count: 2, level: 1 },
    ]);
    expect(storedDecorations(undefined)).toEqual([]);
  });
});
