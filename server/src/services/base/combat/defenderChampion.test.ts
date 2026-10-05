import { describe, expect, test } from "bun:test";
import { championsAfterDefence } from "./defenderChampion.js";

/** The defender's caged champions after the battle (issues #195, #310). */

const stored = [
  { t: 1, l: 2, hp: 5000, pl: 0, status: 0 },
  { t: 3, l: 4, hp: 900, pl: 1, status: 1 },
];

describe("championsAfterDefence", () => {
  test("lowers the one that fought to the battle's health, and leaves the rest", () => {
    expect(championsAfterDefence(stored, [{ t: 1, hp: 3210.7 }])).toEqual([{ ...stored[0]!, hp: 3210 }, stored[1]!]);
  });

  test("writes 0 for one that died, and never raises one above what it had", () => {
    expect(championsAfterDefence(stored, [{ t: 1, hp: 0 }])?.[0]?.hp).toBe(0);
    expect(championsAfterDefence(stored, [{ t: 1, hp: 9999 }])?.[0]?.hp).toBe(5000);
  });

  test("saves each of a basic champion and a Krallen that both defended (#310)", () => {
    const both = [
      { t: 5, l: 5, hp: 9000, pl: 2, status: 0 },
      { t: 2, l: 3, hp: 700, pl: 0, status: 1 },
      { t: 3, l: 6, hp: 4000, pl: 1, status: 0 },
    ];
    expect(
      championsAfterDefence(both, [
        { t: 5, hp: 0 },
        { t: 3, hp: 1234.5 },
      ])
    ).toEqual([{ ...both[0]!, hp: 0 }, both[1]!, { ...both[2]!, hp: 1234 }]);
  });

  test("changes nothing when none defended, or the type is not held", () => {
    expect(championsAfterDefence(stored, [])).toBe(stored);
    expect(championsAfterDefence(stored, [{ t: 5, hp: 1 }])).toEqual(stored);
    expect(championsAfterDefence(undefined, [{ t: 1, hp: 1 }])).toBeUndefined();
  });
});
