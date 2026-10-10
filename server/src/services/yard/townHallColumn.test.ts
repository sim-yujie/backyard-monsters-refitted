import { describe, expect, mock, test } from "bun:test";
import { townHallColumnValue } from "./townHallColumn.js";

mock.module("../../server.js", () => ({ postgres: { em: {} }, redis: {} }));
const { Save } = await import("../../database/models/save.model.js");

// Type 14 is the main yard's Town Hall; `cB` > 0 is a build still counting down.
describe("townHallColumnValue", () => {
  test("is the Town Hall's level", () => {
    expect(townHallColumnValue({ a: { t: 14, l: 7 }, b: { t: 2, l: 9 } })).toBe(7);
  });

  test("a hall with no l reads level 1", () => {
    expect(townHallColumnValue({ a: { t: 14 } })).toBe(1);
  });

  test("an upgrade still running keeps the old level; a hall still being built is 0", () => {
    expect(townHallColumnValue({ a: { t: 14, l: 6, cU: 100 } })).toBe(6);
    expect(townHallColumnValue({ a: { t: 14, l: 1, cB: 50 } })).toBe(0);
  });

  test("no hall, or no data, is 0", () => {
    expect(townHallColumnValue({ a: { t: 2, l: 3 } })).toBe(0);
    expect(townHallColumnValue(null)).toBe(0);
    expect(townHallColumnValue(undefined)).toBe(0);
  });

  test("reads a double-encoded JSON string, and 0 for junk", () => {
    expect(townHallColumnValue(JSON.stringify({ a: { t: 14, l: 10 } }))).toBe(10);
    expect(townHallColumnValue("{not json")).toBe(0);
  });
});

describe("Save.syncTownHallLevel", () => {
  const make = (buildingdata: unknown) => Object.assign(Object.create(Save.prototype), { buildingdata, thlevel: 0 }) as InstanceType<typeof Save>;

  test("an insert sets the level from the blob", () => {
    const save = make({ a: { t: 14, l: 4 } });
    save.syncTownHallLevel();
    expect(save.thlevel).toBe(4);
  });

  test("an update that changes buildingdata re-reads it (a finished upgrade)", () => {
    const save = make({ a: { t: 14, l: 5 } });
    save.thlevel = 4;
    save.syncTownHallLevel({ changeSet: { payload: { buildingdata: {} } } });
    expect(save.thlevel).toBe(5);
  });

  test("an update that does not touch buildingdata leaves it alone", () => {
    const save = make({ a: { t: 14, l: 5 } });
    save.thlevel = 4;
    save.syncTownHallLevel({ changeSet: { payload: { resources: {} } } });
    expect(save.thlevel).toBe(4);
  });
});
