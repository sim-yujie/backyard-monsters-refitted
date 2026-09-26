import type { BaseLoadResponse, ChampionSaveEntry } from "@/api/types";
import type { MonsterLevels, Roster } from "@/game/combat/rules/types";
import type { OffsetCell } from "@/game/HexGrid";

/**
 * The one-shot handoff between the screen that chose a target and the screen
 * that opens it (`docs/design/attack-flow.md` §F1 "Where the target goes").
 *
 * `SceneManager.goTo` takes a name and nothing else, so the target rides in a
 * module variable between the click and the next scene's `enter()`, the same
 * way `api/auth.ts`'s session and `api/http.ts`'s token outlive one call. A
 * target is consumed, not read: the scene that opens it clears it, so a stale
 * choice can never leak into an unrelated visit.
 *
 * Two doors, two targets. Attack from the map sets an {@link AttackTarget} and
 * goes to the attack scene. View yard on a foreign cell sets a
 * {@link ViewTarget} and goes to the yard scene, which shows the yard read-only
 * and — if the cell can be attacked — offers an Attack button that issues the
 * attack load itself and hands the response on inside `AttackTarget.load`, so
 * the attack scene skips the fetch it was just handed.
 */

/**
 * What kind of cell is being opened. Decides the `/base/load` mode: a wild
 * monster camp takes `wmview`/`wmattack`, a player's main yard or outpost takes
 * `view`/`attack` (`server/src/enums/Base.ts`).
 */
export type AttackTargetKind = "wild" | "main" | "outpost";

/**
 * What the attacker has to send, gathered on the map before the yard opens —
 * the same moment the Flash client fills `ATTACK._curCreaturesAvailable`
 * (`docs/specs/combat.md:278-286`, `PopupAttackA.as:214-239`).
 */
export interface AttackRoster {
  /**
   * Monster counts summed across the attacker's own cells whose flinger reaches
   * the target. Only ids with a positive count.
   */
  readonly monsters: Roster;
  /** Academy levels by roster id; an absent id is level 1. */
  readonly levels: MonsterLevels;
  /**
   * Every champion the attacker owns, as the own-yard save lists them. The
   * attack load declares all of them, as `ATTACK.AttackData()` does; which one
   * may be flung (`hp > 0`, `status === 0`) is the army panel's question.
   */
  readonly champions: readonly ChampionSaveEntry[];
  /**
   * The highest flinger level among the cells in range, which sets the fling
   * capacity (`combat.md:293-304`). 0 when no cell reaches the target.
   */
  readonly flingerLevel: number;
  /** The attacker's catapult level, 0 when none. */
  readonly catapultLevel: number;
}

/** The cell an attack is about to open. */
export interface AttackTarget {
  /** The defender's base id, as the map cell carries it. */
  readonly baseid: string;
  readonly kind: AttackTargetKind;
  /** Where on the map it is, for the attack scene's Back and the save's cell. */
  readonly cell: OffsetCell;
  /** Owner username, or the tribe name of a wild monster camp. */
  readonly name: string;
  readonly roster: AttackRoster;
  /**
   * The attack load's response, when the caller already issued it. Set by the
   * yard scene's Attack button (View yard → Attack), left out from the map, in
   * which case the attack scene fetches it.
   */
  readonly load?: BaseLoadResponse;
}

/** A foreign cell the yard scene is about to show read-only. */
export interface ViewTarget {
  readonly baseid: string;
  readonly kind: AttackTargetKind;
  readonly cell: OffsetCell;
  readonly name: string;
  /**
   * The attack this look could turn into, or null when the map's preconditions
   * refuse it — in which case the yard shows no Attack button at all (§4.1).
   */
  readonly attack: AttackTarget | null;
  /** Why `attack` is null, for the status line; null when it is not. */
  readonly refusal: string | null;
}

let attackTarget: AttackTarget | null = null;
let viewTarget: ViewTarget | null = null;

/** Records the cell the attack scene should open next. */
export const setAttackTarget = (target: AttackTarget): void => {
  attackTarget = target;
};

/** Takes the pending attack target, clearing it. Null when nothing was set. */
export const consumeAttackTarget = (): AttackTarget | null => {
  const target = attackTarget;
  attackTarget = null;
  return target;
};

/** Records the foreign cell the yard scene should show next. */
export const setViewTarget = (target: ViewTarget): void => {
  viewTarget = target;
};

/**
 * Takes the pending view target, clearing it. Null means the yard scene opens
 * the player's own yard, as it always did.
 */
export const consumeViewTarget = (): ViewTarget | null => {
  const target = viewTarget;
  viewTarget = null;
  return target;
};
