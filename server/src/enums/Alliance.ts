/**
 * Role a player holds within their alliance. Permissions
 * are derived from this in code rather than stored.
 * @enum {string}
 */
export enum AllianceRole {
  LEADER = "leader",
  OFFICER = "officer",
  MEMBER = "member",
}

/**
 * The three alliance types (beta 7 alliances design v5 §4). The leader picks
 * one; each has its own member and Officer limits (`ALLIANCE_TYPES`).
 * @enum {string}
 */
export enum AllianceType {
  MIDAS = "midas",
  CONQUEST = "conquest",
  FORTRESS = "fortress",
}

/**
 * How one alliance has flagged another - Foe, Neutral or Ally.
 *
 * @enum {number}
 */
export enum AllianceStance {
  HOSTILE = -1,
  NEUTRAL = 0,
  FRIENDLY = 1,
}

/**
 * What a row in the alliance feed represents.
 *
 * @enum {string}
 */
export enum AllianceMessageType {
  MESSAGE = "message",
  JOINED = "joined",
  LEFT = "left",
  KICKED = "kicked",
  PROMOTED = "promoted",
  CREATED = "created",
  RELATIONSHIP = "relationship",
  OFFICER = "officer",
  DEMOTED = "demoted",
  TYPE_CHANGED = "type_changed",
  RENAMED = "renamed",
  TAKEOVER = "takeover",
  /** A member's yard or outpost was attacked (beta 7 design v5 §12): an automatic line with Show on map. */
  UNDER_ATTACK = "under_attack",
  /** Two stars of a constellation lit (design v5 §9a); body `{"id","step"}`. */
  STAR_LIT = "star_lit",
  /** A weekly goal added (design v5 §8); body `{"kind","tier"}`. */
  GOAL_SET = "goal_set",
  /** A weekly goal reached; body `{"kind","tier","points"}`. */
  GOAL_DONE = "goal_done",
  /** A member suggested the next step of a constellation (design v5 §9a, PROPOSED); body `{"id","step"}`. */
  STAR_SUGGESTED = "star_suggested",
  /** A member asked mates for resources (design v5 §12b); body `{"request","amounts","reason"}`; chat shows Give. */
  TRADE_ASK = "trade_ask",
  /** A trade done; body `{"to","arrived"}`. */
  TRADE_DONE = "trade_done",
}

/**
 * Which side opened the exchange. A leader inviting a player and a player asking
 * to join an alliance are the same record; only the originator differs, and that
 * decides who sees it in their Invites tab and what the dialog offers them.
 *
 * @enum {string}
 */
export enum AllianceInviteType {
  INVITE = "invite",
  REQUEST = "request",
}

/**
 * Where an invite stands. Resolving one is what notifies the originator: a
 * pending row is shown to the counterparty, and once accepted or declined the
 * same row becomes the outcome notice shown back to whoever started it.
 *
 * @enum {string}
 */
export enum AllianceInviteStatus {
  PENDING = "pending",
  ACCEPTED = "accepted",
  DECLINED = "declined",
}

