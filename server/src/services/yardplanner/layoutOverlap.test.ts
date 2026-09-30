import { describe, expect, test } from "bun:test";
import { ClientSafeError } from "../../middleware/clientSafeError.js";
import type { LayoutNode } from "../../schemas/YardPlannerSchemas.js";
import { checkNodePlacement } from "./validateLayout.js";

/**
 * Save and Apply refuse a layout with a building inside the Town Hall, even
 * when the hall is building 0 (#212).
 *
 * The owner's hall has id 0, and the web planner's grid read "blocked by 0"
 * as "free", so it let an Aerial Defense Tower be dropped onto it. This is the
 * server half: `checkNodePlacement` compares rectangles and must not have the
 * same hole. Expansion 0, the hall (type 14, 130 x 130) in the middle at
 * (-65, -65), the tower (type 115, 70 x 70).
 */

const HALL = 14;
const ADT = 115;

const node = (id: number, t: number, x: number, y: number): LayoutNode => ({ id, t, x, y });

const refusal = (run: () => void): ClientSafeError => {
  try {
    run();
  } catch (error) {
    if (error instanceof ClientSafeError) return error;
    throw error;
  }
  throw new Error("expected a refusal");
};

/** The tower one grid step into the hall from each side, and flush against it. */
const SIDES = [
  { side: "left", into: [-130, -35], flush: [-135, -35] },
  { side: "right", into: [60, -35], flush: [65, -35] },
  { side: "top", into: [-35, -130], flush: [-35, -135] },
  { side: "bottom", into: [-35, 60], flush: [-35, 65] },
] as const;

describe("checkNodePlacement: building 0", () => {
  for (const { side, into, flush } of SIDES) {
    test(`refuses an ADT pushed into the centred hall from the ${side}`, () => {
      const nodes = [node(0, HALL, -65, -65), node(1, ADT, into[0], into[1])];
      const { overlapping } = refusal(() => checkNodePlacement(nodes, 0)).data as {
        overlapping: number[];
      };
      expect([...overlapping].sort()).toEqual([0, 1]);
    });

    test(`accepts one flush against it on the ${side}`, () => {
      const nodes = [node(0, HALL, -65, -65), node(1, ADT, flush[0], flush[1])];
      expect(() => checkNodePlacement(nodes, 0)).not.toThrow();
    });
  }

  test("refuses it whichever order the layout lists them in", () => {
    const nodes = [node(1, ADT, -35, -35), node(0, HALL, -65, -65)];
    const { overlapping } = refusal(() => checkNodePlacement(nodes, 0)).data as {
      overlapping: number[];
    };
    expect([...overlapping].sort()).toEqual([0, 1]);
  });
});
