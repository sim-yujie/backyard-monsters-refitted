import { describe, expect, test } from "bun:test";

import { bucketCost, championByType, championStat, type FlingLog } from "../../game-rules/combat/index.js";
import {
  DESCENT_FLINGER_CAPACITY,
  descentFightableLog,
  descentFlingerCapacity,
  descentIndexOf,
  descentLevelOf,
  descentProgressAfter,
  descentRefusal,
  descentYardOf,
  flingerLevelOf,
  nextDescentIndex,
  purseAfterDescentLoot,
} from "./descent.js";
import { NO_INFERNO_PROGRESS, type InfernoProgressRecord } from "./infernoProgress.js";

/**
 * The Descent's rules (`docs/design/inferno.md` §2.4, WP 1.11-1.12): which yard
 * is open, the Flinger payload, what a fling may carry, and the progress a
 * landed attack leaves.
 */

const NOW = 1_800_000_000;
/** All five emergence raids done: the cave is open. */
const OPEN: InfernoProgressRecord = { ...NO_INFERNO_PROGRESS, emergenceLevel: 5, emergenceLastAt: NOW - 100 };
/** The first `count` yards beaten. */
const beaten = (count: number): InfernoProgressRecord => ({
  ...OPEN,
  descentDestroyed: Array.from({ length: 13 }, (_, index) => (index < count ? 1 : 0)),
});
const NO_LOOT = { r1: 0, r2: 0, r3: 0, r4: 0 };

describe("which Descent yard is open", () => {
  test("the 13 base ids are 201-213, nothing else", () => {
    expect(descentIndexOf("201")).toBe(0);
    expect(descentIndexOf(213)).toBe(12);
    for (const other of ["200", "214", "2O1", "", "201.5", "-201", null]) expect(descentIndexOf(other)).toBeNull();
  });

  test("the cave has to be up all five levels", () => {
    expect(descentRefusal(NO_INFERNO_PROGRESS, "201")).toBe("caveClosed");
    expect(descentRefusal({ ...OPEN, emergenceLevel: 4 }, "201")).toBe("caveClosed");
    expect(descentRefusal(OPEN, "201")).toBeNull();
  });

  test("only the next base: not one beaten, not one further down", () => {
    const progress = beaten(3);
    expect(nextDescentIndex(progress)).toBe(3);
    expect(descentRefusal(progress, "204")).toBeNull();
    expect(descentRefusal(progress, "203")).toBe("notNextBase");
    expect(descentRefusal(progress, "205")).toBe("notNextBase");
    expect(descentRefusal(progress, "213")).toBe("notNextBase");
    expect(descentRefusal(progress, "1234")).toBe("notDescentBase");
  });

  test("once passed nothing is open, and the counter reads 14", () => {
    const passed = { ...beaten(13), descentPassedAt: NOW };
    expect(nextDescentIndex(passed)).toBeNull();
    expect(descentRefusal(passed, "213")).toBe("descentPassed");
    expect(descentLevelOf(passed)).toBe(14);
    expect(descentLevelOf(beaten(4))).toBe(5);
    expect(descentLevelOf(OPEN)).toBe(1);
  });

  test("each yard comes from the data file", () => {
    expect(descentYardOf(0).baseid).toBe("201");
    expect(descentYardOf(12).baseid).toBe("213");
    // From yard 206 the yard houses monsters for its Housing Bunkers (§2.4).
    expect(descentYardOf(5).monsters).toEqual({ IC1: 10 });
  });
});

describe("the Flinger in the Descent", () => {
  test("the main table's payload at the attacker's own Flinger level (YARD_PROPS.as:709)", () => {
    expect(DESCENT_FLINGER_CAPACITY).toEqual([250, 850, 1500, 2500, 3500, 3500, 3500]);
    expect(descentFlingerCapacity(0, false)).toBe(0);
    expect(descentFlingerCapacity(1, false)).toBe(250);
    expect(descentFlingerCapacity(4, false)).toBe(2500);
    expect(descentFlingerCapacity(5, false)).toBe(3500);
  });

  test("Declare War adds a quarter (ATTACK.as:592-594)", () => {
    expect(descentFlingerCapacity(4, true)).toBe(3125);
  });

  test("the level is the built Flinger's; one still being built does not count", () => {
    expect(flingerLevelOf({ "1": { t: 5, l: 3 }, "2": { t: 14, l: 6 } })).toBe(3);
    expect(flingerLevelOf({ "1": { t: 5, l: 1, cB: 100 } })).toBe(0);
    expect(flingerLevelOf(null)).toBe(0);
  });
});

