import { describe, expect, test } from "bun:test";

import { parseArgs, parseMonsters, SEED_BUNKER, withRoomFor } from "./inferno-seed.js";
import type { BuildingDataMap } from "../types/BuildingData.js";

/** The dev Inferno seed (`bun run inferno:seed`). */

describe("parseArgs", () => {
  test("reads the username, database and monsters in any order", () => {
    expect(parseArgs(["--db", "bym_s2c", "agenttester", "--monsters", "IC1=6,IC2=4"])).toEqual({
      username: "agenttester",
      db: "bym_s2c",
      monsters: { IC1: 6, IC2: 4 },
      envDb: false,
    });
  });

  test("needs a username and a database", () => {
    expect(() => parseArgs(["agenttester"])).toThrow("Usage");
    expect(() => parseArgs(["--db", "bym_s2c"])).toThrow("Usage");
  });
});

describe("parseMonsters", () => {
  test("refuses a main-yard monster or a bad count", () => {
    expect(() => parseMonsters("C1=4")).toThrow();
    expect(() => parseMonsters("IC1=0")).toThrow();
    expect(() => parseMonsters("IC1=two")).toThrow();
  });

  test("adds up a repeated id", () => {
    expect(parseMonsters("IC1=2,IC1=3")).toEqual({ IC1: 5 });
  });
});

describe("withRoomFor", () => {
  const UNDER_HALL = { id: 1, t: 14, X: -100, Y: 0, l: 1 };
  const yardOf = (...buildings: object[]) => ({
    type: "inferno",
    buildingdata: Object.fromEntries(buildings.map((b) => [String((b as { id: number }).id), b])) as unknown as BuildingDataMap,
    buildinghealthdata: {},
  });

  test("adds a Housing Bunker at the lowest level that fits", () => {
    // 6 x 15 + 4 x 15 + 2 x 30 = 210 places: more than level 1's 200.
    const buildings = withRoomFor(yardOf(UNDER_HALL), { IC1: 6, IC2: 4, IC4: 2 });
    expect(buildings["2"]).toEqual({ id: 2, ...SEED_BUNKER, l: 2 } as never);
  });

  test("leaves a yard with room alone", () => {
    const yard = yardOf(UNDER_HALL, { id: 4, t: 128, X: 0, Y: 0, l: 3 });
    expect(withRoomFor(yard, { IC1: 6 })).toEqual(yard.buildingdata);
  });

  test("raises a Housing Bunker too small, and refuses past level 6", () => {
    const yard = yardOf({ id: 4, t: 128, X: 0, Y: 0, l: 1 });
    expect(withRoomFor(yard, { IC8: 5 })["4"]).toMatchObject({ l: 3 });
    expect(() => withRoomFor(yard, { IC8: 19 })).toThrow("level 6");
  });
});
