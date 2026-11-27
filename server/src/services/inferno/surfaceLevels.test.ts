import { describe, expect, mock, test } from "bun:test";

// The Inferno yard is read through a stand-in, so each test says what it holds.
const lookups: unknown[] = [];
let infernoAcademy: unknown = null;
mock.module("../../server.js", () => ({
  postgres: {
    em: {
      findOne: async (_entity: unknown, where: unknown) => {
        lookups.push(where);
        return infernoAcademy === undefined ? null : { academy: infernoAcademy };
      },
    },
  },
}));

const { surfaceArmyLevels, withInfernoLevels } = await import("./surfaceLevels.js");

const MAIN = { C6: { level: 4, powerup: 2 }, C2: { level: 3 } };
const INFERNO = { IC2: { level: 3, powerup: 1 }, IC1: { level: 2 }, C6: { level: 6 } };

describe("withInfernoLevels: an Inferno monster on the surface fights at its Inferno level (beta 10)", () => {
  test("takes Inferno monsters' levels from the Inferno Academy and the rest from the main one", () => {
    expect(withInfernoLevels(MAIN, INFERNO)).toEqual({ C6: 4, C2: 3, IC2: 3, IC1: 2 });
  });

  test("never lets the Inferno yard change a surface monster's level", () => {
    expect(withInfernoLevels(MAIN, { C6: { level: 6 } })).toEqual({ C6: 4, C2: 3 });
  });

  test("leaves the main Academy as it was without an Inferno yard", () => {
    expect(withInfernoLevels(MAIN, null)).toEqual({ C6: 4, C2: 3 });
  });
});

describe("surfaceArmyLevels: an attack start's levels", () => {
  const attacker = { academy: MAIN, baseid_inferno: 7001 } as never;

  test("reads the Inferno yard when the army can fling an Inferno monster", async () => {
    lookups.length = 0;
    infernoAcademy = INFERNO;
    const levels = await surfaceArmyLevels(attacker, { "1001": { C6: 10, IC2: 12 } });
    expect(levels).toEqual({ C6: 4, C2: 3, IC2: 3, IC1: 2 });
    expect(lookups).toEqual([{ baseid: "7001" }]);
  });

  test("reads nothing more for an army without one, nor for a player with no Inferno yard", async () => {
    lookups.length = 0;
    infernoAcademy = INFERNO;
    expect(await surfaceArmyLevels(attacker, { "1001": { C6: 10, IC2: 0 } })).toEqual({ C6: 4, C2: 3 });
    expect(await surfaceArmyLevels({ academy: MAIN, baseid_inferno: 0 } as never, { "1001": { IC2: 3 } })).toEqual({
      C6: 4,
      C2: 3,
    });
    expect(lookups).toEqual([]);
  });

  test("an Inferno monster held in an outpost counts too", async () => {
    lookups.length = 0;
    infernoAcademy = INFERNO;
    const levels = await surfaceArmyLevels(attacker, { "1001": { C6: 10 }, "2002": { IC1: 4 } });
    expect(levels.IC1).toBe(2);
  });
});
