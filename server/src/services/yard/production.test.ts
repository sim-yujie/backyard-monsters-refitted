import { describe, expect, test } from "bun:test";
import { hatchTime, housingSpace } from "../../game-data/monsterCatalogue.js";
import type { JsonObject } from "../../types/JsonObject.js";
import {
  readProduction,
  simulateProduction,
  type HatcheryWork,
  type ProductionInput,
} from "./production.js";

/**
 * The production walk on plain blobs. Numbers come from the catalogue at the
 * start so a changed table fails loudly here rather than silently shifting
 * every expectation: Pokey (C1) at level 1 hatches in 15 s and takes 10 space.
 */

const T0 = 1_800_000_000;
const C1_TIME = hatchTime("C1", 1)!;
const C1_SPACE = housingSpace("C1", 1)!;

const working = (...ids: number[]): HatcheryWork[] => ids.map((id) => ({ id, workingFrom: T0 }));

const inputOf = (monsters: JsonObject, overrides: Partial<ProductionInput> = {}): ProductionInput => ({
  monsters,
  hatcheries: working(1),
  hccFrom: null,
  capacity: 10_000,
  overdrive: [],
  levels: {},
  ...overrides,
});

/** One hatchery producing `monster` from a fresh countdown with `queue` behind it. */
const oneHatchery = (queue: unknown[], producing: [string, number] = ["", 0]): JsonObject => ({
  saved: T0,
  housed: {},
  h: [[producing[0], producing[1], queue]],
  hid: [1],
  hstage: [producing[0] ? 1 : 0],
  hcc: [],
});

const housedOf = (result: { monsters: JsonObject }) => result.monsters.housed as Record<string, number>;

