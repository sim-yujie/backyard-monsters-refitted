import { describe, expect, it } from "vitest";
import type { BaseLoadResponse, BuildingData } from "@/api/types";
import { rowOf } from "./buildingCosts";
import { fixedWorkSource, NO_WORK, readWork, workUntil, type WorkSave } from "./buildingWork";
import { animPolicy, WorkKind } from "./yardAnim";

/**
 * Which buildings animate, building type by building type (#255): a strip
 * that runs only while working runs while the clock is before the building's
 * `workUntil`, and every other strip runs regardless.
 */

const SAVED = 1_000_000;
const INF = Number.POSITIVE_INFINITY;

const saveWith = (
  buildings: Record<string, Partial<BuildingData>>,
  extra: Partial<WorkSave> = {},
) =>
  ({
    currenttime: SAVED,
    savetime: SAVED,
    buildingdata: buildings as BaseLoadResponse["buildingdata"],
    ...extra,
  }) as WorkSave;

/** Whether building `id` of `type` animates at `now`. */
const animates = (save: WorkSave, type: number, id: number, now: number): boolean =>
  now < workUntil(type, id, readWork(save));

const twigs = rowOf(1)![6]!;
const CAPACITY = twigs.capacity[0]!;
const PRODUCE = twigs.produce[0]!;
const CYCLE = twigs.cycleTime[0]!;

describe("which types animate only while working", () => {
  it("ties each working building to its job, and leaves the rest running", () => {
    const expected: Record<number, WorkKind | null> = {
      1: WorkKind.HARVEST,
      2: WorkKind.HARVEST,
      3: WorkKind.HARVEST,
      4: WorkKind.HARVEST,
      8: WorkKind.UNLOCK,
      13: WorkKind.HATCH,
      26: WorkKind.TRAIN,
      116: WorkKind.RESEARCH,
      // Decorations, the sign and the Outpost Defender loop for ever in Flash.
      28: null,
      52: null,
      53: null,
      105: null,
      140: null,
    };
    for (const [type, work] of Object.entries(expected)) {
      expect(animPolicy(Number(type))?.work, `type ${type}`).toBe(work);
    }
  });

  it("drops only the hatchery back to cell 0 when it stops", () => {
    expect(animPolicy(13)?.restOnIdle).toBe(true);
    for (const type of [1, 2, 3, 4, 8, 26, 116]) {
      expect(animPolicy(type)?.restOnIdle, `type ${type}`).toBe(false);
    }
  });

  it("runs a decoration with no work at all", () => {
    expect(workUntil(105, 7, NO_WORK)).toBe(INF);
    expect(workUntil(140, 7, NO_WORK)).toBe(INF);
  });

  it("holds a working type nobody says is working", () => {
    for (const type of [1, 8, 13, 26, 116]) {
      expect(workUntil(type, 7, NO_WORK), `type ${type}`).toBe(Number.NEGATIVE_INFINITY);
    }
  });
});

describe("harvesters", () => {
  it("runs while the buffer fills and stops the moment it is full", () => {
    const save = saveWith({ "5": { id: 5, t: 1, l: 1, st: CAPACITY - PRODUCE, cP: 10 } });
    // One cycle left: `cP` seconds.
    expect(readWork(save).get(5)).toBe(SAVED + 10);
    expect(animates(save, 1, 5, SAVED)).toBe(true);
    expect(animates(save, 1, 5, SAVED + 9.9)).toBe(true);
    expect(animates(save, 1, 5, SAVED + 10)).toBe(false);
  });

  it("counts the whole cycles left to fill", () => {
    const save = saveWith({ "5": { id: 5, t: 1, l: 1, st: 0 } });
    const cycles = Math.ceil(CAPACITY / PRODUCE);
    expect(readWork(save).get(5)).toBe(SAVED + cycles * CYCLE);
  });

  it("stands still when full", () => {
    const save = saveWith({ "5": { id: 5, t: 2, l: 1, st: CAPACITY * 10 } });
    expect(readWork(save).has(5)).toBe(false);
    expect(animates(save, 2, 5, SAVED)).toBe(false);
  });

  it("restarts once collected, which is a new save with an empty buffer", () => {
    const full = saveWith({ "5": { id: 5, t: 1, l: 1, st: CAPACITY } });
    const banked = saveWith({ "5": { id: 5, t: 1, l: 1, st: 0 } });
    expect(animates(full, 1, 5, SAVED)).toBe(false);
    expect(animates(banked, 1, 5, SAVED)).toBe(true);
  });

  it("stands still while building, upgrading or fortifying", () => {
    for (const countdown of [{ cB: 60 }, { cU: 60 }, { cF: 60 }]) {
      const save = saveWith({ "5": { id: 5, t: 3, l: 1, st: 0, ...countdown } });
      expect(animates(save, 3, 5, SAVED), JSON.stringify(countdown)).toBe(false);
    }
  });

  it("stands still below half health", () => {
    const save = saveWith({ "5": { id: 5, t: 4, l: 1, st: 0, hp: 1 } });
    expect(animates(save, 4, 5, SAVED)).toBe(false);
  });

  it("keeps an outpost's harvesters running however full", () => {
    const save = saveWith({ "5": { id: 5, t: 1, l: 1, st: CAPACITY } }, { type: "outpost" });
    expect(readWork(save).get(5)).toBe(INF);
    const upgrading = saveWith(
      { "5": { id: 5, t: 1, l: 1, st: CAPACITY, cU: 60 } },
      { type: "outpost" },
    );
    expect(readWork(upgrading).has(5)).toBe(false);
  });
});

