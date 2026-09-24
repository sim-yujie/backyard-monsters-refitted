import { describe, expect, it } from "vitest";
import {
  LAYOUT_VERSION,
  type BaseLoadResponse,
  type Layout,
  type LayoutNode,
  type LayoutNodePlan,
} from "@/api/types";
import fixture from "../../../../test/fixtures/baseload-sandbox-yard.json";
import { readYard, type Yard } from "../yardModel";
import { payloadFor, planLoad } from "./layout";
import { Plan } from "./plan";

/**
 * Planned upgrades across the save and load boundary.
 *
 * Positions have their own tests in `plan.test.ts`; what is checked here is
 * the `plan` field alone: that a layout carries it only when there is one, and
 * that loading one into a yard that has moved on drops it rather than asking
 * Apply to refuse it (`docs/design/planner-upgrades.md` §2.3).
 *
 * The fixture is the sandbox yard: 575 buildings, six Cannon Towers at level
 * 1, 400 Blocks, a level 10 Town Hall and no countdowns.
 */

/** The captured yard with a few building rows patched. */
const yardWith = (changes: Record<number, Record<string, unknown>> = {}): Yard => {
  const copy = JSON.parse(JSON.stringify(fixture)) as {
    buildingdata: Record<string, Record<string, unknown>>;
  };
  for (const [id, patch] of Object.entries(changes)) Object.assign(copy.buildingdata[id]!, patch);
  return readYard(copy as unknown as BaseLoadResponse);
};

const planOf = (yard: Yard = yardWith()): Plan => Plan.fromYard(yard);

const cannonIds = (plan: Plan): number[] =>
  plan
    .buildings()
    .filter((node) => node.type === 20)
    .map((node) => node.id);

/** Wraps nodes as the server would send them. */
const asLayout = (nodes: LayoutNode[]): Layout => ({
  slot: 0,
  name: "test",
  version: LAYOUT_VERSION,
  expansion: 6,
  updatedAt: 1_700_000_000,
  nodes,
});

/** One saved node standing where the plan already has that building. */
const savedNode = (plan: Plan, id: number, over: Partial<LayoutNode> = {}): LayoutNode => {
  const node = plan.get(id)!;
  return { id, t: node.type, x: node.x, y: node.y, ...over };
};

describe("payloadFor", () => {
  it("writes a plan on the nodes that have one and nowhere else", () => {
    const plan = planOf();
    const [planned, bare] = cannonIds(plan);
    plan.setPlan(planned!, 4);

    const nodes = payloadFor(plan).nodes;
    const withPlan = nodes.find((node) => node.id === planned)!;
    const without = nodes.find((node) => node.id === bare)!;

    expect(withPlan.plan).toEqual({ level: 4, order: 0 });
    expect(without.plan).toBeUndefined();
    expect("plan" in without).toBe(false);
  });

  it("keeps the level and the order a plan was given", () => {
    const plan = planOf();
    const [first, second] = cannonIds(plan);
    plan.setPlan(first!, 2);
    plan.setPlan(second!, 7);

    const nodes = payloadFor(plan).nodes;
    expect(nodes.find((node) => node.id === second)!.plan).toEqual({ level: 7, order: 1 });
  });

  it("drops the field again once the plan is cleared", () => {
    const plan = planOf();
    const [tower] = cannonIds(plan);
    plan.setPlan(tower!, 3);
    plan.setPlan(tower!, null);

    expect(payloadFor(plan).nodes.find((node) => node.id === tower)!.plan).toBeUndefined();
  });
});