describe("simulateProduction — one hatchery", () => {
  test("the catalogue numbers this file relies on", () => {
    expect(C1_TIME).toBe(15);
    expect(C1_SPACE).toBe(10);
  });

  test("houses exactly the monsters whose time has passed, and keeps the rest's progress", () => {
    // In production with 15 s left, 10 more queued: 1 + floor((100 - 15) / 15) = 6 done by T0 + 100.
    const result = simulateProduction(inputOf(oneHatchery([["C1", 10, 1]], ["C1", 15])), T0, T0 + 100);

    expect(housedOf(result)).toEqual({ C1: 6 });
    // The seventh started at T0 + 90 and has 5 s of its 15 left.
    expect(result.monsters.h).toEqual([["C1", 5, [["C1", 4, 1]], 1]]);
    expect(result.monsters.hstage).toEqual([1]);
    expect(result.monsters.saved).toBe(T0 + 100);
    expect(result.events.filter((event) => event.kind === "hatched").map((event) => event.at)).toEqual([
      T0 + 15,
      T0 + 30,
      T0 + 45,
      T0 + 60,
      T0 + 75,
      T0 + 90,
    ]);
  });

  test("an idle hatchery with a queue starts at `from`, and runs dry to idle", () => {
    const result = simulateProduction(inputOf(oneHatchery([["C1", 3, 1]])), T0, T0 + 1000);

    expect(housedOf(result)).toEqual({ C1: 3 });
    expect(result.monsters.h).toEqual([["", 0, []]]);
    expect(result.monsters.hstage).toEqual([0]);
  });

  test("walking in two legs gives the same blob as one walk (idempotent catch-up)", () => {
    const blob = oneHatchery([["C1", 20, 1], ["C2", 5, 2]], ["C1", 7]);
    const whole = simulateProduction(inputOf(blob), T0, T0 + 333);
    const first = simulateProduction(inputOf(blob), T0, T0 + 101);
    const second = simulateProduction(inputOf(first.monsters), T0 + 101, T0 + 333);
    const again = simulateProduction(inputOf(second.monsters), T0 + 333, T0 + 333);

    expect(second.monsters).toEqual(whole.monsters);
    expect(again.monsters).toEqual(whole.monsters);
    expect(again.events).toEqual([]);
  });

  test("stalls when housing is full: nothing lost, nothing refunded, waits finished", () => {
    // Capacity for exactly 2 Pokeys on top of the 3 housed.
    const blob = { ...oneHatchery([["C1", 5, 1]], ["C1", 15]), housed: { C1: 3 } };
    const result = simulateProduction(inputOf(blob, { capacity: 5 * C1_SPACE }), T0, T0 + 10_000);

    expect(housedOf(result)).toEqual({ C1: 5 });
    // The third finished and waits; two came off the queue, three remain.
    expect(result.monsters.hstage).toEqual([2]);
    expect(result.monsters.h).toEqual([["C1", 0, [["C1", 3, 1]], 1]]);
    expect(result.events.at(-1)).toEqual({ kind: "stalled", at: T0 + 45, hatchery: 1, monster: "C1" });
  });

  test("a stalled hatchery resumes the moment housing grows", () => {
    const blob = { ...oneHatchery([["C1", 5, 1]], ["C1", 15]), housed: { C1: 3 } };
    const capacity = [
      { at: T0, value: 5 * C1_SPACE },
      { at: T0 + 100, value: 100 * C1_SPACE },
    ];
    const result = simulateProduction(inputOf(blob, { capacity }), T0, T0 + 1000);

    expect(housedOf(result)).toEqual({ C1: 9 });
    const hatched = result.events.filter((event) => event.kind === "hatched").map((event) => event.at);
    // Two before the stall; the waiting one at T0 + 100, then every 15 s.
    expect(hatched).toEqual([T0 + 15, T0 + 30, T0 + 100, T0 + 115, T0 + 130, T0 + 145]);
  });

  test("an overdrive window partly overlapping the walk speeds only that part", () => {
    // HOD 4x over [T0 + 30, T0 + 60), the walk T0 → T0 + 90: two at 1x, then
    // 15 s monsters take ceil(15 / 4) = 4 s; the one started at T0 + 58 gets
    // 2 s at 4x (8 of its 15) and the other 7 at 1x.
    const overdrive = [{ start: T0 + 30, end: T0 + 60, power: 4 }];
    const result = simulateProduction(inputOf(oneHatchery([["C1", 40, 1]]), { overdrive }), T0, T0 + 90);
    const hatched = result.events.filter((event) => event.kind === "hatched").map((event) => event.at - T0);

    expect(hatched).toEqual([15, 30, 34, 38, 42, 46, 50, 54, 58, 67, 82]);
  });

  test("overdrive arithmetic: a countdown straddling the window's start", () => {
    // 15 s monster started at T0 (idle hatchery), overdrive 10x from T0 + 5:
    // 5 s at 1x leaves 10, which 10x does in 1 s → done at T0 + 6.
    const overdrive = [{ start: T0 + 5, end: T0 + 3600, power: 10 }];
    const result = simulateProduction(inputOf(oneHatchery([["C1", 1, 1]]), { overdrive }), T0, T0 + 10);

    expect(result.events[0]).toEqual({ kind: "hatched", at: T0 + 6, hatchery: 1, monster: "C1" });
  });

  test("a hatchery that does not work (below half health, building, upgrading) does nothing", () => {
    const blob = oneHatchery([["C1", 5, 1]], ["C1", 10]);
    const result = simulateProduction(
      inputOf(blob, { hatcheries: [{ id: 1, workingFrom: null }] }),
      T0,
      T0 + 10_000
    );

    expect(housedOf(result)).toEqual({});
    expect(result.monsters.h).toEqual([["C1", 10, [["C1", 5, 1]], 1]]);
  });

  test("a hatchery that starts working part-way (a finished upgrade) starts then", () => {
    const blob = oneHatchery([["C1", 5, 1]], ["C1", 10]);
    const result = simulateProduction(
      inputOf(blob, { hatcheries: [{ id: 1, workingFrom: T0 + 500 }] }),
      T0,
      T0 + 520
    );

    expect(result.events).toEqual([{ kind: "hatched", at: T0 + 510, hatchery: 1, monster: "C1" }]);
  });

  test("the countdown uses the academy level (C1 at level 6 hatches in 5 s)", () => {
    const result = simulateProduction(
      inputOf(oneHatchery([["C1", 10, 6]]), { levels: { C1: 6 } }),
      T0,
      T0 + 50
    );

    expect(hatchTime("C1", 6)).toBe(5);
    expect(housedOf(result)).toEqual({ C1: 10 });
  });
});

