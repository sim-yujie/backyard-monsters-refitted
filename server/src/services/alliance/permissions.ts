import { AllianceRole } from "../../enums/Alliance.js";

/**
 * Everything a rank inside an alliance may or may not do.
 * @enum {string}
 */
export enum AllianceAction {
  /** Invite a player. */
  INVITE = "invite",
  /** Accept or refuse a player's request to join. */
  ANSWER_REQUEST = "answerRequest",
  /** Kick a Member. */
  KICK_MEMBER = "kickMember",
  /** Kick an Officer. */
  KICK_OFFICER = "kickOfficer",
  /** Make a Member an Officer, or an Officer a Member. */
  SET_RANK = "setRank",
  /** Hand leadership to someone else. */
  HAND_OVER = "handOver",
  /** Edit the description (the marketplace ad). */
  EDIT_AD = "editAd",
  /** Pick the shield. */
  PICK_SHIELD = "pickShield",
  /** Rename the alliance. */
  RENAME = "rename",
  /** Switch the alliance type. */
  SWITCH_TYPE = "switchType",
  /** Disband the alliance. */
  DISBAND = "disband",
  /** Mark another alliance Foe / Neutral / Ally (left out of beta 7; the route stays). */
  SET_RELATIONSHIP = "setRelationship",
  /** List unaffiliated players to invite. */
  SUGGESTED_MEMBERS = "suggestedMembers",
}

const LEADER_ONLY = [AllianceRole.LEADER] as const;
const LEADER_AND_OFFICERS = [AllianceRole.LEADER, AllianceRole.OFFICER] as const;

/**
 * The one permission table (alliance audit improvement 11; design v5 §6).
 * Every alliance controller and service asks `can` rather than comparing a
 * role by hand. Members may chat, leave and report, which need no row here.
 *
 * Members inviting friends with an Officer's approval (design v5 §6) is not
 * built: the audit's improvement 10 suggests dropping it for a share link, and
 * the owner has not chosen. Until then only the Leader and Officers invite.
 */
export const ALLIANCE_PERMISSIONS: Record<AllianceAction, readonly AllianceRole[]> = {
  [AllianceAction.INVITE]: LEADER_AND_OFFICERS,
  [AllianceAction.ANSWER_REQUEST]: LEADER_AND_OFFICERS,
  [AllianceAction.KICK_MEMBER]: LEADER_AND_OFFICERS,
  [AllianceAction.KICK_OFFICER]: LEADER_ONLY,
  [AllianceAction.SET_RANK]: LEADER_ONLY,
  [AllianceAction.HAND_OVER]: LEADER_ONLY,
  [AllianceAction.EDIT_AD]: LEADER_AND_OFFICERS,
  [AllianceAction.PICK_SHIELD]: LEADER_ONLY,
  [AllianceAction.RENAME]: LEADER_ONLY,
  [AllianceAction.SWITCH_TYPE]: LEADER_ONLY,
  [AllianceAction.DISBAND]: LEADER_ONLY,
  [AllianceAction.SET_RELATIONSHIP]: LEADER_ONLY,
  [AllianceAction.SUGGESTED_MEMBERS]: LEADER_AND_OFFICERS,
};

/**
 * Whether a rank may do something.
 *
 * @param {AllianceRole | null | undefined} role - The player's rank; none for a player outside the alliance.
 * @param {AllianceAction} action - What they want to do.
 * @returns {boolean} True when the table allows it.
 */
export const can = (role: AllianceRole | null | undefined, action: AllianceAction): boolean =>
  Boolean(role) && ALLIANCE_PERMISSIONS[action].includes(role!);

/**
 * Whether one rank may kick another. Nobody kicks the Leader; Officers kick
 * only Members (owner: "Officers cannot kick Officers or the Leader").
 *
 * @param {AllianceRole | null | undefined} actor - The kicker's rank.
 * @param {AllianceRole | null | undefined} target - The rank of the player being kicked.
 * @returns {boolean} True when the kick is allowed.
 */
export const canKick = (actor: AllianceRole | null | undefined, target: AllianceRole | null | undefined): boolean => {
  if (target === AllianceRole.MEMBER) return can(actor, AllianceAction.KICK_MEMBER);
  if (target === AllianceRole.OFFICER) return can(actor, AllianceAction.KICK_OFFICER);

  return false;
};

/**
 * Every action a rank may take, for the web to show or hide buttons.
 *
 * @param {AllianceRole | null | undefined} role - The player's rank.
 * @returns {AllianceAction[]} The allowed actions.
 */
export const allowedActions = (role: AllianceRole | null | undefined): AllianceAction[] =>
  Object.values(AllianceAction).filter((action) => can(role, action));
