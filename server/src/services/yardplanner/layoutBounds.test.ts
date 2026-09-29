import { describe, expect, test } from "bun:test";
import { ClientSafeError } from "../../middleware/clientSafeError.js";
import type { LayoutNode } from "../../schemas/YardPlannerSchemas.js";
import type { BuildingDataMap } from "../../types/BuildingData.js";
import { checkNodePlacement } from "./validateLayout.js";

/**
 * Decorations are held to the plot like every other building (owner decision
 * 2026-09-29, #128), except one left exactly where the save has it: the Flash
 * planner's 3240 x 2600 decoration area put some outside the plot, and
 * nothing moves them on its own. Expansion 0 is a 1000 x 800 plot, x in
 * [-500, 500), y in [-400, 400). Type 28 is the American Flag, 17 the Block.
 */

const FLAG = 28;
const BLOCK = 17;

const node = (id: number, t: number, x: number, y: number): LayoutNode => ({ id, t, x, y });

const saved = {
  "1": { id: 1, t: FLAG, X: 900, Y: 0 },
  "2": { id: 2, t: BLOCK, X: 900, Y: 100 },
  "3": { id: 3, t: FLAG, X: 0, Y: 0 },
} as unknown as BuildingDataMap;

const refusal = (run: () => void): ClientSafeError => {
  try {
    run();
  } catch (error) {
    return error as ClientSafeError;
  }
  throw new Error("expected a refusal");
};

describe("checkNodePlacement: decorations and the plot", () => {
  test("a decoration outside the plot may stay at its saved spot", () => {
    expect(() => checkNodePlacement([node(1, FLAG, 900, 0)], 0, [], saved)).not.toThrow();
  });

  test("moving it, even further out or to another outside spot, is refused", () => {
    const error = refusal(() => checkNodePlacement([node(1, FLAG, 920, 0)], 0, [], saved));
    expect(error.data).toMatchObject({ outOfBounds: [1] });
  });

  test("moving it inside the plot is fine", () => {
    expect(() => checkNodePlacement([node(1, FLAG, 100, 0)], 0, [], saved)).not.toThrow();
  });

  test("a decoration inside the plot may not be moved out of it", () => {
    const error = refusal(() => checkNodePlacement([node(3, FLAG, 1200, 0)], 0, [], saved));
    expect(error.data).toMatchObject({ outOfBounds: [3] });
  });

  test("the exception is for decorations only", () => {
    const error = refusal(() => checkNodePlacement([node(2, BLOCK, 900, 100)], 0, [], saved));
    expect(error.data).toMatchObject({ outOfBounds: [2] });
  });

  test("without the save's buildings nothing is excused", () => {
    const error = refusal(() => checkNodePlacement([node(1, FLAG, 900, 0)], 0));
    expect(error.data).toMatchObject({ outOfBounds: [1] });
  });
});
