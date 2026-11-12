import { UniqueConstraintViolationException, type FilterQuery } from "@mikro-orm/core";

import type { EntityManager, PostgreSqlDriver } from "@mikro-orm/postgresql";

import {
  AllianceInviteStatus,
  AllianceInviteType,
  AllianceMessageType,
  AllianceRole,
  type AllianceType,
} from "../../enums/Alliance.js";
import { Alliance } from "../../database/models/alliance.model.js";
import { AllianceInvite } from "../../database/models/allianceinvite.model.js";
import { User } from "../../database/models/user.model.js";
import { postgres } from "../../server.js";
import { addAllianceMember, lockAlliance, lockMembership } from "./membership.js";
import { AllianceAction, can } from "./permissions.js";
import { memberLimit } from "./allianceTypes.js";
import { assertMayJoin, assertRejoinAllowed, loadGateSave, lockGateSave } from "./joinGate.js";
import { adOf, assertAdAllows, joinerLevel } from "./allianceAd.js";
import {
  allianceFullErr,
  inviteNotPendingErr,
  mustLeaveAllianceErr,
  invitePendingErr,
  mustLeaveAllianceToAcceptErr,
  permissionErr,
  requestPendingErr,
  userAlreadyInAllianceErr,
} from "../../errors/errors.js";

interface InviteMessage {
  invite_id: number;
  type: AllianceInviteType;
  status: AllianceInviteStatus;
  alliance_id: number;
  alliance_name: string;
  alliance_image: number;
  leader_name: string;
  invited_by_name: string;
  user_id: number;
  user_name: string;
  user_pic_square: string | null;
  base_id: string | null;
  update_at_formatted: string;
}

/**
 * Rows the given player should see in their Invites tab.
 *
 * The inbox is one table read from two sides. A pending row belongs to whoever
 * has to answer it, and resolving it hands the row to whoever opened it, so the
 * status change doubles as the "accepted"/"declined" notice. A leader therefore
 * (or Officer) sees incoming requests plus the outcomes of invites sent; an ordinary
 * player sees incoming invites plus the outcomes of requests they made.
 *
 * @param {User} user - The player whose inbox is being read.
 * @returns {FilterQuery<AllianceInvite>} The visibility clause for that player.
 */
const inboxScope = (user: User): FilterQuery<AllianceInvite> => {
  const asPlayer = {
    user_id: user.userid,
    $or: [
      { type: AllianceInviteType.INVITE, status: AllianceInviteStatus.PENDING },
      { type: AllianceInviteType.REQUEST, status: { $ne: AllianceInviteStatus.PENDING } },
    ],
  };

  const answersRequests = can(user.alliance_role, AllianceAction.ANSWER_REQUEST) && user.alliance_id;

  if (!answersRequests) return asPlayer;

  const asLeader = {
    alliance_id: user.alliance_id,
    $or: [
      { type: AllianceInviteType.REQUEST, status: AllianceInviteStatus.PENDING },
      { type: AllianceInviteType.INVITE, status: { $ne: AllianceInviteStatus.PENDING } },
    ],
  };

  return { $or: [asPlayer, asLeader] };
};

/**
 * Formats a timestamp the way the Invites table expects it.
 *
 * @param {Date} date - The timestamp to format.
 * @returns {string} MM/DD/YYYY.
 */
const formatInviteDate = (date: Date): string => {
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");

  return `${month}/${day}/${date.getFullYear()}`;
};

/**
 * Builds the Invites tab payload for a player, resolving the alliance and player
 * named on each row. Both sides are batched rather than fetched per row.
 *
 * @param {User} user - The player whose inbox is being read.
 * @returns {Promise<InviteMessage[]>} Newest first, as the original listed them.
 */
