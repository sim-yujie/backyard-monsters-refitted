import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { MikroORM } from "@mikro-orm/postgresql";

import ormConfig from "../../mikro-orm.config.js";
import { AllianceInviteStatus, AllianceInviteType, AllianceMessageType, AllianceRole } from "../../enums/Alliance.js";
import { Alliance } from "../../database/models/alliance.model.js";
import { User } from "../../database/models/user.model.js";
import { memoryRedis } from "../../testing/memoryRedis.js";

/**
 * Joining, leaving and handing over an alliance with two requests at the same
 * moment, against a real Postgres (alliance audit, 10 Nov 2026). Whatever the
 * timing, a player ends up in exactly one alliance, every alliance keeps
 * exactly one leader who is in it, and the loser of each race is refused with
 * a clear message rather than silently overwritten.
 *
 * Opt-in, like the other `*.db.test.ts`: runs only when ALLIANCE_TEST_DB names
 * a throwaway copy of the `bym` schema, and refuses the shared `bym`. The
 * requests commit for real (two transactions cannot share a rollback), so the
 * rows use ids 993_700 and up and are deleted after. Redis is in memory, and so
 * is `server.js`, so nothing boots.
 */
const dbName = process.env.ALLIANCE_TEST_DB;
const enabled = Boolean(dbName) && dbName !== "bym";

const orm = enabled ? await MikroORM.init({ ...ormConfig, dbName, debug: false, pool: { min: 0, max: 10 } }) : null;

// Stood in even when skipped: the real `server.js` would start a server.
mock.module("../../server.js", () => ({
  postgres: {
    orm,
    // A request's own entity manager, as each request has one.
    get em() {
      if (!orm) throw new Error("ALLIANCE_TEST_DB is not set");
      return orm.em.fork();
    },
  },
  redis: { ...memoryRedis(), publish: async () => 0 },
}));

const { answerInvite } = await import("./allianceInvites.js");
const { addAllianceMember, promoteAllianceMember, removeAllianceMember } = await import("./membership.js");

const BASE = 993_700;
const PLAYER = BASE + 1;
const LEADER_A = BASE + 2;
const LEADER_B = BASE + 3;
const MEMBER_1 = BASE + 4;
const MEMBER_2 = BASE + 5;
const USERS = [PLAYER, LEADER_A, LEADER_B, MEMBER_1, MEMBER_2];
const ALLIANCE_A = BASE + 1;
const ALLIANCE_B = BASE + 2;
const FOUNDED = "zz_ai_founded";

const sql = <R = Record<string, any>>(query: string, params: unknown[] = []) =>
  orm!.em.fork().execute<R[]>(query, params);

const clear = async () => {
  await sql(`DELETE FROM bym.alliance WHERE id IN (?, ?) OR name = ?`, [ALLIANCE_A, ALLIANCE_B, FOUNDED]);
  await sql(`DELETE FROM bym."user" WHERE userid IN (${USERS.join(",")})`);
};

const addUser = (userid: number) =>
  sql(
    `INSERT INTO bym."user" (userid, username, email, password, blocked_users, last_seen_at)
     VALUES (?, ?, ?, 'x', '[]', now())`,
    [userid, `zz_ai_${userid}`, `zz_ai_${userid}@test.invalid`]
  );

const addAlliance = async (id: number, leader: number, members: number[] = []) => {
  await sql(
    `INSERT INTO bym.alliance (id, name, leader_userid, leader_name, world_id, created_at)
     VALUES (?, ?, ?, ?, 'w', now())`,
    [id, `zz_ai_${id}`, leader, `zz_ai_${leader}`]
  );
  await sql(`UPDATE bym."user" SET alliance_id = ?, alliance_role = 'leader' WHERE userid = ?`, [id, leader]);
  for (const member of members) {
    await sql(`UPDATE bym."user" SET alliance_id = ?, alliance_role = 'member' WHERE userid = ?`, [id, member]);
  }
};

const addInvite = async (allianceId: number, userid: number, type: AllianceInviteType) => {
  const [row] = await sql<{ id: number }>(
    `INSERT INTO bym.alliance_invite (alliance_id, user_id, type, status, created_at, updated_at)
     VALUES (?, ?, ?, 'pending', now(), now()) RETURNING id`,
    [allianceId, userid, type]
  );
  return row!.id;
};

