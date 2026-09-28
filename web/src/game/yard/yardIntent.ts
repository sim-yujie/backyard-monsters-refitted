/**
 * What the yard should open on arrival, asked for by another screen: the
 * Build window on one building's tile ("Build Flinger" on a Map Room 1 card)
 * or a tab of the Monsters screen ("Hatch").
 *
 * The same one-shot handoff as `game/attack/attackTarget.ts`:
 * `SceneManager.goTo` takes a name and nothing else, so the request rides in
 * a module variable and the yard consumes it once its own yard has loaded. A
 * request is taken, not read, so it can never replay on a later visit.
 */
export type YardIntent =
  | { readonly kind: "build"; readonly type: number }
  | { readonly kind: "monsters"; readonly tab: string };

let pending: YardIntent | null = null;

export const setYardIntent = (intent: YardIntent): void => {
  pending = intent;
};

/** Takes the pending request, clearing it. Null when there is none. */
export const consumeYardIntent = (): YardIntent | null => {
  const intent = pending;
  pending = null;
  return intent;
};
