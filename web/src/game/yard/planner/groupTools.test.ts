import { describe, expect, it } from "vitest";
import { footprintOf } from "../YardGrid";
import { GroupOp, GROUP_OPS, groupExtent, groupTargets, type Footprint } from "./groupTools";
import { GRID_STEP, type Position } from "./placement";

/**
 * F7's geometry, checked against numbers worked out by hand.
 *
 * Everything here is arithmetic on footprints: no plan, no grid, no validation.
 * What is being asserted is that the transforms are the ones §3, F7 describes —
 * a mirror is a reflection about the selection's own centre, an align puts one
 * edge of every footprint on one line, and a distribution equalises the gaps
 * between the outermost two — and that each of them lands back on the 5-unit
 * grid the occupancy bitmap is addressed by.
 *
 * Sizes come from the real table (`footprintOf`) wherever a test is about a
 * particular building, so a change to a footprint shows up here rather than in
 * a browser.
 */

/** A 70-unit tower (type 20), the yard's most common square footprint. */
const TOWER = 70;
/** A 20-unit wall (type 17). */
const WALL = 20;
/** The Inferno Portal, the only non-square footprint in the game. */
const [PORTAL_WIDTH, PORTAL_HEIGHT] = footprintOf(127);

const node = (id: number, x: number, y: number, width: number, height = width): Footprint => ({
  id,
  x,
  y,
  width,
  height,
});

/** The targets as a plain object, which reads better in an assertion. */
const asObject = (targets: ReadonlyMap<number, Position>): Record<number, Position> =>
  Object.fromEntries(targets);

/** The whole selection after an operation, moved buildings and still ones. */
const applied = (op: GroupOp, nodes: readonly Footprint[]): Footprint[] => {
  const targets = groupTargets(op, nodes);
  return nodes.map((item) => {
    const to = targets.get(item.id);
    return to ? { ...item, x: to.x, y: to.y } : item;
  });
};

const onGrid = (nodes: readonly Footprint[]): boolean =>
  nodes.every((item) => item.x % GRID_STEP === 0 && item.y % GRID_STEP === 0);

describe("the footprint table this all rests on", () => {
  it("has the portal at 190 by 160, so mirroring is not size-symmetric", () => {
    expect([PORTAL_WIDTH, PORTAL_HEIGHT]).toEqual([190, 160]);
    expect(footprintOf(20)).toEqual([TOWER, TOWER]);
    expect(footprintOf(17)).toEqual([WALL, WALL]);
  });
});

