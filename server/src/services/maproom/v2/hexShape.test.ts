import { describe, expect, mock, test } from "bun:test";

import { MapRoom2 } from "../../../enums/MapRoom.js";
import { Tribes } from "../../../enums/Tribes.js";
import { hexDistance, hexNeighbours, type HexShape } from "../../../game-rules/maproom/range.js";
import { isVisible } from "../../../game-rules/maproom/sight.js";

mock.module("../../../server.js", () => ({ postgres: { em: { find: async () => [] } }, redis: {} }));

const { mr2HexShape } = await import("../../../config/MapRoom2Config.js");
const { mr2NeighbourCoords } = await import("./neighbourDefence.js");
const { isAdjacentToMainYard } = await import("./takeoverCost.js");
const { OUTPOST_SWEEP, checkOutpostRange, getDistanceFromMain, outpostsNearCell } = await import("./rangeCheck.js");

/**
 * Map Room 2's hex shape switch (`MR2_HEX_SHAPE`, MR2 look plan step 1): every
 * server rule that asks "which cells touch" or "how far" answers for the
 * shape the switch names, and flat (the default) answers exactly as before.
 */

const key = (cells: Array<{ x: number; y: number }>) => cells.map(({ x, y }) => `${x},${y}`).sort();
const wrap = (value: number, size: number) => ((value % size) + size) % size;

/** A spread of cells: both parities, the corners and the seams. */
const SAMPLES: Array<[number, number]> = [
  [0, 0],
  [1, 0],
  [0, 1],
  [1, 1],
  [400, 400],
  [401, 400],
  [400, 401],
  [401, 401],
  [799, 799],
  [799, 0],
  [0, 799],
  [123, 456],
  [654, 321],
];

/** Odd-r pointy-top neighbour offsets from the offset-coordinate literature. */
const POINTY_EVEN_ROW = [
  [1, 0],
  [0, -1],
  [-1, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
];
const POINTY_ODD_ROW = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [0, 1],
  [1, 1],
];

describe("MR2_HEX_SHAPE", () => {
  test("is flat unless pointy", () => {
    expect(mr2HexShape({})).toBe("flat");
    expect(mr2HexShape({ MR2_HEX_SHAPE: "flat" })).toBe("flat");
    expect(mr2HexShape({ MR2_HEX_SHAPE: "on" })).toBe("flat");
    expect(mr2HexShape({ MR2_HEX_SHAPE: "pointy" })).toBe("pointy");
    expect(mr2HexShape({ MR2_HEX_SHAPE: " POINTY " })).toBe("pointy");
  });
});

describe("neighbours", () => {
  test("pointy-top matches the odd-r reference table, wrapped", () => {
    for (const [x, y] of SAMPLES) {
      const deltas = y % 2 === 0 ? POINTY_EVEN_ROW : POINTY_ODD_ROW;
      const expected = deltas.map(([dx, dy]) => ({
        x: wrap(x + dx!, MapRoom2.WIDTH),
        y: wrap(y + dy!, MapRoom2.HEIGHT),
      }));
      expect(key(mr2NeighbourCoords(x, y, "pointy"))).toEqual(key(expected));
    }
  });

  test("flat-top is unchanged: the shared rule and the server's own list agree", () => {
    for (const [x, y] of SAMPLES) {
      expect(key(mr2NeighbourCoords(x, y, "flat"))).toEqual(key(hexNeighbours(x, y, "flat")));
    }
  });

  for (const shape of ["flat", "pointy"] as HexShape[]) {
    test(`${shape}: neighbours are symmetric and exactly one step away`, () => {
      for (const [x, y] of SAMPLES) {
        const around = mr2NeighbourCoords(x, y, shape);
        expect(new Set(key(around)).size).toBe(6);
        for (const n of around) {
          expect(hexDistance({ x, y }, n, shape)).toBe(1);
          expect(key(mr2NeighbourCoords(n.x, n.y, shape))).toContain(`${x},${y}`);
        }
      }
    });

    test(`${shape}: a camp has at most one same-tribe neighbour`, () => {
      for (const [x, y] of SAMPLES) {
        const tribe = (x + y) % Tribes.length;
        const same = mr2NeighbourCoords(x, y, shape).filter((n) => (n.x + n.y) % Tribes.length === tribe);
        expect(same.length).toBeLessThanOrEqual(1);
      }
    });
  }

  test("pointy-top: the same-tribe neighbour is (x-1, y+1) on even rows, (x+1, y-1) on odd rows", () => {
    const tribeOf = (c: { x: number; y: number }) => (c.x + c.y) % Tribes.length;
    expect(mr2NeighbourCoords(400, 400, "pointy").filter((n) => tribeOf(n) === 0)).toEqual([{ x: 399, y: 401 }]);
    expect(mr2NeighbourCoords(401, 401, "pointy").filter((n) => tribeOf(n) === 2)).toEqual([{ x: 402, y: 400 }]);
  });

  test("the switch picks the shape when none is given", () => {
    const before = process.env.MR2_HEX_SHAPE;
    process.env.MR2_HEX_SHAPE = "pointy";
    expect(key(mr2NeighbourCoords(10, 10))).toEqual(key(mr2NeighbourCoords(10, 10, "pointy")));
    delete process.env.MR2_HEX_SHAPE;
    expect(key(mr2NeighbourCoords(10, 10))).toEqual(key(mr2NeighbourCoords(10, 10, "flat")));
    if (before !== undefined) process.env.MR2_HEX_SHAPE = before;
  });
});

