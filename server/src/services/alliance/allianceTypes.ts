import { ALLIANCE_TYPES, TYPE_SWITCH } from "../../config/AllianceConfig.js";
import { AllianceType } from "../../enums/Alliance.js";

const DAY_MS = 24 * 3600 * 1000;

/** Why a type switch is refused, for the web to word. */
export type TypeSwitchRefusal = "sameType" | "tooManyMembers" | "tooManyOfficers" | "waitForDownSwitch";

/** What switching to one type would do, as the switch screen shows it before the leader confirms. */
export interface TypeSwitchQuote {
  type: AllianceType;
  /** True for a bigger member limit: free, at once, nothing lost. */
  up: boolean;
  refusal: TypeSwitchRefusal | null;
  /** Unspent points after the switch (stars reset, so spent points become 0). */
  points_after: number;
  /** Epoch seconds when a waiting down switch becomes possible; null when it is not waiting. */
  available_at: number | null;
}

/** The state of an alliance a switch is worked out from. */
export interface TypeSwitchState {
  type: AllianceType;
  points: number;
  points_spent: number;
  type_changed_at: Date | null;
  members: number;
  officers: number;
}

/** Most members a type allows, the leader included. */
export const memberLimit = (type: AllianceType): number => ALLIANCE_TYPES[type].members;

/** Most Officers a type allows. */
export const officerLimit = (type: AllianceType): number => ALLIANCE_TYPES[type].officers;

/** True when `to` allows more members than `from`. */
export const isUpSwitch = (from: AllianceType, to: AllianceType): boolean => memberLimit(to) > memberLimit(from);

/**
 * The points an alliance has after switching type. Stars reset, so everything
 * comes back as unspent points. Up: all of it, converted by the member-limit
 * ratio. Down: the kept shares (`TYPE_SWITCH`), then converted. Rounded down.
 *
 * Example (design v5 §4): a Midas with 1,200 spent and 100 unspent going down
 * would keep 600 + 100; going up to Conquest it keeps all 1,300 x 2 = 2,600.
 *
 * @param {Pick<TypeSwitchState, "type" | "points" | "points_spent">} state - The alliance before the switch.
 * @param {AllianceType} to - The type being switched to.
 * @returns {number} Unspent points after the switch.
 */
export const pointsAfterSwitch = (
  state: Pick<TypeSwitchState, "type" | "points" | "points_spent">,
  to: AllianceType
): number => {
  const ratio = memberLimit(to) / memberLimit(state.type);
  const kept = isUpSwitch(state.type, to)
    ? state.points + state.points_spent
    : state.points * TYPE_SWITCH.downKeepUnspent + state.points_spent * TYPE_SWITCH.downKeepSpent;

  return Math.floor(kept * ratio);
};

/**
 * What switching to `to` would do now, or why it is refused. The leader
 * cannot pick a type whose member limit is below the current member count,
 * nor one whose Officer limit is below the current Officers (demote first). A
 * down switch waits `TYPE_SWITCH.downWaitDays` after the last switch; founding
 * does not start that wait, so a new alliance that picked too big a type can
 * step down at once.
 *
 * @param {TypeSwitchState} state - The alliance as it stands.
 * @param {AllianceType} to - The type being asked for.
 * @param {Date} now - The current time.
 * @returns {TypeSwitchQuote} The outcome.
 */
export const quoteTypeSwitch = (state: TypeSwitchState, to: AllianceType, now: Date): TypeSwitchQuote => {
  const up = isUpSwitch(state.type, to);
  const quote: TypeSwitchQuote = {
    type: to,
    up,
    refusal: null,
    points_after: pointsAfterSwitch(state, to),
    available_at: null,
  };

  if (to === state.type) return { ...quote, refusal: "sameType", points_after: state.points };
  if (state.members > memberLimit(to)) return { ...quote, refusal: "tooManyMembers" };
  if (state.officers > officerLimit(to)) return { ...quote, refusal: "tooManyOfficers" };

  if (!up && state.type_changed_at) {
    const availableAt = state.type_changed_at.getTime() + TYPE_SWITCH.downWaitDays * DAY_MS;

    if (now.getTime() < availableAt) {
      return { ...quote, refusal: "waitForDownSwitch", available_at: Math.ceil(availableAt / 1000) };
    }
  }

  return quote;
};

/**
 * The quote for every type the alliance is not, for the switch screen.
 *
 * @param {TypeSwitchState} state - The alliance as it stands.
 * @param {Date} now - The current time.
 * @returns {TypeSwitchQuote[]} One per other type, smallest first.
 */
export const typeSwitchOptions = (state: TypeSwitchState, now: Date): TypeSwitchQuote[] =>
  Object.values(AllianceType)
    .filter((type) => type !== state.type)
    .sort((a, b) => memberLimit(a) - memberLimit(b))
    .map((type) => quoteTypeSwitch(state, type, now));
