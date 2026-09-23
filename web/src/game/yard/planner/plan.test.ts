import { describe, expect, it } from "vitest";
import type { BaseLoadResponse, Layout } from "@/api/types";
import fixture from "../../../../test/fixtures/baseload-sandbox-yard.json";
import { readYard } from "../yardModel";
import { LAYOUT_VERSION } from "@/api/types";
import { layoutDate, MissReason, payloadFor, planLoad } from "./layout";
import { MUSHROOM_ID_BASE, Plan } from "./plan";
import { moveCommand } from "./commands";

const yard = readYard(fixture as unknown as BaseLoadResponse);

const freshPlan = (): Plan => Plan.fromYard(yard);

/** The six cannon towers, which the browser check also drives. */
const cannonIds = (plan: Plan): number[] =>
  plan
    .buildings()
    .filter((node) => node.type === 20)
    .map((node) => node.id);

/**
 * A shift this selection can legally take.
 *
 * The captured yard is a full 575-building base, so no fixed offset is free in
 * it; the tests want "somewhere else that works", not one particular spot.
 * Lifting first is what `beginMove` is for, so the search runs against the same
 * grid state a real drag would see.
 */
const freeDelta = (plan: Plan, ids: number[]): { dx: number; dy: number } => {
  plan.beginMove(ids);
  for (let distance = 20; distance <= 600; distance += 20) {
    const candidates: [number, number][] = [
      [0, -distance],
      [0, distance],
      [-distance, 0],
      [distance, 0],
    ];
    for (const [dx, dy] of candidates) {
      if (plan.testMove(dx, dy).valid) {
        plan.cancelMove();
        return { dx, dy };
      }
    }
  }
  plan.cancelMove();
  throw new Error("no free offset for this selection in the captured yard");
};

describe("Plan.fromYard", () => {
  it("takes every building and every mushroom", () => {
    const plan = freshPlan();
    expect(plan.buildings()).toHaveLength(yard.buildings.length);
    expect(plan.size).toBe(yard.buildings.length + yard.mushrooms.length);
  });

  it("keeps the yard's expansion level and the plot it implies", () => {
    const plan = freshPlan();
    expect(plan.expansion).toBe(yard.expansionLevel);
    expect(plan.plot).toEqual({ halfWidth: 890, halfHeight: 710 });
  });

  it("marks mushrooms fixed and gives them ids of their own", () => {
    const plan = freshPlan();
    for (const mushroom of yard.mushrooms) {
      const node = plan.get(MUSHROOM_ID_BASE + mushroom.id);
      expect(node?.fixed).toBe(true);
      expect(node?.width).toBe(30);
    }
  });

  it("starts with nothing moved", () => {
    expect(freshPlan().movedIds()).toEqual([]);
  });

  it("is a copy: editing it does not touch the yard", () => {
    const plan = freshPlan();
    const first = yard.buildings[0]!;
    plan.setPosition(first.id, first.x + 100, first.y);
    expect(yard.buildings[0]!.x).toBe(first.x);
  });

  it("reads the captured yard as internally valid", () => {
    expect(freshPlan().validate().valid).toBe(true);
  });
});

