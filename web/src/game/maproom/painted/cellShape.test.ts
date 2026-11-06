import { describe, expect, it } from "vitest";
import { HexGrid, mapRoomGrid } from "@/game/HexGrid";
import { cellCentre, flatTopShape, locateCell, pointyTopShape, textureAspect, type CellShape } from "./cellShape";

/** A plain pointy-top (odd-r) reference, independent of `cellShape.ts`'s sums. */
const pointyNeighbours = (col: number, row: number): string[] => {
  const odd = row & 1;
  const steps = odd
    ? [[1, 0], [1, -1], [0, -1], [-1, 0], [0, 1], [1, 1]]
    : [[1, 0], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1]];
  return steps.map(([dc, dr]) => `${col + dc!},${row + dr!}`).sort();
};

const flatNeighbours = (col: number, row: number): string[] =>
  HexGrid.neighbours(col, row).map((cell) => `${cell.col},${cell.row}`).sort();

/** Points spread through a cell, from its centre to just inside its corners. */
const spread = (shape: CellShape, col: number, row: number): { x: number; y: number }[] => {
  const centre = cellCentre(shape, col, row);
  const points = [];
  for (let ring = 0; ring <= 0.9; ring += 0.3) {
    for (let angle = 0; angle < 360; angle += 30) {
      const radians = (angle * Math.PI) / 180;
      points.push({
        x: centre.x + Math.cos(radians) * ring * shape.unitX * 0.86,
        y: centre.y + Math.sin(radians) * ring * shape.unitY * 0.86,
      });
    }
  }
  return points;
};

describe("painted ground cell shape", () => {
  it("flat-top matches today's HexGrid: centres, picking and the cell across a side", () => {
    const shape = flatTopShape();
    for (const [col, row] of [[0, 0], [1, 0], [5, 7], [6, 7], [399, 400], [800, 3]] as const) {
      expect(cellCentre(shape, col, row)).toEqual(mapRoomGrid.cellToPixel(col, row));
      for (const point of spread(shape, col, row)) {
        const hit = locateCell(shape, point.x, point.y);
        expect({ col: hit.col, row: hit.row }).toEqual(mapRoomGrid.pixelToCell(point.x, point.y));
        expect({ col: hit.col, row: hit.row }).toEqual({ col, row });
        expect(flatNeighbours(col, row)).toContain(`${hit.across.col},${hit.across.row}`);
      }
    }
  });

  it("pointy-top: odd rows shift half a cell right, and every point picks its own cell", () => {
    const shape = pointyTopShape(150, 150);
    expect(cellCentre(shape, 0, 0)).toEqual({ x: 0, y: 0 });
    expect(cellCentre(shape, 0, 1)).toEqual({ x: 75, y: 112.5 });
    expect(cellCentre(shape, 3, 2)).toEqual({ x: 450, y: 225 });
    for (const [col, row] of [[0, 0], [0, 1], [4, 6], [7, 9], [400, 401]] as const) {
      for (const point of spread(shape, col, row)) {
        const hit = locateCell(shape, point.x, point.y);
        expect({ col: hit.col, row: hit.row }).toEqual({ col, row });
        expect(pointyNeighbours(col, row)).toContain(`${hit.across.col},${hit.across.row}`);
      }
    }
  });

  it("inset is 1 at a cell's centre and 0 on its sides", () => {
    for (const shape of [flatTopShape(), pointyTopShape()]) {
      const centre = cellCentre(shape, 4, 4);
      expect(locateCell(shape, centre.x, centre.y).inset).toBeCloseTo(1, 6);
      const right = cellCentre(shape, 5, 4);
      const neighbourCentre = shape.kind === "pointy" ? right : cellCentre(shape, 4, 5);
      const mid = { x: (centre.x + neighbourCentre.x) / 2, y: (centre.y + neighbourCentre.y) / 2 };
      expect(locateCell(shape, mid.x, mid.y).inset).toBeLessThan(1e-6);
    }
  });

  it("squashes textures like the cells: today's 150 x 75 cells, the painted 150 x 150 ones", () => {
    expect(textureAspect(flatTopShape())).toBeCloseTo(75 / Math.sqrt(3) / 75, 6);
    expect(textureAspect(pointyTopShape(150, 150))).toBeCloseTo(75 / (150 / Math.sqrt(3)), 6);
  });
});
