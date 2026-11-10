import { EntityManager, PostgreSqlDriver } from "@mikro-orm/postgresql";

import { AllianceMessageType, AllianceRole, AllianceType } from "../../enums/Alliance.js";
import { Alliance } from "../../database/models/alliance.model.js";
import { User } from "../../database/models/user.model.js";
import { postgres } from "../../server.js";
import { disconnectAllianceChat } from "../../chat/chatControl.js";
import { invalidateAllianceSight, invalidatePlayerSight } from "../maproom/sight/sightService.js";
import { announceShout, emitShout, type ShoutDraft } from "./allianceMessages.js";
import { AllianceAction, can, canKick } from "./permissions.js";
import { officerLimit } from "./allianceTypes.js";
import {
  alreadyInAllianceErr,
  cannotKickErr,
  cannotPromoteErr,
  leaderMustTransferErr,
  officerSeatsFullErr,
  permissionErr,
} from "../../errors/errors.js";

type EntryShout = AllianceMessageType.CREATED | AllianceMessageType.JOINED;
/** The ranks `setAllianceRank` moves a player between. */
type Rank = AllianceRole.OFFICER | AllianceRole.MEMBER;
type ExitShout = AllianceMessageType.KICKED | AllianceMessageType.LEFT;

type Em = EntityManager<PostgreSqlDriver>;

/** A player's membership as the database holds it right now. */
export interface Membership {
  alliance_id: number | null;
  alliance_role: AllianceRole | null;
}

/*
 * Who is in which alliance changes only inside a transaction that first locks
 * the alliance row, then the player rows it reads (lockAlliance, then
 * lockMembership). The checks run again under those locks, because the copies a
 * request loaded may already be stale: two requests from the same player, or
 * from a player and their leader, could otherwise both pass a check made
 * outside and then overwrite each other (alliance audit, 10 Nov 2026). Taking
 * the locks in that one order keeps two such transactions from deadlocking.
 */

/** An alliance row as read under its lock. */
export interface LockedAlliance {
  id: number;
  type: AllianceType;
}

/**
 * Locks an alliance's row until the transaction ends and reads its type, which
 * sets the member and Officer limits, from the database.
 *
 * @param {Em} em - The transaction's EntityManager.
 * @param {number} allianceId - The alliance to lock.
 * @returns {Promise<LockedAlliance | null>} Null when the alliance no longer exists (disbanded).
 */
export const lockAlliance = async (em: Em, allianceId: number): Promise<LockedAlliance | null> => {
  const [row] = await em.execute<LockedAlliance[]>(
    `SELECT id, type FROM bym.alliance WHERE id = ? FOR UPDATE`,
    [allianceId]
  );

  return row ?? null;
};

/**
 * Locks a player's row until the transaction ends and reads their membership
 * from the database, not from any copy loaded earlier in the request.
 *
 * @param {Em} em - The transaction's EntityManager.
 * @param {number} userid - The player to lock.
 * @returns {Promise<Membership | null>} Their membership, or null when the player does not exist.
 */
export const lockMembership = async (em: Em, userid: number): Promise<Membership | null> => {
  const [row] = await em.execute<Membership[]>(
    `SELECT alliance_id, alliance_role FROM bym."user" WHERE userid = ? FOR UPDATE`,
    [userid]
  );

  return row ?? null;
};

/**
 * Adds a user to an alliance with the given role.
 *
 * The write goes through nativeUpdate so the caller may hand in the EntityManager
 * of an open transaction, whose identity map does not hold the passed user. The
 * in-memory entity is synced to match once the write lands.
 *
 * The write only lands on a player with no alliance, so the database itself
 * refuses a second join, whatever the timing and however many server processes
 * there are. Call it inside a transaction, so a refusal also undoes whatever the
 * caller wrote before it (the new alliance, the accepted invite).
 *
 * @param {User} user - The user joining.
 * @param {Alliance} alliance - The alliance being joined.
 * @param {AllianceRole} role - The role to assign the user.
 * @param {EntryShout | null} shoutType - CREATED for a founder, JOINED for a new member, or null to raise none.
 * @param {EntityManager} em - EntityManager to write through, defaulting to the request's.
 * @throws {ClientSafeError} When the player is already in an alliance.
 */
