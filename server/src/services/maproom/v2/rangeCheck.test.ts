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
 *
 * Since issue #190 it measures hex steps on the wrapping world, as Flash drew
 * the range (`MapRoomPopup.as:975-1016`), and counts Declare War's two cells
 * only while the powerup runs.
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
    declareWar: false,
    ...overrides,
  });

describe("main yard range", () => {
  test("a camp r steps away is in range and one r + 1 away is refused", () => {
    // Level 1 flinger reaches 4 cells. Straight down a column is one step a row.
    expect(range({ cell: { x: 400, y: 404 } })).toEqual({ ok: true, via: "main" });
    expect(range({ cell: { x: 400, y: 405 } })).toEqual({ ok: false, reason: "no-outposts" });
    // Level 4 reaches 10.
    expect(range({ flinger: 4, cell: { x: 410, y: 400 } })).toEqual({ ok: true, via: "main" });
    expect(range({ flinger: 4, cell: { x: 411, y: 400 } })).toEqual({
      ok: false,
      reason: "no-outposts",
    });
  });

  test("the reachable area is a hex ring, not a box", () => {
    // Three across and three down: the old square rule called this 3 away.
    expect(getDistanceFromMain(403, 403, 400, 400)).toBe(5);
    expect(range({ cell: { x: 403, y: 403 } })).toEqual({ ok: false, reason: "no-outposts" });
    // Four across and two up is still four steps: a box corner the ring keeps.
    expect(getDistanceFromMain(404, 398, 400, 400)).toBe(4);
    expect(range({ cell: { x: 404, y: 398 } })).toEqual({ ok: true, via: "main" });
  });

  test("Declare War's two cells count only while it is running", () => {
    const edge = { x: 400, y: 406 };
    expect(range({ cell: edge })).toEqual({ ok: false, reason: "no-outposts" });
    expect(range({ cell: edge, declareWar: true })).toEqual({ ok: true, via: "main" });
    expect(range({ cell: { x: 400, y: 407 }, declareWar: true })).toEqual({
      ok: false,
      reason: "no-outposts",
    });
  });

  test("distance wraps around the toroidal grid", () => {
    // (799, 400) is one cell west of (0, 400), not 799 cells east.
    expect(getDistanceFromMain(799, 400, 0, 400)).toBe(1);
    expect(getDistanceFromMain(400, 799, 400, 0)).toBe(1);

    expect(range({ homebase: ["0", "400"], cell: { x: 799, y: 400 } })).toEqual({
      ok: true,
      via: "main",
    });
  });

  test("a flinger-less yard reaches nothing, not even its own cell's neighbour", () => {
    expect(withDeclareWar(getMainYardRange(0), true)).toBe(0);

    expect(range({ flinger: 0, cell: { x: 401, y: 400 }, declareWar: true })).toEqual({
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
    expect(
      range({
        cell: { x: 422, y: 400 },
        outposts: [outpost(420, 400, "op-near")],
        // Level 2 outpost: 2 cells.
        outpostFlingers: new Map([["op-near", 2]]),
      })
    ).toEqual({ ok: true, via: "outpost" });
  });

  test("an outpost r steps from the target reaches it and r + 1 does not", () => {
    const at = (y: number) =>
      range({
        cell: { x: 420, y: 400 },
        outposts: [outpost(420, y, "op")],
        outpostFlingers: new Map([["op", 3]]),
      });
    expect(at(403)).toEqual({ ok: true, via: "outpost" });
    expect(at(404)).toEqual({ ok: false, reason: "out-of-range" });
  });

  test("an outpost's Declare War cells count only while it runs", () => {
    const check = (declareWar: boolean) =>
      range({
        cell: { x: 420, y: 400 },
        outposts: [outpost(420, 403, "op")],
        outpostFlingers: new Map([["op", 1]]),
        declareWar,
      });
    expect(check(false)).toEqual({ ok: false, reason: "out-of-range" });
    expect(check(true)).toEqual({ ok: true, via: "outpost" });
  });

  test("each outpost is measured from its own cell with its own flinger", () => {
    // The strong outpost is far away; the near one is weak. Neither reaches,
    // though the old rule tested the strong one's reach against the near
    // one's offset and let the attack through.
    expect(
      range({
        cell: { x: 420, y: 400 },
        outposts: [outpost(420, 402, "op-weak"), outpost(426, 400, "op-strong")],
        outpostFlingers: new Map([
          ["op-weak", 1],
          ["op-strong", 4],
        ]),
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

    expect(nearby).toEqual([{ baseid: "op-wrapped", x: 798, y: 799, dx: -3, dy: -2 }]);
    // Four steps across the seam: a level 4 outpost reaches, a level 3 does not.
    expect(checkOutpostRange(nearby, new Map([["op-wrapped", 4]]), false)).toEqual({
      ok: true,
      via: "outpost",
    });
    expect(checkOutpostRange(nearby, new Map([["op-wrapped", 3]]), false)).toEqual({
      ok: false,
      reason: "out-of-range",
    });
  });

  test("the sweep box holds every cell the longest outpost ring reaches", () => {
    // Level 4 plus Declare War reaches 6 steps; every such cell is inside the box.
    const target = { x: 400, y: 400 };
    for (let x = 390; x <= 410; x++) {
      for (let y = 390; y <= 410; y++) {
        if (getDistanceFromMain(x, y, target.x, target.y) > 6) continue;
        expect(outpostsNearCell(target, [outpost(x, y, "op")])).toHaveLength(1);
      }
    }
  });

  test("an outpost with no save row cannot vouch for the attack", () => {
    const nearby = outpostsNearCell({ x: 400, y: 400 }, [outpost(401, 400, "op-gone")]);

    expect(checkOutpostRange(nearby, new Map(), true)).toEqual({
      ok: false,
      reason: "out-of-range",
    });
  });
});

describe("planning", () => {
  test("the main yard settles the answer without touching the database", () => {
    expect(
      planRangeCheck({
        homebase: HOME,
        flinger: 4,
        cell: { x: 405, y: 405 },
        outposts: [],
        declareWar: false,
      })
    ).toEqual({ ok: true, via: "main" });
  });

  test("nearby outposts are handed back for their flinger levels to be looked up", () => {
    const plan = planRangeCheck({
      homebase: HOME,
      flinger: 1,
      cell: { x: 420, y: 400 },
      outposts: [[421, 400, "op-near"]],
      declareWar: false,
    });

    expect(plan).toEqual({ pending: [{ baseid: "op-near", x: 421, y: 400, dx: 1, dy: 0 }] });
  });
});
