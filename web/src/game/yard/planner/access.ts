import { BaseMode } from "@/api/types";

/**
 * Who may open the planner.
 *
 * Design §8, Q5: "Planner opens **read-only from anywhere** and is **editable
 * in build mode**. Owning the Yard Planner building unlocks it; its damage,
 * build, upgrade or fortify state never locks it. Entry is a toolbar button,
 * not the building's popup."
 *
 * Owner decision 2026-09-30 replaced the first of Q5's rules: layout mode is
 * every player's, and the Yard Planner building unlocks only the Blueprint
 * view. Owner report 2026-10-22 struck the "read-only from anywhere" half: in
 * someone else's yard the planner gave away what the yard itself keeps
 * hidden — every building's level on the Blueprint, tower ranges and dead
 * zones, storage room, workers, and Find listing the traps by kind and count.
 * The rules now:
 *
 * 1. The player's own yard, loaded in build mode, is editable, main yard or
 *    outpost, Yard Planner or not.
 * 2. Anything else — a visit, a world-map view, a friend's yard, an attack —
 *    has no planner at all: the Layout button is left out and P does nothing.
 * 3. The Blueprint view needs a Yard Planner in the yard shown, and is never
 *    offered in an outpost, even one that has one ({@link blueprintBlock}).
 *
 * What is deliberately *not* here is the Flash client's rule that a damaged or
 * counting-down Yard Planner removed the entry (`BUILDINGINFO.as:99,111,118,125`).
 * Q5 drops it for damage, upgrades and fortifying. The one state that does
 * count is the first build: owner report 2026-10-26, a Yard Planner still
 * being built must not unlock the Blueprint view yet. `hasYardPlanner` asks
 * whether the yard holds a finished one (level 1 or more; the yard model
 * reports a running build countdown as level 0), and never reads health,
 * fortification or an upgrade countdown.
 *
 * Pure on purpose: the yard scene passes its load type and whose yard it is,
 * and the rules keep their own tests.
 */

/** Yard Planner type id, `client/scripts/YARD_PROPS.as:1084`. */
export const YARD_PLANNER_TYPE = 10;

export const PlannerAccess = {
  /** Not the player's own yard: no planner, and no button for one. */
  LOCKED: "locked",
  /** The player's own yard: the planner opens with every tool. */
  EDIT: "edit",
} as const;
export type PlannerAccess = (typeof PlannerAccess)[keyof typeof PlannerAccess];

/**
 * The little of a yard this needs: the types it holds.
 *
 * Narrower than `Yard` so a test can ask without constructing a save.
 */
export interface PlannerAccessYard {
  readonly buildings: readonly { readonly type: number; readonly level: number }[];
}

/** Whether the yard holds a Yard Planner that has been built. */
export const hasYardPlanner = (yard: PlannerAccessYard): boolean =>
  yard.buildings.some((building) => building.type === YARD_PLANNER_TYPE && building.level >= 1);

/** Whether the yard's only Yard Planner is still being built. */
const yardPlannerBuilding = (yard: PlannerAccessYard): boolean =>
  !hasYardPlanner(yard) && yard.buildings.some((building) => building.type === YARD_PLANNER_TYPE);

/**
 * Whether the player may open the planner in this yard.
 *
 * `loadType` is the `type` the yard was fetched with (`BaseMode`); `ownYard`
 * is whether the yard belongs to the signed-in player. Both are needed: a
 * build-mode load is always the caller's own base today, but a client that
 * gains an admin view should not have "build mode" alone stand in for
 * ownership. Whether the yard holds a Yard Planner does not matter here: it
 * unlocks the Blueprint view only, and only in the player's own yard.
 */
export const plannerAccess = (loadType: string, ownYard: boolean): PlannerAccess =>
  ownYard && loadType === BaseMode.BUILD ? PlannerAccess.EDIT : PlannerAccess.LOCKED;

/** Why the Blueprint view is off in a yard with no Yard Planner. */
export const BLUEPRINT_NEEDS_PLANNER = "Build a Yard Planner to unlock Blueprint view";
/** Why it is off while the yard's Yard Planner is still being built (2026-10-26). */
export const BLUEPRINT_PLANNER_BUILDING = "Blueprint view unlocks when your Yard Planner is finished";
/** Why it is off in an outpost, which cannot build one (2026-09-30). */
export const BLUEPRINT_NOT_IN_OUTPOSTS = "Blueprint view isn't available in outposts";