describe("mirroring", () => {
  /**
   * The derivation §3, F7 gives: a footprint covers `[x, x + width)`, so
   * reflecting it about `cx` puts its origin at `2cx - x - width`, not at
   * `2cx - x`. With `2cx = minX + maxX` the whole thing stays in integers.
   */
  it("reflects the origin about the selection's centre, width included", () => {
    const towers = [node(1, 0, 0, TOWER), node(2, 100, 0, TOWER), node(3, 200, 0, TOWER)];
    // minX 0, maxX 270, so 2cx is 270.
    expect(asObject(groupTargets(GroupOp.MIRROR_X, towers))).toEqual({
      1: { x: 270 - 0 - TOWER, y: 0 },
      3: { x: 270 - 200 - TOWER, y: 0 },
    });
  });

  it("leaves a building the reflection does not move out of the answer", () => {
    const towers = [node(1, 0, 0, TOWER), node(2, 100, 0, TOWER), node(3, 200, 0, TOWER)];
    // The middle tower is its own mirror image: 270 - 100 - 70 is 100.
    expect(groupTargets(GroupOp.MIRROR_X, towers).has(2)).toBe(false);
  });

  it("keeps the bounding box exactly where it was, whatever the sizes", () => {
    const mixed = [node(1, 0, 0, WALL), node(2, 100, 0, TOWER)];
    const before = groupExtent(mixed);
    const after = groupExtent(applied(GroupOp.MIRROR_X, mixed));
    expect(after).toEqual(before);
    expect(asObject(groupTargets(GroupOp.MIRROR_X, mixed))).toEqual({
      1: { x: 150, y: 0 },
      2: { x: 0, y: 0 },
    });
  });

  it("is its own inverse", () => {
    const towers = [node(1, 0, 0, TOWER), node(2, 35, 100, WALL), node(3, 200, 60, TOWER)];
    expect(applied(GroupOp.MIRROR_X, applied(GroupOp.MIRROR_X, towers))).toEqual(towers);
    expect(applied(GroupOp.MIRROR_Y, applied(GroupOp.MIRROR_Y, towers))).toEqual(towers);
  });

  it("uses the portal's own width across and its own height down", () => {
    const withPortal = [node(1, 0, 0, PORTAL_WIDTH, PORTAL_HEIGHT), node(2, 300, 0, WALL)];

    // Across: minX 0, maxX 320. The portal's 190 comes off its own origin.
    expect(asObject(groupTargets(GroupOp.MIRROR_X, withPortal))).toEqual({
      1: { x: 320 - 0 - PORTAL_WIDTH, y: 0 },
      2: { x: 320 - 300 - WALL, y: 0 },
    });

    // Down: the portal is the tallest thing here, so minY 0, maxY 160, and it
    // reflects onto itself while the wall does not.
    expect(asObject(groupTargets(GroupOp.MIRROR_Y, withPortal))).toEqual({
      2: { x: 300, y: 160 - 0 - WALL },
    });
  });

  it("does nothing to a selection that is already symmetric about its axis", () => {
    const column = [node(1, 0, 0, WALL), node(2, 0, 100, WALL)];
    expect(groupTargets(GroupOp.MIRROR_X, column).size).toBe(0);
  });

  it("changes only one axis each", () => {
    const towers = [node(1, 0, 0, TOWER), node(2, 200, 300, TOWER)];
    for (const [id, to] of groupTargets(GroupOp.MIRROR_X, towers)) {
      expect(to.y).toBe(towers.find((item) => item.id === id)?.y);
    }
    for (const [id, to] of groupTargets(GroupOp.MIRROR_Y, towers)) {
      expect(to.x).toBe(towers.find((item) => item.id === id)?.x);
    }
  });
});

describe("aligning", () => {
  const spread = [node(1, 0, 0, TOWER), node(2, 35, 200, TOWER), node(3, 100, 400, TOWER)];

  it("puts every left edge on the leftmost one", () => {
    expect(asObject(groupTargets(GroupOp.ALIGN_LEFT, spread))).toEqual({
      2: { x: 0, y: 200 },
      3: { x: 0, y: 400 },
    });
  });

  it("puts every right edge on the rightmost one", () => {
    // maxX is 100 + 70; a 70-wide tower's origin is therefore 100.
    expect(asObject(groupTargets(GroupOp.ALIGN_RIGHT, spread))).toEqual({
      1: { x: 100, y: 0 },
      2: { x: 100, y: 200 },
    });
  });

  it("aligns right by the far edge, so a mixed selection does not line up on x", () => {
    const mixed = [node(1, 0, 0, TOWER), node(2, 0, 200, WALL)];
    // maxX is 70. The wall's origin has to be 50 for its right edge to reach it.
    expect(asObject(groupTargets(GroupOp.ALIGN_RIGHT, mixed))).toEqual({
      2: { x: 50, y: 200 },
    });
  });

  it("puts every top and bottom edge on the extreme one", () => {
    const down = [node(1, 0, 0, TOWER), node(2, 200, 35, TOWER), node(3, 400, 100, TOWER)];
    expect(asObject(groupTargets(GroupOp.ALIGN_TOP, down))).toEqual({
      2: { x: 200, y: 0 },
      3: { x: 400, y: 0 },
    });
    expect(asObject(groupTargets(GroupOp.ALIGN_BOTTOM, down))).toEqual({
      1: { x: 0, y: 100 },
      2: { x: 200, y: 100 },
    });
  });

  it("centres a mixed selection on the bounding box's middle, not on one origin", () => {
    const mixed = [node(1, 0, 0, TOWER), node(2, 0, 200, WALL)];
    // The box runs 0 to 70, so its middle is 35 and a 20-wide wall starts at 25.
    expect(asObject(groupTargets(GroupOp.ALIGN_CENTRE_X, mixed))).toEqual({
      2: { x: 25, y: 200 },
    });
  });

  it("centres the portal down by its own 160, not by its width", () => {
    const withPortal = [node(1, 0, 0, PORTAL_WIDTH, PORTAL_HEIGHT), node(2, 400, 0, TOWER)];
    // The box runs 0 to 160 down; a 70-tall tower centred in it starts at 45.
    expect(asObject(groupTargets(GroupOp.ALIGN_CENTRE_Y, withPortal))).toEqual({
      2: { x: 400, y: 45 },
    });
  });

  it("does nothing when the edges are already on the line", () => {
    const column = [node(1, 0, 0, TOWER), node(2, 0, 200, TOWER)];
    expect(groupTargets(GroupOp.ALIGN_LEFT, column).size).toBe(0);
  });

  it("stays on the grid when a centre lands on a half unit", () => {
    // A 2-unit-wide oddity: nothing in the table is this small, but a
    // decoration takes its size from the props table rather than the footprint
    // table and is not guaranteed to be a multiple of five.
    const odd = [node(1, 0, 0, 72), node(2, 0, 200, 2)];
    // (0 + 72 - 2) / 2 is 35, which is already on the grid; widen it by one.
    const odder = [node(1, 0, 0, 73), node(2, 0, 200, 2)];
    expect(onGrid(applied(GroupOp.ALIGN_CENTRE_X, odd))).toBe(true);
    expect(onGrid(applied(GroupOp.ALIGN_CENTRE_X, odder))).toBe(true);
  });
});