describe("takeover adjacency", () => {
  test("pointy-top: exactly the six neighbours, wrapping at the edge", () => {
    for (const [x, y] of SAMPLES) {
      const around = new Set(key(mr2NeighbourCoords(x, y, "pointy")));
      for (let dx = -2; dx <= 2; dx++) {
        for (let dy = -2; dy <= 2; dy++) {
          const cx = wrap(x + dx, MapRoom2.WIDTH);
          const cy = wrap(y + dy, MapRoom2.HEIGHT);
          expect(isAdjacentToMainYard(x, y, cx, cy, "pointy")).toBe(around.has(`${cx},${cy}`));
        }
      }
    }
  });

  test("flat-top: the same six as the neighbour count inside the world (Flash's test does not wrap)", () => {
    for (const [x, y] of [
      [400, 400],
      [401, 400],
      [123, 456],
    ] as const) {
      const around = new Set(key(mr2NeighbourCoords(x, y, "flat")));
      for (let dx = -2; dx <= 2; dx++) {
        for (let dy = -2; dy <= 2; dy++) {
          expect(isAdjacentToMainYard(x, y, x + dx, y + dy, "flat")).toBe(around.has(`${x + dx},${y + dy}`));
        }
      }
    }
  });
});

describe("range", () => {
  for (const shape of ["flat", "pointy"] as HexShape[]) {
    test(`${shape}: the outpost sweep box holds every cell within reach`, () => {
      const centre = { x: 401, y: 401 };
      for (let dx = -OUTPOST_SWEEP - 3; dx <= OUTPOST_SWEEP + 3; dx++) {
        for (let dy = -OUTPOST_SWEEP - 3; dy <= OUTPOST_SWEEP + 3; dy++) {
          const steps = hexDistance(centre, { x: centre.x + dx, y: centre.y + dy }, shape);
          if (steps <= OUTPOST_SWEEP) {
            expect(Math.abs(dx)).toBeLessThanOrEqual(OUTPOST_SWEEP);
            expect(Math.abs(dy)).toBeLessThanOrEqual(OUTPOST_SWEEP);
          }
        }
      }
    });

    test(`${shape}: a range ring of r holds 3r(r+1)+1 cells`, () => {
      for (const reach of [1, 2, 4, 6, 10]) {
        let count = 0;
        for (let dx = -reach; dx <= reach; dx++) {
          for (let dy = -reach; dy <= reach; dy++) {
            if (hexDistance({ x: 0, y: 0 }, { x: dx, y: dy }, shape) <= reach) count++;
          }
        }
        expect(count).toBe(3 * reach * (reach + 1) + 1);
      }
    });
  }

  test("the same pair of cells can be a different distance apart on each shape", () => {
    // Along a row: three steps on pointy-top, three on flat-top (a zig-zag).
    expect(getDistanceFromMain(403, 400, 400, 400, "pointy")).toBe(3);
    expect(getDistanceFromMain(403, 400, 400, 400, "flat")).toBe(3);
    // Straight down a column: six steps on both.
    expect(getDistanceFromMain(400, 406, 400, 400, "pointy")).toBe(6);
    expect(getDistanceFromMain(400, 406, 400, 400, "flat")).toBe(6);
    // Two cells right and one row down: 2 on flat-top, 3 on pointy-top.
    expect(getDistanceFromMain(402, 401, 400, 400, "flat")).toBe(2);
    expect(getDistanceFromMain(402, 401, 400, 400, "pointy")).toBe(3);
    // One cell right and two rows down: 2 on pointy-top, 3 on flat-top.
    expect(getDistanceFromMain(401, 402, 400, 400, "pointy")).toBe(2);
    expect(getDistanceFromMain(401, 402, 400, 400, "flat")).toBe(3);
  });

  test("an outpost's reach measures on the switch's shape", () => {
    const nearby = outpostsNearCell({ x: 404, y: 402 }, [[400, 400, "op"]]);
    const flingers = new Map([["op", 4]]);
    for (const shape of ["flat", "pointy"] as HexShape[]) {
      const steps = hexDistance({ x: 400, y: 400 }, { x: 404, y: 402 }, shape);
      const verdict = checkOutpostRange(nearby, flingers, shape);
      expect("ok" in verdict && verdict.ok).toBe(steps <= 4);
    }
  });

  test("sight measures on the shape it is given", () => {
    const source = { x: 400, y: 400, reach: 2 };
    for (const shape of ["flat", "pointy"] as HexShape[]) {
      for (const [x, y] of SAMPLES) {
        expect(isVisible({ x, y }, [source], [], shape)).toBe(hexDistance(source, { x, y }, shape) <= 2);
      }
    }
  });
});
