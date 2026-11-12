import { UniqueConstraintViolationException } from "@mikro-orm/core";
import type { EntityManager, PostgreSqlDriver } from "@mikro-orm/postgresql";

import { AllianceMessageType, AllianceRole } from "../../enums/Alliance.js";
import { Status } from "../../enums/StatusCodes.js";
import { Alliance } from "../../database/models/alliance.model.js";
import { User } from "../../database/models/user.model.js";
import { ClientSafeError } from "../../middleware/clientSafeError.js";
import { postgres } from "../../server.js";
import { ABSENT_LEADER_DAYS, RENAME_COOLDOWN_DAYS } from "../../config/AllianceConfig.js";
import { allianceNameTakenErr, permissionErr } from "../../errors/errors.js";
import { announceShout } from "./allianceMessages.js";
import { lockAlliance, lockMembership } from "./membership.js";
import { AllianceAction, can } from "./permissions.js";
import { assertNameAllowed } from "./textFilter.js";

type Em = EntityManager<PostgreSqlDriver>;

const DAY_MS = 24 * 3600_000;

/** A refusal with a `reason` for the web to word (403). */
const refusedErr = (reason: string, message: string, detail: object = {}) =>
  new ClientSafeError({ message, status: Status.FORBIDDEN, data: { reason, ...detail }, isClientFriendly: true });

/*
 * Absent-leader takeover (design v5 §6, decided): once the leader has not
 * played for `ABSENT_LEADER_DAYS` (7), the longest-serving Officer who played
 * in that time may take over; with no such Officer, the longest-serving Member
 * who did. "Longest-serving" is the earliest `alliance_joined_at` (then the
 * lowest account number, so there is always exactly one). An Officer who has
 * not played either is passed over like the leader: the button must reach
 * someone who is here. The old leader takes the new leader's rank, as in a
 * hand-over.
 */

/** Whether a player last seen at `lastSeen` counts as absent at `now`. */
export const isAbsent = (lastSeen: Date | string | null | undefined, now: Date): boolean =>
  !lastSeen || now.getTime() - new Date(lastSeen).getTime() > ABSENT_LEADER_DAYS * DAY_MS;

interface LeaderRow {
  userid: number;
  last_seen_at: Date | null;
}

const readLeader = async (em: Em, allianceId: number, lock: boolean): Promise<LeaderRow | null> => {
  const [row] = await em.execute<LeaderRow[]>(
    `SELECT userid, last_seen_at FROM bym."user"
      WHERE alliance_id = ? AND alliance_role = 'leader'
      ORDER BY userid LIMIT 1 ${lock ? "FOR UPDATE" : ""}`,
    [allianceId]
  );

  return row ?? null;
};

/** The one player who may take over at `now`, or null. Does not check the leader. */
export const takeoverCandidate = async (em: Em, allianceId: number, now: Date): Promise<number | null> => {
  const activeSince = new Date(now.getTime() - ABSENT_LEADER_DAYS * DAY_MS);
  const [row] = await em.execute<{ userid: number }[]>(
    `SELECT userid FROM bym."user"
      WHERE alliance_id = ? AND alliance_role IN ('officer', 'member') AND last_seen_at > ?
      ORDER BY (alliance_role = 'officer') DESC, alliance_joined_at ASC NULLS LAST, userid ASC
      LIMIT 1`,
    [allianceId, activeSince]
  );

  return row ? Number(row.userid) : null;
};

/** Whether `userid` may take over `allianceId` at `now` (for myalliance's `can_take_over`). */
export const canTakeOver = async (allianceId: number, userid: number, now: Date, em: Em = postgres.em): Promise<boolean> => {
  const leader = await readLeader(em, allianceId, false);

  if (!leader || Number(leader.userid) === userid || !isAbsent(leader.last_seen_at, now)) return false;

  return (await takeoverCandidate(em, allianceId, now)) === userid;
};

