import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  DEFAULT_FOOTPRINT,
  FOOTPRINTS,
  footprintOf,
  isDecoration,
} from "./buildingFootprints.js";

/**
 * The sandbox yard capture the web client's tests run against: a real 575
 * building save, so every type in it is a type a live account can send us.
 */
const FIXTURE = "../../../web/test/fixtures/baseload-sandbox-yard.json";

interface Building {
  t: number;
  id: number;
}

const fixtureTypes = (): number[] => {
  const raw = JSON.parse(readFileSync(new URL(FIXTURE, import.meta.url), "utf8"));
  const buildings = Object.values(raw.buildingdata as Record<string, Building>);
  return [...new Set(buildings.map((building) => building.t))].sort((a, b) => a - b);
};

describe("buildingFootprints", () => {
  test("every type in the sandbox yard fixture has an entry", () => {
    const missing = fixtureTypes().filter((type) => FOOTPRINTS[type] === undefined);
    expect(missing).toEqual([]);
  });

  test("the fixture is the yard it claims to be", () => {
    // Guards against the fixture being swapped for a near-empty save, which
    // would make the check above pass for the wrong reason.
    expect(fixtureTypes().length).toBeGreaterThan(20);
  });

  test("footprints are positive integers in yard units", () => {
    for (const [type, footprint] of Object.entries(FOOTPRINTS)) {
      expect(Number.isInteger(footprint.w)).toBe(true);
      expect(Number.isInteger(footprint.h)).toBe(true);
      expect(footprint.w, `type ${type} width`).toBeGreaterThan(0);
      expect(footprint.h, `type ${type} height`).toBeGreaterThan(0);
    }
  });

  test("the per-class footprints from the spec win over the props size class", () => {
    // docs/specs/base-building.md §2, "Footprints".
    expect(footprintOf(17)).toMatchObject({ w: 20, h: 20 }); // Wooden Block
    expect(footprintOf(18)).toMatchObject({ w: 20, h: 20 }); // Stone Block
    expect(footprintOf(14)).toMatchObject({ w: 130, h: 130 }); // Town Hall
    expect(footprintOf(15)).toMatchObject({ w: 160, h: 160 }); // Monster Housing
    expect(footprintOf(127)).toMatchObject({ w: 190, h: 160 }); // Inferno Portal
    expect(footprintOf(7)).toMatchObject({ w: 30, h: 30 }); // Mushroom
  });

  test("decorations take their footprint from the props size", () => {
    expect(footprintOf(28)).toMatchObject({ w: 20, h: 20, decoration: true });
    expect(footprintOf(102)).toMatchObject({ w: 100, h: 100, decoration: true });
    expect(isDecoration(28)).toBe(true);
    expect(isDecoration(14)).toBe(false);
    expect(isDecoration(7)).toBe(false);
  });

  test("an unknown type falls back rather than throwing", () => {
    expect(footprintOf(99999)).toEqual(DEFAULT_FOOTPRINT);
  });
});