export const getInviteMessages = async (user: User): Promise<InviteMessage[]> => {
  const invites = await postgres.em.find(AllianceInvite, inboxScope(user), { orderBy: { updated_at: "DESC" }});

  if (invites.length === 0) return [];

  const allianceIds = invites.map((invite) => invite.alliance_id);
  // The players named on each row, and whoever sent each invite.
  const userIds = invites.flatMap((invite) => (invite.invited_by ? [invite.user_id, invite.invited_by] : [invite.user_id]));

  const [alliances, players] = await Promise.all([
    postgres.em.find(Alliance, { id: { $in: allianceIds } }),
    postgres.em.find(
      User,
      { userid: { $in: userIds } },
      { fields: ["userid", "username", "pic_square", "save.baseid"] }
    ),
  ]);

  const alliancesById = new Map(alliances.map((alliance) => [alliance.id, alliance]));
  const playersById = new Map(players.map((player) => [player.userid, player]));

  const messages: InviteMessage[] = [];

  for (const invite of invites) {
    const alliance = alliancesById.get(invite.alliance_id);
    const player = playersById.get(invite.user_id);

    if (!alliance || !player) continue;

    const message: InviteMessage = {
      invite_id: invite.id,
      type: invite.type,
      status: invite.status,
      alliance_id: alliance.id,
      alliance_name: alliance.name,
      alliance_image: alliance.image,
      leader_name: alliance.leader_name,
      // Invites sent before 10 Nov 2026 do not say who sent them: the leader then.
      invited_by_name: (invite.invited_by && playersById.get(invite.invited_by)?.username) || alliance.leader_name,
      user_id: player.userid,
      user_name: player.username,
      user_pic_square: player.pic_square ?? null,
      base_id: player.save?.baseid ?? null,
      update_at_formatted: formatInviteDate(invite.updated_at),
    };

    messages.push(message);
  }

  return messages;
};

/**
 * Clears rows from a player's inbox, scoped through the same visibility clause
 * the listing uses, so ids from another inbox match nothing.
 *
 * An unanswered row is declined rather than destroyed: deleting one is a
 * refusal, and the other side is owed the outcome notice. It still leaves the
 * deleter's view, since a resolved row belongs to the counterparty's. Each
 * statement carries its own status predicate, so a row answered mid-request
 * keeps its outcome.
 *
 * @param {User} user - The player clearing their inbox.
 * @param {number[]} inviteIds - The rows they selected.
 * @returns {Promise<number>} How many rows left their inbox.
 */
export const deleteInviteMessages = async (user: User, inviteIds: number[]) => {
  if (inviteIds.length === 0) return 0;

  const scope = { $and: [inboxScope(user), { id: { $in: inviteIds } }] };

  const deleted = await postgres.em.nativeDelete(AllianceInvite, {
    $and: [scope, { status: { $ne: AllianceInviteStatus.PENDING } }],
  });

  const declined = await postgres.em.nativeUpdate(
    AllianceInvite,
    { $and: [scope, { status: AllianceInviteStatus.PENDING }] },
    { status: AllianceInviteStatus.DECLINED, updated_at: new Date() }
  );

  return deleted + declined;
};

/**
 * Drops every pending exchange a player is part of - requests they sent and invites
 * sent to them.
 *
 * Called when their base changes Map Room version, which makes all of them moot:
 * the accept would be refused anyway, and the row would otherwise sit in a leader's
 * Invites tab looking actionable while failing with a message about someone else's
 * map room. Deleted rather than declined, because nobody decided anything.
 *
 * @param {number} userId - The player whose pending rows are being dropped.
 * @returns {Promise<number>} How many rows were removed.
 */
export const clearPendingInvites = async (userId: number): Promise<number> =>
  await postgres.em.nativeDelete(AllianceInvite, {
    user_id: userId,
    status: AllianceInviteStatus.PENDING,
  });

/**
 * Refuses an alliance that has no room left under its type's member limit.
 *
 * @param {EntityManager} em - EntityManager to count through, so a caller inside a transaction counts within it.
 * @param {number} allianceId - The alliance being filled.
 * @param {AllianceType} type - Its type, read under the alliance lock when the caller holds one.
 */