/**
 * `POST /alliance/takeover`: `user` becomes leader of their alliance, if its
 * leader is absent and they are the one the rule picks. Everything is read
 * again under the alliance's lock.
 */
export const takeOverLeadership = async (user: User, alliance: Alliance, now: Date): Promise<void> => {
  await postgres.em.transactional(async (em) => {
    if (!(await lockAlliance(em, alliance.id))) throw permissionErr();

    const leader = await readLeader(em, alliance.id, true);
    const me = await lockMembership(em, user.userid);

    if (!leader || me?.alliance_id !== alliance.id) throw permissionErr();
    if (!isAbsent(leader.last_seen_at, now)) {
      throw refusedErr("leaderActive", `Your leader has played in the last ${ABSENT_LEADER_DAYS} days.`);
    }
    if ((await takeoverCandidate(em, alliance.id, now)) !== user.userid) {
      throw refusedErr("notNext", "Someone who has served longer may take over first.");
    }

    const myRank = me.alliance_role as AllianceRole.OFFICER | AllianceRole.MEMBER;

    await em.nativeUpdate(
      User,
      { userid: leader.userid, alliance_id: alliance.id, alliance_role: AllianceRole.LEADER },
      { alliance_role: myRank }
    );
    await em.nativeUpdate(User, { userid: user.userid, alliance_id: alliance.id }, { alliance_role: AllianceRole.LEADER });
    await em.nativeUpdate(Alliance, { id: alliance.id }, { leader_userid: user.userid, leader_name: user.username });
  });

  user.alliance_role = AllianceRole.LEADER;
  alliance.leader_userid = user.userid;
  alliance.leader_name = user.username;

  await announceShout({ allianceId: alliance.id, author: user, type: AllianceMessageType.TAKEOVER, body: "" });
};

/** When the alliance may next be renamed by its leader, or null when it may now. */
export const renameAvailableAt = (
  state: { renamed_at?: Date | string | null; must_rename?: boolean | null },
  now: Date
): Date | null => {
  if (state.must_rename || !state.renamed_at) return null;

  const at = new Date(new Date(state.renamed_at).getTime() + RENAME_COOLDOWN_DAYS * DAY_MS);

  return at > now ? at : null;
};

/**
 * `POST /alliance/rename`: the leader renames the alliance, at most once per
 * `RENAME_COOLDOWN_DAYS` (7), through the word filter, to a name no other
 * alliance has. After an admin rename (`must_rename`) there is no wait.
 */
export const renameAlliance = async (user: User, alliance: Alliance, name: string, now: Date): Promise<void> => {
  if (!can(user.alliance_role, AllianceAction.RENAME)) throw permissionErr();

  assertNameAllowed(name);

  await postgres.em
    .transactional(async (em) => {
      if (!(await lockAlliance(em, alliance.id))) throw permissionErr();

      const me = await lockMembership(em, user.userid);

      if (me?.alliance_id !== alliance.id || !can(me.alliance_role, AllianceAction.RENAME)) throw permissionErr();

      const [state] = await em.execute<{ renamed_at: Date | null; must_rename: boolean }[]>(
        `SELECT renamed_at, must_rename FROM bym.alliance WHERE id = ?`,
        [alliance.id]
      );
      const at = state ? renameAvailableAt(state, now) : null;

      if (at) {
        throw refusedErr("renameCooldown", `An alliance may be renamed once every ${RENAME_COOLDOWN_DAYS} days.`, {
          available_at: Math.floor(at.getTime() / 1000),
        });
      }

      await em.nativeUpdate(Alliance, { id: alliance.id }, { name, renamed_at: now, must_rename: false });
    })
    .catch((error) => {
      if (error instanceof UniqueConstraintViolationException) throw allianceNameTakenErr();
      throw error;
    });

  alliance.name = name;
  alliance.renamed_at = now;
  alliance.must_rename = false;

  await announceShout({ allianceId: alliance.id, author: user, type: AllianceMessageType.RENAMED, body: name });
};
