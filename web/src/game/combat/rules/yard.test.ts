import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_FOOTPRINT,
  blocksPathing,
  buildEngineYard,
  buildingClass,
  buildingMaxHp,
  distance,
  footprintOf,
  fromIso,
  isMainTarget,
  toIso,
} from "./yard.js";

/**
 * The yard model: the class table, the footprints and the two projections.
 *
 * Two of the three tables here are transcriptions of data that lives somewhere
 * else — the props `_class` the combat stats generator writes into its row
 * comments, and `server/src/game-data/buildingFootprints.ts` — so the tests
 * that matter most re-read the source and compare row for row. A transcription
 * nobody checks is a transcription that drifts, and a drifted class table would
 * point a wall specialist at a storage silo.
 *
 * Reading those files from a test is allowed where the module itself may not:
 * tests are not copied to the server and are excluded from `boundary.test.ts`
 * by the same filter the sync script uses.
 */

const MODULE_DIR = fileURLToPath(new URL(".", import.meta.url));
const SERVER_FOOTPRINTS = fileURLToPath(
  new URL("../../../../../server/src/game-data/buildingFootprints.ts", import.meta.url),
);

/** Every `type -> class` the generated file's row comments name. */
const generatedClasses = (): Map<number, string> => {
  const text = readFileSync(`${MODULE_DIR}combatStatsData.ts`, "utf8");
  const found = new Map<number, string>();
  for (const match of text.matchAll(/\/\/\s*(\d+)\s+.+?\s+\((\w+)\)\s+—/g)) {
    found.set(Number(match[1]), match[2] as string);
  }
  return found;
};

/** Every non-decoration `type -> { w, h }` the server's footprint table holds. */
const serverFootprints = (): Map<number, { w: number; h: number }> => {
  const text = readFileSync(SERVER_FOOTPRINTS, "utf8");
  const found = new Map<number, { w: number; h: number }>();
  const row = /^\s*(\d+):\s*\{\s*w:\s*(\d+),\s*h:\s*(\d+),\s*decoration:\s*(true|false)\s*\}/gm;
  for (const match of text.matchAll(row)) {
    if (match[4] === "true") continue;
    found.set(Number(match[1]), { w: Number(match[2]), h: Number(match[3]) });
  }
  return found;
};

describe("the building class table", () => {
  const generated = generatedClasses();

  it("agrees with every class the generated stats file names", () => {
    expect(generated.size).toBeGreaterThan(130);
    const disagreements: string[] = [];
    for (const [type, name] of generated) {
      if (buildingClass(type) !== name) {
        disagreements.push(`${type}: table says ${buildingClass(type)}, generator says ${name}`);
      }
    }
    expect(disagreements).toEqual([]);
  });

  it("puts the walls, the towers and the traps where the rules expect them", () => {
    expect(buildingClass(17)).toBe("wall");
    expect(buildingClass(18)).toBe("wall");
    expect(buildingClass(20)).toBe("tower");
    expect(buildingClass(24)).toBe("trap");
    expect(buildingClass(117)).toBe("trap");
    expect(buildingClass(7)).toBe("mushroom");
    expect(buildingClass(14)).toBe("special");
    expect(buildingClass(1)).toBe("resource");
  });

  it("blocks pathing on walls and on nothing else", () => {
    // `BWALL` is the only class that calls `PATHING.RegisterBuilding`.
    const blocking = [];
    for (let type = 1; type <= 140; type += 1) if (blocksPathing(type)) blocking.push(type);
    expect(blocking).toEqual([17, 18]);
  });

  it("keeps walls, traps and cages out of the pool group 1 draws from", () => {
    // A creep never chooses a wall: the grid hands it the one in the way.
    expect(isMainTarget(buildingClass(17))).toBe(false);
    expect(isMainTarget(buildingClass(24))).toBe(false);
    expect(isMainTarget(buildingClass(114))).toBe(false);
    expect(isMainTarget(buildingClass(20))).toBe(true);
    expect(isMainTarget(buildingClass(6))).toBe(true);
    expect(isMainTarget(buildingClass(28))).toBe(false);
  });
});

