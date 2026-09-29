import { BaseMode } from "@/api/types";

/**
 * Who may open the planner, and whether they may change anything.
 *
 * Design §8, Q5: "Planner opens **read-only from anywhere** and is **editable
 * in build mode**. Owning the Yard Planner building unlocks it; its damage,
 * build, upgrade or fortify state never locks it. Entry is a toolbar button,
 * not the building's popup."
 *
 * Owner decision 2026-09-30 replaced the first of Q5's rules: layout mode is
 * every player's, and the Yard Planner building unlocks only the Blueprint
 * view. The rules now:
 *
 * 1. The player's own yard, loaded in build mode, is editable, main yard or
 *    outpost, Yard Planner or not.
 * 2. Anything else that can be drawn — a visit, a world-map view, a replay of
 *    an attack — opens the planner to look at, never to change, and only if
 *    that yard holds a Yard Planner (a visit keeps the rule it always had).
 * 3. The Blueprint view needs a Yard Planner in the yard shown, and is never
 *    offered in an outpost, even one that has one ({@link blueprintBlock}).
 *
 * What is deliberately *not* here is the Flash client's rule that a damaged or
 * counting-down Yard Planner removed the entry (`BUILDINGINFO.as:99,111,118,125`).
 * Q5 drops it, so this function never reads a building's health, level,
 * fortification or countdown: `hasYardPlanner` asks whether the yard holds one,
 * full stop.
 *
 * Pure on purpose: the yard scene passes its load type and whose yard it is,
 * and the rules keep their own tests.
 */

/** Yard Planner type id, `client/scripts/YARD_PROPS.as:1084`. */
export const YARD_PLANNER_TYPE = 10;

export const PlannerAccess = {
  /** Someone else's yard with no Yard Planner: the button is disabled. */
  LOCKED: "locked",
  /** The planner opens, but nothing in it can be changed. */
  READ_ONLY: "read-only",
  /** The planner opens with every tool. */
  EDIT: "edit",
} as const;
export type PlannerAccess = (typeof PlannerAccess)[keyof typeof PlannerAccess];

/**
 * The little of a yard this needs: the types it holds.
 *
 * Narrower than `Yard` so a test — and a future visit flow that has not built a
 * full `Yard` yet — can ask without constructing a save.
 */
export interface PlannerAccessYard {
  readonly buildings: readonly { readonly type: number }[];
}

/** Whether the yard holds a Yard Planner, in whatever state. */
export const hasYardPlanner = (yard: PlannerAccessYard): boolean =>
  yard.buildings.some((building) => building.type === YARD_PLANNER_TYPE);

/**
 * What the player may do with the planner in this yard.
 *
 * `loadType` is the `type` the yard was fetched with (`BaseMode`); `ownYard`
 * is whether the yard belongs to the signed-in player. Both are needed: a
 * build-mode load is always the caller's own base today, but a client that
 * gains outposts or an admin view should not have "build mode" alone stand in
 * for ownership.
 */
export const plannerAccess = (
  yard: PlannerAccessYard,
  loadType: string,
  ownYard: boolean,
): PlannerAccess => {
  if (ownYard && loadType === BaseMode.BUILD) return PlannerAccess.EDIT;
  if (!hasYardPlanner(yard)) return PlannerAccess.LOCKED;
  return PlannerAccess.READ_ONLY;
};

/** Why the Blueprint view is off in a yard with no Yard Planner. */
export const BLUEPRINT_NEEDS_PLANNER = "Build a Yard Planner to unlock Blueprint view";
/** Why it is off in an outpost, which cannot build one (2026-09-30). */
export const BLUEPRINT_NOT_IN_OUTPOSTS = "Blueprint view isn't available in outposts";

/**
 * Why the planner's Blueprint view cannot be opened in this yard, or null
 * when it can: never in an outpost, and elsewhere only with a Yard Planner
 * (owner decision 2026-09-30).
 */
export const blueprintBlock = (
  yard: PlannerAccessYard & { readonly kind?: string },
): string | null => {
  if (yard.kind === "outpost") return BLUEPRINT_NOT_IN_OUTPOSTS;
  return hasYardPlanner(yard) ? null : BLUEPRINT_NEEDS_PLANNER;
};

/**
 * The Plan button's tooltip, which is the only place the rule is explained.
 *
 * A disabled button with no reason on it is the worst version of this: the
 * player cannot see the Yard Planner is what unlocks it, so the tooltip names
 * the building.
 */
export const plannerEntryTooltip = (access: PlannerAccess): string => {
  switch (access) {
    case PlannerAccess.LOCKED:
      return "This yard has no Yard Planner to look at its layout with";
    case PlannerAccess.READ_ONLY:
      return "Open the Yard Planner to look around (P) — editing needs your own yard in build mode";
    case PlannerAccess.EDIT:
      return "Open the Yard Planner (P)";
  }
};
