import { describe, expect, it } from "vitest";
import {
  BLUEPRINT_WORLD,
  blueprintDragToYard,
  blueprintToWorld,
  blueprintToYard,
  centredRect,
  iconBox,
  MAX_ICON_SCALE,
  MIN_ICON_WIDTH,
  rectContains,
  rectCorners,
  stackBoxes,
  tileCategory,
  tileLabel,
  tileRect,
  TileCategory,
  tileShowsIcon,
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

describe("tileShowsIcon", () => {
  it("leaves walls and traps as flat colour", () => {
    expect(tileShowsIcon(TileCategory.WALL, 20, 20)).toBe(false);
    expect(tileShowsIcon(TileCategory.TRAP, 20, 20)).toBe(false);
    // Even given a tile with room, because a wall run reads better unbroken.
    expect(tileShowsIcon(TileCategory.WALL, 200, 200)).toBe(false);
  });

  it("draws on anything else that is wide enough", () => {
    expect(tileShowsIcon(TileCategory.DEFENSIVE, 70, 70)).toBe(true);
    expect(tileShowsIcon(TileCategory.BUILDING, 130, 130)).toBe(true);
    expect(tileShowsIcon(TileCategory.RESOURCE, 190, 160)).toBe(true);
    expect(tileShowsIcon(TileCategory.DECORATION, MIN_ICON_WIDTH, MIN_ICON_WIDTH)).toBe(true);
  });

  it("skips a tile too small to show a picture on either axis", () => {
    expect(tileShowsIcon(TileCategory.MISC, MIN_ICON_WIDTH - 1, 100)).toBe(false);
    expect(tileShowsIcon(TileCategory.MISC, 100, MIN_ICON_WIDTH - 1)).toBe(false);
  });
});

describe("iconBox", () => {
  it("fits by whichever side runs out first and centres the rest", () => {
    // A wide picture on a square tile: width binds, so it is padded off the
    // left and right edges and floats in the middle vertically.
    const wide = iconBox(100, 100, 200, 100);
    expect(wide).not.toBeNull();
    expect(wide?.width).toBeCloseTo(94);
    expect(wide?.height).toBeCloseTo(47);
    expect(wide?.x).toBeCloseTo(3);
    expect((wide?.y ?? 0) + (wide?.height ?? 0) / 2).toBeCloseTo(50);

    // A tall picture on the same tile: height binds instead.
    const tall = iconBox(100, 100, 100, 200);
    expect(tall?.height).toBeCloseTo(94);
    expect(tall?.width).toBeCloseTo(47);
    expect(tall?.y).toBeCloseTo(3);
    expect((tall?.x ?? 0) + (tall?.width ?? 0) / 2).toBeCloseTo(50);
  });

  it("never lets the picture reach the tile's edge", () => {
    for (const [tileWidth, tileHeight] of [
      [40, 40],
      [70, 70],
      [130, 130],
      [190, 160],
    ] as const) {
      const box = iconBox(tileWidth, tileHeight, 260, 180);
      expect(box).not.toBeNull();
      expect(box?.x).toBeGreaterThan(0);
      expect(box?.y).toBeGreaterThan(0);
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThan(tileWidth);
      expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThan(tileHeight);
    }
  });

  it("keeps the picture's aspect ratio", () => {
    const box = iconBox(190, 160, 260, 180);
    expect((box?.width ?? 0) / (box?.height ?? 1)).toBeCloseTo(260 / 180);
  });

  it("does not magnify a picture smaller than its tile", () => {
    const box = iconBox(130, 130, 32, 24);
    expect(box).toEqual({ x: (130 - 32) / 2, y: (130 - 24) / 2, width: 32, height: 24 });
    expect(MAX_ICON_SCALE).toBe(1);
  });

  it("gives up the padding rather than the picture on a tiny tile", () => {
    const box = iconBox(4, 4, 100, 100);
    expect(box).not.toBeNull();
    expect(box?.width).toBeGreaterThan(0);
    expect(box?.height).toBeGreaterThan(0);
  });

  it("has nothing to draw for art with no size, which is art still loading", () => {
    expect(iconBox(100, 100, 0, 100)).toBeNull();
    expect(iconBox(100, 100, 100, 0)).toBeNull();
    expect(iconBox(0, 0, 100, 100)).toBeNull();
  });
});

describe("stackBoxes", () => {
  /** The Railgun's own numbers: base `top.3.png` and gun `anim.3.loaded.png`. */
  const RAILGUN = [
    { x: -39, y: 7, width: 76, height: 51 },
    { x: -49, y: -9, width: 96, height: 56 },
  ];

  it("fits a lone picture exactly where iconBox would put it", () => {
    const piece = { x: -30, y: -40, width: 200, height: 100 };
    const boxes = stackBoxes(100, 100, [piece]);
    expect(boxes).toEqual([iconBox(100, 100, 200, 100)]);
  });

  it("keeps a tower's gun over its base rather than fitting each alone", () => {
    const boxes = stackBoxes(70, 70, RAILGUN);
    expect(boxes).not.toBeNull();
    const [base, gun] = boxes ?? [];
    // The union is 96 wide and 67 tall, so the gun's top-left is 10 units left
    // of and 16 above the base's, scaled by the one factor both share.
    const scale = (base?.width ?? 0) / RAILGUN[0]!.width;
    expect((gun?.x ?? 0) - (base?.x ?? 0)).toBeCloseTo(-10 * scale);
    expect((gun?.y ?? 0) - (base?.y ?? 0)).toBeCloseTo(-16 * scale);
    // Fitting them separately would centre and blow up each one, which is
    // what the tile must not do: the base alone fills the tile's full width.
    const alone = iconBox(70, 70, 76, 51);
    expect(alone?.width).toBeCloseTo(64);
    expect(base?.width).toBeLessThan(alone?.width ?? 0);
  });

  it("keeps the whole stack inside the tile", () => {
    const boxes = stackBoxes(70, 70, RAILGUN) ?? [];
    for (const box of boxes) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(70);
      expect(box.y + box.height).toBeLessThanOrEqual(70);
    }
  });

  it("scales every layer by the same factor, so nothing skews", () => {
    const boxes = stackBoxes(70, 70, RAILGUN) ?? [];
    const scales = boxes.map((box, index) => box.width / RAILGUN[index]!.width);
    expect(scales[1]).toBeCloseTo(scales[0] ?? 0);
    for (const [index, box] of boxes.entries()) {
      expect(box.height / RAILGUN[index]!.height).toBeCloseTo(scales[0] ?? 0);
    }
  });

  it("centres the union, not any one layer", () => {
    const boxes = stackBoxes(70, 70, RAILGUN) ?? [];
    const left = Math.min(...boxes.map((box) => box.x));
    const right = Math.max(...boxes.map((box) => box.x + box.width));
    expect((left + right) / 2).toBeCloseTo(35);
  });

  it("has nothing to draw without pieces, or with one still loading", () => {
    expect(stackBoxes(70, 70, [])).toBeNull();
    expect(stackBoxes(70, 70, [{ x: 0, y: 0, width: 0, height: 10 }])).toBeNull();
    expect(stackBoxes(0, 0, RAILGUN)).toBeNull();
  });
});
