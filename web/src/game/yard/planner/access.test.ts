import { describe, expect, it } from "vitest";
import { BaseMode } from "@/api/types";
import {
  hasYardPlanner,
  PlannerAccess,
  plannerAccess,
  plannerEntryTooltip,
  YARD_PLANNER_TYPE,
} from "./access";

/**
 * The planner's entry rule (design §8, Q5).
 *
 * Two of the three inputs have no caller in the client yet — every load it
 * makes is its own main yard in build mode — so these cases are the
 * specification a visit flow will be held to, not a description of code paths
 * that run today.
 */

/** A yard holding one building of each given type. */
const yardOf = (...types: number[]) => ({
  buildings: types.map((type, index) => ({ id: index + 1, type })),
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
});

describe("plannerAccess", () => {
  it("locks a yard with no Yard Planner, own and in build mode or not", () => {
    expect(plannerAccess(WITHOUT, BaseMode.BUILD, true)).toBe(PlannerAccess.LOCKED);
    expect(plannerAccess(WITHOUT, BaseMode.VIEW, false)).toBe(PlannerAccess.LOCKED);
    expect(plannerAccess({ buildings: [] }, BaseMode.BUILD, true)).toBe(PlannerAccess.LOCKED);
  });

  it("gives full editing on the player's own yard in build mode", () => {
    expect(plannerAccess(WITH, BaseMode.BUILD, true)).toBe(PlannerAccess.EDIT);
  });

  it("is read-only on someone else's yard, however it was loaded", () => {
    expect(plannerAccess(WITH, BaseMode.VIEW, false)).toBe(PlannerAccess.READ_ONLY);
    expect(plannerAccess(WITH, BaseMode.WORLD_MAP_VIEW, false)).toBe(PlannerAccess.READ_ONLY);
    expect(plannerAccess(WITH, BaseMode.ATTACK, false)).toBe(PlannerAccess.READ_ONLY);
    // Ownership alone is not enough: a build-mode load of a yard that is not
    // the caller's would still only be read-only.
    expect(plannerAccess(WITH, BaseMode.BUILD, false)).toBe(PlannerAccess.READ_ONLY);
  });

  it("is read-only on the player's own yard outside build mode", () => {
    expect(plannerAccess(WITH, BaseMode.VIEW, true)).toBe(PlannerAccess.READ_ONLY);
    expect(plannerAccess(WITH, BaseMode.ATTACK, true)).toBe(PlannerAccess.READ_ONLY);
  });

  /**
   * The rule Q5 struck out. The Flash client pulled the entry when the Yard
   * Planner was damaged or counting down (`BUILDINGINFO.as:99,111,118,125`);
   * nothing here reads health, level, fortification or a countdown, so a
   * building in any of those states still unlocks the planner.
   */
  it("never locks on the Yard Planner's own damage, build or upgrade state", () => {
    const ruined = {
      buildings: [
        {
          id: 1,
          type: YARD_PLANNER_TYPE,
          level: 0,
          fortification: 0,
          hp: 0,
          condition: "destroyed",
          countdown: { kind: "upgrade", endsAt: 9_999_999_999 },
        },
      ],
    };
    expect(plannerAccess(ruined, BaseMode.BUILD, true)).toBe(PlannerAccess.EDIT);
  });
});

describe("plannerEntryTooltip", () => {
  it("names the building that unlocks the planner when it is locked", () => {
    expect(plannerEntryTooltip(PlannerAccess.LOCKED)).toBe(
      "Build the Yard Planner to plan your yard",
    );
  });

  it("offers the shortcut when the planner can be opened", () => {
    expect(plannerEntryTooltip(PlannerAccess.EDIT)).toContain("(P)");
    expect(plannerEntryTooltip(PlannerAccess.READ_ONLY)).toContain("(P)");
  });
});