describe("moving a selection", () => {
  it("accepts a move into empty ground and records it", () => {
    const plan = freshPlan();
    const ids = cannonIds(plan);
    const before = ids.map((id) => ({ x: plan.get(id)!.x, y: plan.get(id)!.y }));
    const { dx, dy } = freeDelta(plan, ids);

    plan.beginMove(ids);
    expect(plan.testMove(dx, dy).valid).toBe(true);
    const entries = plan.commitMove(dx, dy);

    expect(entries).toHaveLength(ids.length);
    ids.forEach((id, index) => {
      expect(plan.get(id)!.x).toBe(before[index]!.x + dx);
      expect(plan.get(id)!.y).toBe(before[index]!.y + dy);
    });
  });

  it("refuses a move onto another building", () => {
    const plan = freshPlan();
    const [one, two] = plan.buildings();
    plan.beginMove([one!.id]);
    const dx = two!.x - one!.x;
    const dy = two!.y - one!.y;
    expect(plan.testMove(dx, dy).valid).toBe(false);
    expect(plan.commitMove(dx, dy)).toBeNull();
    expect(plan.get(one!.id)!.x).toBe(one!.x);
  });

  it("refuses a move out of the plot", () => {
    const plan = freshPlan();
    const first = plan.buildings()[0]!;
    plan.beginMove([first.id]);
    expect(plan.testMove(5000, 0).valid).toBe(false);
    expect(plan.commitMove(5000, 0)).toBeNull();
  });

  it("puts the cells back after a refused drop", () => {
    const plan = freshPlan();
    const first = plan.buildings()[0]!;
    plan.beginMove([first.id]);
    plan.commitMove(5000, 0);
    // Anything else moving onto it must now be blocked again.
    const second = plan.buildings()[1]!;
    plan.beginMove([second.id]);
    expect(plan.testMove(first.x - second.x, first.y - second.y).valid).toBe(false);
  });

  it("puts the cells back on cancel", () => {
    const plan = freshPlan();
    const first = plan.buildings()[0]!;
    plan.beginMove([first.id]);
    plan.cancelMove();
    expect(plan.validate().valid).toBe(true);
    expect(plan.hasMoved(first.id)).toBe(false);
  });

  it("returns null for a drop that did not move anything", () => {
    const plan = freshPlan();
    plan.beginMove([plan.buildings()[0]!.id]);
    expect(plan.commitMove(0, 0)).toBeNull();
  });

  it("will not lift a mushroom", () => {
    const plan = freshPlan();
    const mushroom = yard.mushrooms[0];
    if (!mushroom) return;
    expect(plan.beginMove([MUSHROOM_ID_BASE + mushroom.id])).toEqual([]);
  });

  it("leaves the plan valid after a committed move", () => {
    const plan = freshPlan();
    const ids = cannonIds(plan);
    const { dx, dy } = freeDelta(plan, ids);
    plan.beginMove(ids);
    plan.commitMove(dx, dy);
    expect(plan.validate().valid).toBe(true);
  });

  it("tracks which buildings are no longer where they started", () => {
    const plan = freshPlan();
    const ids = cannonIds(plan);
    const { dx, dy } = freeDelta(plan, ids);
    plan.beginMove(ids);
    plan.commitMove(dx, dy);
    expect(plan.movedIds().sort((a, b) => a - b)).toEqual([...ids].sort((a, b) => a - b));
  });
});

describe("undo through the command stack", () => {
  it("puts a group move back exactly", () => {
    const plan = freshPlan();
    const ids = cannonIds(plan);
    const before = ids.map((id) => ({ x: plan.get(id)!.x, y: plan.get(id)!.y }));
    const { dx, dy } = freeDelta(plan, ids);

    plan.beginMove(ids);
    const entries = plan.commitMove(dx, dy)!;
    const command = moveCommand(entries, (batch, reverse) => plan.move(batch, reverse));

    command.revert();
    ids.forEach((id, index) => {
      expect(plan.get(id)!.x).toBe(before[index]!.x);
      expect(plan.get(id)!.y).toBe(before[index]!.y);
    });
    expect(plan.movedIds()).toEqual([]);
    expect(plan.validate().valid).toBe(true);

    command.apply();
    expect(plan.movedIds()).toHaveLength(ids.length);
    expect(plan.validate().valid).toBe(true);
  });

  it("keeps the occupancy grid honest across a whole undo cycle", () => {
    const plan = freshPlan();
    const ids = cannonIds(plan);
    const { dx, dy } = freeDelta(plan, ids);
    plan.beginMove(ids);
    const entries = plan.commitMove(dx, dy)!;

    for (let round = 0; round < 3; round++) {
      plan.move(entries, true);
      plan.move(entries, false);
    }
    plan.move(entries, true);

    // The towers are home and nothing may now move onto one of them.
    const tower = plan.get(ids[0]!)!;
    const other = plan.buildings().find((node) => node.type === 17)!;
    plan.beginMove([other.id]);
    expect(plan.testMove(tower.x - other.x, tower.y - other.y).valid).toBe(false);
  });
});

describe("layout serialisation", () => {
  it("writes every building and no mushroom", () => {
    const payload = payloadFor(freshPlan());
    expect(payload.version).toBe(LAYOUT_VERSION);
    expect(payload.expansion).toBe(yard.expansionLevel);
    expect(payload.nodes).toHaveLength(yard.buildings.length);
    expect(payload.nodes.some((node) => node.t === 7)).toBe(false);
  });

  it("writes the position in the server's lower-case fields", () => {
    const plan = freshPlan();
    const node = plan.buildings()[0]!;
    const written = payloadFor(plan).nodes.find((entry) => entry.id === node.id)!;
    expect(written).toMatchObject({ id: node.id, t: node.type, x: node.x, y: node.y });
  });

  it("omits level 1 and zero fortification, as the save does", () => {
    const plan = freshPlan();
    const nodes = payloadFor(plan).nodes;
    const levelOne = plan.buildings().find((node) => node.level === 1 && node.fort === 0);
    if (!levelOne) return;
    const written = nodes.find((entry) => entry.id === levelOne.id)!;
    expect(written.l).toBeUndefined();
    expect(written.fort).toBeUndefined();
  });

  it("round-trips a moved plan", () => {
    const plan = freshPlan();
    const ids = cannonIds(plan);
    const { dx, dy } = freeDelta(plan, ids);
    plan.beginMove(ids);
    plan.commitMove(dx, dy);
    const payload = payloadFor(plan);

    const restored = freshPlan();
    const result = planLoad(restored, asLayout(payload.nodes, payload.expansion));
    restored.move(result.entries, false);

    expect(result.didNotFit).toEqual([]);
    expect(result.missing).toEqual([]);
    for (const node of plan.buildings()) {
      expect(restored.get(node.id)!.x).toBe(node.x);
      expect(restored.get(node.id)!.y).toBe(node.y);
    }
  });
});

