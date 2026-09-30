import type { EntityManager } from "@mikro-orm/core";
import { Message } from "../../database/models/message.model.js";
import { Save } from "../../database/models/save.model.js";
import { BaseType } from "../../enums/Base.js";
import { MapRoomVersion } from "../../enums/MapRoom.js";
import { MessageType } from "../../enums/MessageType.js";
import { spanText } from "./truceRules.js";
import type { RelocatePrice } from "../maproom/v2/relocateRules.js";

/**
 * The rules of an invitation to move (#205): a player offers one of their own
 * Map Room 2 outposts to another player, whose main yard may then move onto it
 * (Flash's `migraterequest`, `PopupInfoMine.as:297-343`, `MapRoom.as:214-305`).
 * The owner's decisions of 2026-09-30:
 *
 * - The invitation is the `migraterequest` message itself: its sender invites,
 *   its recipient is invited, `baseid` names the outpost, `coords` and
 *   `worldid` say where, and `migratestate` says where it stands. No table of
 *   its own.
 * - It waits {@link INVITE_LIFETIME} for an answer, then lapses; and it is void
 *   once the outpost is no longer its sender's. Both are read, not written:
 *   {@link inviteState}. The routes that take an outpost from its owner also
 *   write `void` ({@link voidOutpostInvites}), so an outpost won back does not
 *   bring an old invitation back to life.
 * - An outpost holds at most one invitation still waiting.
 * - Accepting costs the invited player {@link INVITE_PRICE}, charged by the
 *   server, and starts their relocation cooldown. It is refused softly, the
 *   invitation left open, while either yard is under attack, the invited
 *   player is in an alliance or cooling down, or cannot pay.
 * - The one who invited gets nothing back: the outpost, its buildings and its
 *   housed monsters are gone. The game tells them of the answer
 *   ({@link inviteNoticeText}).
 */

/** How long an invitation waits for its answer, in seconds: 7 days. */
export const INVITE_LIFETIME = 7 * 24 * 60 * 60;

/** What accepting costs: 1,200 Shiny or 10,000,000 of each resource (`MapRoom.as:271-272`). */
export const INVITE_PRICE: RelocatePrice = { shiny: 1_200, resources: 10_000_000 };

/** The notices the game writes to the one who invited (`userid` 0, as `outpostNotices.ts` writes them). */
export const INVITE_ACCEPTED = "inviteaccepted";
export const INVITE_DECLINED = "invitedeclined";

/** Where an invitation stands. `expired` and `void` are read, never stored, but for `void` ({@link voidOutpostInvites}). */
export enum InviteState {
  REQUESTED = "requested",
  ACCEPTED = "accepted",
  REJECTED = "rejected",
  REVOKED = "revoked",
  EXPIRED = "expired",
  VOID = "void",
}

/** The invitation as far as the rules need it: its `migraterequest` message. */
export type InviteMessage = Pick<Message, "userid" | "updatetime" | "migratestate">;

/** The outpost's save as far as the rules need it. */
export type InviteOutpost = { saveuserid: number; type: string } | null;

/** The last moment an invitation can be answered, in unix seconds. */
export const inviteLapsesAt = (invite: Pick<Message, "updatetime">) => Number(invite.updatetime) + INVITE_LIFETIME;

/** Whether the outpost is still its inviter's: it exists, is an outpost, and is theirs. */
export const outpostStillTheirs = (invite: Pick<Message, "userid">, outpost: InviteOutpost) =>
  outpost !== null && outpost.type === BaseType.OUTPOST && outpost.saveuserid === invite.userid;

/**
 * Where an invitation stands at `now`: as stored once answered, withdrawn or
 * voided; while it waits, lapsed after {@link INVITE_LIFETIME}, and void once
 * the outpost is not its inviter's.
 */
export const inviteState = (invite: InviteMessage, outpost: InviteOutpost, now: number): InviteState => {
  const stored = (invite.migratestate ?? InviteState.REQUESTED) as InviteState;
  if (stored !== InviteState.REQUESTED) return stored;
  if (inviteLapsesAt(invite) <= now) return InviteState.EXPIRED;
  if (!outpostStillTheirs(invite, outpost)) return InviteState.VOID;
  return InviteState.REQUESTED;
};

/** The filter for invitations still waiting at `now`, lapse included; the outpost's owner is checked apart. */
export const openInviteFilter = (now: number) => ({
  messagetype: MessageType.MIGRATE_REQUEST,
  migratestate: InviteState.REQUESTED,
  updatetime: { $gt: now - INVITE_LIFETIME },
});

