/**
 * The player at work in the Yard Planner (beta.4, the owner's fix to #275).
 *
 * The planner saves nothing until Apply, so the server hears no real game
 * action while the player moves, places and rotates buildings there, and the
 * "Stay protected?" prompt came up nine minutes in, mid-layout. The planner
 * says here whenever the player really works in it (a plan edit, a selection,
 * a tool, a press on its own bars), and the app hands that to the prompt's
 * watch (`ProtectionWatch.active`), which taps "stay" for them when the
 * prompt is nearly due. Sitting idle in the planner says nothing, so the
 * prompt still comes then.
 *
 * On the main yard the planner hands over its plan too, read only when a tap
 * goes: the tap carries it, and the server's bot check counts new work in it
 * as play (`server/src/services/user/plannerWork.ts`), so hours of
 * rearranging with no Apply never read as a run of bare taps.
 */

/** The plan as it stands, a layout payload as JSON. */
export type PlannerPlan = () => string;
type Listener = (plan?: PlannerPlan) => void;
const listeners = new Set<Listener>();

/** The player just did something in the planner; `plan` reads its plan on the main yard. */
export const notePlannerActivity = (plan?: PlannerPlan): void => {
  for (const listener of listeners) listener(plan);
};

/** Hears every {@link notePlannerActivity}. Returns the unsubscribe. */
export const onPlannerActivity = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