const checkAllianceSpace = async (em: EntityManager<PostgreSqlDriver>, allianceId: number, type: AllianceType) => {
  const members = await em.count(User, { alliance_id: allianceId });

  if (members >= memberLimit(type)) throw allianceFullErr();
};

/**
 * Opens an exchange between an alliance and a player.
 *
 * @param {Alliance} alliance - The alliance being joined or doing the inviting.
 * @param {number} userId - The player being invited, or making the request.
 * @param {AllianceInviteType} type - Which side opened it.
 * @param {object} opts - `invitedBy`: the Leader or Officer sending an invite;
 *   `em`: an open transaction to write through (the invite's mail lands with it).
 * @returns {Promise<AllianceInvite>} The pending row.
 */
export const openInvite = async (
  alliance: Alliance,
  userId: number,
  type: AllianceInviteType,
  opts: { invitedBy?: number; em?: EntityManager<PostgreSqlDriver> } = {}
): Promise<AllianceInvite> => {
  const em = opts.em ?? postgres.em;

  await checkAllianceSpace(em, alliance.id, alliance.type);

  const invite = new AllianceInvite();
  invite.alliance_id = alliance.id;
  invite.user_id = userId;
  invite.type = type;
  invite.invited_by = opts.invitedBy ?? null;

  try {
    em.persist(invite);
    await em.flush();
  } catch (err) {
    if (!(err instanceof UniqueConstraintViolationException)) throw err;
    throw type === AllianceInviteType.REQUEST ? requestPendingErr() : invitePendingErr();
  }

  return invite;
};

/**
 * Answers a pending exchange.
 *
 * Only the side being asked may answer: an invite is the invited player's to
 * take, a request is the leader's. Accepting joins the player through the
 * membership service inside a transaction, so the row cannot resolve without the
 * membership landing with it.
 *
 * @param {User} user - The player answering.
 * @param {number} inviteId - The row being answered.
 * @param {AllianceInviteStatus} status - Accepted or declined.
 * @returns {Promise<AllianceInvite>} The resolved row.
 */
export const answerInvite = async (user: User, inviteId: number, status: AllianceInviteStatus): Promise<AllianceInvite> => {
  const invite = await postgres.em.findOne(AllianceInvite, { id: inviteId });

  if (!invite) throw permissionErr();

  if (invite.status !== AllianceInviteStatus.PENDING) throw inviteNotPendingErr();

  const answersForAlliance =
    can(user.alliance_role, AllianceAction.ANSWER_REQUEST) && user.alliance_id === invite.alliance_id;

  const isInvite = invite.type === AllianceInviteType.INVITE;
  const canAnswer = isInvite ? invite.user_id === user.userid : answersForAlliance;

  if (!canAnswer) throw permissionErr();

  if (status === AllianceInviteStatus.DECLINED) {
    await resolveInvite(postgres.em, invite, status);

    return invite;
  }

  const alliance = await postgres.em.findOne(Alliance, { id: invite.alliance_id });

  if (!alliance) throw permissionErr();

  const player = await postgres.em.findOne(User, { userid: invite.user_id });

  if (!player) throw permissionErr();

  const isAnswerer = player.userid === user.userid;
  const alreadyInOne = () => (isAnswerer ? mustLeaveAllianceToAcceptErr() : userAlreadyInAllianceErr());

  if (player.alliance_id) throw alreadyInOne();

  // The gate again: the player may have left the world or lost the Observatory
  // since the invite or request was sent.
  const who = isAnswerer ? undefined : player.username;

  assertMayJoin(await loadGateSave(postgres.em, player), { allianceWorld: alliance.world_id, who });

  // Everything above was read outside any lock, so it is checked again here
  // under the alliance's lock and the player's. Without that, a player
  // accepting two invites at once (or accepting one while their request
  // elsewhere is accepted, or while founding an alliance) passed the
  // "not in an alliance" check twice, and the second join silently moved them
  // (alliance audit, 10 Nov 2026).
  await postgres.em.transactional(async (em) => {
    const locked = await lockAlliance(em, alliance.id);

    if (!locked) throw permissionErr();

    if (!isInvite) {
      const answerer = await lockMembership(em, user.userid);
      const stillMay =
        answerer?.alliance_id === alliance.id && can(answerer.alliance_role, AllianceAction.ANSWER_REQUEST);

      if (!stillMay) throw permissionErr();
    }

    const membership = await lockMembership(em, player.userid);

    if (!membership) throw permissionErr();
    if (membership.alliance_id) throw alreadyInOne();
    assertRejoinAllowed(membership.alliance_left_at, new Date(), isAnswerer ? undefined : player.username);

    // The gate once more, on the main save locked until the join lands: leaving
    // the world takes the same lock first, so the two can never cross.
    assertMayJoin(await lockGateSave(em, player.userid), { allianceWorld: alliance.world_id, who });

    await checkAllianceSpace(em, alliance.id, locked.type);
    await resolveInvite(em, invite, status);
    await addAllianceMember(player, alliance, AllianceRole.MEMBER, AllianceMessageType.JOINED, em);
  });

  return invite;
};

