import { describe, expect, test } from "bun:test";
import type { BuildingData, BuildingDataMap } from "../../types/BuildingData.js";
import { catchUpArmyRow } from "./armies.js";
import { housingCapacity, housingCapacityNow } from "./housing.js";

/**
 * Housing on a yard nobody has opened since its Housing finished (patch,
 * 24 Nov 2026): the stored row still carries the countdown, so the capacity
 * Repeat attack and the map transfers read has to play it forward first.
 */

const NOW = 1_800_000_000;
const HOUR = 3600;

/** An outpost row as stored: Housing (type 15) and when it was last written. */
const outpost = (buildings: Record<string, Partial<BuildingData>>, savetime: number = NOW - HOUR) => ({
  type: "outpost",
  savetime,
  buildingdata: buildings as BuildingDataMap,
  buildinghealthdata: {},
  monsters: { housed: {} },
});

describe("housingCapacityNow", () => {
  test("Housing that finished building while the yard was closed counts", () => {
    const yard = outpost({ "1": { id: 1, t: 15, l: 1, cB: 600, prefab: 6 }, "2": { id: 2, t: 15, l: 1, cB: 1800 } });
    // Stored: both still under construction, nothing counts.
    expect(housingCapacity(yard, false)).toBe(0);
    // An hour later both are done: the prefab at its kit level (540), the other at level 1 (200).
    expect(housingCapacityNow(yard, false, NOW)).toBe(740);
  });

  test("Housing still building does not count", () => {
    const yard = outpost({ "1": { id: 1, t: 15, l: 1, cB: 2 * HOUR }, "2": { id: 2, t: 15, l: 6 } });
    expect(housingCapacityNow(yard, false, NOW)).toBe(540);
  });

  test("an upgrade whose time has passed counts at the new level; one still running at the old", () => {
    const done = outpost({ "1": { id: 1, t: 15, l: 5, cU: 600 } });
    expect(housingCapacity(done, false)).toBe(450);
    expect(housingCapacityNow(done, false, NOW)).toBe(540);

    const running = outpost({ "1": { id: 1, t: 15, l: 5, cU: 2 * HOUR } });
    expect(housingCapacityNow(running, false, NOW)).toBe(450);
  });

  test("a damaged or repairing building's countdown stays paused, as the catch-up keeps it", () => {
    const damaged = { ...outpost({ "1": { id: 1, t: 15, l: 1, cB: 600 } }), buildinghealthdata: { "1": 500 } };
    expect(housingCapacityNow(damaged, false, NOW)).toBe(0);
    const repairing = outpost({ "1": { id: 1, t: 15, l: 5, cU: 600, rE: 1 } });
    expect(housingCapacityNow(repairing, false, NOW)).toBe(450);
  });

  test("a row with no savetime advances nothing: a running build still does not count", () => {
    for (const savetime of [undefined, null, 0]) {
      const yard = { ...outpost({ "1": { id: 1, t: 15, l: 1, cB: 600 } }), savetime: savetime as number | null | undefined };
      expect(housingCapacityNow(yard, false, NOW)).toBe(0);
    }
  });

  test("the stored row is not changed", () => {
    const yard = outpost({ "1": { id: 1, t: 15, l: 1, cB: 600 } });
    const before = structuredClone(yard.buildingdata);
    housingCapacityNow(yard, false, NOW);
    expect(yard.buildingdata).toEqual(before);
    expect(yard.buildingdata["1"]?.cB).toBe(600);
  });

  test("Housing Expansion still applies", () => {
    const yard = outpost({ "1": { id: 1, t: 15, l: 1, cB: 600, prefab: 6 } });
    expect(housingCapacityNow(yard, true, NOW)).toBe(housingCapacity(outpost({ "1": { id: 1, t: 15, l: 6 } }), true));
  });

  test("matches the space the yard's own catch-up reports (what the map shows)", () => {
    const yard = outpost({
      "1": { id: 1, t: 15, l: 1, cB: 600, prefab: 6 },
      "2": { id: 2, t: 15, l: 5, cU: 900 },
      "3": { id: 3, t: 15, l: 1, cB: 2 * HOUR },
    });
    const space = Number(catchUpArmyRow(yard, null, NOW).monsters?.space);
    expect(space).toBe(1080);
    expect(housingCapacityNow(yard, false, NOW)).toBe(space);
  });
});
