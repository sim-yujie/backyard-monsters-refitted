import { describe, expect, test } from "bun:test";
import { raidFighting, readFightLock } from "./raidLock.js";

/**
 * The yard's lock while a wild monster raid is fought (#226 WP3): read off
 * `aiattacks.fight`, and over by itself at `until`.
 */

const NOW = 1_900_000_000;

describe("raidFighting", () => {
  test("holds until the lock's end, and not after", () => {
    const save = { aiattacks: { v: 2, fight: { id: "r_one", until: NOW + 10 } } };
    expect(raidFighting(save, NOW)).toBe(true);
    expect(raidFighting(save, NOW + 9)).toBe(true);
    expect(raidFighting(save, NOW + 10)).toBe(false);
  });

  test("no lock, or one in any other shape, is no fight", () => {
    expect(raidFighting({}, NOW)).toBe(false);
    expect(raidFighting({ aiattacks: null }, NOW)).toBe(false);
    expect(raidFighting({ aiattacks: "[]" }, NOW)).toBe(false);
    expect(raidFighting({ aiattacks: { v: 2 } }, NOW)).toBe(false);
    expect(raidFighting({ aiattacks: { fight: { id: 5, until: NOW + 10 } } }, NOW)).toBe(false);
    expect(raidFighting({ aiattacks: { fight: { id: "r_one", until: "soon" } } }, NOW)).toBe(false);
  });
});

describe("readFightLock", () => {
  test("keeps the id and whole seconds", () => {
    expect(readFightLock({ id: "r_one", until: NOW + 0.7 })).toEqual({ id: "r_one", until: NOW });
    expect(readFightLock({ id: "r_one", until: Number.NaN })).toBeUndefined();
  });
});