export const addAllianceMember = async (
  user: User,
  alliance: Alliance,
  role: AllianceRole,
  shoutType: EntryShout | null,
  em: Em = postgres.em
) => {
  const { id } = alliance;

  const joined = await em.nativeUpdate(
    User,
    { userid: user.userid, alliance_id: null },
    { alliance_id: id, alliance_role: role }
  );

  if (joined === 0) throw alreadyInAllianceErr();

  user.alliance_id = id;
  user.alliance_role = role;

  if (shoutType) await emitShout({ allianceId: id, author: user, type: shoutType, body: "", em });

  // A Map Room 2 fog of war sight cached before this join is missing the
  // alliance's shared sight, and the alliance's own cache is missing this
  // member's (issue #329, `docs/design/fog-of-war.md` §9).
  await Promise.all([invalidatePlayerSight(user.userid), invalidateAllianceSight(id)]);
};

/**
 * Removes a user from their alliance, disbanding it when no one else remains.
 *
 * Every rule is checked again under the locks: the player must still be in
 * this alliance (they may have left and joined another since the request read
 * them), a leader may only go once no one else remains, and a kick needs the
 * kicker to still hold a rank that may kick the player's rank (`canKick`). The count that decides a disband is taken under the
 * alliance lock too, so a player accepted at the same moment is either counted
 * or refused, never left behind in a deleted alliance.
 *
 * @param {User} user - The user leaving or being removed.
 * @param {Alliance} alliance - The alliance they belong to.
 * @param {ExitShout} shoutType - KICKED when removed by a leader, LEFT when they chose to go.
 * @param {User} kickedBy - The Leader or Officer doing the kick, for KICKED.
 * @returns {Promise<boolean>} True if the alliance was disbanded (last member out).
 * @throws {ClientSafeError} When the user is no longer in it, a leader still has members, or the kicker no longer leads.
 */
export const removeAllianceMember = async (
  user: User,
  alliance: Alliance,
  shoutType: ExitShout,
  kickedBy?: User
) => {
  const disbanded = await postgres.em.transactional(async (em) => {
    if (!(await lockAlliance(em, alliance.id))) throw permissionErr();

    const kicker = kickedBy ? await lockMembership(em, kickedBy.userid) : null;

    if (kickedBy && kicker?.alliance_id !== alliance.id) throw cannotKickErr();

    const membership = await lockMembership(em, user.userid);

    if (membership?.alliance_id !== alliance.id) throw kickedBy ? cannotKickErr() : permissionErr();

    if (kickedBy && !canKick(kicker?.alliance_role, membership.alliance_role)) throw cannotKickErr();

    const remaining = await em.count(User, { alliance_id: alliance.id, userid: { $ne: user.userid } });

    if (membership.alliance_role === AllianceRole.LEADER && remaining > 0) {
      throw kickedBy ? cannotKickErr() : leaderMustTransferErr(alliance.name);
    }

    await em.nativeUpdate(User, { userid: user.userid }, { alliance_id: null, alliance_role: null });

    if (remaining === 0) await em.nativeDelete(Alliance, { id: alliance.id });

    return remaining === 0;
  });

  user.alliance_id = null;
  user.alliance_role = null;

  // The player's own sight no longer shares the alliance's, and the
  // alliance's cached union no longer includes them (issue #329,
  // `docs/design/fog-of-war.md` §9).
  await Promise.all([invalidatePlayerSight(user.userid), invalidateAllianceSight(alliance.id)]);

  if (!disbanded) {
    const shout: ShoutDraft = {
      allianceId: alliance.id,
      author: user,
      type: shoutType,
      body: "",
    };

    await announceShout(shout);
  }

  await disconnectAllianceChat(user.userid);

  return disbanded;
};

/**
 * Leaving the world is leaving the alliance (owner, 10 Nov 2026): an alliance
 * lives in one world. A member or Officer simply leaves; a leader alone
 * disbands it; a leader with others is refused (`leaderMustTransferErr`)
 * before anything about the world changes, so they hand over first.
 *
 * @param {User} user - The player about to leave their world.
 * @returns {Promise<void>} Once they are out of any alliance.
 */
export const leaveAllianceForWorldChange = async (user: User): Promise<void> => {
  if (!user.alliance_id) return;

  const alliance = await postgres.em.findOne(Alliance, { id: user.alliance_id });

  if (!alliance) {
    user.alliance_id = null;
    user.alliance_role = null;
    return;
  }

  await removeAllianceMember(user, alliance, AllianceMessageType.LEFT);
};

