import { describe, expect, it } from "vitest";
import { mapRoomGrid } from "@/game/HexGrid";
import { cellLift, groundLift, paintOrder, pickCell } from "./ground";

describe("groundLift (Flash's MapRoomCell.Update)", () => {
  it("raises land 0.6 px a metre above 100, truncated like Flash's int()", () => {
    expect(groundLift(100)).toBe(0);
    expect(groundLift(101)).toBe(0);
    expect(groundLift(105)).toBe(-3);
    expect(groundLift(150)).toBe(-30);
    expect(groundLift(208)).toBe(-64);
  });

  it("sinks water 1 px a metre below 100", () => {
    expect(groundLift(99)).toBe(1);
    expect(groundLift(80)).toBe(20);
    expect(groundLift(18)).toBe(82);
  });

  it("leaves fog and unloaded cells flat", () => {
    expect(cellLift(undefined)).toBe(0);
  });
});

describe("paintOrder (Flash's depth = y * 1000 + x)", () => {
  it("paints rows top to bottom, and a column's half-row step between them", () => {
    expect(paintOrder(5, 3)).toBeLessThan(paintOrder(5, 4));
    // Odd columns sit half a row lower here, so they paint after their even neighbours.
    expect(paintOrder(4, 3)).toBeLessThan(paintOrder(5, 3));
    expect(paintOrder(5, 3)).toBeLessThan(paintOrder(4, 4));
    expect(paintOrder(4, 3)).toBeLessThan(paintOrder(6, 3));
  });
});

describe("pickCell", () => {
  const flat = () => 0;

  it("is the plain grid on flat ground", () => {
    for (const [col, row] of [[10, 10], [11, 10], [3, 7]] as const) {
      const centre = mapRoomGrid.cellToPixel(col, row);
      expect(pickCell(centre.x, centre.y, flat)).toEqual({ col, row });
    }
  });

  it("finds a hill's top face where it is drawn, over the cell behind it", () => {
    // Cell (10, 11) stands 60 px up, so its face covers most of (10, 10)'s place.
    const lift = (col: number, row: number) => (col === 10 && row === 11 ? -60 : 0);
    const raised = mapRoomGrid.cellToPixel(10, 11);
    expect(pickCell(raised.x, raised.y - 60, lift)).toEqual({ col: 10, row: 11 });
    // The lower half of its place is now its cliff, on no face: still that cell.
    expect(pickCell(raised.x, raised.y + 20, lift)).toEqual({ col: 10, row: 11 });
    // The cell behind's own place, now under the hill's face, picks the hill.
    const behind = mapRoomGrid.cellToPixel(10, 10);
    expect(pickCell(behind.x, behind.y + 10, lift)).toEqual({ col: 10, row: 11 });
  });

  it("finds sunken water below its place", () => {
    const lift = () => 50;
    const sunk = mapRoomGrid.cellToPixel(4, 4);
    expect(pickCell(sunk.x, sunk.y + 50, lift)).toEqual({ col: 4, row: 4 });
  });

  it("gives the front face where two raised faces overlap", () => {
    const lift = () => -30;
    const centre = mapRoomGrid.cellToPixel(7, 7);
    expect(pickCell(centre.x, centre.y - 30, lift)).toEqual({ col: 7, row: 7 });
  });
});