describe("simulateProduction — Hatchery Control Centre", () => {
  const hccYard = (hcc: unknown[], h: unknown[][] = [["", 0, []], ["", 0, []], ["", 0, []]]): JsonObject => ({
    saved: T0,
    housed: {},
    h,
    hid: [11, 12, 13],
    hstage: h.map((entry) => (entry[0] ? 1 : 0)),
    hcc,
  });

  test("hands the shared queue out in hid order, one monster per idle hatchery", () => {
    const result = simulateProduction(
      inputOf(hccYard([["C1", 2, 1], ["C2", 5, 1]]), { hatcheries: working(11, 12, 13), hccFrom: T0 }),
      T0,
      T0 + 1
    );

    // 11 and 12 take the two Pokeys, 13 the first Octo-ooze.
    expect((result.monsters.h as unknown[][]).map((entry) => entry[0])).toEqual(["C1", "C1", "C2"]);
    expect(result.monsters.hcc).toEqual([["C2", 4, 1]]);
  });

  test("a hatchery that frees up first takes the next head; order breaks ties", () => {
    const result = simulateProduction(
      inputOf(hccYard([["C1", 4, 1]], [["C1", 10, []], ["C1", 5, []], ["", 0, []]]), {
        hatcheries: working(11, 12, 13),
        hccFrom: T0,
      }),
      T0,
      T0 + 5
    );

    // T0: 13 idle takes one (3 left). T0 + 5: 12 finishes and takes one (2 left).
    expect(result.monsters.hcc).toEqual([["C1", 2, 1]]);
    expect(housedOf(result)).toEqual({ C1: 1 });
  });

  test("no hand-out before the HCC works, nor to a hatchery that does not work", () => {
    const result = simulateProduction(
      inputOf(hccYard([["C1", 5, 1]]), {
        hatcheries: [
          { id: 11, workingFrom: null },
          { id: 12, workingFrom: T0 },
          { id: 13, workingFrom: T0 },
        ],
        hccFrom: T0 + 100,
      }),
      T0,
      T0 + 100
    );

    expect((result.monsters.h as unknown[][]).map((entry) => entry[0])).toEqual(["", "C1", "C1"]);
    expect(result.monsters.hcc).toEqual([["C1", 3, 1]]);
  });
});

describe("readProduction — stored shapes", () => {
  test("old two-element stacks read as paid at the current academy level; C100 becomes C12", () => {
    const model = readProduction(
      { h: [["C100", 30, [["C1", 3], ["C100", 2, 2], ["junk", 5]]]], hid: [7], hstage: [1], hcc: [["C1", 1]] },
      [7],
      { C1: 4, C12: 3 }
    );

    expect(model.hatcheries).toEqual([
      { id: 7, monster: "C12", countdown: 30, stage: 1, paidLevel: 3, queue: [["C1", 3, 4], ["C12", 2, 2]] },
    ]);
    expect(model.hcc).toEqual([["C1", 1, 4]]);
  });

  test("stages 3/4 restart the countdown, a spent stage 1 waits for housing", () => {
    const model = readProduction(
      { h: [["C1", 0], ["C1", 0], ["C1", 3]], hid: [1, 2, 3], hstage: [1, 3, 2] },
      [1, 2, 3, 4],
      {}
    );

    expect(model.hatcheries.map(({ stage, countdown }) => [stage, countdown])).toEqual([
      [2, 0],
      [1, C1_TIME],
      [2, 0],
      [0, 0],
    ]);
  });

  test("a hatchery missing from the building list is dropped", () => {
    const result = simulateProduction(
      inputOf({ h: [["C1", 5, []], ["C2", 5, []]], hid: [1, 2], hstage: [1, 1], housed: {} }),
      T0,
      T0
    );

    expect(result.monsters.hid).toEqual([1]);
    expect(result.monsters.hcount).toBe(1);
  });
});
