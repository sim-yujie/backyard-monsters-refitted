import { describe, expect, test } from "bun:test";

import { extractTownHall } from "./extractTownHall.js";

/**
 * The Flash client left `l` out of a level-1 building, so an old yard's Town
 * Hall can have no level. It must read as level 1, or `townHall.l < 6` is
 * false and a level-1 Town Hall passes the Map Room 2 check (upstream c2803f8ee).
 */
describe("extractTownHall", () => {
  test("a Town Hall saved without a level reads as level 1", () => {
    const townHall = extractTownHall({ b1: { t: 1, l: 4 }, b2: { t: 14, id: 2, x: 10, y: 20 } });

    expect(townHall).toMatchObject({ t: 14, id: 2, l: 1 });
    expect(townHall!.l < 6).toBe(true);
  });

  test("a saved level is kept", () => {
    expect(extractTownHall({ b1: { t: 14, l: 7 } })?.l).toBe(7);
  });

  test("the yard's own building is left untouched", () => {
    const buildingdata = { b1: { t: 14, id: 1 } };

    extractTownHall(buildingdata);

    expect(buildingdata.b1).toEqual({ t: 14, id: 1 });
  });

  test("a yard with no Town Hall gives null", () => {
    expect(extractTownHall({ b1: { t: 1, l: 2 } })).toBeNull();
    expect(extractTownHall({})).toBeNull();
  });
});
