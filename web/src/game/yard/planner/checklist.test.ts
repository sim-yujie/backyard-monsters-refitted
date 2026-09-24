import { describe, expect, it } from "vitest";
import { buildChecklist } from "./checklist";
import { InvalidReason, type PlacementResult, type PlanNode } from "./placement";
import type { ApplyPreview } from "./upgrades";

/**
 * The pre-Apply checklist (design §3, F17).
 *
 * Three blocking rows about placement and, once anything is planned, three
 * warning rows about the upgrade walk. What matters here is which rows refuse
 * and which only report: a warning counted as a refusal would put a red badge
 * on a plan that is perfectly fine, and a refusal counted as a warning would
 * let Apply through onto a yard the server is about to reject.
 */

const node = (over: Partial<PlanNode> & { id: number }): PlanNode => ({
  // Type 20 is a cannon tower, which has a name in the art table.
  type: 20,
  x: 0,
  y: 0,
  width: 70,
  height: 70,
  level: 1,
  fort: 0,
  decoration: false,
  fixed: false,
  stored: false,
  plan: null,
  busy: false,
  damaged: false,
  ...over,
});

const index = (...nodes: PlanNode[]): Map<number, PlanNode> =>
  new Map(nodes.map((entry) => [entry.id, entry]));

const VALID: PlacementResult = { valid: true, issues: [] };

const rowOf = (checklist: ReturnType<typeof buildChecklist>, key: string) =>
  checklist.rows.find((row) => row.key === key);

/** An Apply preview with nothing in it, for the rows that only need counts. */
const previewOf = (over: Partial<ApplyPreview> = {}): ApplyPreview => ({
  started: [],
  finished: [],
  waiting: [],
  skipped: [],
  cost: { r1: 0, r2: 0, r3: 0, r4: 0 },
  points: 0,
  workers: { total: 5, busyBefore: 0, busyAfter: 0 },
  remaining: { r1: 0, r2: 0, r3: 0, r4: 0 },
  ...over,
});

describe("buildChecklist", () => {
  it("passes a plan with everything placed and nothing overlapping", () => {
    const checklist = buildChecklist(index(node({ id: 1 })), VALID);

    expect(checklist.ok).toBe(true);
    expect(checklist.rows.map((row) => row.key)).toEqual(["placed", "overlap", "bounds"]);
    expect(checklist.faulted.size).toBe(0);
  });

  it("blocks Apply while a building is in the drawer, and names it", () => {
    const checklist = buildChecklist(index(node({ id: 7 })), VALID, [7]);

    expect(checklist.ok).toBe(false);
    const row = rowOf(checklist, "placed");
    expect(row?.ok).toBe(false);
    expect(row?.warning).toBeUndefined();
    expect(row?.items).toEqual([{ id: 7, label: "Cannon Tower is in the drawer" }]);
    expect([...checklist.faulted]).toEqual([7]);
  });

  /*
   * The server would accept a layout that leaves a decoration out
   * (`unplacedBuildings` exempts them), but it does not *remove* a building it
   * is not sent — so a stored decoration would come back where it stood,
   * possibly under whatever the plan has moved onto those cells.
   */
  it("blocks on a stored decoration too", () => {
    const checklist = buildChecklist(
      index(node({ id: 3, type: 30, decoration: true })),
      VALID,
      [3],
    );

    expect(checklist.ok).toBe(false);
    expect(rowOf(checklist, "placed")?.items).toHaveLength(1);
  });

  it("names both buildings of an overlap and outlines them", () => {
    const checklist = buildChecklist(
      index(node({ id: 1 }), node({ id: 2 })),
      { valid: false, issues: [{ id: 1, reason: InvalidReason.OVERLAP, otherId: 2 }] },
    );

    expect(checklist.ok).toBe(false);
    expect(rowOf(checklist, "overlap")?.items[0]?.label).toBe(
      "Cannon Tower overlaps Cannon Tower",
    );
    expect([...checklist.faulted].sort()).toEqual([1, 2]);
  });

  it("says which area a building has left", () => {
    const checklist = buildChecklist(
      index(node({ id: 1 }), node({ id: 2, type: 30, decoration: true })),
      {
        valid: false,
        issues: [
          { id: 1, reason: InvalidReason.BOUNDS },
          { id: 2, reason: InvalidReason.BOUNDS },
        ],
      },
    );

    const labels = rowOf(checklist, "bounds")?.items.map((item) => item.label);
    expect(labels?.[0]).toContain("outside the yard");
    expect(labels?.[1]).toContain("outside the decoration area");
  });

  it("leaves the upgrade rows out when nothing is planned", () => {
    const checklist = buildChecklist(index(node({ id: 1 })), VALID, [], previewOf());
    expect(checklist.rows).toHaveLength(3);
  });

  it("reports a job with no worker rather than refusing the Apply", () => {
    const preview = previewOf({ waiting: [{ id: 1, t: 20, from: 1, to: 2, reason: "workers" }] });
    const checklist = buildChecklist(index(node({ id: 1 })), VALID, [], preview);
    const row = rowOf(checklist, "upgradeWorkers");

    expect(row?.ok).toBe(false);
    expect(row?.warning).toBe(true);
    // A warning is not a refusal, and it puts no red outline on anything.
    expect(checklist.ok).toBe(true);
    expect(checklist.faulted.size).toBe(0);
  });
});
