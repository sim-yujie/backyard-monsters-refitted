/**
 * What the yard should open on arrival, asked for by another screen: the
 * Build window on one building's tile ("Build Flinger" on a Map Room 1 card)
 * or a tab of the Monsters screen ("Hatch"), or the Monster Baiter's test
 * panel (a Baiter test's "Change army", #22 WP4), or the Defences screen (a
 * defence replay's Back, an attack notice's Defences on the map, #363), or a
 * notice (a friend's visit refused on the way in, #372), or the Inferno map
 * (back from a Moloch tribe attack, Inferno WP 2.10).
 *
 * The same one-shot handoff as `game/attack/attackTarget.ts`:
 * `SceneManager.goTo` takes a name and nothing else, so the request rides in
 * a module variable and the yard consumes it once its own yard has loaded. A
 * request is taken, not read, so it can never replay on a later visit.
 */
export type YardIntent =
  | { readonly kind: "build"; readonly type: number }
  | { readonly kind: "monsters"; readonly tab: string }
  | { readonly kind: "baiter" }
  | { readonly kind: "defences" }
  /** A line to show on arrival: why a friend's yard did not open (#372). */
  | { readonly kind: "notice"; readonly text: string }
  /** The Inferno map over the Inferno yard: the way back from a Moloch tribe attack (Inferno WP 2.10). */
  | { readonly kind: "infernoMap" };

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
