import { describe, expect, it } from "vitest";
import type { BaseLoadResponse } from "@/api/types";
import fixture from "../../../test/fixtures/baseload-sandbox-yard.json";
import { readYard } from "./yardModel";
import {
  busyWorkers,
  freeWorkers,
  holdsWorker,
  SHARPER_TOOLS_MULTIPLIER,
  sharperToolsMultiplier,
  WORKER_CAP,
  workerCount,
} from "./workers";

/**
 * The client half of the worker rules, read over a `readYard` yard so that a
 * change to either side shows up here
 * (`server/src/services/yardplanner/workers.test.ts` is the other half).
 */

/** A yard built from a handful of buildings, for the cases the capture lacks. */
const yardWith = (
  buildings: Record<string, Record<string, number>>,
  storedata: BaseLoadResponse["storedata"] = null,
) =>
  readYard({
    error: 0,
    id: 1,
    baseid: "1",
    basesaveid: 1,
    worldsize: [800, 800],
    currenttime: 1_000_000,
    savetime: 1_000_000,
    buildingdata: buildings,
    storedata,
  } as unknown as BaseLoadResponse);

/** One tower, with whatever countdown a case needs on it. */
const tower = (id: number, extra: Record<string, number> = {}) => ({
  [String(id)]: { X: 0, Y: 0, t: 20, id, ...extra },
});

describe("workerCount", () => {
  it("gives a yard with no store purchases the one worker it started with", () => {
    expect(workerCount(null)).toBe(1);
    expect(workerCount(undefined)).toBe(1);
    expect(workerCount({})).toBe(1);
    expect(workerCount({ ENL: { q: 6 } })).toBe(1);
  });

  it("adds one per extra worker bought", () => {
    expect(workerCount({ BEW: { q: 1 } })).toBe(2);
    expect(workerCount({ BEW: { q: 2 } })).toBe(3);
    expect(workerCount({ BEW: { q: 4 } })).toBe(WORKER_CAP);
  });

  it("clamps a save claiming more purchases than the store sells", () => {
    expect(workerCount({ BEW: { q: 9 } })).toBe(WORKER_CAP);
  });

  it("treats an unreadable or negative quantity as none", () => {
    expect(workerCount({ BEW: {} })).toBe(1);
    expect(workerCount({ BEW: { q: -3 } })).toBe(1);
    expect(workerCount({ BEW: { q: Number.NaN } })).toBe(1);
  });

  it("rounds a fractional quantity down", () => {
    expect(workerCount({ BEW: { q: 2.9 } })).toBe(3);
  });
});

describe("busyWorkers", () => {
  it("counts nobody in an empty yard", () => {
    expect(busyWorkers(yardWith({}))).toBe(0);
  });

  it("counts a build, an upgrade and a fortify countdown", () => {
    expect(busyWorkers(yardWith(tower(1, { cB: 600 })))).toBe(1);
    expect(busyWorkers(yardWith(tower(1, { cU: 900 })))).toBe(1);
    expect(busyWorkers(yardWith(tower(1, { cF: 120 })))).toBe(1);
  });

  it("counts a building once however many countdowns it carries", () => {
    expect(busyWorkers(yardWith(tower(1, { cB: 10, cU: 20, cF: 30 })))).toBe(1);
  });

  it("does not count a repair", () => {
    expect(busyWorkers(yardWith(tower(1, { cR: 300 })))).toBe(0);
    expect(busyWorkers(yardWith(tower(1, { rE: 1, hp: 100 })))).toBe(0);
  });

  it("does not count a countdown that has run out", () => {
    expect(busyWorkers(yardWith(tower(1, { cU: 0 })))).toBe(0);
  });

  it("adds up across the yard", () => {
    const yard = yardWith({
      ...tower(1, { cU: 900 }),
      ...tower(2, { cB: 60 }),
      ...tower(3),
      ...tower(4, { cF: 5 }),
    });
    expect(busyWorkers(yard)).toBe(3);
  });
});

describe("the yard's worker figures", () => {
  it("reads five workers and no running job off the sandbox capture", () => {
    const yard = readYard(fixture as unknown as BaseLoadResponse);
    expect(fixture.storedata.BEW.q).toBe(4);
    expect(yard.workers).toEqual({ total: 5, busy: 0 });
    expect(freeWorkers(yard)).toBe(5);
  });

  it("takes a running job out of the free count", () => {
    const yard = yardWith({ ...tower(1, { cU: 900 }), ...tower(2) }, { BEW: { q: 1 } });
    expect(yard.workers).toEqual({ total: 2, busy: 1 });
    expect(freeWorkers(yard)).toBe(1);
  });

  it("never reports a negative free count", () => {
    const yard = yardWith({ ...tower(1, { cU: 900 }), ...tower(2, { cU: 900 }) });
    expect(yard.workers).toEqual({ total: 1, busy: 2 });
    expect(freeWorkers(yard)).toBe(0);
  });
});

describe("holdsWorker", () => {
  it("is true for the three countdowns that take a worker and false otherwise", () => {
    const kinds = (extra: Record<string, number>): boolean =>
      holdsWorker(yardWith(tower(1, extra)).buildings[0]!);

    expect(kinds({ cB: 60 })).toBe(true);
    expect(kinds({ cU: 900 })).toBe(true);
    expect(kinds({ cF: 30 })).toBe(true);
    expect(kinds({ cR: 300 })).toBe(false);
    expect(kinds({})).toBe(false);
  });
});

describe("sharperToolsMultiplier", () => {
  const NOW = 1_000_000;

  it("shortens a countdown by a fifth while the buff runs", () => {
    expect(sharperToolsMultiplier({ BST: { e: NOW + 1 } }, NOW)).toBe(SHARPER_TOOLS_MULTIPLIER);
    expect(SHARPER_TOOLS_MULTIPLIER).toBe(0.8);
  });

  it("is 1 once it has expired, and for a yard that never bought it", () => {
    expect(sharperToolsMultiplier({ BST: { e: NOW } }, NOW)).toBe(1);
    expect(sharperToolsMultiplier({ BST: { e: NOW - 1 } }, NOW)).toBe(1);
    expect(sharperToolsMultiplier({}, NOW)).toBe(1);
    expect(sharperToolsMultiplier(null, NOW)).toBe(1);
    expect(sharperToolsMultiplier({ BST: {} }, NOW)).toBe(1);
  });

  it("is what the yard carries as its build time", () => {
    expect(readYard(fixture as unknown as BaseLoadResponse).buildTime).toBe(1);
    const buffed = readYard({
      error: 0,
      currenttime: NOW,
      savetime: NOW,
      buildingdata: {},
      storedata: { BST: { e: NOW + 3_600 } },
    } as unknown as BaseLoadResponse);
    expect(buffed.buildTime).toBe(0.8);
  });
});
