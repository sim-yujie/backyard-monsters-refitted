import { BaseMode } from "@/api/types";

/**
 * Who may open the planner, and whether they may change anything.
 *
 * Design §8, Q5: "Planner opens **read-only from anywhere** and is **editable
 * in build mode**. Owning the Yard Planner building unlocks it; its damage,
 * build, upgrade or fortify state never locks it. Entry is a toolbar button,
 * not the building's popup."
 *
 * Three rules, and nothing else:
 *
 * 1. A yard with no Yard Planner building has no planner at all. This is the
 *    only thing that closes the door.
 * 2. The player's own yard, loaded in build mode, is editable.
 * 3. Anything else that can be drawn — a visit, a world-map view, a replay of
 *    an attack — opens the planner to look at, never to change.
 *
 * What is deliberately *not* here is the Flash client's rule that a damaged or
 * counting-down Yard Planner removed the entry (`BUILDINGINFO.as:99,111,118,125`).
 * Q5 drops it, so this function never reads a building's health, level,
 * fortification or countdown: `hasYardPlanner` asks whether the yard holds one,
 * full stop.
 *
 * Pure on purpose. The client cannot yet open another player's yard — every
 * `/base/load` it makes is `type: "build"` on its own main base
 * (`src/api/base.ts`) — so rule 3 has no caller today. Keeping the rule in a
 * function with its own tests means the visit flow only has to pass its load
 * type in, rather than rediscover what read-only should mean.
 */

/** Yard Planner type id, `client/scripts/YARD_PROPS.as:1084`. */
export const YARD_PLANNER_TYPE = 10;

export const PlannerAccess = {
  /** No Yard Planner in this yard: the button is disabled. */
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
  if (!hasYardPlanner(yard)) return PlannerAccess.LOCKED;
  if (ownYard && loadType === BaseMode.BUILD) return PlannerAccess.EDIT;
  return PlannerAccess.READ_ONLY;
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
      return "Build the Yard Planner to plan your yard";
    case PlannerAccess.READ_ONLY:
      return "Open the Yard Planner to look around (P) — editing needs your own yard in build mode";
    case PlannerAccess.EDIT:
      return "Open the Yard Planner (P)";
  }
};
