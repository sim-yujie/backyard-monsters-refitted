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

const building = (id: number, t: number, X: number, Y: number, l?: number): BuildingData =>
  ({ id, t, X, Y, ...(l === undefined ? {} : { l }) }) as unknown as BuildingData;

/** A yard with a Town Hall 10, a wall, a Booby Trap and a Heavy Trap. */
const yard = (): BuildingDataMap => ({
  "0": building(0, 14, 5, -15, 10),
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
    const older: FiredTrap = { t: 117, X: -300, Y: 300, at: 1 };
    const save = saveWith(yard(), [older]);
    const submitted = { ...yard() };
    delete submitted["3"];

    buildingDataHandler(submitted, save);

    expect(save.firedtraps).toHaveLength(2);
    expect(save.firedtraps![0]).toEqual(older);
    expect(save.firedtraps![1]).toMatchObject({ t: 117, X: 300, Y: -200 });
  });

  test("the list is capped, keeping the newest", () => {
    // 200 spots that touch no building and no other spot. The Town Hall is
    // left out, so the Booby Trap limit does not trim the list first.
    const old: FiredTrap[] = Array.from({ length: FIRED_TRAP_MAX }, (_, at) => ({
      t: 24,
      X: 1_000 + (at % 20) * 20,
      Y: 1_000 + Math.floor(at / 20) * 20,
      at,
    }));
    const hallless = yard();
    delete hallless["0"];
    const save = saveWith(hallless, old);
    const submitted = { ...hallless };
    delete submitted["2"];

    buildingDataHandler(submitted, save);

    expect(save.firedtraps).toHaveLength(FIRED_TRAP_MAX);
    // The oldest fell off the front and the new one is last.
    expect(save.firedtraps![0]).toMatchObject({ X: 1_020, Y: 1_000 });
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
  test("player report: traps rebuilt by hand and fired again are one list, not 24 + 17", () => {
    // Town Hall 5 (28 Booby Traps allowed) with 24 Booby Traps in a row.
    const start: BuildingDataMap = { "0": building(0, 14, 5, -15, 5) };
    for (let i = 0; i < 24; i++) start[String(100 + i)] = building(100 + i, 24, -600 + i * 20, 400);
    const save = saveWith(structuredClone(start));

    // Attack 1 sets every trap off.
    buildingDataHandler({ "0": start["0"] }, save);
    expect(save.firedtraps).toHaveLength(24);

    // The player builds all 24 again by hand, on the same spots, with new ids.
    const rebuilt: BuildingDataMap = { "0": start["0"]! };
    for (let i = 0; i < 24; i++) rebuilt[String(200 + i)] = building(200 + i, 24, -600 + i * 20, 400);
    save.buildingdata = structuredClone(rebuilt);

    // Attack 2 sets 17 of the new ones off.
    const survivors: BuildingDataMap = { "0": rebuilt["0"]! };
    for (let i = 17; i < 24; i++) survivors[String(200 + i)] = rebuilt[String(200 + i)]!;
    buildingDataHandler(survivors, save);

    // 17 traps are missing, so 17 are offered, each on a free spot.
    expect(save.firedtraps).toHaveLength(17);
    expect(new Set(save.firedtraps!.map((entry) => entry.X)).size).toBe(17);
  });
});
