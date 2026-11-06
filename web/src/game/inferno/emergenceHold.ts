/**
 * Whether Moloch's emergence is playing on the main yard (WP 1.10): the
 * camera's turn to the cave, Moloch's words, the earthquake. Bob's tips and
 * the "Achievement earned!" card keep out of its way while it does
 * (`plugins/tips.ts`, `plugins/achievements.ts`).
 */

let holders = 0;
const listeners = new Set<(playing: boolean) => void>();

const tell = (): void => {
  const playing = holders > 0;
  for (const listener of listeners) listener(playing);
};

/** Whether anything of the emergence is on screen. */
export const emergencePlaying = (): boolean => holders > 0;

/** Marks the emergence as playing until the returned release is called (once; again does nothing). */
export const holdForEmergence = (): (() => void) => {
  holders++;
  if (holders === 1) tell();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holders--;
    if (holders === 0) tell();
  };
};

/** Hears the emergence start and stop; returns the unsubscribe. */
export const onEmergencePlaying = (listener: (playing: boolean) => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
