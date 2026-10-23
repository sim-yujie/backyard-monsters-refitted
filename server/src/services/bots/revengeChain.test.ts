import { describe, expect, test } from "bun:test";

import { hatchTime } from "../../game-data/monsterCatalogue.js";
import {
  armyRefillSeconds,
  CHAIN_DESTROYED_DAMAGE,
  CHAIN_LENGTH,
  CHAIN_MIN_DAMAGE,
  CHAIN_REFILL_HOURS,
  CHAIN_SLACK_MINUTES,
  CHAIN_WAIT_HOURS,
  drawChainLength,
  hatcheriesIn,
  nextInChain,
  readChain,
} from "./revengeChain.js";

/**
 * A revenge as a chain of 2-4 attacks (owner 2026-10-23, `revengeChain.ts`):
 * what follows each landed attack, the spacing by the bot's hatcheries, and
 * the chain as the job's payload keeps it.
 */

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const NOW = 1_790_000_000;
const REFILL = 2 * HOUR;

const hit = (damageBefore: number, damageAfter: number) => ({ damageBefore, damageAfter });

describe("nextInChain", () => {
  test("the first attack draws a length of 2-4, every one of them", () => {
    const lengths = new Set<number>();
    for (let i = 0; i < 100; i++) lengths.add(drawChainLength(() => i / 100));
    expect([...lengths].sort()).toEqual([2, 3, 4]);
    expect(drawChainLength(() => 0)).toBe(CHAIN_LENGTH.min);
    expect(drawChainLength(() => 0.999_999)).toBe(CHAIN_LENGTH.max);
  });

  test("an attack doing 20 points or more goes on, once the army is back, with a wait limit", () => {
    const step = nextInChain(null, hit(0, CHAIN_MIN_DAMAGE), NOW, REFILL, () => 0);
    expect(step).toEqual({
      act: "next",
      chain: { length: 2, done: 1, last: NOW },
      due: NOW + REFILL + CHAIN_SLACK_MINUTES.min * MINUTE,
      giveupAt: NOW + REFILL + CHAIN_SLACK_MINUTES.min * MINUTE + CHAIN_WAIT_HOURS * HOUR,
    });
    // The slack is at most an hour.
    const late = nextInChain(null, hit(0, 30), NOW, REFILL, () => 0.999_999);
    expect(late.act === "next" && late.due).toBeLessThanOrEqual(NOW + REFILL + CHAIN_SLACK_MINUTES.max * MINUTE);
  });

  test("the damage counted is the attack's own: a yard already at 30% taken to 45% stops it", () => {
    expect(nextInChain(null, hit(30, 45), NOW, REFILL, () => 0.9)).toMatchObject({ act: "end", reason: "lowDamage" });
    expect(nextInChain(null, hit(30, 50), NOW, REFILL, () => 0.9).act).toBe("next");
  });

  test("a weak attack (the owner's 5%) ends the chain after one", () => {
    expect(nextInChain(null, hit(0, 5), NOW, REFILL, () => 0.9)).toMatchObject({ act: "end", reason: "lowDamage" });
    expect(nextInChain(null, hit(0, CHAIN_MIN_DAMAGE - 0.5), NOW, REFILL, () => 0.9)).toEqual({
      act: "end",
      reason: "lowDamage",
      length: 4,
    });
  });

  test("a destroyed yard ends the chain", () => {
    expect(nextInChain(null, hit(40, CHAIN_DESTROYED_DAMAGE), NOW, REFILL, () => 0.9)).toEqual({
      act: "end",
      reason: "destroyed",
      length: 4,
    });
    expect(nextInChain(null, hit(0, 100), NOW, REFILL, () => 0.9)).toMatchObject({ act: "end", reason: "destroyed" });
  });

  test("the chain ends at its length: 4 attacks at most, 2 at least when every one hits hard", () => {
    let chain = null;
    let attacks = 0;
    for (;;) {
      attacks++;
      const step = nextInChain(chain, hit(0, 25), NOW + attacks * HOUR, REFILL, () => 0.999_999);
      if (step.act === "end") {
        expect(step.reason).toBe("length");
        break;
      }
      chain = step.chain;
      expect(chain).toEqual({ length: 4, done: attacks, last: NOW + attacks * HOUR });
    }
    expect(attacks).toBe(4);
    const two = nextInChain({ length: 2, done: 1, last: NOW }, hit(0, 25), NOW + 3 * HOUR, REFILL, () => 0);
    expect(two).toEqual({ act: "end", reason: "length", length: 2 });
  });
});

describe("armyRefillSeconds", () => {
  test("each monster's own hatch time, the hatcheries working side by side", () => {
    const pokey = hatchTime("C1", 1)!;
    const octo = hatchTime("C5", 1)!;
    const total = 200 * pokey + 30 * octo;
    const army = { monsters: { C1: 200, C5: 30 }, levels: {} };
    expect(armyRefillSeconds(army, 1)).toBe(Math.min(CHAIN_REFILL_HOURS.max * HOUR, Math.max(CHAIN_REFILL_HOURS.min * HOUR, total)));
    expect(armyRefillSeconds(army, 4)).toBe(
      Math.min(CHAIN_REFILL_HOURS.max * HOUR, Math.max(CHAIN_REFILL_HOURS.min * HOUR, Math.ceil(total / 4)))
    );
    expect(armyRefillSeconds(army, 4)).toBeLessThan(armyRefillSeconds(army, 1));
  });

  test("held inside the band; no hatchery takes the top", () => {
    expect(armyRefillSeconds({ monsters: { C1: 1 }, levels: {} }, 3)).toBe(CHAIN_REFILL_HOURS.min * HOUR);
    expect(armyRefillSeconds({ monsters: { C1: 100_000 }, levels: {} }, 1)).toBe(CHAIN_REFILL_HOURS.max * HOUR);
    expect(armyRefillSeconds({ monsters: { C1: 10 }, levels: {} }, 0)).toBe(CHAIN_REFILL_HOURS.max * HOUR);
  });

  test("hatcheries are buildings of type 13", () => {
    expect(hatcheriesIn({ 1: { t: 13 }, 2: { t: 13 }, 3: { t: 16 }, 4: { t: 15 } })).toBe(2);
    expect(hatcheriesIn(null)).toBe(0);
  });
});

describe("readChain", () => {
  test("the payload's chain, or null before the first attack", () => {
    expect(readChain({})).toBeNull();
    expect(readChain(null)).toBeNull();
    expect(readChain({ chain: { length: 3, done: 1, last: NOW } })).toEqual({ length: 3, done: 1, last: NOW });
    expect(readChain({ chain: { length: 3, done: 0, last: NOW } })).toBeNull();
    expect(readChain({ chain: { length: "x", done: 1, last: NOW } })).toBeNull();
  });
});