describe("footprints", () => {
  it("matches the server's table for every non-decoration type", () => {
    const server = serverFootprints();
    expect(server.size).toBe(51);
    const disagreements: string[] = [];
    for (const [type, size] of server) {
      const held = footprintOf(type);
      if (held.w !== size.w || held.h !== size.h) {
        disagreements.push(`${type}: ${held.w}x${held.h} against ${size.w}x${size.h}`);
      }
    }
    expect(disagreements).toEqual([]);
  });

  it("falls back to the pathing rectangle, then to 40 x 40", () => {
    // Type 28 is a decoration: not in the table, but it has a `_gridCost` row.
    expect(footprintOf(28)).toEqual({ w: 20, h: 20 });
    expect(footprintOf(9999)).toEqual(DEFAULT_FOOTPRINT);
  });
});

describe("the isometric projection", () => {
  it("is `PATHING.FromISO`, truncating towards zero", () => {
    expect(fromIso(0, 0)).toEqual({ x: 0, y: 0 });
    expect(fromIso(100, 50)).toEqual({ x: 100, y: 0 });
    expect(fromIso(-615, 115)).toEqual({ x: -192, y: 422 });
  });

  it("round-trips a point that lands on the lattice", () => {
    const cart = fromIso(200, 100);
    expect(toIso(cart.x, cart.y)).toEqual({ x: 200, y: 100 });
  });

  it("adds an isometric y offset to both cartesian axes", () => {
    // Which is why `checkTarget`'s `_middle` offset is `(cx + m, cy + m)`.
    const plain = fromIso(340, 120);
    const raised = fromIso(340, 120 + 35);
    expect(raised.x - plain.x).toBe(35);
    expect(raised.y - plain.y).toBe(35);
  });

  it("measures plain euclidean distance, as `GLOBAL.QuickDistance` does", () => {
    expect(distance(0, 0, 3, 4)).toBe(5);
  });
});

describe("buildEngineYard", () => {
  const input = {
    buildingdata: {
      "7": { id: 7, t: 20, l: 3, X: 180, Y: -480 },
      "2": { t: 17, X: -615, Y: 115 },
      "9": { id: 9, t: 24, X: -720, Y: -585 },
      "4": { id: 4, t: 1, X: 355, Y: 375, st: 720 },
    },
    buildinghealthdata: { "7": 1000, "9": 0 },
    resources: { r1: 500 },
  } as const;

  it("sorts by id and takes a missing id from the map key", () => {
    const yard = buildEngineYard(input);
    expect(yard.buildings.map((one) => one.id)).toEqual([2, 4, 7, 9]);
  });

  it("defaults an absent level to 1 and absent health to full", () => {
    const yard = buildEngineYard(input);
    const wall = yard.buildings[0];
    expect(wall?.level).toBe(1);
    expect(wall?.hp).toBe(buildingMaxHp(17, 1));
  });

  it("clamps a reported health into the ladder", () => {
    const yard = buildEngineYard(input);
    const tower = yard.buildings.find((one) => one.id === 7);
    expect(tower?.hp).toBe(1000);
    expect(tower?.maxHp).toBe(buildingMaxHp(20, 3));
  });

  it("reads a trap at zero health as already fired", () => {
    const yard = buildEngineYard(input);
    expect(yard.buildings.find((one) => one.id === 9)?.fired).toBe(true);
  });

  it("carries a harvester's buffer and marks an empty one looted", () => {
    const yard = buildEngineYard(input);
    const harvester = yard.buildings.find((one) => one.id === 4);
    expect(harvester?.stored).toBe(720);
    expect(harvester?.looted).toBe(false);
  });

  it("zeroes the resources a caller does not name", () => {
    const yard = buildEngineYard(input);
    expect(yard.resources).toEqual({ r1: 500, r2: 0, r3: 0, r4: 0 });
  });
});
