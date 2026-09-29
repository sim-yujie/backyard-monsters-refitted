import { describe, expect, it } from "vitest";
import type { BaseLoadResponse } from "@/api/types";
import { isStorageId, STORAGE_ID_BASE, withStoredDecorations } from "../decorStorage";
import { readYard } from "../yardModel";
import { buildChecklist } from "./checklist";
import { payloadFor } from "./layout";
import { Plan } from "./plan";

/**
 * The planner and decoration storage (#128): what storage holds reaches the
 * drawer as stored nodes, a decoration lifted into the drawer goes into
 * storage on Apply rather than blocking it, and one put down out of storage
 * is sent as `fromStorage`.
 *
 * Expansion 0: a 1000 x 800 plot. Type 14 is the Town Hall, 20 a Cannon
 * Tower, 28 the American Flag, 121 a totem.
 */

const save = (researchdata: Record<string, unknown> = {}): BaseLoadResponse =>
  ({
    error: 0,
    currenttime: 1,
    savetime: 1,
    storedata: {},
    buildinghealthdata: {},
    researchdata,
    buildingdata: {
      "1": { id: 1, t: 14, X: -400, Y: -300, l: 3 },
      "2": { id: 2, t: 20, X: 200, Y: -200, l: 1 },
      "3": { id: 3, t: 28, X: 900, Y: 0 },
    },
  }) as unknown as BaseLoadResponse;

const planOf = (researchdata: Record<string, unknown> = {}): Plan =>
  Plan.fromYard(readYard(withStoredDecorations(save(researchdata))));

describe("withStoredDecorations", () => {
  it("adds one building per stored decoration, with storage ids and a totem's level", () => {
    const withStorage = withStoredDecorations(save({ b28: 2, b121: 1, bl121: 3, b20: 4 }));
    const added = Object.values(withStorage.buildingdata ?? {}).filter((one) => isStorageId(Number(one.id)));
    expect(added.map((one) => [one.id, one.t, one.l ?? 1])).toEqual([
      [STORAGE_ID_BASE + 28_000, 28, 1],
      [STORAGE_ID_BASE + 28_001, 28, 1],
      [STORAGE_ID_BASE + 121_000, 121, 3],
    ]);
  });

  it("hands back the same save when nothing is stored", () => {
    const plain = save();
    expect(withStoredDecorations(plain)).toBe(plain);
  });
});

describe("Plan and storage", () => {
  it("stored decorations start in the drawer, holding no cells", () => {
    const plan = planOf({ b28: 2 });
    const stored = plan.storedNodes();
    expect(stored.map((node) => [node.type, node.fromStorage])).toEqual([
      [28, true],
      [28, true],
    ]);
    expect(stored.every((node) => node.home === undefined)).toBe(true);
    // (0, 0) is where they were handed over; nothing stands on those cells.
    expect(plan.canPlace(28, 0, 0).reason).toBeNull();
  });

  it("one put down is sent as fromStorage, not as a node", () => {
    const plan = planOf({ b28: 1 });
    const [node] = plan.storedNodes();
    expect(plan.place(node!.id, 100, 100)).not.toBeNull();

    const payload = payloadFor(plan);
    expect(payload.nodes.map((one) => one.id)).toEqual([1, 2, 3]);
    expect(payload.fromStorage).toEqual([{ t: 28, x: 100, y: 100 }]);
  });

  it("goes inside the plot only: storage has no saved spot to keep", () => {
    const plan = planOf({ b28: 1 });
    const [node] = plan.storedNodes();
    expect(plan.place(node!.id, 900, 300)).toBeNull();
  });

  it("no fromStorage when nothing came out of storage", () => {
    expect(payloadFor(planOf({ b28: 1 })).fromStorage).toBeUndefined();
  });

  it("a decoration in the drawer is not unplaced: it goes into storage", () => {
    const plan = planOf({ b28: 1 });
    plan.store([2, 3]);

    expect(plan.unplacedIds()).toEqual([2]);
    expect(plan.toStorageIds()).toEqual([3]);
    const checklist = buildChecklist(plan.index(), plan.validate(), plan.unplacedIds(), null, plan.toStorageIds());
    const rows = Object.fromEntries(checklist.rows.map((row) => [row.key, row]));
    expect(rows["placed"]?.items.map((item) => item.id)).toEqual([2]);
    expect(rows["toStorage"]).toMatchObject({ ok: false, warning: true, items: [{ id: 3 }] });
  });

  it("with only decorations in the drawer nothing blocks Apply", () => {
    const plan = planOf({ b28: 1 });
    plan.store([3]);
    const checklist = buildChecklist(plan.index(), plan.validate(), plan.unplacedIds(), null, plan.toStorageIds());
    expect(checklist.ok).toBe(true);
  });

  it("the flag outside the plot keeps its saved spot and is sent there", () => {
    const plan = planOf();
    expect(plan.validate().valid).toBe(true);
    expect(payloadFor(plan).nodes.find((one) => one.id === 3)).toMatchObject({ x: 900, y: 0 });
  });

  it("a rebase leaves a decoration out of storage where the player put it", () => {
    const plan = planOf({ b28: 1 });
    const [node] = plan.storedNodes();
    plan.place(node!.id, 100, 100);
    plan.absorb(readYard(withStoredDecorations(save({ b28: 1 }))));
    expect(plan.get(node!.id)).toMatchObject({ stored: false, x: 100, y: 100 });
  });
});
