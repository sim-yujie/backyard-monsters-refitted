import { describe, expect, mock, test } from "bun:test";

// A main yard's defence reads nothing but the row it is handed.
mock.module("../../../server.js", () => ({ postgres: {} }));

const { servedDefenderForces } = await import("./defenderForces.js");

const NOW = 1_800_000_000;
const HOUR = 3_600;

/** A main yard whose level 1 Fomor was hurt to 1,200 when its owner last looked. */
const yard = (savetime: number) =>
  ({
    type: "main",
    buildingdata: {},
    academy: {},
    savetime,
    champion: [{ t: 3, l: 1, hp: 1_200, fd: 0, fb: 0, pl: 1, ft: NOW + HOUR, status: 0 }],
  }) as never;

describe("servedDefenderForces: the caged champion's health", () => {
  test("defends healed to now, not at the health stored at the owner's last visit", async () => {
    // Level 1 Fomor heals from empty to its full 15,000 in an hour.
    const forces = await servedDefenderForces(yard(NOW - HOUR), NOW);
    expect(forces.defenderChampions).toEqual([{ t: 3, l: 1, hp: 15_000, pl: 1 }]);
  });

  test("part way: int(15,000 × 5 / 3,600) = 20 for every 5 seconds since", async () => {
    const forces = await servedDefenderForces(yard(NOW - 60), NOW);
    expect(forces.defenderChampions[0]!.hp).toBe(1_200 + 20 * 12);
  });
});