describe("what a Descent fling may carry", () => {
  const fling = (monsters: Record<string, number>, champion?: { t: number; l: number }) => ({
    kind: "fling" as const,
    t: 40,
    x: 300,
    y: 150,
    r: 100,
    monsters,
    ...(champion && { champion }),
  });
  const log = (...events: FlingLog["events"]): FlingLog => ({ v: 1, seed: 7, events });

  test("an honest log comes back as it was", () => {
    const honest = log(fling({ C1: 10 }), { kind: "retreat", t: 900 });
    expect(descentFightableLog(honest, 2500, undefined)).toEqual(honest);
  });

  test("no catapult bombs and no siege weapons in the Descent", () => {
    const cut = descentFightableLog(
      log(
        { kind: "bomb", t: 10, x: 0, y: 0, id: "tw0" },
        { kind: "siege", t: 20, x: 0, y: 0, id: "decoy" } as never,
        fling({ C1: 1 })
      ),
      2500,
      undefined
    );
    expect(cut.events.map((event) => event.kind)).toEqual(["fling"]);
  });

  test("a fling fuller than the Flinger holds is cut to what fits", () => {
    const each = bucketCost({ C1: 1 }, undefined);
    const cut = descentFightableLog(log(fling({ C1: 1000 })), 250, undefined);
    expect(cut.events[0]).toMatchObject({ monsters: { C1: Math.floor(250 / each) } });
  });

  test("a champion goes in first and takes its own room", () => {
    const champion = { t: 1, l: 1 };
    const room = championStat(championByType(1)!, "bucket", 1);
    const each = bucketCost({ C1: 1 }, undefined);
    const cut = descentFightableLog(log(fling({ C1: 1000 }, champion)), 850, undefined);
    expect(cut.events[0]).toMatchObject({ champion, monsters: { C1: Math.floor((850 - room) / each) } });
  });

  test("with no Flinger nothing but a champion goes", () => {
    expect(descentFightableLog(log(fling({ C1: 5 })), 0, undefined).events).toEqual([]);
  });
});

describe("the progress a landed Descent attack leaves", () => {
  const health = { "3": 0, "7": 120 };

  test("90% damage beats the yard and opens the next (ATTACK.as:970)", () => {
    const update = descentProgressAfter(OPEN, { index: 0, damage: 90, health, loot: NO_LOOT });
    expect(update.won).toBe(true);
    expect(update.descentDestroyed.slice(0, 2)).toEqual([1, 0]);
    expect(update.descentBest[0]).toBe(90);
    expect(update.level).toBe(2);
    expect(update.captured).toBe(false);
    expect(update.descentYards["201"]).toBeUndefined();
  });

  test("89% is a loss: the yard keeps its damage and what it gave", () => {
    const first = descentProgressAfter(OPEN, { index: 0, damage: 89.9, health, loot: { r1: 100, r2: 0, r3: 5, r4: 0 } });
    expect(first.won).toBe(false);
    expect(first.descentDestroyed[0]).toBe(0);
    expect(first.level).toBe(1);
    expect(first.descentYards["201"]).toEqual({ health, looted: { r1: 100, r2: 0, r3: 5, r4: 0 } });

    const second = descentProgressAfter(
      { ...OPEN, descentDestroyed: first.descentDestroyed, descentBest: first.descentBest, descentYards: first.descentYards },
      { index: 0, damage: 50, health, loot: { r1: 10, r2: 0, r3: 0, r4: 0 } }
    );
    expect(second.descentYards["201"]!.looted).toEqual({ r1: 110, r2: 0, r3: 5, r4: 0 });
    // The best damage only goes up.
    expect(second.descentBest[0]).toBe(89);
  });

  test("the 13th win passes the Descent: capture, counter 14", () => {
    const update = descentProgressAfter(beaten(12), { index: 12, damage: 100, health: {}, loot: NO_LOOT });
    expect(update.captured).toBe(true);
    expect(update.level).toBe(14);
    expect(update.descentDestroyed).toEqual(Array(13).fill(1));
  });

  test("a loss on the 13th is no capture", () => {
    const update = descentProgressAfter(beaten(12), { index: 12, damage: 60, health: {}, loot: NO_LOOT });
    expect(update.captured).toBe(false);
    expect(update.level).toBe(13);
  });
});

describe("the Inferno purse in the Descent", () => {
  test("loot is added in full, past the 10,000 cap (ATTACK.as:703-709)", () => {
    const purse = purseAfterDescentLoot(
      { r1: 9_000, r2: 0, r3: 0, r4: 0, r1max: 10_000 },
      { r1: 4_000, r2: 3_000, r3: 0, r4: 1 }
    );
    expect(purse).toEqual({ r1: 13_000, r2: 3_000, r3: 0, r4: 1, r1max: 10_000 });
  });
});
