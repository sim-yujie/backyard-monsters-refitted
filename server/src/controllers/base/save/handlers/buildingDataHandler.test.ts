import { describe, expect, test } from "bun:test";
import type { Save } from "../../../../database/models/save.model.js";
import {
  FIRED_TRAP_MAX,
  type BuildingData,
  type BuildingDataMap,
  type FiredTrap,
} from "../../../../types/BuildingData.js";
import { buildingDataHandler } from "./buildingDataHandler.js";

/**
 * The handler only ever reads `buildingdata` and `firedtraps` off the save and
 * writes the same two back, so a plain object standing in for the entity is
 * enough and keeps the test out of the database.
 */
const saveWith = (buildingdata: BuildingDataMap, firedtraps: FiredTrap[] = []): Save =>
  ({ buildingdata, firedtraps }) as unknown as Save;

const building = (id: number, t: number, X: number, Y: number): BuildingData =>
  ({ id, t, X, Y }) as unknown as BuildingData;

/** A yard with a Town Hall, a wall, a Booby Trap and a Heavy Trap. */
const yard = (): BuildingDataMap => ({
  "0": building(0, 14, 5, -15),
  "1": building(1, 17, 100, 100),
  "2": building(2, 24, -720, -585),
  "3": building(3, 117, 300, -200),
});

describe("buildingDataHandler", () => {
  test("a trap the attacker no longer reports is dropped and recorded", () => {
    const save = saveWith(yard());
    const submitted = { ...yard() };
    delete submitted["2"];

    buildingDataHandler(submitted, save);

    expect(Object.keys(save.buildingdata!)).toEqual(["0", "1", "3"]);
    expect(save.firedtraps).toHaveLength(1);
    expect(save.firedtraps![0]).toMatchObject({ t: 24, X: -720, Y: -585 });
    expect(typeof save.firedtraps![0]!.at).toBe("number");
  });

  test("both trap types are recorded, and nothing else is", () => {
    const save = saveWith(yard());

    // The attacker reports nothing at all: every trap fired, while the wall and
    // the Town Hall are kept from the database regardless.
    buildingDataHandler({}, save);

    expect(Object.keys(save.buildingdata!)).toEqual(["0", "1"]);
    expect(save.firedtraps!.map(({ t, X, Y }) => ({ t, X, Y }))).toEqual([
      { t: 24, X: -720, Y: -585 },
      { t: 117, X: 300, Y: -200 },
    ]);
  });

  test("a trap still reported is kept and not recorded", () => {
    const save = saveWith(yard());

    buildingDataHandler(yard(), save);

    expect(Object.keys(save.buildingdata!)).toEqual(["0", "1", "2", "3"]);
    expect(save.firedtraps).toEqual([]);
  });

  test("new entries are appended after the ones already there", () => {
    const older: FiredTrap = { t: 117, X: 1, Y: 2, at: 1 };
    const save = saveWith(yard(), [older]);
    const submitted = { ...yard() };
    delete submitted["3"];

    buildingDataHandler(submitted, save);

    expect(save.firedtraps).toHaveLength(2);
    expect(save.firedtraps![0]).toEqual(older);
    expect(save.firedtraps![1]).toMatchObject({ t: 117, X: 300, Y: -200 });
  });

  test("the list is capped, keeping the newest", () => {
    const old: FiredTrap[] = Array.from({ length: FIRED_TRAP_MAX }, (_, at) => ({
      t: 24,
      X: at,
      Y: 0,
      at,
    }));
    const save = saveWith(yard(), old);
    const submitted = { ...yard() };
    delete submitted["2"];

    buildingDataHandler(submitted, save);

    expect(save.firedtraps).toHaveLength(FIRED_TRAP_MAX);
    // The oldest fell off the front and the new one is last.
    expect(save.firedtraps![0]).toMatchObject({ X: 1 });
    expect(save.firedtraps!.at(-1)).toMatchObject({ t: 24, X: -720, Y: -585 });
  });

  test("a column that has never been written reads as empty", () => {
    const save = { buildingdata: yard() } as unknown as Save;
    const submitted = { ...yard() };
    delete submitted["2"];

    buildingDataHandler(submitted, save);

    expect(save.firedtraps).toHaveLength(1);
  });

  test("no submission at all leaves the save untouched", () => {
    const save = saveWith(yard());
    const before = save.buildingdata;

    buildingDataHandler(null, save);

    expect(save.buildingdata).toBe(before);
    expect(save.firedtraps).toEqual([]);
  });
});