/**
 * Why the planner's Blueprint view cannot be opened in this yard, or null
 * when it can: never in an outpost, and elsewhere only with a finished Yard
 * Planner (owner decisions 2026-09-30 and 2026-10-26).
 */
export const blueprintBlock = (
  yard: PlannerAccessYard & { readonly kind?: string },
): string | null => {
  if (yard.kind === "outpost") return BLUEPRINT_NOT_IN_OUTPOSTS;
  if (hasYardPlanner(yard)) return null;
  return yardPlannerBuilding(yard) ? BLUEPRINT_PLANNER_BUILDING : BLUEPRINT_NEEDS_PLANNER;
};

/*
 * The Yard Planner building's gate on the planner's tools (owner, beta 8,
 * grilling of 19 Nov 2026). Layout mode stays every player's — moving,
 * Apply, undo and redo, Stored, re-arming traps, Select and Box — but these
 * need a finished Yard Planner in the yard shown (the Blueprint rule above:
 * level 1 or more, damage and upgrades never matter):
 *
 * - layout slots 2 to 10 (one slot without; the server holds the same line,
 *   `server/src/services/yardplanner/plannerGate.ts`);
 * - Tower ranges and Dead zones (and the coverage panel they open);
 * - Find, the yard picture and Compare;
 * - the many-walls Upgrade walls (one wall at a time is free, from its pop-up);
 * - the Blueprint view ({@link blueprintBlock}, as before).
 *
 * The main yard and the Inferno each need their own; an outpost never has
 * one, so there they stay locked for good (the owner chose that knowingly),
 * even in an outpost that came with a Yard Planner standing.
 */

/** Layout slots a yard without a Yard Planner may use: slot 1. */
export const FREE_LAYOUT_SLOTS = 1;

/** What a locked tool says without a Yard Planner. */
export const TOOL_NEEDS_PLANNER = "Build a Yard Planner";
/** What it says while the Yard Planner is still being built. */
export const TOOL_PLANNER_BUILDING = "Finish your Yard Planner";
/** What it says in an outpost, which can never build one. */
export const TOOL_NOT_IN_OUTPOSTS = "Not in outposts";

/**
 * Why the Yard Planner's tools (the comment above) are locked in this yard,
 * or null when they are not.
 */
export const plannerToolBlock = (
  yard: PlannerAccessYard & { readonly kind?: string },
): string | null => {
  if (yard.kind === "outpost") return TOOL_NOT_IN_OUTPOSTS;
  if (hasYardPlanner(yard)) return null;
  return yardPlannerBuilding(yard) ? TOOL_PLANNER_BUILDING : TOOL_NEEDS_PLANNER;
};

/** How many layout slots, from slot 1 up, the yard may save to. */
export const usableLayoutSlots = (blocked: string | null, slots: number): number =>
  blocked === null ? slots : Math.min(FREE_LAYOUT_SLOTS, slots);

/**
 * Whether the planner offers saved layouts (the Layouts button and panel,
 * Ctrl+S) in this yard. An outpost has none (`BasePlanner.as:41`, #191); the
 * main yard and the Inferno yard each have their own (owner decision I17,
 * 2026-10-29). The Inferno yard is opened with a `baseid`, so "has a baseid"
 * is not the test: until 16 Nov 2026 that hid its Layouts button and left its
 * slots reachable only by Ctrl+S.
 */
export const hasLayoutSlots = (yard: { readonly kind?: string }): boolean => yard.kind !== "outpost";

/**
 * The Layout button's tooltip. Someone else's yard has no button to put it
 * on; the locked text is there for any other way in that is ever added.
 */
export const plannerEntryTooltip = (access: PlannerAccess): string => {
  switch (access) {
    case PlannerAccess.LOCKED:
      return "The layout planner is only for your own yards";
    case PlannerAccess.EDIT:
      return "Open the Yard Planner (P)";
  }
};