/**
 * Hands leadership of an alliance to one of its Officers or Members.
 *
 * The two swap: the new leader's old rank goes to the old leader, so an
 * Officer taking over leaves the old leader an Officer and the Officer count
 * never moves. Alliance ownership is updated to the new leader's id and name.
 *
 * @param {User} leader - The current leader, stepping down.
 * @param {User} member - The Officer or Member taking over.
 * @param {Alliance} alliance - The alliance changing hands.
 */
export const promoteAllianceMember = async (leader: User, member: User, alliance: Alliance) => {
  const oldRank = await postgres.em.transactional(async (em) => {
    if (!(await lockAlliance(em, alliance.id))) throw permissionErr();

    const memberNow = await lockMembership(em, member.userid);
    const rank = memberNow?.alliance_role;
    const takesOverFrom =
      memberNow?.alliance_id === alliance.id && (rank === AllianceRole.MEMBER || rank === AllianceRole.OFFICER);

    if (!takesOverFrom) throw cannotPromoteErr();

    // Each write only lands if its player still holds the role it changes, in
    // this alliance, so a double click or a member leaving at the same moment
    // can never leave the alliance with two leaders, or a leader outside it.
    const stepsDown = await em.nativeUpdate(
      User,
      { userid: leader.userid, alliance_id: alliance.id, alliance_role: AllianceRole.LEADER },
      { alliance_role: rank }
    );

    if (stepsDown === 0) throw permissionErr();

    const takesOver = await em.nativeUpdate(
      User,
      { userid: member.userid, alliance_id: alliance.id, alliance_role: rank },
      { alliance_role: AllianceRole.LEADER }
    );

    if (takesOver === 0) throw cannotPromoteErr();

    await em.nativeUpdate(
      Alliance,
      { id: alliance.id },
      { leader_userid: member.userid, leader_name: member.username }
    );

    return rank;
  });

  member.alliance_role = AllianceRole.LEADER;
  leader.alliance_role = oldRank;

  alliance.leader_userid = member.userid;
  alliance.leader_name = member.username;

  const shout: ShoutDraft = {
    allianceId: alliance.id,
    author: member,
    type: AllianceMessageType.PROMOTED,
    body: "",
  }

  await announceShout(shout);
};

/**
 * Makes a Member an Officer, or an Officer a Member (design v5 §6). Only a
 * rank with `SET_RANK` may, checked again under the locks, and an Officer seat
 * is only given while the type has one free (2 / 4 / 6), counted under the
 * alliance lock so two promotions at once cannot both take the last seat.
 *
 * @param {User} actor - The Leader doing it.
 * @param {User} target - The player whose rank changes.
 * @param {Alliance} alliance - The alliance.
 * @param {Rank} rank - The rank to give.
 * @returns {Promise<boolean>} False when the player already held that rank.
 * @throws {ClientSafeError} When the actor may not, the target is not an Officer or Member here, or no seat is free.
 */
export const setAllianceRank = async (actor: User, target: User, alliance: Alliance, rank: Rank) => {
  const changed = await postgres.em.transactional(async (em) => {
    const locked = await lockAlliance(em, alliance.id);

    if (!locked) throw permissionErr();

    const actorNow = await lockMembership(em, actor.userid);

    if (actorNow?.alliance_id !== alliance.id || !can(actorNow.alliance_role, AllianceAction.SET_RANK)) {
      throw cannotPromoteErr();
    }

    const targetNow = await lockMembership(em, target.userid);
    const from = targetNow?.alliance_role;
    const movable =
      targetNow?.alliance_id === alliance.id && (from === AllianceRole.MEMBER || from === AllianceRole.OFFICER);

    if (!movable) throw cannotPromoteErr();
    if (from === rank) return false;

    if (rank === AllianceRole.OFFICER) {
      const officers = await em.count(User, { alliance_id: alliance.id, alliance_role: AllianceRole.OFFICER });

      if (officers >= officerLimit(locked.type)) throw officerSeatsFullErr(officerLimit(locked.type));
    }

    await em.nativeUpdate(User, { userid: target.userid }, { alliance_role: rank });

    return true;
  });

  if (!changed) return false;

  target.alliance_role = rank;

  const type = rank === AllianceRole.OFFICER ? AllianceMessageType.OFFICER : AllianceMessageType.DEMOTED;

  await announceShout({ allianceId: alliance.id, author: target, type, body: "" });

  return true;
};