describe("distributing", () => {
  it("equalises the gaps and leaves the outermost two where they are", () => {
    const row = [node(1, 0, 0, TOWER), node(2, 80, 0, TOWER), node(3, 500, 0, TOWER)];
    // Span 570, footprints 210, so 360 of space over two gaps: 180 each.
    expect(asObject(groupTargets(GroupOp.DISTRIBUTE_X, row))).toEqual({
      2: { x: 250, y: 0 },
    });
  });

  it("measures the gaps between footprints, not between origins", () => {
    const mixed = [node(1, 0, 0, WALL), node(2, 50, 0, TOWER), node(3, 200, 0, WALL)];
    // Span 220, footprints 110, so 110 over two gaps: 55 each, and the tower
    // starts one wall plus one gap in.
    expect(asObject(groupTargets(GroupOp.DISTRIBUTE_X, mixed))).toEqual({
      2: { x: 75, y: 0 },
    });
  });

  it("snaps each result but accumulates the ideal position, so nothing drifts", () => {
    const row = [
      node(1, 0, 0, WALL),
      node(2, 20, 0, WALL),
      node(3, 40, 0, WALL),
      node(4, 95, 0, WALL),
    ];
    // Span 115, footprints 80, so 35 over three gaps: 11.666… each. The ideal
    // origins are 31.67 and 63.33, which snap to 30 and 65. Carrying the
    // snapped value forward instead would have put the second at 60.
    expect(asObject(groupTargets(GroupOp.DISTRIBUTE_X, row))).toEqual({
      2: { x: 30, y: 0 },
      3: { x: 65, y: 0 },
    });
  });

  it("works down the yard as well as across it", () => {
    const column = [node(1, 0, 0, TOWER), node(2, 0, 80, TOWER), node(3, 0, 500, TOWER)];
    expect(asObject(groupTargets(GroupOp.DISTRIBUTE_Y, column))).toEqual({
      2: { x: 0, y: 250 },
    });
  });

  it("orders by position rather than by the order the selection came in", () => {
    const shuffled = [node(3, 500, 0, TOWER), node(1, 0, 0, TOWER), node(2, 80, 0, TOWER)];
    expect(asObject(groupTargets(GroupOp.DISTRIBUTE_X, shuffled))).toEqual({
      2: { x: 250, y: 0 },
    });
  });

  it("breaks a tie by id, so two presses give the same answer", () => {
    const tied = [node(9, 0, 0, WALL), node(4, 0, 0, WALL), node(1, 200, 0, WALL)];
    const once = groupTargets(GroupOp.DISTRIBUTE_X, tied);
    const twice = groupTargets(GroupOp.DISTRIBUTE_X, tied);
    expect(asObject(once)).toEqual(asObject(twice));
    // 4 sorts before 9, so 9 is the middle one and the one that moves.
    expect([...once.keys()]).toEqual([9]);
  });

  it("keeps the portal's own height out of the gaps down the column", () => {
    const column = [
      node(1, 0, 0, WALL),
      node(2, 0, 100, PORTAL_WIDTH, PORTAL_HEIGHT),
      node(3, 0, 600, WALL),
    ];
    // Span 620, footprints 20 + 160 + 20, so 420 over two gaps: 210 each.
    expect(asObject(groupTargets(GroupOp.DISTRIBUTE_Y, column))).toEqual({
      2: { x: 0, y: 230 },
    });
  });
});

