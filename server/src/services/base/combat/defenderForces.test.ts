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
    const forces = await servedDefenderForces(yard(NOW - HOUR), null, NOW);
    expect(forces.defenderChampions).toEqual([{ t: 3, l: 1, hp: 15_000, pl: 1, fb: 0 }]);
  });

  test("defends a food-bonus champion at its cage card's full health, with its food bonus", async () => {
    // Level 6 Fomor at food bonus 2, a week after its last defence: 40,000 + 2,200, as the card shows it.
    const fed = {
      type: "main",
      buildingdata: {},
      academy: {},
      savetime: NOW - 7 * 24 * HOUR,
      champion: [{ t: 3, l: 6, hp: 1_000, fd: 0, fb: 2, pl: 1, ft: NOW + HOUR, status: 0 }],
    } as never;
    const forces = await servedDefenderForces(fed, null, NOW);
    expect(forces.defenderChampions).toEqual([{ t: 3, l: 6, hp: 42_200, pl: 1, fb: 2 }]);
  });

  test("part way: int(15,000 × 5 / 3,600) = 20 for every 5 seconds since", async () => {
    const forces = await servedDefenderForces(yard(NOW - 60), null, NOW);
    expect(forces.defenderChampions[0]!.hp).toBe(1_200 + 20 * 12);
  });
});

describe("servedDefenderForces: an Inferno yard's Housing Bunkers", () => {
  /** An Inferno yard with one Housing Bunker (type 128) standing. */
  const inferno = (monsters: unknown) =>
    ({
      type: "inferno",
      buildingdata: { 5: { id: 5, t: 128, l: 1, X: 0, Y: 0 } },
      buildinghealthdata: {},
      academy: {},
      savetime: NOW,
      champion: [],
      monsters,
    }) as never;

  test("a player's yard defends with what it keeps under `housed`", async () => {
    const forces = await servedDefenderForces(inferno({ housed: { IC1: 6 } }), null, NOW);
    expect(forces.bunkers[5]).toEqual({ IC1: 6 });
  });

  test("a data-file yard's flat list still defends", async () => {
    const forces = await servedDefenderForces(inferno({ IC1: 10 }), null, NOW);
    expect(forces.bunkers[5]).toEqual({ IC1: 10 });
  });
});
