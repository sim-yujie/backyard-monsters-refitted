import { describe, expect, test } from "bun:test";
import type { BuildingDataMap } from "../../../types/BuildingData.js";
import { MAX_ELAPSED_SECONDS, elapsedSince, referenceYard } from "./referenceYard.js";

/**
 * The reference yard is what every economy rule compares against, so the two
 * things it has to get right are the clamp and the replay: a countdown that
 * merely ticked must never read as a violation, and a save from the distant
 * past must not hand out an unbounded harvest allowance.
 */

const NOW = 1_800_000_000;

/** One building with an upgrade countdown running. */
const upgrading = (cU: number): BuildingDataMap => ({
  "1": { x: 0, y: 0, t: 20, id: 1, l: 2, cU },
});

describe("elapsedSince", () => {
  test("is the gap between the stored save and now", () => {
    expect(elapsedSince(NOW - 90, NOW)).toBe(90);
  });

  test("clamps a save from the future to zero", () => {
    expect(elapsedSince(NOW + 500, NOW)).toBe(0);
  });

  test("clamps the sandbox row's savetime of 0 to thirty days", () => {
    expect(elapsedSince(0, NOW)).toBe(MAX_ELAPSED_SECONDS);
  });

  test("reads an absent or unreadable savetime as the epoch", () => {
    expect(elapsedSince(null, NOW)).toBe(MAX_ELAPSED_SECONDS);
    expect(elapsedSince(undefined, 120)).toBe(120);
  });
});

describe("referenceYard", () => {
  test("brings a countdown forward by the elapsed time", () => {
    const yard = referenceYard(
      { savetime: NOW - 60, buildingdata: upgrading(100) },
      NOW
    );

    expect(yard.elapsed).toBe(60);
    expect(yard.buildingdata["1"]?.cU).toBe(40);
    expect(yard.buildingdata["1"]?.l).toBe(2);
  });

  test("finishes the countdown and raises the level once it runs out", () => {
    const yard = referenceYard(
      { savetime: NOW - 120, buildingdata: upgrading(100) },
      NOW
    );

    expect(yard.elapsed).toBe(120);
    expect(yard.buildingdata["1"]?.cU).toBeUndefined();
    expect(yard.buildingdata["1"]?.l).toBe(3);
  });

  test("leaves a damaged building's countdown where it was", () => {
    const yard = referenceYard(
      {
        savetime: NOW - 120,
        buildingdata: upgrading(100),
        buildinghealthdata: { "1": 50 },
      },
      NOW
    );

    expect(yard.buildingdata["1"]?.cU).toBe(100);
    expect(yard.buildingdata["1"]?.l).toBe(2);
  });

  test("changes nothing when no time has passed", () => {
    const yard = referenceYard({ savetime: NOW, buildingdata: upgrading(100) }, NOW);

    expect(yard.elapsed).toBe(0);
    expect(yard.buildingdata["1"]?.cU).toBe(100);
  });

  test("does not disturb the stored yard it was handed", () => {
    const stored = upgrading(100);
    referenceYard({ savetime: NOW - 60, buildingdata: stored }, NOW);

    expect(stored["1"]?.cU).toBe(100);
  });

  test("reads an absent buildingdata as an empty yard", () => {
    const yard = referenceYard({ savetime: NOW - 60 }, NOW);

    expect(yard.buildingdata).toEqual({});
    expect(yard.elapsed).toBe(60);
  });
});
