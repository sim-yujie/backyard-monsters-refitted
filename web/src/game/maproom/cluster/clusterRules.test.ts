import { describe, expect, it } from "vitest";
import {
  CLUSTER_ZOOM,
  LONE_CREST_ZOOM,
  NEAR_ZOOM,
  cellKey,
  countText,
  groupCells,
  sameStep,
  stepFor,
  type ClusterCell,
  type ClusterGroup,
} from "./clusterRules";

/** Map pin clustering (owner's option C, 25 Nov 2026): what merges into what on the world grid. */

const cell = (col: number, row: number, group: ClusterGroup, aid = 0): ClusterCell => ({
  key: cellKey(col, row),
  wx: col * 100,
  wy: row * 100,
  group,
  aid,
});

const step = { plaqueCells: 8, plaqueMin: 2, crests: true };

describe("stepFor", () => {
  it("is off at and above the cluster zoom, so play zoom 0.6 is unchanged", () => {
    expect(stepFor(CLUSTER_ZOOM, 50, false, true)).toBeNull();
    expect(stepFor(0.6, 60, false, true)).toBeNull();
    expect(stepFor(0.49, 49, false, true)).not.toBeNull();
  });

  it("gives own and hostile cells crests only below the lone-crest zoom", () => {
    expect(stepFor(LONE_CREST_ZOOM - 0.01, 30, false, true)!.crests).toBe(true);
    expect(stepFor(LONE_CREST_ZOOM, 30, false, true)!.crests).toBe(false);
  });

  it("merges two cells when far, only crowds of three close in, and every cell on the raster", () => {
    expect(stepFor(0.26, 30, false, true)!.plaqueMin).toBe(2);
    expect(stepFor(NEAR_ZOOM, 30, false, true)!.plaqueMin).toBe(3);
    expect(stepFor(0.14, 15, false, false)!.plaqueMin).toBe(1);
  });

  it("uses power-of-two squares that grow as the cells shrink", () => {
    const big = stepFor(0.26, 30, false, true)!.plaqueCells;
    const small = stepFor(0.14, 15, false, true)!.plaqueCells;
    expect(Math.log2(big) % 1).toBe(0);
    expect(small).toBe(big * 2);
    // Zooming within a band keeps the same squares, so plaques do not change while zooming a little.
    expect(sameStep(stepFor(0.26, 30, false, true), stepFor(0.25, 29, false, true))).toBe(true);
  });
});

describe("groupCells", () => {
  it("never merges own, hostile or the main yard: one crest each", () => {
    const cells = [cell(1, 1, "home"), cell(2, 1, "you"), cell(3, 1, "you"), cell(2, 2, "hostile"), cell(3, 2, "hostile")];
    const { tokens, hidden } = groupCells(cells, step);
    expect(tokens).toHaveLength(5);
    expect(tokens.every((t) => t.kind === "crest" && t.cells.length === 1)).toBe(true);
    expect(tokens.map((t) => t.group).sort()).toEqual(["home", "hostile", "hostile", "you", "you"]);
    expect(hidden).toHaveLength(5);
  });

  it("keeps the main yard's crest even when own outposts show their markers", () => {
    const cells = [cell(1, 1, "home"), cell(2, 1, "you"), cell(2, 2, "hostile")];
    const { tokens, hidden } = groupCells(cells, { ...step, crests: false });
    expect(tokens.map((t) => t.group)).toEqual(["home"]);
    expect(hidden).toEqual([cellKey(1, 1)]);
  });

  it("merges alliance and neutral cells per square, never with each other", () => {
    const cells = [
      cell(0, 0, "alliance", 7),
      cell(1, 0, "alliance", 7),
      cell(2, 3, "alliance", 7),
      cell(4, 4, "other"),
      cell(5, 5, "other"),
      cell(9, 0, "alliance", 7), // the next square
      cell(10, 1, "alliance", 7),
    ];
    const { tokens } = groupCells(cells, step);
    const plaques = tokens.filter((t) => t.kind === "plaque");
    expect(plaques.map((t) => `${t.group}${t.cells.length}`).sort()).toEqual(["alliance2", "alliance3", "other2"]);
    expect(plaques.find((t) => t.group === "alliance" && t.cells.length === 3)!.aid).toBe(7);
  });

  it("leaves a lone cell (fewer than the minimum) as its own marker", () => {
    const { tokens, hidden } = groupCells([cell(0, 0, "alliance"), cell(20, 20, "other"), cell(21, 20, "other")], step);
    expect(tokens.map((t) => t.cells.length)).toEqual([2]);
    expect(hidden).not.toContain(cellKey(0, 0));
    expect(hidden).toContain(cellKey(20, 20));
    // Three needed close in: two stay as markers.
    expect(groupCells([cell(20, 20, "other"), cell(21, 20, "other")], { ...step, plaqueMin: 3 }).tokens).toHaveLength(0);
  });

  it("counts every cell once and puts the plaque in their middle with their box", () => {
    const cells = [cell(0, 0, "alliance"), cell(2, 0, "alliance"), cell(1, 3, "alliance")];
    const [plaque] = groupCells(cells, step).tokens;
    expect(plaque!.cells).toHaveLength(3);
    expect(plaque!.wx).toBeCloseTo(100);
    expect(plaque!.wy).toBeCloseTo(100);
    expect([plaque!.minX, plaque!.minY, plaque!.maxX, plaque!.maxY]).toEqual([0, 0, 200, 300]);
  });

  it("lists the cells under plaques (their borders may go too), not the crests'", () => {
    const cells = [cell(0, 0, "alliance"), cell(1, 0, "alliance"), cell(5, 5, "you"), cell(6, 6, "home")];
    const { underPlaques, hidden } = groupCells(cells, step);
    expect(underPlaques.sort()).toEqual([cellKey(0, 0), cellKey(1, 0)].sort());
    expect(hidden).toHaveLength(4);
  });

  it("leaves friends out entirely (they keep their own markers)", () => {
    const cells = [{ ...cell(0, 0, "other"), group: "friend" as unknown as ClusterGroup }];
    expect(groupCells(cells, step).tokens).toHaveLength(0);
  });
});

describe("countText", () => {
  it("writes thousands short", () => {
    expect(countText(7)).toBe("7");
    expect(countText(999)).toBe("999");
    expect(countText(1420)).toBe("1k");
    expect(countText(14021)).toBe("14k");
  });
});
