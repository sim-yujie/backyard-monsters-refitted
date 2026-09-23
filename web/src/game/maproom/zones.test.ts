import { describe, expect, it } from "vitest";
import { AREA_ZONE_SIZE, WORLD_HEIGHT, WORLD_WIDTH } from "@/config";
import { zoneId } from "@/api/maproom";
import {
  ZONE_COLUMNS,
  ZONE_ROWS,
  inWorld,
  rangeCentre,
  zoneCentre,
  zoneFor,
  zoneFromId,
  zonePriority,
  zonesForRange,
} from "./zones";

describe("zone identity", () => {
  it("maps a cell to the zone whose origin is the multiple of 10 below it", () => {
    expect(zoneFor(710, 347)).toEqual({ id: zoneId(710, 340), originX: 710, originY: 340 });
    expect(zoneFor(0, 0)).toEqual({ id: 0, originX: 0, originY: 0 });
    expect(zoneFor(9, 9)).toEqual({ id: 0, originX: 0, originY: 0 });
    expect(zoneFor(799, 799)).toEqual({ id: zoneId(790, 790), originX: 790, originY: 790 });
  });

  it("round trips through the id", () => {
    for (const [x, y] of [
      [0, 0],
      [710, 347],
      [799, 0],
      [0, 799],
      [450, 450],
    ] as const) {
      const zone = zoneFor(x, y);
      expect(zoneFromId(zone.id)).toEqual(zone);
    }
  });

  it("gives every zone in the world a distinct id", () => {
    const ids = new Set<number>();
    for (let x = 0; x < WORLD_WIDTH; x += AREA_ZONE_SIZE) {
      for (let y = 0; y < WORLD_HEIGHT; y += AREA_ZONE_SIZE) {
        ids.add(zoneFor(x, y).id);
      }
    }
    expect(ids.size).toBe(ZONE_COLUMNS * ZONE_ROWS);
  });
});

describe("zonesForRange", () => {
  it("covers a range that sits inside one zone with exactly that zone", () => {
    const zones = zonesForRange({ minCol: 712, maxCol: 715, minRow: 341, maxRow: 344 });
    expect(zones).toEqual([{ id: zoneId(710, 340), originX: 710, originY: 340 }]);
  });

  it("includes the zone a range starts inside, not only the ones it fully spans", () => {
    const zones = zonesForRange({ minCol: 715, maxCol: 725, minRow: 345, maxRow: 345 });
    expect(zones.map((zone) => zone.originX)).toEqual([710, 720]);
  });

  it("covers every cell of the range", () => {
    const range = { minCol: 98, maxCol: 133, minRow: 7, maxRow: 42 };
    const covered = new Set(zonesForRange(range).map((zone) => zone.id));

    for (let x = range.minCol; x <= range.maxCol; x++) {
      for (let y = range.minRow; y <= range.maxRow; y++) {
        expect(covered.has(zoneFor(x, y).id)).toBe(true);
      }
    }
  });

  it("returns no duplicates", () => {
    const zones = zonesForRange({ minCol: 0, maxCol: 55, minRow: 0, maxRow: 55 });
    expect(new Set(zones.map((zone) => zone.id)).size).toBe(zones.length);
    expect(zones.length).toBe(6 * 6);
  });

  it("clamps to the world rather than asking for cells that do not exist", () => {
    const zones = zonesForRange({ minCol: -40, maxCol: 5, minRow: 795, maxRow: 900 });
    expect(zones).toEqual([{ id: zoneId(0, 790), originX: 0, originY: 790 }]);
  });

  it("is empty when the range is inverted", () => {
    expect(zonesForRange({ minCol: 50, maxCol: 10, minRow: 0, maxRow: 10 })).toEqual([]);
  });
});

describe("priority", () => {
  it("orders zones by distance from the viewport centre", () => {
    const range = { minCol: 700, maxCol: 739, minRow: 340, maxRow: 379 };
    const centre = rangeCentre(range);
    expect(centre).toEqual({ x: 719.5, y: 359.5 });

    const ordered = zonesForRange(range).sort(
      (a, b) => zonePriority(a, centre) - zonePriority(b, centre),
    );

    // The four zones touching the centre come first, the corners come last.
    expect(ordered.slice(0, 4).map((zone) => zone.id)).toContain(zoneFor(715, 355).id);
    expect(ordered[ordered.length - 1]).toBeDefined();
    expect(zonePriority(ordered[0]!, centre)).toBeLessThan(
      zonePriority(ordered[ordered.length - 1]!, centre),
    );
  });

  it("measures from the middle of a zone, not its origin", () => {
    expect(zoneCentre({ id: 0, originX: 710, originY: 340 })).toEqual({ x: 715, y: 345 });
  });
});

describe("inWorld", () => {
  it("accepts the corners and rejects everything outside", () => {
    expect(inWorld(0, 0)).toBe(true);
    expect(inWorld(WORLD_WIDTH - 1, WORLD_HEIGHT - 1)).toBe(true);
    expect(inWorld(-1, 0)).toBe(false);
    expect(inWorld(0, WORLD_HEIGHT)).toBe(false);
  });
});
