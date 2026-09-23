import { describe, expect, test } from "bun:test";
import { ClientSafeError } from "../../middleware/clientSafeError.js";
import type { BuildingDataMap } from "../../types/BuildingData.js";
import type { LayoutNode } from "../../schemas/YardPlannerSchemas.js";
import { checkPlans } from "./validateLayout.js";

/**
 * `checkPlans` (`docs/design/planner-upgrades.md` §2.2).
 *
 * The yard here is built by hand rather than read from the sandbox capture,
 * because every case is one building with one plan on it and the capture's 575
 * buildings would only get in the way. Types used: 20 is the Cannon Tower
 * (ten levels), 17 the Block (five), 14 the Town Hall (ten), 121 a totem the
 * generated table gives a six-step ladder even though it is a decoration, and
 * 122 a build-menu placeholder.
 */

/** A node with a plan on it; `order` is required once the schema has parsed. */
const node = (id: number, t: number, level: number, order = 0): LayoutNode => ({
  id,
  t,
  x: 0,
  y: 0,
  plan: { level, order },
});

/** A yard holding the ids above, at whatever level each test needs. */
const yardOf = (entries: readonly (readonly [id: number, t: number, l?: number])[]) => {
  const buildings: BuildingDataMap = {};
  for (const [id, t, l] of entries) {
    buildings[String(id)] = { x: 0, y: 0, t, id, ...(l === undefined ? {} : { l }) };
  }
  return buildings;
};

/** The error a call threw, typed, so a test can read its status and data. */
const thrownBy = (run: () => void): ClientSafeError => {
  try {
    run();
  } catch (error) {
    if (error instanceof ClientSafeError) return error;
    throw error;
  }
  throw new Error("expected checkPlans to throw");
};

describe("plans the ladder allows", () => {
  const yard = yardOf([
    [1, 20],
    [2, 17],
    [3, 14, 10],
  ]);

  test("accepts a target inside the type's ladder", () => {
    expect(() => checkPlans([node(1, 20, 10), node(2, 17, 5)], yard)).not.toThrow();
  });

  test("ignores a node with no plan at all", () => {
    expect(() => checkPlans([{ id: 1, t: 20, x: 0, y: 0 }], yard)).not.toThrow();
  });

  test("accepts an empty layout and a yard it cannot read", () => {
    expect(() => checkPlans([], yard)).not.toThrow();
    expect(() => checkPlans([node(1, 20, 5)], null)).not.toThrow();
  });
});

describe("plans past the ladder", () => {
  const yard = yardOf([[1, 20]]);

  test("refuses a target above the type's maximum level", () => {
    const error = thrownBy(() => checkPlans([node(1, 20, 11)], yard));
    expect(error.status).toBe(400);
    expect(error.data).toEqual({ planLevel: [1] });
  });

  test("refuses a target above a wall's five levels", () => {
    const error = thrownBy(() => checkPlans([node(4, 17, 6)], yardOf([[4, 17]])));
    expect(error.data).toEqual({ planLevel: [4] });
  });

  test("names every offending node, up to the listing limit", () => {
    const nodes = [1, 2, 3, 4, 5, 6, 7].map((id) => node(id, 20, 99));
    const error = thrownBy(() => checkPlans(nodes, yardOf(nodes.map((one) => [one.id, 20]))));
    expect(error.data).toEqual({ planLevel: [1, 2, 3, 4, 5] });
    expect(error.message).toContain("and 2 more");
  });
});

describe("plans on types with no upgrade ladder", () => {
  test("refuses a decoration, even one the generated table gives steps", () => {
    const error = thrownBy(() => checkPlans([node(1, 121, 3)], yardOf([[1, 121]])));
    expect(error.status).toBe(400);
    expect(error.data).toEqual({ planLevel: [1] });
  });

  test("refuses a build-menu placeholder", () => {
    const error = thrownBy(() => checkPlans([node(1, 122, 2)], yardOf([[1, 122]])));
    expect(error.data).toEqual({ planLevel: [1] });
  });

  test("refuses a type the cost table has no row for", () => {
    const error = thrownBy(() => checkPlans([node(1, 9999, 2)], yardOf([[1, 9999]])));
    expect(error.data).toEqual({ planLevel: [1] });
  });
});

describe("plans the yard has caught up on", () => {
  const yard = yardOf([
    [1, 20, 5],
    [2, 20],
    [3, 20, 3],
  ]);

  test("apply lets them through, because the walk reports them instead", () => {
    expect(() => checkPlans([node(1, 20, 5)], yard)).not.toThrow();
    expect(() => checkPlans([node(1, 20, 4)], yard)).not.toThrow();
  });

  test("save refuses a target at the building's own level", () => {
    const error = thrownBy(() => checkPlans([node(1, 20, 5)], yard, { refuseCaughtUp: true }));
    expect(error.status).toBe(400);
    expect(error.data).toEqual({ planCaughtUp: [1] });
  });

  test("save refuses a target below the building's own level", () => {
    const error = thrownBy(() => checkPlans([node(1, 20, 3)], yard, { refuseCaughtUp: true }));
    expect(error.data).toEqual({ planCaughtUp: [1] });
  });

  test("measures against the save, not the node's advisory level", () => {
    // The node says the building was level 1 when the layout was drawn; the
    // save says 5, and the save is what counts.
    const stale: LayoutNode = { ...node(1, 20, 4), l: 1 };
    expect(thrownBy(() => checkPlans([stale], yard, { refuseCaughtUp: true })).data).toEqual({
      planCaughtUp: [1],
    });
  });

  test("a building with no stored level is at level 1", () => {
    expect(() => checkPlans([node(2, 20, 2)], yard, { refuseCaughtUp: true })).not.toThrow();
    expect(
      thrownBy(() => checkPlans([node(2, 20, 2)], yardOf([[2, 20, 4]]), { refuseCaughtUp: true }))
        .data
    ).toEqual({ planCaughtUp: [2] });
  });

  test("a building still counting its initial build down is at level 0", () => {
    const building: BuildingDataMap = { "2": { x: 0, y: 0, t: 20, id: 2, l: 4, cB: 600 } };
    expect(() => checkPlans([node(2, 20, 2)], building, { refuseCaughtUp: true })).not.toThrow();
  });

  test("leaves a node the save does not hold to checkNodesOwned", () => {
    // A missing building reads as level 0, the same as one still being built,
    // so nothing here is caught up. Ownership is not this function's rule:
    // `checkNodesOwned` has already refused the request by the time it runs.
    expect(() => checkPlans([node(77, 20, 2)], yard, { refuseCaughtUp: true })).not.toThrow();
  });

  test("the ladder fault wins when a layout has both", () => {
    const error = thrownBy(() =>
      checkPlans([node(3, 20, 2), node(1, 20, 99)], yard, { refuseCaughtUp: true })
    );
    expect(error.data).toEqual({ planLevel: [1] });
  });
});