describe("planLoad: plans", () => {
  it("restores a plan the yard can still do", () => {
    const plan = planOf();
    const [tower] = cannonIds(plan);
    const result = planLoad(
      plan,
      asLayout([savedNode(plan, tower!, { plan: { level: 5, order: 3 } })]),
    );

    expect(result.plans).toEqual([
      { id: tower, before: null, after: { level: 5, order: 3 } },
    ]);
    expect(result.plansDropped).toBe(0);
    // Nothing is written: the caller pushes the entries through the stack.
    expect(plan.get(tower!)!.plan).toBeNull();
    plan.setPlans(result.plans, false);
    expect(plan.get(tower!)!.plan).toEqual({ level: 5, order: 3 });
  });

  it("drops a plan the building has caught up with", () => {
    // The layout wants level 3 on a tower the yard has already taken to 4.
    const caughtUp = Plan.fromYard(yardWith({ 32: { l: 4 } }));
    const result = planLoad(
      caughtUp,
      asLayout([savedNode(caughtUp, 32, { plan: { level: 3, order: 0 } })]),
    );

    expect(result.plans).toEqual([]);
    expect(result.plansDropped).toBe(1);
  });

  it("drops a plan on a building that is busy or damaged", () => {
    const plan = Plan.fromYard(yardWith({ [32]: { cU: 600 }, [33]: { hp: 10 } }));
    const result = planLoad(
      plan,
      asLayout([
        savedNode(plan, 32, { plan: { level: 3, order: 0 } }),
        savedNode(plan, 33, { plan: { level: 3, order: 1 } }),
      ]),
    );

    expect(result.plans).toEqual([]);
    expect(result.plansDropped).toBe(2);
  });

  it("drops a plan past the top of the ladder or on a type with none", () => {
    const plan = planOf();
    const [tower] = cannonIds(plan);
    const trap = plan.buildings().find((node) => node.type === 24)!;
    const result = planLoad(
      plan,
      asLayout([
        savedNode(plan, tower!, { plan: { level: 99, order: 0 } }),
        savedNode(plan, trap.id, { plan: { level: 2, order: 1 } }),
      ]),
    );

    expect(result.plans).toEqual([]);
    expect(result.plansDropped).toBe(2);
  });

  it("reads a plan on a building whose position did not fit", () => {
    const plan = planOf();
    const [tower] = cannonIds(plan);
    const result = planLoad(
      plan,
      asLayout([savedNode(plan, tower!, { x: 5_000, plan: { level: 3, order: 0 } })]),
    );

    // The tower stays where it stood and can still be upgraded there.
    expect(result.didNotFit).toHaveLength(1);
    expect(result.plans).toHaveLength(1);
  });

  it("leaves a plan the layout says nothing about alone", () => {
    const plan = planOf();
    const [planned, other] = cannonIds(plan);
    plan.setPlan(planned!, 3);

    const result = planLoad(plan, asLayout([savedNode(plan, other!)]));

    expect(result.plans).toEqual([]);
    expect(plan.get(planned!)!.plan).toEqual({ level: 3, order: 0 });
  });

  it("numbers a plan by reading order when the layout has no order on it", () => {
    const plan = planOf();
    const [first, second] = cannonIds(plan);
    const result = planLoad(
      plan,
      asLayout([
        savedNode(plan, first!, { plan: { level: 3 } as LayoutNodePlan }),
        savedNode(plan, second!, { plan: { level: 3 } as LayoutNodePlan }),
      ]),
    );

    expect(result.plans.map((entry) => entry.after!.order)).toEqual([0, 1]);
  });

  it("says nothing changed when the plan is the one already set", () => {
    const plan = planOf();
    const [tower] = cannonIds(plan);
    plan.setPlan(tower!, 5);
    const result = planLoad(
      plan,
      asLayout([savedNode(plan, tower!, { plan: { level: 5, order: 0 } })]),
    );

    expect(result.plans).toEqual([]);
    expect(result.plansDropped).toBe(0);
  });

  it("reports no plans for a layout that carries none", () => {
    const plan = planOf();
    const result = planLoad(plan, asLayout([savedNode(plan, cannonIds(plan)[0]!)]));

    expect(result.plans).toEqual([]);
    expect(result.plansDropped).toBe(0);
  });
});
