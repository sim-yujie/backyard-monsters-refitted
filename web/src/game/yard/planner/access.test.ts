import { describe, expect, it } from "vitest";
import { BaseMode } from "@/api/types";
import {
  BLUEPRINT_NEEDS_PLANNER,
  BLUEPRINT_NOT_IN_OUTPOSTS,
  BLUEPRINT_PLANNER_BUILDING,
  blueprintBlock,
  hasYardPlanner,
  PlannerAccess,
  plannerAccess,
  plannerEntryTooltip,
  YARD_PLANNER_TYPE,
} from "./access";

/** The planner's entry rule (design §8, Q5, as changed 2026-09-30 and 2026-10-22). */

/** A yard holding one building of each given type. */
const yardOf = (...types: number[]) => ({
  buildings: types.map((type, index) => ({ id: index + 1, type, level: 1 })),
});

/** Town hall, a cannon tower and a wall: a yard with no Yard Planner. */
const WITHOUT = yardOf(14, 20, 17);
const WITH = yardOf(14, 20, 17, YARD_PLANNER_TYPE);

describe("hasYardPlanner", () => {
  it("finds the Yard Planner by type id", () => {
    expect(hasYardPlanner(WITH)).toBe(true);
    expect(hasYardPlanner(WITHOUT)).toBe(false);
    expect(hasYardPlanner({ buildings: [] })).toBe(false);
  });

  /** Owner report 2026-10-26: a Yard Planner still being built (level 0) does not count. */
  it("does not count a Yard Planner that is still being built", () => {
    const building = { buildings: [{ type: 14, level: 1 }, { type: YARD_PLANNER_TYPE, level: 0 }] };
    expect(hasYardPlanner(building)).toBe(false);
    expect(blueprintBlock(building)).toBe(BLUEPRINT_PLANNER_BUILDING);
    expect(blueprintBlock({ ...building, kind: "outpost" })).toBe(BLUEPRINT_NOT_IN_OUTPOSTS);
  });
});

describe("plannerAccess", () => {
  it("opens on the player's own yard in build mode, main yard or outpost alike", () => {
    expect(plannerAccess(BaseMode.BUILD, true)).toBe(PlannerAccess.EDIT);
  });

  /**
   * Owner report 2026-10-22: a look at someone else's yard through the
   * planner gave away every building's level, tower ranges, storage room and
   * the traps by kind and count. No yard but the player's own opens it, with
   * or without a Yard Planner in it.
   */
  it("never opens on someone else's yard, however it was loaded", () => {
    for (const mode of [BaseMode.VIEW, BaseMode.WORLD_MAP_VIEW, BaseMode.ATTACK, BaseMode.BUILD]) {
      expect(plannerAccess(mode, false)).toBe(PlannerAccess.LOCKED);
    }
  });

  it("never opens on the player's own yard outside build mode", () => {
    expect(plannerAccess(BaseMode.VIEW, true)).toBe(PlannerAccess.LOCKED);
    expect(plannerAccess(BaseMode.ATTACK, true)).toBe(PlannerAccess.LOCKED);
  });

  it("has only the two answers: the own yard's planner, or none", () => {
    expect(Object.values(PlannerAccess).sort()).toEqual([PlannerAccess.EDIT, PlannerAccess.LOCKED].sort());
  });
});

describe("plannerEntryTooltip", () => {
  it("says the planner is for the player's own yards", () => {
    expect(plannerEntryTooltip(PlannerAccess.LOCKED)).toBe("The layout planner is only for your own yards");
  });

  it("offers the shortcut when the planner can be opened", () => {
    expect(plannerEntryTooltip(PlannerAccess.EDIT)).toContain("(P)");
  });
});

describe("blueprintBlock (2026-09-30)", () => {
  it("needs a Yard Planner in the yard shown", () => {
    expect(blueprintBlock(WITH)).toBeNull();
    expect(blueprintBlock({ ...WITH, kind: "main" })).toBeNull();
    expect(blueprintBlock(WITHOUT)).toBe(BLUEPRINT_NEEDS_PLANNER);
    expect(BLUEPRINT_NEEDS_PLANNER).toBe("Build a Yard Planner to unlock Blueprint view");
  });

  it("is never offered in an outpost, even one that has a Yard Planner", () => {
    expect(blueprintBlock({ ...WITH, kind: "outpost" })).toBe(BLUEPRINT_NOT_IN_OUTPOSTS);
    expect(blueprintBlock({ ...WITHOUT, kind: "outpost" })).toBe(BLUEPRINT_NOT_IN_OUTPOSTS);
    expect(BLUEPRINT_NOT_IN_OUTPOSTS).toBe("Blueprint view isn't available in outposts");
  });
});
