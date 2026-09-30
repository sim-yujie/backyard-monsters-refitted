import { describe, expect, it } from "vitest";
import { LAYOUT_VERSION, type BaseLoadResponse, type Layout } from "@/api/types";
import { readYard } from "../yardModel";
import { MissReason, planLoad } from "./layout";
import { PlaceBlock, Plan } from "./plan";
import { InvalidReason } from "./placement";

/**
 * A building with id 0 is a building (#212).
 *
 * The owner's Town Hall is building 0. The occupancy grid used to answer
 * "blocked by 0" and "not blocked" the same way, so an Aerial Defense Tower
 * could be dragged, placed or loaded straight onto the hall, in either view.
 *
 * Expansion 0: a 1000 x 800 plot. The hall (type 14, 130 x 130) sits in the
 * middle at (-65, -65), covering [-65, 65) on both axes; the tower (type 115,
 * 70 x 70) starts well clear of it.
 */

const HALL = 0;
const ADT = 1;

const save = (): BaseLoadResponse =>
  ({
    error: 0,
    currenttime: 1,
    savetime: 1,
    storedata: {},
    resources: { r1: 1e9, r2: 1e9, r3: 1e9, r4: 1e9 },
    buildinghealthdata: {},
    buildingdata: {
      "0": { id: HALL, t: 14, X: -65, Y: -65, l: 5 },
      "1": { id: ADT, t: 115, X: 300, Y: 200, l: 1 },
    },
  }) as unknown as BaseLoadResponse;

const freshPlan = (): Plan => Plan.fromYard(readYard(save()));

/** The tower one grid step into the hall from each side, and flush against it. */
const SIDES = [
  { side: "left", into: { x: -130, y: -35 }, flush: { x: -135, y: -35 } },
  { side: "right", into: { x: 60, y: -35 }, flush: { x: 65, y: -35 } },
  { side: "top", into: { x: -35, y: -130 }, flush: { x: -35, y: -135 } },
  { side: "bottom", into: { x: -35, y: 60 }, flush: { x: -35, y: 65 } },
] as const;

describe("the Town Hall at the centre, as building 0", () => {
  it("takes its footprint from the Flash class: 130 x 130 (BUILDING14.as:18)", () => {
    const hall = freshPlan().get(HALL)!;
    expect([hall.width, hall.height]).toEqual([130, 130]);
    expect(freshPlan().get(ADT)!.width).toBe(70);
  });

  for (const { side, into, flush } of SIDES) {
    it(`refuses an ADT dragged into it from the ${side}`, () => {
      const plan = freshPlan();
      const adt = plan.get(ADT)!;
      const dx = into.x - adt.x;
      const dy = into.y - adt.y;

      plan.beginMove([ADT]);
      const result = plan.testMove(dx, dy);
      expect(result.valid).toBe(false);
      expect(result.issues).toEqual([
        { id: ADT, reason: InvalidReason.OVERLAP, otherId: HALL },
      ]);
      expect(plan.commitMove(dx, dy)).toBeNull();
      expect([adt.x, adt.y]).toEqual([300, 200]);
      expect(plan.validate().valid).toBe(true);
    });

    it(`lets an ADT stand flush against it on the ${side}`, () => {
      const plan = freshPlan();
      const adt = plan.get(ADT)!;
      plan.beginMove([ADT]);
      expect(plan.commitMove(flush.x - adt.x, flush.y - adt.y)).not.toBeNull();
      expect(plan.validate().valid).toBe(true);
    });

    it(`refuses an ADT put down from the drawer into it from the ${side}`, () => {
      const plan = freshPlan();
      plan.store([ADT]);
      expect(plan.canPlace(115, into.x, into.y)).toEqual({
        reason: PlaceBlock.OCCUPIED,
        blockedBy: HALL,
      });
      expect(plan.place(ADT, into.x, into.y)).toBeNull();
      expect(plan.place(ADT, flush.x, flush.y)).not.toBeNull();
    });
  }

  it("refuses an arrow-key nudge that would step onto it", () => {
    const plan = freshPlan();
    plan.beginMove([ADT]);
    plan.commitMove(65 - 300, -35 - 200);
    plan.beginMove([ADT]);
    expect(plan.commitMove(-5, 0)).toBeNull();
    expect(plan.get(ADT)!.x).toBe(65);
  });

  it("refuses the hall dragged onto the tower, too", () => {
    const plan = freshPlan();
    plan.beginMove([HALL]);
    expect(plan.testMove(300, 200).issues).toEqual([
      { id: HALL, reason: InvalidReason.OVERLAP, otherId: ADT },
    ]);
    plan.cancelMove();
  });

  it("has the checklist report the overlap whichever of the two is stamped first", () => {
    const plan = freshPlan();
    plan.setPosition(ADT, -35, -35);
    const result = plan.validate();
    expect(result.valid).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(new Set([result.issues[0]!.id, result.issues[0]!.otherId])).toEqual(
      new Set([HALL, ADT]),
    );
  });

  it("does not load a layout that puts the tower inside it", () => {
    const plan = freshPlan();
    const layout: Layout = {
      slot: 0,
      name: "clipped",
      version: LAYOUT_VERSION,
      expansion: 0,
      updatedAt: 1_700_000_000,
      nodes: [{ id: ADT, t: 115, x: -35, y: -35 }],
    };
    const result = planLoad(plan, layout);
    expect(result.entries).toEqual([]);
    expect(result.didNotFit).toEqual([{ id: ADT, type: 115, reason: MissReason.BLOCKED }]);
  });
});
