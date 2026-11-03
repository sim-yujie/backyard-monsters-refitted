import { describe, expect, it } from "vitest";
import {
  LAYOUT_VERSION,
  type BaseLoadResponse,
  type Layout,
  type LayoutNode,
} from "@/api/types";
import fixture from "../../../../test/fixtures/baseload-sandbox-yard.json";
import { readYard, type Yard } from "../yardModel";
import { layoutMeta, payloadFor, planLoad } from "./layout";
import { Plan } from "./plan";

/**
 * Layouts across the save and load boundary: the drawer, and the `plan`
 * field older layouts carry.
 *
 * Positions have their own tests in `plan.test.ts`. Per-building upgrade
 * planning was removed on 2026-11-03 (owner), so a layout is written without
 * a `plan` field and an old one that has it still loads, the field ignored.
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

describe("old saved plans", () => {
  it("writes no plan field on any node", () => {
    const plan = planOf();
    for (const node of payloadFor(plan).nodes) expect(node).not.toHaveProperty("plan");
  });

  it("loads a layout that still carries plans, ignoring the plan", () => {
    const plan = planOf();
    const [tower] = cannonIds(plan);
    const saved = { ...savedNode(plan, tower!), plan: { level: 5, order: 0 } } as LayoutNode;

    const result = planLoad(plan, asLayout([saved]));

    expect(result.didNotFit).toEqual([]);
    expect(result).not.toHaveProperty("plans");
    expect(plan.get(tower!)).not.toHaveProperty("plan");
  });
});

describe("layoutMeta", () => {
  it("names the drawer only when the layout keeps something in it", () => {
    const layout = asLayout([]);
    layout.updatedAt = "2026-10-05T00:00:00Z";
    expect(layoutMeta(layout)).toMatch(/^0 buildings · expansion 6 · /);

    layout.stored = [
      { id: 1, t: 20 },
      { id: 2, t: 20 },
    ];
    expect(layoutMeta(layout)).toMatch(/^0 buildings · 2 in storage · expansion 6 · /);
  });
});

describe("planLoad and the drawer", () => {
  it("lifts what the layout stores and places what it names, leaving the rest", () => {
    const plan = planOf();
    const [lifted, placed] = cannonIds(plan);
    plan.store([placed!]);

    const result = planLoad(plan, {
      ...asLayout([savedNode(plan, placed!)]),
      stored: [{ id: lifted!, t: 20 }],
    });

    expect(result.lifts.map((entry) => entry.id)).toEqual([lifted]);
    expect(result.lifts[0]?.store).toBe(true);
    expect(result.places.map((entry) => entry.id)).toEqual([placed]);
    expect(result.places[0]?.store).toBe(false);
    expect(result.entries).toEqual([]);
  });

  it("does not lift a building already in the drawer, and drops one the yard has lost", () => {
    const plan = planOf();
    const [stored] = cannonIds(plan);
    plan.store([stored!]);

    const result = planLoad(plan, {
      ...asLayout([]),
      stored: [
        { id: stored!, t: 20 },
        { id: 999_999, t: 20 },
      ],
    });

    expect(result.lifts).toEqual([]);
    expect(result.missing).toEqual([]);
  });

  it("leaves a stored building in the drawer when its saved spot is outside the plot", () => {
    const plan = planOf();
    const [stored] = cannonIds(plan);
    plan.store([stored!]);

    const result = planLoad(plan, asLayout([savedNode(plan, stored!, { x: 5000, y: 5000 })]));

    expect(result.places).toEqual([]);
    expect(result.didNotFit.map((miss) => miss.id)).toEqual([stored]);
  });
});
