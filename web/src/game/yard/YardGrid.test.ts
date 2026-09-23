import { describe, expect, it } from "vitest";
import fixture from "../../../test/fixtures/baseload-sandbox-yard.json";
import {
  depthKey,
  footprintBox,
  footprintCentre,
  footprintOf,
  fromIso,
  toIso,
  YARD_SIZES,
  yardBounds,
  yardSize,
  yardToWorld,
} from "./YardGrid";

/** Every building in the captured yard, as `{ X, Y, t }`. */
const buildings = Object.values(
  fixture.buildingdata as Record<string, { X: number; Y: number; t: number }>,
);

describe("isometric conversion", () => {
  it("matches the values GRID.as computes", () => {
    // Worked by hand from client/scripts/GRID.as:135-144.
    expect(toIso(0, 0)).toEqual({ x: 0, y: 0 });
    expect(toIso(100, 0)).toEqual({ x: 100, y: 50 });
    expect(toIso(0, 100)).toEqual({ x: -100, y: 50 });
    expect(toIso(5, -15)).toEqual({ x: 20, y: -5 });
    expect(fromIso(20, -5)).toEqual({ x: 5, y: -15 });
  });

  it("subtracts z from the vertical axis", () => {
    expect(toIso(100, 100, 30)).toEqual({ x: 0, y: 70 });
  });

  it("round-trips every building position in the captured yard", () => {
    expect(buildings.length).toBe(575);
    for (const building of buildings) {
      const iso = toIso(building.X, building.Y);
      expect(fromIso(iso.x, iso.y)).toEqual({ x: building.X, y: building.Y });
    }
  });

  it("round-trips odd sums, where the two roundings have to disagree", () => {
    for (let x = -13; x <= 13; x++) {
      for (let y = -13; y <= 13; y++) {
        const iso = toIso(x, y);
        expect(fromIso(iso.x, iso.y)).toEqual({ x, y });
      }
    }
  });
});

describe("depth", () => {
  it("orders by isometric y first", () => {
    expect(depthKey(0, 10, 1)).toBeGreaterThan(depthKey(900, 9, 1));
  });

  it("breaks ties on isometric x, then on id", () => {
    expect(depthKey(10, 5, 1)).toBeGreaterThan(depthKey(9, 5, 1));
    expect(depthKey(10, 5, 2)).toBeGreaterThan(depthKey(10, 5, 1));
  });

  it("puts a building further down the screen on top", () => {
    // Two buildings one behind the other on the same isometric column.
    const near = toIso(200, 200);
    const far = toIso(100, 100);
    expect(depthKey(near.x, near.y, 1)).toBeGreaterThan(depthKey(far.x, far.y, 2));
  });
});

describe("plot size", () => {
  it("is the seven-rung ladder STORE.ProcessPurchases builds", () => {
    expect(YARD_SIZES).toHaveLength(7);
    expect(YARD_SIZES[0]).toEqual([1000, 800]);
    expect(YARD_SIZES[6]).toEqual([1780, 1420]);
  });

  it("matches the Yard Planner's own table everywhere but one rung", () => {
    // client/scripts/com/monsters/baseplanner/PlannerDesignView.as:106.
    const planner = [
      [1000, 800],
      [1100, 880],
      [1220, 980],
      [1340, 1080],
      [1480, 1180],
      [1620, 1300],
      [1780, 1420],
    ];
    for (let i = 0; i < planner.length; i++) {
      // The height at one purchase is the exception: the live formula's
      // compounding gives 880.00000000000011, which rounds up to 900.
      if (i === 1) {
        expect(YARD_SIZES[i]).toEqual([1100, 900]);
        continue;
      }
      expect(YARD_SIZES[i]).toEqual(planner[i]);
    }
  });

  it("clamps an expansion level outside the ladder", () => {
    expect(yardSize(-1)).toEqual([1000, 800]);
    expect(yardSize(99)).toEqual([1780, 1420]);
  });

  it("matches the captured yard's expansion level", () => {
    expect(fixture.storedata.ENL.q).toBe(6);
    expect(yardSize(fixture.storedata.ENL.q)).toEqual([1780, 1420]);
  });
});

describe("plot bounds", () => {
  const bounds = yardBounds(6);

  it("is a diamond half as tall as it is wide, plus the margin", () => {
    // 1780 x 1420 yard units: the diamond spans (1780 + 1420) / 2 = 1600 either
    // side of the origin on x, and half that on y.
    expect(bounds.width).toBe(3200 + 240);
    expect(bounds.height).toBe(1600 + 240);
    expect(bounds.originX).toBe(1600 + 120);
    expect(bounds.originY).toBe(800 + 120);
  });

  it("puts the four corners on the extremes", () => {
    const [top, right, bottom, left] = bounds.corners;
    expect(top).toEqual({ x: 1540, y: 120 });
    expect(right).toEqual({ x: 3320, y: 1010 });
    expect(bottom).toEqual({ x: 1900, y: 1720 });
    expect(left).toEqual({ x: 120, y: 830 });
  });

  it("keeps every building in the captured yard inside the bounds", () => {
    for (const building of buildings) {
      const box = footprintBox(bounds, building.t, building.X, building.Y);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(bounds.width);
      expect(box.y + box.height).toBeLessThanOrEqual(bounds.height);
    }
  });
});

describe("footprints", () => {
  it("matches the table in docs/specs/base-building.md section 2", () => {
    expect(footprintOf(17)).toEqual([20, 20]); // Wooden Block
    expect(footprintOf(24)).toEqual([20, 20]); // Booby Trap
    expect(footprintOf(1)).toEqual([70, 70]); // Twig Snapper
    expect(footprintOf(6)).toEqual([80, 80]); // Storage Silo
    expect(footprintOf(5)).toEqual([90, 90]); // Flinger
    expect(footprintOf(26)).toEqual([100, 100]); // Monster Academy
    expect(footprintOf(14)).toEqual([130, 130]); // Town Hall
    expect(footprintOf(15)).toEqual([160, 160]); // Monster Housing
    expect(footprintOf(127)).toEqual([190, 160]); // Inferno Portal
    expect(footprintOf(7)).toEqual([30, 30]); // Mushroom
  });

  it("falls back for a type it does not name", () => {
    expect(footprintOf(9999)).toEqual([40, 40]);
  });

  it("puts the box around the whole diamond", () => {
    const bounds = yardBounds(0);
    const box = footprintBox(bounds, 14, 0, 0);
    const origin = yardToWorld(bounds, 0, 0);
    // 130 x 130: 130 right, 130 left, and (130 + 130) / 2 down from the origin.
    expect(box.x).toBe(origin.x - 130);
    expect(box.width).toBe(260);
    expect(box.y).toBe(origin.y);
    expect(box.height).toBe(130);
  });

  it("centres on the middle of the diamond", () => {
    const bounds = yardBounds(0);
    const box = footprintBox(bounds, 14, 0, 0);
    const centre = footprintCentre(bounds, 14, 0, 0);
    expect(centre.x).toBe(box.x + box.width / 2);
    expect(centre.y).toBe(box.y + box.height / 2);
  });
});
