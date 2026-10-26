import { describe, expect, test } from "bun:test";

import { parseArgs, parseMonsters, SEED_BUNKER, withBunker } from "./inferno-seed.js";
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

describe("withBunker", () => {
  test("adds a level 1 Housing Bunker under the next id", () => {
    const yard = { "1": { id: 1, t: 14, X: -100, Y: 0, l: 1 } } as unknown as BuildingDataMap;
    expect(withBunker(yard)["2"]).toEqual({ id: 2, ...SEED_BUNKER } as never);
  });

  test("leaves a yard that has one alone", () => {
    const yard = { "4": { id: 4, t: 128, X: 0, Y: 0, l: 3 } } as unknown as BuildingDataMap;
    expect(withBunker(yard)).toEqual(yard);
  });
});