/**
 * Writes `void` on every invitation still waiting on this outpost: it has
 * changed hands, or is gone (a takeover, the owner's own move onto it, the
 * owner leaving the world).
 */
export const voidOutpostInvites = (em: EntityManager, baseid: string) =>
  em.nativeUpdate(
    Message,
    { messagetype: MessageType.MIGRATE_REQUEST, migratestate: InviteState.REQUESTED, baseid },
    { migratestate: InviteState.VOID }
  );

/** The same, for every outpost a player gives up at once (leaving the world). */
export const voidInvitesFrom = (em: EntityManager, userid: number) =>
  em.nativeUpdate(
    Message,
    { messagetype: MessageType.MIGRATE_REQUEST, migratestate: InviteState.REQUESTED, userid },
    { migratestate: InviteState.VOID }
  );

/**
 * The invitations still waiting on a player's own outposts, by base id: the
 * thread each is in (the map cell's `pi`, Flash's `_invitePendingID`,
 * `MapRoomCell.as:347`). The outposts are theirs, so none is void.
 */
export const pendingInvitesOn = async (
  em: EntityManager,
  userid: number,
  baseids: readonly string[],
  now: number
): Promise<Map<string, number>> => {
  if (baseids.length === 0) return new Map();
  const invites = await em.find(Message, { ...openInviteFilter(now), userid, baseid: { $in: [...baseids] } });
  return new Map(invites.map((invite) => [invite.baseid!, invite.threadid]));
};

/** A thread's invitation: its latest `migraterequest`, or null. */
export const findThreadInvite = async (em: EntityManager, threadid: number): Promise<Message | null> => {
  const [invite] = await em.find(
    Message,
    { threadid, messagetype: MessageType.MIGRATE_REQUEST },
    { orderBy: { updatetime: "DESC", createdAt: "DESC" }, limit: 1 }
  );
  return invite ?? null;
};

/** The save of an invitation's outpost as it is now, or null when it is gone. */
export const findInviteOutpost = async (em: EntityManager, baseid: string | null): Promise<InviteOutpost> => {
  if (!baseid) return null;
  const save = await em.findOne(Save, { baseid }, { fields: ["saveuserid", "type"] });
  return save ? { saveuserid: save.saveuserid, type: save.type } : null;
};

/**
 * The outposts of many invitations at once, by base id, for the thread list
 * and the thread: each as {@link findInviteOutpost} would answer.
 */
export const findInviteOutposts = async (
  em: EntityManager,
  baseids: readonly (string | null)[]
): Promise<Map<string, InviteOutpost>> => {
  const wanted = [...new Set(baseids.filter((id): id is string => !!id))];
  const saves = wanted.length
    ? await em.find(Save, { baseid: { $in: wanted } }, { fields: ["baseid", "saveuserid", "type"] })
    : [];
  return new Map(saves.map((save) => [save.baseid, { saveuserid: save.saveuserid, type: save.type }]));
};

/**
 * What the mail routes add to an invitation for the client: where it stands
 * now (`migratestate`, lapse and void included) and when it lapses
 * (`migrateexpire`, unix seconds).
 */
export const inviteFields = (invite: Message, outposts: Map<string, InviteOutpost>, now: number) => ({
  migratestate: inviteState(invite, (invite.baseid && outposts.get(invite.baseid)) || null, now),
  migrateexpire: inviteLapsesAt(invite),
});

/* ── Refusals ───────────────────────────────────────────────────────────── */

/** Why an invitation cannot be sent, or accepted now. */
export type InviteRefusal =
  | "notYourOutpost"
  | "self"
  | "notMapRoom2"
  | "otherWorld"
  | "inAlliance"
  | "coolingDown"
  | "underAttack"
  | "noHomeCell"
  | "notEnoughShiny"
  | "notEnoughResources";

/** The soft refusal the routes send: `{ error: 1, message, reason }`, and `retryat` when there is a wait. */
export interface InviteSoftRefusal {
  error: 1;
  message: string;
  reason: InviteRefusal;
  retryat?: number;
}

/** The inviter's side of the words. */
const TO_INVITER: Partial<Record<InviteRefusal, string>> = {
  notYourOutpost: "That outpost is not yours to offer.",
  self: "You cannot invite yourself.",
  notMapRoom2: "They are not on Map Room 2, so they cannot move to your outpost.",
  otherWorld: "They are in another world, so they cannot move to your outpost.",
  inAlliance: "They are in an alliance. They must leave it before they can move to your outpost.",
};

