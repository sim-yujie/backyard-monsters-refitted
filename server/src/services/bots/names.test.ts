import { describe, expect, test } from "bun:test";

import { usernameProblem } from "../../game-rules/account/accountRules.js";
import { mulberry32 } from "../../game-rules/combat/rng.js";
import { isProfaneUsername } from "../user/usernameFilter.js";
import { botName, isUsableName, NAME_STYLES } from "./names.js";

/** Bot usernames in real players' styles (issue #239, decision 3). */

const names = (seed: number, count: number): string[] => {
  const rng = mulberry32(seed);
  return Array.from({ length: count }, () => botName(rng));
};

describe("botName", () => {
  const sample = names(239, 3000);

  test("every name passes the sign-up rules and the word filter", () => {
    for (const name of sample) {
      expect(usernameProblem(name)).toBeNull();
      expect(isProfaneUsername(name)).toBe(false);
    }
  });

  test("no name says bot", () => {
    expect(sample.filter((name) => /bot/i.test(name))).toEqual([]);
  });

  test("names vary: few repeats and every style shows up", () => {
    // 500 bots draw few repeats (the factory redraws those anyway).
    const bots = sample.slice(0, 500);
    expect(new Set(bots.map((name) => name.toLowerCase())).size).toBeGreaterThan(bots.length * 0.95);
    expect(new Set(sample.map((name) => name.toLowerCase())).size).toBeGreaterThan(sample.length * 0.85);

    expect(sample.some((name) => /^[A-Z][a-z]+[A-Z][a-z]+$/.test(name))).toBe(true); // MossyGoblin
    expect(sample.some((name) => /^[a-z]+_[a-z]+$/.test(name))).toBe(true); // kai_builds
    expect(sample.some((name) => /^[A-Za-z]+\d{1,3}$/.test(name))).toBe(true); // Pebble77
    expect(sample.some((name) => /^xX[A-Z][a-z]+Xx$/.test(name))).toBe(true); // xXSnapperXx
    expect(sample.some((name) => /^[a-z]+(19|20)?\d\d$/.test(name))).toBe(true); // marco1996
    expect(NAME_STYLES.length).toBeGreaterThanOrEqual(6);
  });

  test("the same seed gives the same names", () => {
    expect(names(7, 50)).toEqual(names(7, 50));
    expect(names(7, 50)).not.toEqual(names(8, 50));
  });
});

describe("isUsableName", () => {
  test("refuses what sign-up refuses, and bot", () => {
    expect(isUsableName("MossyGoblin")).toBe(true);
    expect(isUsableName("a")).toBe(false);
    expect(isUsableName("waytoolongname")).toBe(false);
    expect(isUsableName("has space")).toBe(false);
    expect(isUsableName("AdminFrog")).toBe(false);
    expect(isUsableName("Robot77")).toBe(false);
  });
});
