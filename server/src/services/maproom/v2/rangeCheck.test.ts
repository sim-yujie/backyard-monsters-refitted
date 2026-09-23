import { describe, expect, test } from "bun:test";
import {
  cellCoordsFromBaseId,
  checkOutpostRange,
  checkRange,
  getDistanceFromMain,
  getMainYardRange,
  getOutpostRange,
  outpostsNearCell,
  planRangeCheck,
  withDeclareWar,
  type OutpostEntry,
  type RangeCheckInput,
} from "./rangeCheck.js";

/**
 * The range rule is pure, so issue #26's whole decision is testable without a
 * database or a request: coordinates and flinger levels in, a verdict out.
 */

const HOME: [string, string] = ["400", "400"];

const noOutposts = new Map<string, number>();

const range = (overrides: Partial<RangeCheckInput> = {}) =>
  checkRange({
    homebase: HOME,
    flinger: 1,
    cell: { x: 402, y: 400 },
    outposts: [],
    outpostFlingers: noOutposts,
    ...overrides,
  });

describe("main yard range", () => {
  test("a cell inside the flinger's reach is in range", () => {
    // Level 1 flinger reaches 4 cells, plus the 2 the server always adds.
    expect(range({ cell: { x: 406, y: 400 } })).toEqual({ ok: true, via: "main" });
  });

  test("a cell one past the flinger's reach is refused", () => {
    expect(range({ cell: { x: 407, y: 400 } })).toEqual({
      ok: false,
      reason: "no-outposts",
    });
  });

  test("distance wraps around the toroidal grid", () => {
    // (799, 400) is one cell west of (0, 400), not 799 cells east.
    expect(getDistanceFromMain(799, 400, 0, 400)).toBe(1);

    expect(range({ homebase: ["0", "400"], cell: { x: 799, y: 400 } })).toEqual({
      ok: true,
      via: "main",
    });
  });

  test("a flinger-less yard reaches nothing, not even its own cell's neighbour", () => {
    expect(withDeclareWar(getMainYardRange(0))).toBe(0);

    expect(range({ flinger: 0, cell: { x: 401, y: 400 } })).toEqual({
      ok: false,
      reason: "no-outposts",
    });
  });

  test("the range table matches the flinger levels the client uses", () => {
    expect([0, 1, 2, 3, 4, 9].map(getMainYardRange)).toEqual([0, 4, 6, 8, 10, 10]);
    expect([0, 1, 2, 3, 4, 9].map(getOutpostRange)).toEqual([0, 1, 2, 3, 4, 4]);
  });
});

describe("missing coordinates", () => {
  test("no cell at all is refused before anything else is considered", () => {
    expect(range({ cell: null })).toEqual({ ok: false, reason: "no-attack-cell" });
    expect(range({ cell: undefined })).toEqual({ ok: false, reason: "no-attack-cell" });
  });

  test("a half-built cell is refused rather than compared against NaN", () => {
    expect(range({ cell: { x: 402 } })).toEqual({ ok: false, reason: "no-attack-cell" });
    expect(range({ cell: { x: NaN, y: 400 } })).toEqual({
      ok: false,
      reason: "no-attack-cell",
    });
  });

  test("an attacker with no homebase is refused", () => {
    expect(range({ homebase: null })).toEqual({ ok: false, reason: "no-homebase" });
  });

  test("a base id that carries no cell yields no coordinates", () => {
    expect(cellCoordsFromBaseId("1402400")).toEqual({ x: 402, y: 400 });
    expect(cellCoordsFromBaseId("tribe")).toBeNull();
    expect(cellCoordsFromBaseId("")).toBeNull();
  });
});

describe("outpost range", () => {
  const outpost = (x: number, y: number, id = `op-${x}-${y}`): OutpostEntry => [x, y, id];

  test("an outpost in reach of the target puts it in range", () => {
    const outposts = [outpost(420, 400, "op-near")];

    expect(
      range({
        cell: { x: 422, y: 400 },
        outposts,
        // Level 1 outpost: 1 cell, plus the 2 the server always adds.
        outpostFlingers: new Map([["op-near", 1]]),
      })
    ).toEqual({ ok: true, via: "outpost" });
  });

  test("an outpost that is near but cannot reach is refused", () => {
    const outposts = [outpost(426, 400, "op-weak")];

    expect(
      range({
        cell: { x: 420, y: 400 },
        outposts,
        outpostFlingers: new Map([["op-weak", 1]]),
      })
    ).toEqual({ ok: false, reason: "out-of-range" });
  });

  test("owning no outposts is a different refusal from owning distant ones", () => {
    expect(range({ cell: { x: 500, y: 500 }, outposts: [] })).toEqual({
      ok: false,
      reason: "no-outposts",
    });

    expect(range({ cell: { x: 500, y: 500 }, outposts: [outpost(100, 100)] })).toEqual({
      ok: false,
      reason: "no-outposts-near-cell",
    });
  });

  test("the sweep keys on both coordinates, not their concatenation", () => {
    // (1, 23) and (12, 3) both flatten to "123" under plain concatenation.
    const nearby = outpostsNearCell({ x: 1, y: 23 }, [outpost(12, 3, "op-decoy")]);

    expect(nearby).toEqual([]);
  });

  test("the sweep wraps around the grid edge", () => {
    const nearby = outpostsNearCell({ x: 1, y: 1 }, [outpost(798, 799, "op-wrapped")]);

    expect(nearby).toEqual([{ baseid: "op-wrapped", dx: -3, dy: -2 }]);
  });

  test("an outpost with no save row cannot vouch for the attack", () => {
    const nearby = outpostsNearCell({ x: 400, y: 400 }, [outpost(401, 400, "op-gone")]);

    expect(checkOutpostRange(nearby, new Map())).toEqual({
      ok: false,
      reason: "out-of-range",
    });
  });
});

describe("planning", () => {
  test("the main yard settles the answer without touching the database", () => {
    expect(
      planRangeCheck({ homebase: HOME, flinger: 4, cell: { x: 405, y: 405 }, outposts: [] })
    ).toEqual({ ok: true, via: "main" });
  });

  test("nearby outposts are handed back for their flinger levels to be looked up", () => {
    const plan = planRangeCheck({
      homebase: HOME,
      flinger: 1,
      cell: { x: 420, y: 400 },
      outposts: [[421, 400, "op-near"]],
    });

    expect(plan).toEqual({ pending: [{ baseid: "op-near", dx: 1, dy: 0 }] });
  });
});
