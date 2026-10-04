import { describe, expect, test } from "bun:test";

import { mulberry32 } from "../../game-rules/combat/rng.js";
import { BOT_MAX_LEVEL, BOT_MIN_LEVEL } from "./factory.js";
import { drawShiny, LEGACY_BOT_SHINY, shinyBand, shinyForSeed, SHINY_DRIFT_MAX, tendShiny } from "./shiny.js";

/** A bot's Shiny (owner decision on #245's leak audit): random, in a band that grows with level. */

const LEVELS = Array.from({ length: BOT_MAX_LEVEL - BOT_MIN_LEVEL + 1 }, (_, index) => BOT_MIN_LEVEL + index);

const inBand = (amount: number, level: number) => {
  const band = shinyBand(level);
  return Number.isInteger(amount) && amount >= band.min && amount <= band.max;
};

describe("shinyBand", () => {
  test("low hundreds to under two thousand at level 1, both ends rising every level", () => {
    expect(shinyBand(1)).toEqual({ min: 120, max: 1800 });
    expect(shinyBand(10)).toEqual({ min: 435, max: 2430 });
    expect(shinyBand(40)).toEqual({ min: 1485, max: 4530 });
    for (const level of LEVELS.slice(1)) {
      expect(shinyBand(level).min).toBeGreaterThan(shinyBand(level - 1).min);
      expect(shinyBand(level).max).toBeGreaterThan(shinyBand(level - 1).max);
    }
  });
});

describe("shinyForSeed (the factory's draw)", () => {
  test("in the band for every level 1-40, never 1,500, never a round number", () => {
    for (const level of LEVELS) {
      for (let seed = 0; seed < 200; seed++) {
        const amount = shinyForSeed(seed * 7919 + level, level);
        expect(inBand(amount, level)).toBe(true);
        expect(amount).not.toBe(LEGACY_BOT_SHINY);
        expect(amount % 10).not.toBe(0);
      }
    }
  });

  // Twenty draws from a band of 1,700-3,000 values share one now and then (the
  // birthday problem), as twenty players' purses would; more than that is bunching.
  test("twenty seeds give at least eighteen different amounts at every level", () => {
    const seeds = Array.from({ length: 20 }, (_, index) => mulberry32(239).next() + index * 104_729);
    for (const level of LEVELS) {
      expect(new Set(seeds.map((seed) => shinyForSeed(seed, level))).size).toBeGreaterThanOrEqual(18);
    }
  });

  test("the same seed and level give the same amount", () => {
    expect(shinyForSeed(123_456, 17)).toBe(shinyForSeed(123_456, 17));
    expect(shinyForSeed(4_000_000_000, 3)).toBe(shinyForSeed(4_000_000_000, 3));
  });
});

describe("drawShiny", () => {
  test("spreads over the band instead of bunching at one end", () => {
    const rng = mulberry32(5);
    const band = shinyBand(20);
    const draws = Array.from({ length: 2000 }, () => drawShiny(20, rng.float));
    const third = (band.max - band.min) / 3;
    const low = draws.filter((amount) => amount < band.min + third).length;
    const high = draws.filter((amount) => amount > band.max - third).length;
    expect(low).toBeGreaterThan(200);
    expect(high).toBeGreaterThan(200);
    expect(draws.every((amount) => inBand(amount, 20))).toBe(true);
  });
});

describe("tendShiny (each grow)", () => {
  test("a bot still on the new-save 1,500 is redrawn on its next grow, at any level", () => {
    const rng = mulberry32(1500);
    for (const level of LEVELS) {
      const amount = tendShiny(LEGACY_BOT_SHINY, level, rng.float);
      expect(amount).not.toBe(LEGACY_BOT_SHINY);
      expect(inBand(amount, level)).toBe(true);
    }
  });

  test("Shiny outside the level's band is redrawn inside it", () => {
    const rng = mulberry32(2);
    for (const level of LEVELS) {
      const band = shinyBand(level);
      for (const credits of [0, band.min - 1, band.max + 1, 999_999, Number.NaN]) {
        expect(inBand(tendShiny(credits, level, rng.float), level)).toBe(true);
      }
    }
  });

  test("inside the band it drifts up a little, or is spent down from the top", () => {
    const band = shinyBand(12);
    const mid = band.min + 501;
    const rng = mulberry32(12);
    for (let i = 0; i < 200; i++) {
      const next = tendShiny(mid, 12, rng.float);
      expect(next).toBeGreaterThan(mid);
      expect(next).toBeLessThanOrEqual(mid + SHINY_DRIFT_MAX + 9);
    }
    for (let i = 0; i < 200; i++) {
      const next = tendShiny(band.max, 12, rng.float);
      expect(next).toBeLessThan(band.max - SHINY_DRIFT_MAX);
      expect(inBand(next, 12)).toBe(true);
    }
  });

  test("a bot climbing 1-40, grown every few hours, stays in its band and never sits on one value", () => {
    const rng = mulberry32(40);
    const growsPerLevel = 18; // 3 days a level, a grow every 4 hours
    let credits = LEGACY_BOT_SHINY;
    for (const level of LEVELS) {
      const seen = new Set<number>();
      for (let grow = 0; grow < growsPerLevel; grow++) {
        credits = tendShiny(credits, level, rng.float);
        expect(inBand(credits, level)).toBe(true);
        expect(credits).not.toBe(LEGACY_BOT_SHINY);
        seen.add(credits);
      }
      expect(seen.size).toBeGreaterThan(growsPerLevel / 2);
    }
  });

  test("many bots over a full climb all stay in band", () => {
    for (let seed = 0; seed < 50; seed++) {
      const rng = mulberry32(seed);
      let credits = shinyForSeed(seed, 1);
      for (const level of LEVELS) {
        for (let grow = 0; grow < 18; grow++) {
          credits = tendShiny(credits, level, rng.float);
          if (!inBand(credits, level) || credits === LEGACY_BOT_SHINY) {
            throw new Error(`seed ${seed} level ${level}: ${credits}`);
          }
        }
      }
    }
  }, 30_000);
});