/**
 * Joins an Open alliance at once (the marketplace's Join, design v5 §7a).
 *
 * The same locked path as accepting an invite: the alliance's row, then the
 * player's, then their main save, so two joins at once, a join while leaving
 * the world, or a join into the last seat can never both land. The ad is read
 * again under the alliance lock, so a Leader switching to Ask to join or
 * raising the minimum level in between is obeyed.
 *
 * @param {User} user - The player joining.
 * @param {Alliance} alliance - The alliance, read before the locks.
 */
export const joinOpenAlliance = async (user: User, alliance: Alliance): Promise<void> => {
  await postgres.em.transactional(async (em) => {
    const locked = await lockAlliance(em, alliance.id);

    if (!locked) throw permissionErr();

    const [row] = await em.execute<{ join_mode: Alliance["join_mode"]; min_level: number }[]>(
      `SELECT join_mode, min_level FROM bym.alliance WHERE id = ?`,
      [alliance.id]
    );
    const ad = adOf({ ...row!, language: null, time_zone: null });

    if (ad.join_mode !== "open") throw permissionErr();
    assertAdAllows(ad, await joinerLevel(em, user.userid));

    const membership = await lockMembership(em, user.userid);

    if (!membership) throw permissionErr();
    if (membership.alliance_id) throw mustLeaveAllianceErr();
    assertRejoinAllowed(membership.alliance_left_at, new Date());

    assertMayJoin(await lockGateSave(em, user.userid), { allianceWorld: alliance.world_id });

    await checkAllianceSpace(em, alliance.id, locked.type);
    await addAllianceMember(user, alliance, AllianceRole.MEMBER, AllianceMessageType.JOINED, em);
  });
};

/**
 * Marks a pending exchange accepted or declined. The write only lands while the
 * row is still pending, so two answers sent at once resolve it exactly once.
 *
 * @param {EntityManager} em - EntityManager to write through: the accept's transaction, or the request's.
 * @param {AllianceInvite} invite - The row being answered.
 * @param {AllianceInviteStatus} status - Accepted or declined.
 * @throws {ClientSafeError} When the row was answered first by another request.
 */
const resolveInvite = async (
  em: EntityManager<PostgreSqlDriver>,
  invite: AllianceInvite,
  status: AllianceInviteStatus
) => {
  const updated_at = new Date();

  const resolved = await em.nativeUpdate(
    AllianceInvite,
    { id: invite.id, status: AllianceInviteStatus.PENDING },
    { status, updated_at }
  );

  if (resolved === 0) throw inviteNotPendingErr();

  invite.status = status;
  invite.updated_at = updated_at;
};