/** A player as a fresh request would load them. */
const load = async (userid: number) => (await orm!.em.fork().findOneOrFail(User, { userid }));
const loadAlliance = async (id: number) => (await orm!.em.fork().findOneOrFail(Alliance, { id }));

/** Runs a request, giving "ok" or the message it was refused with. */
const outcome = (work: Promise<unknown>) =>
  work.then(
    () => "ok",
    (error: Error) => error.message
  );

const accept = async (userid: number, inviteId: number) =>
  answerInvite(await load(userid), inviteId, AllianceInviteStatus.ACCEPTED);

/** What `controllers/alliance/createAlliance.ts` does once its checks pass. */
const found = async (userid: number) => {
  const user = await load(userid);

  await orm!.em.fork().transactional(async (em) => {
    const alliance = em.create(Alliance, {
      name: FOUNDED,
      leader_userid: user.userid,
      leader_name: user.username,
      world_id: "w",
      map_version: 2,
    });
    await em.flush();
    await addAllianceMember(user, alliance, AllianceRole.LEADER, AllianceMessageType.CREATED, em);
  });
};

const membership = async (userid: number) => {
  const [row] = await sql<{ alliance_id: number | null; alliance_role: string | null }>(
    `SELECT alliance_id, alliance_role FROM bym."user" WHERE userid = ?`,
    [userid]
  );
  return row!;
};

const leadersOf = async (allianceId: number) =>
  (await sql<{ userid: number }>(
    `SELECT userid FROM bym."user" WHERE alliance_id = ? AND alliance_role = 'leader'`,
    [allianceId]
  )).map((row) => Number(row.userid));

const joinShouts = async (userid: number) =>
  Number(
    (await sql<{ n: string }>(
      `SELECT count(*) AS n FROM bym.alliance_message WHERE user_id = ? AND message_type IN (?, ?)`,
      [userid, AllianceMessageType.JOINED, AllianceMessageType.CREATED]
    ))[0]!.n
  );

const inviteStatuses = async (...ids: number[]) =>
  (await sql<{ status: string }>(`SELECT status FROM bym.alliance_invite WHERE id IN (${ids.join(",")}) ORDER BY id`)).map(
    (row) => row.status
  );

/** Every alliance this suite made still has exactly one leader, and that leader is in it and named on it. */
const expectSoundAlliances = async () => {
  const rows = await sql<{ id: number; leader_userid: number }>(
    `SELECT id, leader_userid FROM bym.alliance WHERE id IN (?, ?) OR name = ?`,
    [ALLIANCE_A, ALLIANCE_B, FOUNDED]
  );
  for (const row of rows) {
    expect(await leadersOf(Number(row.id))).toEqual([Number(row.leader_userid)]);
  }
};