describe("loading a layout that does not fit", () => {
  it("reports a saved node outside the current plot and leaves it put", () => {
    const plan = freshPlan();
    const node = plan.buildings()[0]!;
    const result = planLoad(plan, asLayout([{ id: node.id, t: node.type, x: 5000, y: 0 }], 6));

    expect(result.entries).toEqual([]);
    expect(result.didNotFit).toEqual([
      { id: node.id, type: node.type, reason: MissReason.BOUNDS },
    ]);
    expect(plan.get(node.id)!.x).toBe(node.x);
  });

  it("reports a saved node landing on a building the layout does not move", () => {
    const plan = freshPlan();
    const [mover, blocker] = plan.buildings();
    const result = planLoad(
      plan,
      asLayout([{ id: mover!.id, t: mover!.type, x: blocker!.x, y: blocker!.y }], 6),
    );
    expect(result.didNotFit[0]).toEqual({
      id: mover!.id,
      type: mover!.type,
      reason: MissReason.BLOCKED,
    });
  });

  it("names saved ids this yard no longer has, with where they stood", () => {
    const plan = freshPlan();
    const result = planLoad(plan, asLayout([{ id: 987_654, t: 24, x: 105, y: -60 }], 6));
    expect(result.missing).toEqual([{ id: 987_654, t: 24, x: 105, y: -60 }]);
    expect(result.didNotFit).toEqual([]);
  });

  it("snaps a missing node's remembered position onto the grid", () => {
    const plan = freshPlan();
    const result = planLoad(plan, asLayout([{ id: 987_654, t: 117, x: 103, y: -58 }], 6));
    expect(result.missing).toEqual([{ id: 987_654, t: 117, x: 105, y: -60 }]);
  });

  it("never auto-places: what did not fit is not moved anywhere", () => {
    const plan = freshPlan();
    const before = plan.buildings().map((node) => ({ id: node.id, x: node.x, y: node.y }));
    const node = before[0]!;
    planLoad(plan, asLayout([{ id: node.id, t: 20, x: 5000, y: 5000 }], 6));
    for (const entry of before) {
      expect(plan.get(entry.id)!.x).toBe(entry.x);
      expect(plan.get(entry.id)!.y).toBe(entry.y);
    }
  });

  it("carries the expansion level the layout was designed for", () => {
    expect(planLoad(freshPlan(), asLayout([], 3)).expansion).toBe(3);
  });

  it("snaps a saved position that is off the grid", () => {
    const plan = freshPlan();
    const node = plan.buildings().find((one) => one.type === 20)!;
    const result = planLoad(plan, asLayout([{ id: node.id, t: node.type, x: 3, y: -498 }], 6));
    if (result.entries.length > 0) {
      expect(result.entries[0]!.toX % 5).toBe(0);
      expect(result.entries[0]!.toY % 5).toBe(0);
    }
  });
});

describe("layoutDate", () => {
  it("reads unix seconds, milliseconds and an ISO string alike", () => {
    const seconds = layoutDate(1_700_000_000);
    expect(layoutDate(1_700_000_000_000)).toBe(seconds);
    expect(layoutDate(new Date(1_700_000_000_000).toISOString())).toBe(seconds);
  });

  it("says so rather than showing an invalid date", () => {
    expect(layoutDate("not a date")).toBe("unknown");
  });
});

describe("validation cost on the 575-building yard", () => {
  it("tests a 400-strong group in well under two milliseconds", () => {
    const plan = freshPlan();
    const walls = plan
      .buildings()
      .filter((node) => node.type === 17 || node.type === 18)
      .slice(0, 400);
    const ids = walls.map((node) => node.id);
    expect(ids.length).toBeGreaterThan(0);

    plan.beginMove(ids);
    for (let i = 0; i < 50; i++) plan.testMove(5, 5); // warm up

    const started = performance.now();
    const rounds = 200;
    for (let i = 0; i < rounds; i++) plan.testMove((i % 20) * 5, 5);
    const perCall = (performance.now() - started) / rounds;

    expect(perCall).toBeLessThan(2);
  });
});

/** Wraps nodes as the server would send them. */
const asLayout = (nodes: Layout["nodes"], expansion: number): Layout => ({
  slot: 0,
  name: "test",
  version: LAYOUT_VERSION,
  expansion,
  updatedAt: 1_700_000_000,
  nodes,
});