describe("what each operation needs before it will do anything", () => {
  it("refuses a selection smaller than its minimum", () => {
    const one = [node(1, 0, 0, TOWER)];
    const two = [node(1, 0, 0, TOWER), node(2, 200, 0, TOWER)];

    for (const op of Object.values(GroupOp)) {
      expect(groupTargets(op, [])).toEqual(new Map());
      expect(groupTargets(op, one)).toEqual(new Map());
    }
    // Distribution is the only one that needs three: two of anything are
    // already the outermost two and there is nothing between them.
    expect(groupTargets(GroupOp.DISTRIBUTE_X, two).size).toBe(0);
    expect(groupTargets(GroupOp.DISTRIBUTE_Y, two).size).toBe(0);
    expect(groupTargets(GroupOp.ALIGN_LEFT, two).size).toBe(1);
  });

  it("says so in the table the toolbar reads", () => {
    expect(GROUP_OPS[GroupOp.MIRROR_X].minimum).toBe(2);
    expect(GROUP_OPS[GroupOp.ALIGN_LEFT].minimum).toBe(2);
    expect(GROUP_OPS[GroupOp.DISTRIBUTE_X].minimum).toBe(3);
    for (const op of Object.values(GroupOp)) {
      expect(GROUP_OPS[op].menu.length).toBeGreaterThan(0);
      expect(GROUP_OPS[op].label.length).toBeGreaterThan(0);
    }
  });
});

describe("the bounding box", () => {
  it("runs from the first origin to the last far edge", () => {
    expect(
      groupExtent([node(1, -100, 40, TOWER), node(2, 200, -30, PORTAL_WIDTH, PORTAL_HEIGHT)]),
    ).toEqual({ minX: -100, maxX: 390, minY: -30, maxY: 130 });
  });

  it("is all zero for nothing, rather than infinite", () => {
    expect(groupExtent([])).toEqual({ minX: 0, maxX: 0, minY: 0, maxY: 0 });
  });
});

describe("staying inside the box", () => {
  /**
   * Worth pinning down because it is why these operations can only ever be
   * refused for an overlap: none of them can push a building out of the plot
   * that was not already leaning out of it.
   */
  it("never widens the selection's extent", () => {
    const nodes = [
      node(1, -200, -150, TOWER),
      node(2, 0, 0, WALL),
      node(3, 130, 40, PORTAL_WIDTH, PORTAL_HEIGHT),
      node(4, 400, 300, TOWER),
    ];
    const before = groupExtent(nodes);

    for (const op of Object.values(GroupOp)) {
      const after = groupExtent(applied(op, nodes));
      expect(after.minX).toBeGreaterThanOrEqual(before.minX - GRID_STEP);
      expect(after.maxX).toBeLessThanOrEqual(before.maxX + GRID_STEP);
      expect(after.minY).toBeGreaterThanOrEqual(before.minY - GRID_STEP);
      expect(after.maxY).toBeLessThanOrEqual(before.maxY + GRID_STEP);
      expect(onGrid(applied(op, nodes))).toBe(true);
    }
  });
});