/** The invited player's side (`msg_mustleavealliance`, `movebase_warning`, `map_rel_res`). */
const TO_INVITEE: Partial<Record<InviteRefusal, string>> = {
  notMapRoom2: "Only a Map Room 2 yard can move to an outpost.",
  otherWorld: "That outpost is in another world. You can only move within your own.",
  inAlliance: "You must first leave your Alliance to accept this invitation.",
  underAttack: "Your yard or that outpost is under attack. Try again when the attack is over.",
  noHomeCell: "Your main yard has no place on the map to move from.",
  notEnoughShiny: "You do not have enough Shiny.",
  notEnoughResources: "You don't have enough resources to relocate.",
};

/**
 * The soft refusal for a reason: the inviter's words when sending, the
 * invited player's when accepting. A cooldown says when it ends.
 */
export const inviteRefusal = (
  reason: InviteRefusal,
  side: "inviter" | "invitee",
  now = 0,
  retryat?: number
): InviteSoftRefusal => {
  if (reason === "coolingDown" && retryat !== undefined) {
    return {
      error: 1,
      message: `You have already moved your main yard. Try again in ${spanText(Math.max(1, retryat - now))}.`,
      reason,
      retryat,
    };
  }
  const words = (side === "inviter" ? TO_INVITER : TO_INVITEE)[reason] ?? TO_INVITEE[reason] ?? TO_INVITER[reason];
  return { error: 1, message: words ?? "The invitation cannot go ahead.", reason };
};

/** The invited player as the rules need them. */
export interface InvitedPlayer {
  userid: number;
  allianceId: number | null | undefined;
  /** Their main save's `mapversion` and `worldid`. */
  mapVersion: number | null | undefined;
  worldid: string | null | undefined;
}

/**
 * Whether a player may be invited to the outpost. `outpostWorld` is the world
 * the outpost's cell is in; `ownsOutpost` answers `relocateTargetRefusal` for
 * the inviter, who must own it as they would to move onto it themselves.
 */
export const inviteSendRefusal = (input: {
  inviterId: number;
  ownsOutpost: boolean;
  outpostWorld: string | null | undefined;
  invited: InvitedPlayer;
}): InviteRefusal | null => {
  const { inviterId, ownsOutpost, outpostWorld, invited } = input;
  if (!ownsOutpost) return "notYourOutpost";
  if (invited.userid === inviterId) return "self";
  if (invited.mapVersion !== MapRoomVersion.V2) return "notMapRoom2";
  if (!outpostWorld || invited.worldid !== outpostWorld) return "otherWorld";
  if (invited.allianceId) return "inAlliance";
  return null;
};

/**
 * Whether the invited player may move now (checked again at accept, whatever
 * held when it was sent). The charge comes after, `chargeRelocation` at
 * {@link INVITE_PRICE}.
 */
export const inviteAcceptRefusal = (input: {
  invited: InvitedPlayer;
  outpostWorld: string | null | undefined;
  cantMoveTill: number | null | undefined;
  underAttack: boolean;
  hasHomeCell: boolean;
  now: number;
}): InviteRefusal | null => {
  const { invited, outpostWorld, cantMoveTill, underAttack, hasHomeCell, now } = input;
  if (invited.mapVersion !== MapRoomVersion.V2) return "notMapRoom2";
  if (!outpostWorld || invited.worldid !== outpostWorld) return "otherWorld";
  if (invited.allianceId) return "inAlliance";
  if (cantMoveTill && cantMoveTill > now) return "coolingDown";
  if (!hasHomeCell) return "noHomeCell";
  if (underAttack) return "underAttack";
  return null;
};

/** The notice to the one who invited: "Bramble accepted your invitation to (243, 206)". */
export const inviteNoticeText = (
  invitedName: string,
  cell: { x: number; y: number },
  accepted: boolean
): { subject: string; message: string } =>
  accepted
    ? {
        subject: `${invitedName} accepted your invitation to (${cell.x}, ${cell.y})`,
        message: "Their main yard has moved onto your outpost, which is theirs now, with everything that was on it gone.",
      }
    : {
        subject: `${invitedName} declined your invitation to (${cell.x}, ${cell.y})`,
        message: "Your outpost stays yours. You can invite someone else to it.",
      };
