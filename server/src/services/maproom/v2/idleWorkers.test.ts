import { describe, expect, test } from "bun:test";
import type { BuildingDataMap } from "../../../types/BuildingData.js";
import { outpostWorkerAt } from "./idleWorkers.js";

/**
 * The map's construction badge (owner, 12 Nov 2026): the stored countdowns are
 * as of the save, so an upgrade that has finished since must read as a free
 * worker without the yard being opened, and a running one says when it ends.
 */
const NOW = 1_800_000_000;

const yard = (buildingdata: BuildingDataMap, savedAgo: number, health: Record<string, number> = {}) => ({
  buildingdata,
  buildinghealthdata: health,
  savetime: NOW - savedAgo,
});

describe("an outpost's worker on the map", () => {
  test("an upgrade that ran out since the save is over: the worker is free", () => {
    const save = yard({ "1": { id: 1, t: 14, l: 2, cU: 90 } } as unknown as BuildingDataMap, 120);
    expect(outpostWorkerAt(save, NOW)).toEqual({ busy: false });
  });

  test("an upgrade still running ends at the save time plus what was left then", () => {
    const save = yard({ "1": { id: 1, t: 14, l: 2, cU: 300 } } as unknown as BuildingDataMap, 120);
    expect(outpostWorkerAt(save, NOW)).toEqual({ busy: true, finishAt: NOW + 180 });
  });

  test("a build and a fortify count the same way", () => {
    expect(outpostWorkerAt(yard({ "1": { id: 1, t: 14, cB: 60 } } as unknown as BuildingDataMap, 0), NOW)).toEqual({
      busy: true,
      finishAt: NOW + 60,
    });
    expect(outpostWorkerAt(yard({ "1": { id: 1, t: 14, l: 3, cF: 45 } } as unknown as BuildingDataMap, 5), NOW)).toEqual({
      busy: true,
      finishAt: NOW + 40,
    });
  });

  test("a Starter Kit prefab builds itself and holds no worker", () => {
    const save = yard({ "1": { id: 1, t: 14, cB: 600, prefab: 3 } } as unknown as BuildingDataMap, 0);
    expect(outpostWorkerAt(save, NOW)).toEqual({ busy: false });
  });

  test("a job on a damaged building is paused: busy, with no end to wait for", () => {
    const save = yard({ "1": { id: 1, t: 14, l: 2, cU: 30 } } as unknown as BuildingDataMap, 600, { "1": 100 });
    expect(outpostWorkerAt(save, NOW)).toEqual({ busy: true, finishAt: null });
  });

  test("no countdown at all, or no save time, is a free worker / the stored countdown", () => {
    expect(outpostWorkerAt(yard({ "1": { id: 1, t: 14, l: 2 } } as unknown as BuildingDataMap, 50), NOW)).toEqual({ busy: false });
    const unsaved = { buildingdata: { "1": { id: 1, t: 14, l: 2, cU: 30 } } as unknown as BuildingDataMap, savetime: 0 };
    expect(outpostWorkerAt(unsaved, NOW)).toEqual({ busy: true, finishAt: NOW + 30 });
  });
});