describe.skipIf(!enabled)("alliance membership under simultaneous requests, on Postgres (alliance audit 10 Nov 2026)", () => {
  beforeEach(async () => {
    await clear();
    for (const userid of USERS) await addUser(userid);
  });

  afterAll(async () => {
    await clear();
    await orm?.close(true);
  });

  test("accepting two invites at once: one joins, the other is refused, the player is in one alliance", async () => {
    await addAlliance(ALLIANCE_A, LEADER_A);
    await addAlliance(ALLIANCE_B, LEADER_B);
    const inviteA = await addInvite(ALLIANCE_A, PLAYER, AllianceInviteType.INVITE);
    const inviteB = await addInvite(ALLIANCE_B, PLAYER, AllianceInviteType.INVITE);

    const outcomes = await Promise.all([outcome(accept(PLAYER, inviteA)), outcome(accept(PLAYER, inviteB))]);

    expect(outcomes.filter((o) => o === "ok")).toHaveLength(1);
    expect(outcomes).toContain("You must leave your current alliance before accepting the invite.");

    const joinedA = outcomes[0] === "ok";
    expect(await membership(PLAYER)).toEqual({
      alliance_id: joinedA ? ALLIANCE_A : ALLIANCE_B,
      alliance_role: AllianceRole.MEMBER,
    });
    // The refused invite is still open, and only one alliance announced the join.
    expect(await inviteStatuses(inviteA, inviteB)).toEqual(joinedA ? ["accepted", "pending"] : ["pending", "accepted"]);
    expect(await joinShouts(PLAYER)).toBe(1);
  });

  test("accepting the same invite twice at once joins once", async () => {
    await addAlliance(ALLIANCE_A, LEADER_A);
    const invite = await addInvite(ALLIANCE_A, PLAYER, AllianceInviteType.INVITE);

    const outcomes = await Promise.all([outcome(accept(PLAYER, invite)), outcome(accept(PLAYER, invite))]);

    expect(outcomes.filter((o) => o === "ok")).toHaveLength(1);
    expect(await membership(PLAYER)).toEqual({ alliance_id: ALLIANCE_A, alliance_role: AllianceRole.MEMBER });
    expect(await joinShouts(PLAYER)).toBe(1);
  });

  test("accepting an invite while a leader accepts the player's join request elsewhere: one wins", async () => {
    await addAlliance(ALLIANCE_A, LEADER_A);
    await addAlliance(ALLIANCE_B, LEADER_B);
    const invite = await addInvite(ALLIANCE_A, PLAYER, AllianceInviteType.INVITE);
    const request = await addInvite(ALLIANCE_B, PLAYER, AllianceInviteType.REQUEST);

    const outcomes = await Promise.all([outcome(accept(PLAYER, invite)), outcome(accept(LEADER_B, request))]);

    expect(outcomes.filter((o) => o === "ok")).toHaveLength(1);
    const refusal = outcomes.find((o) => o !== "ok");
    expect(["You must leave your current alliance before accepting the invite.", "User is already in an alliance."]).toContain(
      refusal!
    );
    expect((await membership(PLAYER)).alliance_id).toBe(outcomes[0] === "ok" ? ALLIANCE_A : ALLIANCE_B);
    expect(await joinShouts(PLAYER)).toBe(1);
  });

  test("founding an alliance while accepting an invite: one wins, no leaderless alliance is left behind", async () => {
    await addAlliance(ALLIANCE_A, LEADER_A);
    const invite = await addInvite(ALLIANCE_A, PLAYER, AllianceInviteType.INVITE);

    const outcomes = await Promise.all([outcome(found(PLAYER)), outcome(accept(PLAYER, invite))]);

    expect(outcomes.filter((o) => o === "ok")).toHaveLength(1);
    expect(outcomes.find((o) => o !== "ok")).toMatch(/already a member of an alliance|must leave your current alliance/);

    const [founded] = await sql<{ id: number }>(`SELECT id FROM bym.alliance WHERE name = ?`, [FOUNDED]);
    const player = await membership(PLAYER);

    if (outcomes[0] === "ok") {
      expect(player).toEqual({ alliance_id: Number(founded!.id), alliance_role: AllianceRole.LEADER });
      expect(await inviteStatuses(invite)).toEqual(["pending"]);
    } else {
      // The founding rolled back whole: no alliance with nobody in it.
      expect(founded).toBeUndefined();
      expect(player).toEqual({ alliance_id: ALLIANCE_A, alliance_role: AllianceRole.MEMBER });
    }
    expect(await joinShouts(PLAYER)).toBe(1);
    await expectSoundAlliances();
  });

  test("a leader promoting two members at once leaves exactly one leader", async () => {
    await addAlliance(ALLIANCE_A, LEADER_A, [MEMBER_1, MEMBER_2]);

    const promote = async (memberId: number) =>
      promoteAllianceMember(await load(LEADER_A), await load(memberId), await loadAlliance(ALLIANCE_A));

    const outcomes = await Promise.all([outcome(promote(MEMBER_1)), outcome(promote(MEMBER_2))]);

    expect(outcomes.filter((o) => o === "ok")).toHaveLength(1);
    expect(await leadersOf(ALLIANCE_A)).toEqual([outcomes[0] === "ok" ? MEMBER_1 : MEMBER_2]);
    expect((await membership(LEADER_A)).alliance_role).toBe(AllianceRole.MEMBER);
    await expectSoundAlliances();
  });

  test("a member leaving while being promoted never leaves a leader outside the alliance", async () => {
    await addAlliance(ALLIANCE_A, LEADER_A, [MEMBER_1]);

    const [leader, member, alliance] = [await load(LEADER_A), await load(MEMBER_1), await loadAlliance(ALLIANCE_A)];
    const [leaving, leavingFrom] = [await load(MEMBER_1), await loadAlliance(ALLIANCE_A)];

    const [promoted, left] = await Promise.all([
      outcome(promoteAllianceMember(leader, member, alliance)),
      outcome(removeAllianceMember(leaving, leavingFrom, AllianceMessageType.LEFT)),
    ]);

    // Either the member left first and the promotion was refused, or they
    // were promoted first and, now leading others, may not walk out.
    if (left === "ok") {
      expect(promoted).toBe("You cannot promote members.");
      expect(await membership(MEMBER_1)).toEqual({ alliance_id: null, alliance_role: null });
    } else {
      expect(promoted).toBe("ok");
      expect(left).toMatch(/elect someone to succeed you/);
      expect(await membership(MEMBER_1)).toEqual({ alliance_id: ALLIANCE_A, alliance_role: AllianceRole.LEADER });
    }
    await expectSoundAlliances();
  });

  test("the last leader leaving while a join request is accepted: no one is left in a deleted alliance", async () => {
    await addAlliance(ALLIANCE_A, LEADER_A);
    const request = await addInvite(ALLIANCE_A, PLAYER, AllianceInviteType.REQUEST);

    const [leader, alliance] = [await load(LEADER_A), await loadAlliance(ALLIANCE_A)];

    const [left, accepted] = await Promise.all([
      outcome(removeAllianceMember(leader, alliance, AllianceMessageType.LEFT)),
      outcome(accept(LEADER_A, request)),
    ]);

    const [exists] = await sql(`SELECT id FROM bym.alliance WHERE id = ?`, [ALLIANCE_A]);

    if (left === "ok") {
      // Disbanded first; the accept found no alliance (or no longer a leader) and was refused.
      expect(accepted).not.toBe("ok");
      expect(exists).toBeUndefined();
      expect(await membership(PLAYER)).toEqual({ alliance_id: null, alliance_role: null });
    } else {
      expect(accepted).toBe("ok");
      expect(left).toMatch(/elect someone to succeed you/);
      expect(await membership(PLAYER)).toEqual({ alliance_id: ALLIANCE_A, alliance_role: AllianceRole.MEMBER });
      await expectSoundAlliances();
    }
  });

  test("a kick sent with a stale view cannot take a player out of the alliance they moved to", async () => {
    await addAlliance(ALLIANCE_A, LEADER_A, [PLAYER]);
    await addAlliance(ALLIANCE_B, LEADER_B);

    // The leader's request read the player while they were still in A...
    const [kicker, stale, alliance] = [await load(LEADER_A), await load(PLAYER), await loadAlliance(ALLIANCE_A)];

    // ...then they left and joined B.
    await removeAllianceMember(await load(PLAYER), await loadAlliance(ALLIANCE_A), AllianceMessageType.LEFT);
    await accept(PLAYER, await addInvite(ALLIANCE_B, PLAYER, AllianceInviteType.INVITE));

    expect(await outcome(removeAllianceMember(stale, alliance, AllianceMessageType.KICKED, kicker))).toBe(
      "You cannot kick members."
    );
    expect(await membership(PLAYER)).toEqual({ alliance_id: ALLIANCE_B, alliance_role: AllianceRole.MEMBER });
  });

  test("joining is refused at the database for a player already in an alliance", async () => {
    await addAlliance(ALLIANCE_A, LEADER_A, [PLAYER]);
    await addAlliance(ALLIANCE_B, LEADER_B);

    // A copy loaded before they joined A still says they are free.
    const stale = await load(PLAYER);
    stale.alliance_id = null;

    const joined = orm!.em.fork().transactional((em) =>
      addAllianceMember(stale, { id: ALLIANCE_B } as Alliance, AllianceRole.MEMBER, null, em)
    );

    expect(await outcome(joined)).toBe("You are already a member of an alliance.");
    expect((await membership(PLAYER)).alliance_id).toBe(ALLIANCE_A);
  });
});
