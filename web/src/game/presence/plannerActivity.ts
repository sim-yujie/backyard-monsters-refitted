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
 */

type Listener = () => void;
const listeners = new Set<Listener>();

/** The player just did something in the planner. */
export const notePlannerActivity = (): void => {
  for (const listener of listeners) listener();
};

/** Hears every {@link notePlannerActivity}. Returns the unsubscribe. */
export const onPlannerActivity = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
