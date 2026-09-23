import { describe, expect, it } from "vitest";
import {
  BLUEPRINT_WORLD,
  blueprintDragToYard,
  blueprintToWorld,
  blueprintToYard,
  centredRect,
  rectContains,
  rectCorners,
  tileCategory,
  tileLabel,
  tileRect,
  TileCategory,
} from "./blueprint";
import { DECORATION_HEIGHT, DECORATION_WIDTH } from "./placement";

describe("blueprint projection", () => {
  it("puts the plot centre in the middle of the decoration area", () => {
    const origin = blueprintToWorld(0, 0);
    expect(origin).toEqual({ x: BLUEPRINT_WORLD.originX, y: BLUEPRINT_WORLD.originY });
    expect(BLUEPRINT_WORLD.width - origin.x).toBe(origin.x);
    expect(BLUEPRINT_WORLD.height - origin.y).toBe(origin.y);
  });

  it("round-trips a yard position exactly", () => {
    for (const [x, y] of [
      [0, 0],
      [-550, -450],
      [545, 445],
      [-1620, 1300],
    ] as const) {
      const world = blueprintToWorld(x, y);
      expect(blueprintToYard(world.x, world.y)).toEqual({ x, y });
    }
  });

  it("keeps the whole decoration area inside the world", () => {
    const topLeft = blueprintToWorld(-DECORATION_WIDTH / 2, -DECORATION_HEIGHT / 2);
    const bottomRight = blueprintToWorld(DECORATION_WIDTH / 2, DECORATION_HEIGHT / 2);
    expect(topLeft.x).toBeGreaterThan(0);
    expect(topLeft.y).toBeGreaterThan(0);
    expect(bottomRight.x).toBeLessThan(BLUEPRINT_WORLD.width);
    expect(bottomRight.y).toBeLessThan(BLUEPRINT_WORLD.height);
  });

  it("snaps a drag to the grid on both axes", () => {
    expect(blueprintDragToYard(12, -13)).toEqual({ dx: 10, dy: -15 });
    expect(blueprintDragToYard(2, 2)).toEqual({ dx: 0, dy: 0 });
    expect(blueprintDragToYard(-3, 3)).toEqual({ dx: -5, dy: 5 });
  });
});

describe("tiles", () => {
  it("is the footprint translated to the world", () => {
    // Type 14 is the town hall, a 130 unit square.
    const rect = tileRect(14, 100, -50);
    expect(rect).toEqual({
      x: BLUEPRINT_WORLD.originX + 100,
      y: BLUEPRINT_WORLD.originY - 50,
      width: 130,
      height: 130,
    });
  });

  it("keeps the portal's non-square footprint", () => {
    const rect = tileRect(127, 0, 0);
    expect([rect.width, rect.height]).toEqual([190, 160]);
  });

  it("lists corners clockwise from the top-left", () => {
    expect(rectCorners({ x: 1, y: 2, width: 10, height: 20 })).toEqual([
      [1, 2],
      [11, 2],
      [11, 22],
      [1, 22],
    ]);
  });

  it("counts edges as inside", () => {
    const rect = { x: 10, y: 10, width: 20, height: 20 };
    expect(rectContains(rect, 10, 10)).toBe(true);
    expect(rectContains(rect, 30, 30)).toBe(true);
    expect(rectContains(rect, 20, 20)).toBe(true);
    expect(rectContains(rect, 30.1, 20)).toBe(false);
    expect(rectContains(rect, 9.9, 20)).toBe(false);
  });

  it("centres a plot rectangle on the origin", () => {
    const rect = centredRect(550, 450);
    expect(rect.x + rect.width / 2).toBe(BLUEPRINT_WORLD.originX);
    expect(rect.y + rect.height / 2).toBe(BLUEPRINT_WORLD.originY);
    expect([rect.width, rect.height]).toEqual([1100, 900]);
  });
});

describe("tileCategory", () => {
  it("follows the props table's groups", () => {
    expect(tileCategory(1, false)).toBe(TileCategory.RESOURCE);
    expect(tileCategory(6, false)).toBe(TileCategory.RESOURCE);
    expect(tileCategory(14, false)).toBe(TileCategory.BUILDING);
    expect(tileCategory(128, false)).toBe(TileCategory.BUILDING);
    expect(tileCategory(17, false)).toBe(TileCategory.WALL);
    expect(tileCategory(24, false)).toBe(TileCategory.TRAP);
    expect(tileCategory(117, false)).toBe(TileCategory.TRAP);
    expect(tileCategory(21, false)).toBe(TileCategory.DEFENSIVE);
    expect(tileCategory(114, false)).toBe(TileCategory.DEFENSIVE);
  });

  it("trusts the decoration flag over the table", () => {
    expect(tileCategory(30, true)).toBe(TileCategory.DECORATION);
  });

  it("falls back to misc for the taunt sign, mushrooms and unknown ids", () => {
    expect(tileCategory(52, false)).toBe(TileCategory.MISC);
    expect(tileCategory(7, false)).toBe(TileCategory.MISC);
    expect(tileCategory(9999, false)).toBe(TileCategory.MISC);
  });
});

describe("tileLabel", () => {
  it("names nothing narrower than a small tower", () => {
    expect(tileLabel("Wall", 4, 20)).toEqual({ name: "", level: "4" });
    expect(tileLabel("Sniper Tower", 6, 70)).toEqual({ name: "Sniper", level: "6" });
  });

  it("drops the generic suffix before cutting letters", () => {
    expect(tileLabel("Twig Snapper Harvester", 3, 70).name).toBe("Twig Snap…");
    expect(tileLabel("Laser Tower", 1, 70).name).toBe("Laser");
  });

  it("keeps a whole name that fits and hides level zero", () => {
    expect(tileLabel("Town Hall", 0, 130)).toEqual({ name: "Town Hall", level: "" });
  });
});