describe("the Monster Locker", () => {
  const locker = { "8": { id: 8, t: 8, l: 1 } };

  it("runs while a monster unlocks and stops when it is done", () => {
    const save = saveWith(locker, {
      lockerdata: { C5: { t: 1, s: SAVED - 100, e: SAVED + 500 } },
    });
    expect(animates(save, 8, 8, SAVED)).toBe(true);
    expect(animates(save, 8, 8, SAVED + 500)).toBe(false);
  });

  it("stands still with nothing unlocking", () => {
    const save = saveWith(locker, { lockerdata: { C5: { t: 2 }, C6: { t: 2 } } });
    expect(animates(save, 8, 8, SAVED)).toBe(false);
  });
});

describe("the hatchery", () => {
  const hatchery = { "13": { id: 13, t: 13, l: 1 } };
  const monsters = (stage: number, queue: unknown = []) =>
    ({
      saved: SAVED,
      h: [["C1", 30, queue]],
      hid: [13],
      hstage: [stage],
    }) as unknown as NonNullable<WorkSave["monsters"]>;

  it("runs while a monster grows and stops with an empty queue", () => {
    const save = saveWith(hatchery, { monsters: monsters(1) });
    expect(animates(save, 13, 13, SAVED + 29)).toBe(true);
    expect(animates(save, 13, 13, SAVED + 30)).toBe(false);
  });

  it("keeps running past the monster when more are queued", () => {
    const save = saveWith(hatchery, { monsters: monsters(1, [["C1", 3, 1]]) });
    expect(readWork(save).get(13)).toBe(INF);
  });

  it("stands still waiting for housing, or with nothing in production", () => {
    for (const stage of [0, 2]) {
      const save = saveWith(hatchery, { monsters: monsters(stage) });
      expect(animates(save, 13, 13, SAVED), `stage ${stage}`).toBe(false);
    }
  });
});

describe("the Monster Academy and the Monster Lab", () => {
  it("runs the Academy while it trains", () => {
    const save = saveWith(
      { "26": { id: 26, t: 26, l: 1, upg: "C2" } },
      { academy: { C2: { level: 1, time: SAVED + 60 } } as NonNullable<WorkSave["academy"]> },
    );
    expect(animates(save, 26, 26, SAVED)).toBe(true);
    expect(animates(save, 26, 26, SAVED + 60)).toBe(false);
    expect(animates(saveWith({ "26": { id: 26, t: 26, l: 1 } }), 26, 26, SAVED)).toBe(false);
  });

  it("runs the Lab while it researches", () => {
    const save = saveWith({ "116": { id: 116, t: 116, l: 1, upg: "C2", upt: SAVED + 90 } });
    expect(animates(save, 116, 116, SAVED + 89)).toBe(true);
    expect(animates(save, 116, 116, SAVED + 90)).toBe(false);
    expect(animates(saveWith({ "116": { id: 116, t: 116, l: 1 } }), 116, 116, SAVED)).toBe(
      false,
    );
  });
});

describe("fixedWorkSource", () => {
  it("runs the clock on from the load's currenttime", () => {
    let wall = 50;
    const source = fixedWorkSource(saveWith({}, { currenttime: SAVED }), () => wall);
    expect(source.now()).toBe(SAVED);
    wall += 12;
    expect(source.now()).toBe(SAVED + 12);
  });
});
