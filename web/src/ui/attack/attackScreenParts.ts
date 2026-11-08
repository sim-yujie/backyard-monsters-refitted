/**
 * Which pieces of screen an attack shows around the battlefield, by the kind
 * of fight (owner, beta 7, grill item 35: "Attacks only").
 *
 * A live attack (the player's own fight on another yard, not a Baiter test,
 * a replay or a raid) is cleaned up: no HUD (the resource amounts, Map, Yard
 * and Account), no phone menu holding Map / Yard / Log out, no status line in
 * the bottom-left corner ("36 buildings · 0 destroyed · …") and no minimap.
 * The attack bar, the Army panel and the zoom always stay. Replays, defence
 * views and tests keep the screen they had; a raid never had a HUD or menu.
 */
export interface AttackKind {
  readonly practice: boolean;
  readonly watching: boolean;
  readonly raiding: boolean;
}

export interface AttackScreenParts {
  /** The kind is a live attack (none of the others). */
  readonly live: boolean;
  /** The HUD bar: resources, Map, Yard, Account. */
  readonly hud: boolean;
  /** The phone's overflow menu: Map, Yard, Log out. */
  readonly menu: boolean;
  /** The status line in the bottom-left corner, once the fight is on. */
  readonly statusLine: boolean;
  /** The overview map in the corner (and the phone's map button folding it with the zoom). */
  readonly minimap: boolean;
}

export const attackScreenParts = (kind: AttackKind): AttackScreenParts => {
  const live = !kind.practice && !kind.watching && !kind.raiding;
  return {
    live,
    hud: !live && !kind.raiding,
    menu: !live && !kind.raiding,
    statusLine: !live,
    minimap: !live,
  };
};
