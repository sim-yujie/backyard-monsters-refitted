import { describe, expect, it } from "vitest";
import type { BaseLoadResponse, Layout } from "@/api/types";
import fixture from "../../../../test/fixtures/baseload-sandbox-yard.json";
import { readYard, type Yard } from "../yardModel";
import { LAYOUT_VERSION } from "@/api/types";
import { layoutDate, MissReason, payloadFor, planLoad } from "./layout";
import { Plan } from "./plan";
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
  it("takes every building and no mushroom (#263)", () => {
    const plan = freshPlan();
    expect(plan.buildings()).toHaveLength(yard.buildings.length);
    expect(plan.size).toBe(yard.buildings.length);
  });

  it("keeps the yard's expansion level and the plot it implies", () => {
    const plan = freshPlan();
    expect(plan.expansion).toBe(yard.expansionLevel);
    expect(plan.plot).toEqual({ halfWidth: 890, halfHeight: 710 });
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

  it("a mushroom never blocks a move onto its spot (#263: Apply moves the mushroom)", () => {
    const small = readYard({
      error: 0,
      currenttime: 1,
      savetime: 1,
      buildingdata: { "0": { id: 0, t: 14, X: 0, Y: 0, l: 3 } },
      storedata: {},
      mushrooms: { l: [{ X: 200, Y: 200, frame: 1 }] },
    } as unknown as BaseLoadResponse);
    const plan = Plan.fromYard(small);
    expect(plan.size).toBe(1);

    plan.beginMove([0]);
    expect(plan.testMove(190, 190).valid).toBe(true);
    expect(plan.commitMove(190, 190)).not.toBeNull();
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

/* ── Planned upgrades ─────────────────────────────────────────────────────── */

/** The captured yard with a few building rows patched, as a fresh `Yard`. */
const yardWith = (changes: Record<number, Record<string, unknown>>): Yard => {
  const copy = JSON.parse(JSON.stringify(fixture)) as {
    buildingdata: Record<string, Record<string, unknown>>;
    buildinghealthdata?: Record<string, number>;
  };
  for (const [id, patch] of Object.entries(changes)) Object.assign(copy.buildingdata[id]!, patch);
  return readYard(copy as unknown as BaseLoadResponse);
};

describe("Plan.setPlan", () => {
  it("plans an upgrade and hands back what changed", () => {
    const plan = freshPlan();
    const [tower] = cannonIds(plan);

    expect(plan.setPlan(tower!, 3)).toEqual({
      id: tower,
      before: null,
      after: { level: 3, order: 0 },
    });
    expect(plan.get(tower!)!.plan).toEqual({ level: 3, order: 0 });
  });

  it("refuses anything fixed, and an id the plan does not hold", () => {
    const plan = Plan.fromYard(yardWith({}));
    for (const node of plan.all()) {
      if (node.fixed) expect(plan.setPlan(node.id, 2)).toBeNull();
    }
    expect(plan.setPlan(1_000_099, 2)).toBeNull();
  });

  it("refuses a level the building is already at or past", () => {
    const plan = freshPlan();
    const [tower] = cannonIds(plan);
    expect(plan.setPlan(tower!, 1)).toBeNull();
    expect(plan.setPlan(tower!, 0)).toBeNull();
  });

  it("refuses a level past the top of the ladder", () => {
    const plan = freshPlan();
    const [tower] = cannonIds(plan);
    // Cannon Towers stop at 10; a Booby Trap has one level and no ladder.
    expect(plan.setPlan(tower!, 11)).toBeNull();
    const trap = plan.buildings().find((node) => node.type === 24)!;
    expect(plan.setPlan(trap.id, 2)).toBeNull();
  });

  it("refuses a busy building and a damaged one", () => {
    const plan = freshPlan();
    const [busy, hurt] = cannonIds(plan);
    plan.get(busy!)!.busy = true;
    plan.get(hurt!)!.damaged = true;

    expect(plan.setPlan(busy!, 2)).toBeNull();
    expect(plan.setPlan(hurt!, 2)).toBeNull();
  });

  it("numbers plans in the order they were made", () => {
    const plan = freshPlan();
    const [first, second, third] = cannonIds(plan);
    plan.setPlan(first!, 2);
    plan.setPlan(second!, 2);
    plan.setPlan(third!, 2);

    expect(plan.get(third!)!.plan!.order).toBe(2);
  });

  it("keeps a plan's place in the queue when only its level changes", () => {
    const plan = freshPlan();
    const [first, second] = cannonIds(plan);
    plan.setPlan(first!, 2);
    plan.setPlan(second!, 2);

    expect(plan.setPlan(first!, 5)).toEqual({
      id: first,
      before: { level: 2, order: 0 },
      after: { level: 5, order: 0 },
    });
  });

  it("says nothing changed when the level is the one already planned", () => {
    const plan = freshPlan();
    const [tower] = cannonIds(plan);
    plan.setPlan(tower!, 4);
    expect(plan.setPlan(tower!, 4)).toBeNull();
  });

  it("clears a plan and reports the value it had", () => {
    const plan = freshPlan();
    const [tower] = cannonIds(plan);
    plan.setPlan(tower!, 4);

    expect(plan.setPlan(tower!, null)).toEqual({
      id: tower,
      before: { level: 4, order: 0 },
      after: null,
    });
    expect(plan.get(tower!)!.plan).toBeNull();
    // Nothing to clear is not a change.
    expect(plan.setPlan(tower!, null)).toBeNull();
  });

  it("reuses the order a cleared plan gave up", () => {
    const plan = freshPlan();
    const [first, second] = cannonIds(plan);
    plan.setPlan(first!, 2);
    plan.setPlan(first!, null);
    plan.setPlan(second!, 2);

    expect(plan.get(second!)!.plan!.order).toBe(0);
  });
});

describe("Plan.plannedNodes", () => {
  it("lists plans in the order Apply will walk them, ties broken by id", () => {
    const plan = freshPlan();
    const [a, b, c] = cannonIds(plan);
    plan.setPlan(c!, 2);
    plan.setPlan(a!, 2);
    plan.setPlan(b!, 2);

    expect(plan.plannedNodes().map((node) => node.id)).toEqual([c, a, b]);
    expect(plan.plannedCount).toBe(3);
    expect(plan.plannedLevels()).toEqual(
      new Map([
        [a!, 2],
        [b!, 2],
        [c!, 2],
      ]),
    );
  });

  it("holds nothing at all before anything is planned", () => {
    const plan = freshPlan();
    expect(plan.plannedNodes()).toEqual([]);
    expect(plan.plannedCount).toBe(0);
  });
});

describe("Plan.setPlans", () => {
  it("puts a plan back exactly as undo needs it to", () => {
    const plan = freshPlan();
    const [tower] = cannonIds(plan);
    const first = plan.setPlan(tower!, 3)!;
    const second = plan.setPlan(tower!, 6)!;

    plan.setPlans([second], true);
    expect(plan.get(tower!)!.plan).toEqual({ level: 3, order: 0 });
    plan.setPlans([first], true);
    expect(plan.get(tower!)!.plan).toBeNull();
    plan.setPlans([first, second], false);
    expect(plan.get(tower!)!.plan).toEqual({ level: 6, order: 0 });
  });

  it("skips an id the plan no longer has, as a move does", () => {
    const plan = freshPlan();
    expect(() =>
      plan.setPlans([{ id: 987_654, before: null, after: { level: 2, order: 0 } }], false),
    ).not.toThrow();
  });
});

describe("Plan.absorb", () => {
  it("drops a plan the yard has caught up with and names it", () => {
    const plan = freshPlan();
    const [caught, ahead] = cannonIds(plan);
    plan.setPlan(caught!, 2);
    plan.setPlan(ahead!, 5);

    const result = plan.absorb(yardWith({ [caught!]: { l: 2 }, [ahead!]: { l: 3 } }));

    expect(result.plansDropped).toEqual([caught]);
    expect(plan.get(caught!)!.plan).toBeNull();
    // The one the yard has not reached keeps its plan, at its new level.
    expect(plan.get(ahead!)!.plan).toEqual({ level: 5, order: 1 });
    expect(plan.get(ahead!)!.level).toBe(3);
    expect(result.changed).toContain(ahead);
  });

  it("takes the yard's word for busy and damaged", () => {
    const plan = freshPlan();
    const [tower] = cannonIds(plan);
    expect(plan.get(tower!)!.busy).toBe(false);

    plan.absorb(yardWith({ [tower!]: { cU: 600, hp: 10 } }));

    expect(plan.get(tower!)!.busy).toBe(true);
    expect(plan.get(tower!)!.damaged).toBe(true);
  });

  it("reports nothing dropped when no plan was reached", () => {
    const plan = freshPlan();
    const [tower] = cannonIds(plan);
    plan.setPlan(tower!, 4);

    expect(plan.absorb(yardWith({})).plansDropped).toEqual([]);
    expect(plan.get(tower!)!.plan).toEqual({ level: 4, order: 0 });
  });
});

/* ── Storing (issue #50) ──────────────────────────────────────────────────── */

/** Where the plan currently has a building. */
const positionOf = (plan: Plan, id: number): { x: number; y: number } => {
  const node = plan.get(id)!;
  return { x: node.x, y: node.y };
};

/** A one-slot layout over the given nodes. */
const layoutOf = (nodes: { id: number; t: number; x: number; y: number }[]): Layout => ({
  version: LAYOUT_VERSION,
  expansion: yard.expansionLevel,
  nodes,
  slot: 0,
  name: "test",
  updatedAt: 0,
});

describe("Plan.store", () => {
  it("takes buildings off the plot and hands back where they came from", () => {
    const plan = freshPlan();
    const towers = cannonIds(plan);
    const was = positionOf(plan, towers[0]!);

    const entries = plan.store(towers);

    expect(entries).toHaveLength(towers.length);
    expect(entries[0]).toEqual({ id: towers[0], x: was.x, y: was.y, store: true });
    expect(plan.storedCount).toBe(towers.length);
    expect(plan.storedIds()).toEqual([...towers].sort((a, b) => a - b));
    expect(plan.get(towers[0]!)!.stored).toBe(true);
  });

  it("frees the cells, so something else can be put on them", () => {
    const plan = freshPlan();
    const [tower] = cannonIds(plan);
    const node = plan.get(tower!)!;
    const spot = positionOf(plan, tower!);

    expect(plan.canPlace(node.type, spot.x, spot.y).blockedBy).toBe(tower);
    plan.store([tower!]);
    expect(plan.canPlace(node.type, spot.x, spot.y).reason).toBeNull();
  });

  it("leaves a stored building out of the yard's own lists", () => {
    const plan = freshPlan();
    const before = plan.buildings().length;
    const [tower] = cannonIds(plan);

    plan.store([tower!]);

    expect(plan.buildings()).toHaveLength(before - 1);
    expect(plan.buildings().some((node) => node.id === tower)).toBe(false);
    expect([...plan.all()].some((node) => node.id === tower)).toBe(false);
    // Still reachable by id: the checklist names it and undo restores it.
    expect(plan.get(tower!)?.stored).toBe(true);
    expect(plan.index().get(tower!)).toBeDefined();
  });

  it("skips an id the plan does not hold and anything already stored", () => {
    const plan = freshPlan();
    const [tower] = cannonIds(plan);

    expect(plan.store([1_000_099])).toEqual([]);
    expect(plan.store([tower!])).toHaveLength(1);
    expect(plan.store([tower!])).toEqual([]);
    expect(plan.storedCount).toBe(1);
  });

  it("is not a move: a stored building is not outlined as one", () => {
    const plan = freshPlan();
    const [tower] = cannonIds(plan);
    plan.store([tower!]);

    expect(plan.hasMoved(tower!)).toBe(false);
    expect(plan.movedIds()).not.toContain(tower);
  });

  it("leaves a stored building out of what Apply would upgrade", () => {
    const plan = freshPlan();
    const [tower] = cannonIds(plan);
    plan.setPlan(tower!, 3);
    expect(plan.plannedCount).toBe(1);

    plan.store([tower!]);

    expect(plan.plannedCount).toBe(0);
    expect(plan.plannedNodes()).toEqual([]);
    expect(plan.plannedLevels().has(tower!)).toBe(false);
    // The plan itself is kept, so undoing the store brings it back with it.
    expect(plan.get(tower!)!.plan).toEqual({ level: 3, order: 0 });
  });
});

describe("Plan.setStored", () => {
  it("reverses a store back onto the exact cells it came off", () => {
    const plan = freshPlan();
    const towers = cannonIds(plan);
    const before = towers.map((id) => ({ id, ...positionOf(plan, id) }));

    const entries = plan.store(towers);
    plan.setStored(entries, true);

    expect(plan.storedCount).toBe(0);
    for (const was of before) expect(positionOf(plan, was.id)).toEqual({ x: was.x, y: was.y });
    // The cells are held again: nothing else could be dropped on them.
    const first = plan.get(towers[0]!)!;
    expect(plan.canPlace(first.type, first.x, first.y).blockedBy).toBe(towers[0]);
  });

  it("redoes a store after it has been undone", () => {
    const plan = freshPlan();
    const [tower] = cannonIds(plan);
    const entries = plan.store([tower!]);

    plan.setStored(entries, true);
    plan.setStored(entries, false);

    expect(plan.get(tower!)!.stored).toBe(true);
    expect(plan.storedCount).toBe(1);
  });

  it("skips a building a rebase has taken away", () => {
    const plan = freshPlan();
    expect(() =>
      plan.setStored([{ id: 9_999_999, x: 0, y: 0, store: true }], false),
    ).not.toThrow();
    expect(plan.storedCount).toBe(0);
  });
});

describe("Plan.place", () => {
  it("puts a stored building back where it is asked to", () => {
    const plan = freshPlan();
    const [tower] = cannonIds(plan);
    const node = plan.get(tower!)!;
    const [entry] = plan.store([tower!]);
    const to = { x: entry!.x, y: entry!.y };

    expect(plan.place(tower!, to.x, to.y)).toEqual({ id: tower, x: to.x, y: to.y, store: false });
    expect(node.stored).toBe(false);
    expect(positionOf(plan, tower!)).toEqual(to);
    // And it is holding its cells again.
    expect(plan.canPlace(node.type, to.x, to.y).blockedBy).toBe(tower);
  });

  it("refuses a spot something else is on, and keeps it stored", () => {
    const plan = freshPlan();
    const [first, second] = cannonIds(plan);
    const other = plan.get(second!)!;
    plan.store([first!]);

    expect(plan.place(first!, other.x, other.y)).toBeNull();
    expect(plan.get(first!)!.stored).toBe(true);
    expect(plan.storedCount).toBe(1);
  });

  it("refuses a spot outside the plot", () => {
    const plan = freshPlan();
    const [tower] = cannonIds(plan);
    plan.store([tower!]);

    expect(plan.place(tower!, plan.plot.halfWidth, 0)).toBeNull();
    expect(plan.get(tower!)!.stored).toBe(true);
  });

  it("refuses a building that is not stored", () => {
    const plan = freshPlan();
    const [tower] = cannonIds(plan);
    expect(plan.place(tower!, 0, 0)).toBeNull();
  });
});

describe("a stored building and the rest of the plan", () => {
  it("is left out of the layout a save would write", () => {
    const plan = freshPlan();
    const [tower] = cannonIds(plan);
    const before = payloadFor(plan).nodes.length;

    plan.store([tower!]);

    const payload = payloadFor(plan);
    expect(payload.nodes).toHaveLength(before - 1);
    expect(payload.nodes.some((node) => node.id === tower)).toBe(false);
  });

  it("does not block the cells a loaded layout wants", () => {
    const blocked = freshPlan();
    const [mover, blocker] = cannonIds(blocked);
    const to = positionOf(blocked, blocker!);

    // With the blocker standing there the saved position is refused...
    const refused = planLoad(blocked, layoutOf([{ id: mover!, t: 20, x: to.x, y: to.y }]));
    expect(refused.didNotFit[0]?.reason).toBe(MissReason.BLOCKED);

    // ...and with it stored there is nothing in the way.
    const clear = freshPlan();
    clear.store([blocker!]);
    const loaded = planLoad(clear, layoutOf([{ id: mover!, t: 20, x: to.x, y: to.y }]));
    expect(loaded.didNotFit).toEqual([]);
    expect(loaded.entries[0]).toMatchObject({ id: mover, toX: to.x, toY: to.y });
  });

  it("survives a rebase, and leaves its cells free", () => {
    const plan = freshPlan();
    const [tower] = cannonIds(plan);
    const node = plan.get(tower!)!;
    const spot = positionOf(plan, tower!);
    plan.store([tower!]);

    plan.absorb(yardWith({}));

    expect(plan.get(tower!)!.stored).toBe(true);
    // Absorbing must not erase a footprint the building no longer occupies.
    expect(plan.canPlace(node.type, spot.x, spot.y).reason).toBeNull();
  });

  it("is not validated for overlaps or bounds", () => {
    const plan = freshPlan();
    const [first, second] = cannonIds(plan);
    const target = positionOf(plan, second!);

    plan.store([first!]);
    // Where the other tower stands, which would be an overlap if this one were
    // on the plot at all.
    plan.setPosition(first!, target.x, target.y);

    expect(plan.validate().valid).toBe(true);
  });
});

// #231: the faint outlines round whatever is in hand, against the captured
// 575-building yard.
describe("Plan nearby", () => {
  /** Whether two yard rectangles share any ground. */
  const touches = (
    a: { x: number; y: number; width: number; height: number },
    b: { x: number; y: number; width: number; height: number },
  ): boolean => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

  /**
   * The same question answered the slow way, by a pass over every building:
   * everything touching an area grown by `slack` on each side. The grid
   * rounds its areas out to 20-unit blocks, so it may find a little more
   * than `slack = 0` and never more than `slack = 20`.
   */
  const bruteForce = (plan: Plan, ids: number[], dx: number, dy: number, slack: number): Set<number> => {
    const moving = new Set(ids);
    const found = new Set<number>();
    for (const id of ids) {
      const node = plan.get(id);
      if (!node) continue;
      const margin = Math.max(2 * Math.max(node.width, node.height), 140) + slack;
      const area = {
        x: node.x + dx - margin,
        y: node.y + dy - margin,
        width: node.width + margin * 2,
        height: node.height + margin * 2,
      };
      for (const other of plan.buildings()) {
        if (!moving.has(other.id) && touches(area, other)) found.add(other.id);
      }
    }
    return found;
  };

  const expectBetween = (found: Set<number>, least: Set<number>, most: Set<number>): void => {
    for (const id of least) expect(found.has(id)).toBe(true);
    for (const id of found) expect(most.has(id)).toBe(true);
  };

  it("is everything close to a lifted building, and never the building itself", () => {
    const plan = freshPlan();
    for (const id of cannonIds(plan)) {
      plan.beginMove([id]);
      const found = plan.nearbyLifted(0, 0);
      expect(found.has(id)).toBe(false);
      expect(found.size).toBeGreaterThan(0);
      expectBetween(found, bruteForce(plan, [id], 0, 0, 0), bruteForce(plan, [id], 0, 0, 20));
      plan.cancelMove();
    }
  });

  it("follows the drag's offset", () => {
    const plan = freshPlan();
    const [id] = cannonIds(plan);
    if (id === undefined) throw new Error("no cannon in the fixture");
    plan.beginMove([id]);
    const found = plan.nearbyLifted(300, -200);
    expectBetween(found, bruteForce(plan, [id], 300, -200, 0), bruteForce(plan, [id], 300, -200, 20));
    plan.cancelMove();
  });

  it("joins the areas round every building of a big selection", () => {
    const plan = freshPlan();
    const walls = plan
      .buildings()
      .filter((node) => node.type === 17)
      .map((node) => node.id);
    expect(walls.length).toBeGreaterThan(100);

    plan.beginMove(walls);
    const found = plan.nearbyLifted(0, 0);
    for (const id of walls) expect(found.has(id)).toBe(false);
    for (const id of found) expect(plan.get(id)?.fixed).toBe(false);
    expectBetween(found, bruteForce(plan, walls, 0, 0, 0), bruteForce(plan, walls, 0, 0, 20));
    plan.cancelMove();
  });

  it("is nothing when nothing is lifted", () => {
    expect(freshPlan().nearbyLifted(0, 0).size).toBe(0);
  });

  it("answers for a spot, as a building out of the drawer needs", () => {
    const plan = freshPlan();
    const found = plan.nearbySpot(0, 0, 70, 70);
    const least = new Set(
      plan
        .buildings()
        .filter((node) => touches({ x: -140, y: -140, width: 350, height: 350 }, node))
        .map((node) => node.id),
    );
    for (const id of least) expect(found.has(id)).toBe(true);
    for (const id of found) expect(plan.get(id)?.fixed).toBe(false);
  });
});
