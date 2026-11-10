import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { MikroORM } from "@mikro-orm/postgresql";

import ormConfig from "../../mikro-orm.config.js";
import { User } from "../../database/models/user.model.js";
import { memoryRedis } from "../../testing/memoryRedis.js";
import type { KoaController } from "../../utils/KoaController.js";

/**
 * The alliance flows a player walks through, end to end through the
 * controllers, against a real Postgres: found, ask to join, invite, answer,
 * leave, kick, hand over (alliance audit, 10 Nov 2026, improvement 18). They
 * pin today's behaviour before the revamp changes it, so every later change is
 * checked against a known start.
 *
 * Opt-in, like the other `*.db.test.ts`: runs only when ALLIANCE_TEST_DB names
 * a throwaway copy of the `bym` schema, and refuses the shared `bym`. The rows
 * use ids 993_800 and up (and their own two worlds) and are deleted before and
 * after each test. Redis is in memory, and so is `server.js`, so nothing boots.
 */
const dbName = process.env.ALLIANCE_TEST_DB;
const enabled = Boolean(dbName) && dbName !== "bym";

const orm = enabled ? await MikroORM.init({ ...ormConfig, dbName, debug: false, pool: { min: 0, max: 6 } }) : null;

/** The entity manager of the request being run, as each request has its own. */
let requestEm: ReturnType<NonNullable<typeof orm>["em"]["fork"]> | null = null;

mock.module("../../server.js", () => ({
  postgres: {
    orm,
    get em() {
      if (!requestEm) throw new Error("ALLIANCE_TEST_DB is not set");
      return requestEm;
    },
  },
  redis: { ...memoryRedis(), publish: async () => 0 },
}));

const { createAlliance } = await import("./createAlliance.js");
const { requestJoin } = await import("./requestJoin.js");
const { inviteUser } = await import("./inviteUser.js");
const { getMessageThreads } = await import("../mail/getMessageThreads.js");
const { getMessageThread } = await import("../mail/getMessageThread.js");
const { changeInviteStatus } = await import("./changeInviteStatus.js");
const { leaveAlliance } = await import("./leaveAlliance.js");
const { kickMember } = await import("./kickMember.js");
const { promoteMember } = await import("./promoteMember.js");
const { changeAllianceType } = await import("./changeAllianceType.js");
const { myAlliance } = await import("./myAlliance.js");
const { setMemberRank } = await import("./setMemberRank.js");
const { editAlliance } = await import("./editAlliance.js");
const { searchAlliances } = await import("./searchAlliances.js");
const { takeOverAlliance } = await import("./takeOverAlliance.js");
const { renameAllianceController } = await import("./renameAlliance.js");
const { reportAllianceController } = await import("./reportAlliance.js");
const { adminAllianceAction, listAllianceReports } = await import("../../services/alliance/allianceModeration.js");
const { lastActionKey, lastSeenKey } = await import("../../services/user/online.js");
const { redis } = await import("../../server.js");
const { underAttackShout } = await import("../../services/alliance/underAttack.js");
const { emitShout, getAllianceMessages } = await import("../../services/alliance/allianceMessages.js");
const { BaseType } = await import("../../enums/Base.js");

const BASE = 993_800;
const LEADER = BASE + 1;
const PLAYER = BASE + 2;
const MEMBER = BASE + 3;
const OTHER_WORLD = BASE + 4;
/** Members without a yard, only to fill an alliance up: BASE + 20 and on. */
const FILLERS = Array.from({ length: 60 }, (_, i) => BASE + 20 + i);
const USERS = [LEADER, PLAYER, MEMBER, OTHER_WORLD, ...FILLERS];
const WORLD = "00000000-0000-4000-8000-000000993801";
const WORLD_2 = "00000000-0000-4000-8000-000000993802";
const NAME = "zz_flow_alliance";

const sql = <R = Record<string, any>>(query: string, params: unknown[] = []) =>
  orm!.em.fork().execute<R[]>(query, params);

const clear = async () => {
  await sql(`DELETE FROM bym.alliance_report WHERE reporter_id IN (${USERS.join(",")})`);
  await sql(`DELETE FROM bym.alliance_admin_action WHERE admin_id = ${BASE}`);
  await sql(
    `DELETE FROM bym.alliance WHERE name LIKE 'zz_flow_%'
        OR id IN (SELECT alliance_id FROM bym."user" WHERE userid IN (${USERS.join(",")}) AND alliance_id IS NOT NULL)`
  );
  await sql(`DELETE FROM bym.alliance_invite WHERE user_id IN (${USERS.join(",")})`);
  await sql(`DELETE FROM bym.thread WHERE userid IN (${USERS.join(",")}) OR targetid IN (${USERS.join(",")})`);
  await sql(`DELETE FROM bym.message WHERE userid IN (${USERS.join(",")}) OR targetid IN (${USERS.join(",")})`);
  await sql(`UPDATE bym."user" SET save_basesaveid = NULL WHERE userid IN (${USERS.join(",")})`);
  await sql(`DELETE FROM bym.save WHERE userid IN (${USERS.join(",")})`);
  await sql(`DELETE FROM bym."user" WHERE userid IN (${USERS.join(",")})`);
  await sql(`DELETE FROM bym.world WHERE uuid IN (?, ?)`, [WORLD, WORLD_2]);
};

/** A finished Observatory, the pass into an alliance (`joinGate.ts`). */
const OBSERVATORY_YARD = { o1: { t: 150, l: 1, X: 0, Y: 0 } };

/** A player with a Map Room 2 main yard in the given world, with an Observatory unless told otherwise. */
const addPlayer = async (userid: number, world = WORLD, buildings: Record<string, unknown> = OBSERVATORY_YARD) => {
  await sql(
    `INSERT INTO bym."user" (userid, username, email, password, blocked_users, last_seen_at)
     VALUES (?, ?, ?, 'x', '[]', now())`,
    [userid, `zz_flow_${userid}`, `zz_flow_${userid}@test.invalid`]
  );
  const [save] = await sql<{ basesaveid: number }>(
    `INSERT INTO bym.save (userid, saveuserid, baseid, type, points, basevalue, createtime, name, credits, attacks,
                           takeover_date, created_at, lastupdate_at, worldid, mapversion, mr2upgraded, buildingdata)
     VALUES (?, ?, ?, 'main', 0, '0', 0, 'main', 0, '[]', now(), now(), now(), ?, 2, true, ?::jsonb)
     RETURNING basesaveid`,
    [userid, userid, String(userid), world, JSON.stringify(buildings)]
  );
  await sql(`UPDATE bym."user" SET save_basesaveid = ? WHERE userid = ?`, [save!.basesaveid, userid]);
};

/** Puts `count` yardless members straight into an alliance. */
const fill = async (allianceId: number, count: number) => {
  for (const userid of FILLERS.slice(0, count)) {
    await sql(
      `INSERT INTO bym."user" (userid, username, email, password, blocked_users, last_seen_at, alliance_id, alliance_role)
       VALUES (?, ?, ?, 'x', '[]', now(), ?, 'member')`,
      [userid, `zz_flow_${userid}`, `zz_flow_${userid}@test.invalid`, allianceId]
    );
  }
};

/** Runs a controller as `userid`'s request would, giving its body or the message it was refused with. */
const call = async (controller: KoaController, userid: number, body: Record<string, unknown> = {}) => {
  requestEm = orm!.em.fork();
  const authUser = await requestEm.findOneOrFail(User, { userid });
  const ctx = { authUser, request: { body }, status: 0, body: undefined as unknown };

  try {
    await controller(ctx as never, async () => {});
    return ctx.body as Record<string, any>;
  } catch (error) {
    return { refused: (error as Error).message };
  }
};

const membership = async (userid: number) => {
  const [row] = await sql<{ alliance_id: number | null; alliance_role: string | null }>(
    `SELECT alliance_id, alliance_role FROM bym."user" WHERE userid = ?`,
    [userid]
  );
  return { alliance_id: row!.alliance_id === null ? null : Number(row!.alliance_id), role: row!.alliance_role };
};

const allianceExists = async (id: number) =>
  (await sql(`SELECT 1 FROM bym.alliance WHERE id = ?`, [id])).length > 0;

const pendingInviteId = async (userid: number) => {
  const [row] = await sql<{ id: number }>(
    `SELECT id FROM bym.alliance_invite WHERE user_id = ? AND status = 'pending'`,
    [userid]
  );
  return row ? Number(row.id) : null;
};

const found = async (userid = LEADER, extra: Record<string, unknown> = {}) => {
  const body = await call(createAlliance, userid, {
    alliance_name: NAME,
    alliance_image: 3,
    alliance_desc: "A test alliance",
    ...extra,
  });
  return body;
};

/** Founds the alliance and brings MEMBER in through an accepted request. */
const foundWithMember = async () => {
  const created = await found();
  const allianceId = created.alliance.alliance_id as number;
  await call(requestJoin, MEMBER, { alliance_id: allianceId });
  await call(changeInviteStatus, LEADER, { invite_id: await pendingInviteId(MEMBER), status: "accepted" });
  return allianceId;
};

describe.skipIf(!enabled)("alliance flows through the controllers, on Postgres (alliance audit improvement 18)", () => {
  beforeEach(async () => {
    await clear();
    await sql(
      `INSERT INTO bym.world (uuid, name, player_count, map_version, created_at, lastupdate_at)
       VALUES (?, 'zz_flow_world', 0, 2, now(), now()), (?, 'zz_flow_world_2', 0, 2, now(), now())`,
      [WORLD, WORLD_2]
    );
    for (const userid of [LEADER, PLAYER, MEMBER]) await addPlayer(userid);
    await addPlayer(OTHER_WORLD, WORLD_2);
  });

  afterAll(async () => {
    if (!orm) return;
    await clear();
    await orm.close();
  });

  test("founding makes the player its leader, in their own world", async () => {
    const body = await found();

    expect(body.error).toBe(0);
    expect(body.alliance.world_id).toBe(WORLD);
    expect(await membership(LEADER)).toEqual({ alliance_id: body.alliance.alliance_id, role: "leader" });
  });

  test("founding a second alliance is refused", async () => {
    await found();

    const body = await found(LEADER, { alliance_name: "zz_flow_second" });

    expect(body.refused).toBe("You are already a member of an alliance.");
  });

  test("a taken name is refused", async () => {
    await found();

    expect((await found(PLAYER)).refused).toBe("The alliance name is already taken.");
  });

  test("ask to join, then the leader accepts: the player is a member", async () => {
    const allianceId = (await found()).alliance.alliance_id;

    expect((await call(requestJoin, PLAYER, { alliance_id: allianceId })).error).toBe(0);
    const inviteId = await pendingInviteId(PLAYER);
    expect(inviteId).not.toBeNull();

    expect((await call(changeInviteStatus, LEADER, { invite_id: inviteId, status: "accepted" })).error).toBe(0);
    expect(await membership(PLAYER)).toEqual({ alliance_id: allianceId, role: "member" });
  });

  test("asking twice while one request waits is refused", async () => {
    const allianceId = (await found()).alliance.alliance_id;

    await call(requestJoin, PLAYER, { alliance_id: allianceId });

    expect((await call(requestJoin, PLAYER, { alliance_id: allianceId })).refused).toBe(
      "You already have a request pending."
    );
  });

  test("a player cannot answer their own join request", async () => {
    const allianceId = (await found()).alliance.alliance_id;
    await call(requestJoin, PLAYER, { alliance_id: allianceId });

    const body = await call(changeInviteStatus, PLAYER, { invite_id: await pendingInviteId(PLAYER), status: "accepted" });

    expect(body.refused).toBeDefined();
    expect(await membership(PLAYER)).toEqual({ alliance_id: null, role: null });
  });

  test("the leader invites, the player accepts: the player is a member", async () => {
    const allianceId = (await found()).alliance.alliance_id;

    expect((await call(inviteUser, LEADER, { userid: PLAYER })).error).toBe(0);

    const body = await call(changeInviteStatus, PLAYER, { invite_id: await pendingInviteId(PLAYER), status: "accepted" });

    expect(body.error).toBe(0);
    expect(await membership(PLAYER)).toEqual({ alliance_id: allianceId, role: "member" });
  });

  test("an invite reaches the player as mail from the inviter, answered from there; the mail follows the invite", async () => {
    const allianceId = (await found()).alliance.alliance_id;
    const sent = await call(inviteUser, LEADER, { userid: PLAYER });
    expect(sent.error).toBe(0);

    const [mail] = await sql<{ threadid: number; userid: number; messagetype: string; allianceinviteid: number; subject: string }>(
      `SELECT threadid, userid, messagetype, allianceinviteid, subject FROM bym.message WHERE targetid = ?`,
      [PLAYER]
    );
    expect(mail).toMatchObject({ userid: LEADER, messagetype: "allianceinvite", subject: "Join zz_flow_alliance" });
    expect(Number(mail!.allianceinviteid)).toBe(sent.invite_id);
    const [save] = await sql<{ unreadmessages: number }>(`SELECT unreadmessages FROM bym.save WHERE userid = ? AND type = 'main'`, [PLAYER]);
    expect(save!.unreadmessages).toBe(1);

    const listed = (await call(getMessageThreads, PLAYER)).threads[mail!.threadid];
    expect(listed.allianceinvite).toEqual({
      state: "pending",
      alliance_id: allianceId,
      alliance_name: "zz_flow_alliance",
      alliance_image: expect.any(Number),
    });

    // The mail's button answers the invite it names.
    expect((await call(changeInviteStatus, PLAYER, { invite_id: Number(mail!.allianceinviteid), status: "accepted" })).error).toBe(0);
    expect(await membership(PLAYER)).toEqual({ alliance_id: allianceId, role: "member" });

    const thread = (await call(getMessageThread, PLAYER, { threadid: String(mail!.threadid) })).thread;
    expect(Object.values(thread as Record<string, any>)[0].allianceinvite.state).toBe("accepted");
    // The Invites tab names who sent it.
    expect(Number((await sql(`SELECT invited_by FROM bym.alliance_invite WHERE id = ?`, [sent.invite_id]))[0]!.invited_by)).toBe(LEADER);
  });

  test("an invite between players where one blocked the other is refused, with no invite and no mail", async () => {
    await found();
    await sql(`UPDATE bym."user" SET blocked_users = ? WHERE userid = ?`, [JSON.stringify([LEADER]), PLAYER]);

    expect((await call(inviteUser, LEADER, { userid: PLAYER })).refused).toBe("You cannot invite zz_flow_" + PLAYER + ".");
    expect(await pendingInviteId(PLAYER)).toBeNull();
    expect(await sql(`SELECT 1 FROM bym.message WHERE targetid = ?`, [PLAYER])).toHaveLength(0);
  });

  test("a declined invite joins no one", async () => {
    await found();
    await call(inviteUser, LEADER, { userid: PLAYER });

    await call(changeInviteStatus, PLAYER, { invite_id: await pendingInviteId(PLAYER), status: "declined" });

    expect(await membership(PLAYER)).toEqual({ alliance_id: null, role: null });
  });

  test("an ordinary member cannot invite", async () => {
    await foundWithMember();

    expect((await call(inviteUser, MEMBER, { userid: PLAYER })).refused).toBe(
      "Only the leader or an Officer can invite new members. Ask one of them to send the invitation for you."
    );
    expect(await pendingInviteId(PLAYER)).toBeNull();
    expect(await sql(`SELECT 1 FROM bym.message WHERE targetid = ?`, [PLAYER])).toHaveLength(0);
  });

  test("a member leaves", async () => {
    const allianceId = await foundWithMember();

    expect((await call(leaveAlliance, MEMBER)).error).toBe(0);
    expect(await membership(MEMBER)).toEqual({ alliance_id: null, role: null });
    expect(await allianceExists(allianceId)).toBe(true);
  });

  test("a leader with members cannot leave; the last one out disbands the alliance", async () => {
    const allianceId = await foundWithMember();

    expect((await call(leaveAlliance, LEADER)).refused).toContain("need to elect someone to succeed you");

    await call(leaveAlliance, MEMBER);
    expect((await call(leaveAlliance, LEADER)).error).toBe(0);
    expect(await allianceExists(allianceId)).toBe(false);
  });

  test("the leader kicks a member", async () => {
    await foundWithMember();

    expect((await call(kickMember, LEADER, { userid: MEMBER })).error).toBe(0);
    expect(await membership(MEMBER)).toEqual({ alliance_id: null, role: null });
  });

  test("a member cannot kick, nor can the leader kick themselves", async () => {
    const allianceId = await foundWithMember();

    expect((await call(kickMember, MEMBER, { userid: LEADER })).refused).toBeDefined();
    expect((await call(kickMember, LEADER, { userid: LEADER })).refused).toBeDefined();
    expect(await membership(LEADER)).toEqual({ alliance_id: allianceId, role: "leader" });
  });

  test("handing over leadership swaps the two roles", async () => {
    const allianceId = await foundWithMember();

    expect((await call(promoteMember, LEADER, { userid: MEMBER })).error).toBe(0);
    expect(await membership(MEMBER)).toEqual({ alliance_id: allianceId, role: "leader" });
    expect(await membership(LEADER)).toEqual({ alliance_id: allianceId, role: "member" });
  });

  test("a member cannot hand over leadership", async () => {
    await foundWithMember();

    expect((await call(promoteMember, MEMBER, { userid: MEMBER })).refused).toBeDefined();
  });

  test("a Midas' Council is full at 15 members", async () => {
    const allianceId = (await found(LEADER, { alliance_type: "midas" })).alliance.alliance_id;
    await fill(allianceId, 14);

    expect((await call(requestJoin, PLAYER, { alliance_id: allianceId })).refused).toBe("The alliance is already full.");
  });

  test("a Conquest Horde still has room at 15", async () => {
    const allianceId = (await found(LEADER, { alliance_type: "conquest" })).alliance.alliance_id;
    await fill(allianceId, 14);

    expect((await call(requestJoin, PLAYER, { alliance_id: allianceId })).error).toBe(0);
    await call(changeInviteStatus, LEADER, { invite_id: await pendingInviteId(PLAYER), status: "accepted" });
    expect(await membership(PLAYER)).toEqual({ alliance_id: allianceId, role: "member" });
  });

  test("an accept is refused once the type's limit is reached in between", async () => {
    const allianceId = (await found(LEADER, { alliance_type: "midas" })).alliance.alliance_id;
    await fill(allianceId, 13);
    await call(requestJoin, PLAYER, { alliance_id: allianceId });
    await sql(
      `INSERT INTO bym."user" (userid, username, email, password, blocked_users, last_seen_at, alliance_id, alliance_role)
       VALUES (?, 'zz_flow_late', 'zz_flow_late@test.invalid', 'x', '[]', now(), ?, 'member')`,
      [FILLERS[59], allianceId]
    );

    const body = await call(changeInviteStatus, LEADER, { invite_id: await pendingInviteId(PLAYER), status: "accepted" });

    expect(body.refused).toBe("The alliance is already full.");
  });

  test("switching up is free; switching straight back down waits", async () => {
    const allianceId = (await found(LEADER, { alliance_type: "midas" })).alliance.alliance_id;
    await sql(`UPDATE bym.alliance SET points = 100 WHERE id = ?`, [allianceId]);

    const up = await call(changeAllianceType, LEADER, { alliance_type: "fortress" });
    expect(up).toEqual({ error: 0, type: "fortress", points: 400 });

    const down = await call(changeAllianceType, LEADER, { alliance_type: "midas" });
    expect(down.refused).toContain("has to wait");

    const mine = await call(myAlliance, LEADER);
    expect(mine.alliance).toMatchObject({ type: "fortress", member_limit: 60, officer_limit: 6, points: 400 });
    expect(mine.alliance.type_options.map((one: { refusal: string | null }) => one.refusal)).toEqual([
      "waitForDownSwitch",
      "waitForDownSwitch",
    ]);
  });

  test("a type smaller than the member count is refused, and only the leader may switch", async () => {
    const allianceId = await foundWithMember();
    await sql(`UPDATE bym.alliance SET type = 'conquest' WHERE id = ?`, [allianceId]);
    await fill(allianceId, 15);

    expect((await call(changeAllianceType, LEADER, { alliance_type: "midas" })).refused).toContain("too many members");
    expect((await call(changeAllianceType, MEMBER, { alliance_type: "fortress" })).refused).toBeDefined();
  });

  describe("the join gate (owner, 10 Nov 2026)", () => {
    const setYard = (userid: number, buildings: Record<string, unknown>, mapversion = 2, mr2upgraded = true) =>
      sql(`UPDATE bym.save SET buildingdata = ?::jsonb, mapversion = ?, mr2upgraded = ? WHERE userid = ?`, [
        JSON.stringify(buildings),
        mapversion,
        mr2upgraded,
        userid,
      ]);

    test("founding needs a finished Observatory", async () => {
      await setYard(LEADER, {});
      expect((await found()).refused).toContain("Observatory");

      await setYard(LEADER, { o1: { t: 150, l: 0, X: 0, Y: 0, cB: 5 } });
      expect((await found()).refused).toContain("Observatory");

      await setYard(LEADER, OBSERVATORY_YARD);
      expect((await found()).error).toBe(0);
    });

    test("founding needs Map Room 2", async () => {
      await setYard(LEADER, OBSERVATORY_YARD, 1, false);
      expect((await found()).refused).toContain("Map Room 2");
    });

    test("asking to join needs an Observatory and the alliance's world", async () => {
      const allianceId = (await found()).alliance.alliance_id;

      await setYard(PLAYER, {});
      expect((await call(requestJoin, PLAYER, { alliance_id: allianceId })).refused).toContain("Observatory");

      expect((await call(requestJoin, OTHER_WORLD, { alliance_id: allianceId })).refused).toContain("another world");
      expect(await pendingInviteId(OTHER_WORLD)).toBeNull();
    });

    test("an invite names the player who may not join", async () => {
      const allianceId = (await found()).alliance.alliance_id;

      expect((await call(inviteUser, LEADER, { userid: OTHER_WORLD })).refused).toBe(
        `zz_flow_${OTHER_WORLD} is in another world.`
      );

      await setYard(PLAYER, {});
      expect((await call(inviteUser, LEADER, { userid: PLAYER })).refused).toBe(
        `zz_flow_${PLAYER} has no Observatory yet.`
      );
      expect(allianceId).toBeGreaterThan(0);
    });

    test("an accept is refused once the joining player has lost the gate since", async () => {
      const allianceId = (await found()).alliance.alliance_id;
      await call(requestJoin, PLAYER, { alliance_id: allianceId });
      await sql(`UPDATE bym.save SET worldid = ? WHERE userid = ?`, [WORLD_2, PLAYER]);

      const answer = await call(changeInviteStatus, LEADER, { invite_id: await pendingInviteId(PLAYER), status: "accepted" });

      expect(answer.refused).toBe(`zz_flow_${PLAYER} is in another world.`);
      expect(await membership(PLAYER)).toEqual({ alliance_id: null, role: null });
    });

    test("search lists only the player's own world", async () => {
      await found();
      const own = await call(searchAlliances, PLAYER, { search: "zz_flow", page: 0, world: "false" });
      const other = await call(searchAlliances, OTHER_WORLD, { search: "zz_flow", page: 0, world: "false" });

      expect(own.alliances.map((row: { name: string }) => row.name)).toEqual([NAME]);
      expect(other.alliances).toEqual([]);
    });

    test("search treats % and _ as plain letters", async () => {
      await found();
      await found(MEMBER, { alliance_name: "zz_flow_50%" });

      const names = async (search: string) =>
        (await call(searchAlliances, PLAYER, { search, page: 0, world: "false" })).alliances.map(
          (row: { name: string }) => row.name
        );

      expect(await names("50%")).toEqual(["zz_flow_50%"]);
      expect(await names("%")).toEqual(["zz_flow_50%"]);
      expect(await names("zz_flow_a")).toEqual(["zz_flow_alliance"]);
      expect(await names("zz%flow")).toEqual([]);
    });

    test("search puts alliances with a free seat first, and says type, limit and active members", async () => {
      const full = (await found()).alliance.alliance_id as number;
      await fill(full, 14);
      await found(MEMBER, { alliance_name: "zz_flow_roomy" });

      const body = await call(searchAlliances, PLAYER, { search: "zz_flow", page: 0, world: "false" });

      expect(body.totalResults).toBe(2);
      expect(body.alliances.map((row: { name: string }) => row.name)).toEqual(["zz_flow_roomy", NAME]);
      expect(body.alliances[1]).toMatchObject({ members: 15, type: "midas", member_limit: 15, active_members: 15 });
    });

    test("search says how many members are online now, by My Alliance's rule", async () => {
      const busy = (await found()).alliance.alliance_id as number;
      await fill(busy, 4);
      await found(MEMBER, { alliance_name: "zz_flow_quiet" });
      const now = Math.floor(Date.now() / 1000);
      // Two fillers seen and acting just now; a third only seen (no real action) is not online.
      for (const userid of FILLERS.slice(0, 2)) {
        await redis.setex(lastSeenKey(userid), 60, String(now));
        await redis.setex(lastActionKey(userid), 60, String(now));
      }
      await redis.setex(lastSeenKey(FILLERS[2]!), 60, String(now));

      const body = await call(searchAlliances, PLAYER, { search: "zz_flow", page: 0, world: "false" });
      const online = Object.fromEntries(
        body.alliances.map((row: { name: string; online_members: number }) => [row.name, row.online_members])
      );

      expect(online).toEqual({ [NAME]: 2, zz_flow_quiet: 0 });
      expect((await call(myAlliance, LEADER)).alliance.online_members).toBe(2);
      for (const userid of FILLERS.slice(0, 3)) await redis.del(lastSeenKey(userid), lastActionKey(userid));
    });
  });

  describe("the 24-hour re-join wait (owner, 10 Nov 2026)", () => {
    const aDayAgo = (userid: number) =>
      sql(`UPDATE bym."user" SET alliance_left_at = now() - interval '25 hours' WHERE userid = ?`, [userid]);

    test("a player who left may not ask to join, nor found, for 24 hours", async () => {
      const allianceId = await foundWithMember();
      await call(leaveAlliance, MEMBER);

      const [row] = await sql<{ alliance_left_at: Date | null; alliance_joined_at: Date | null }>(
        `SELECT alliance_left_at, alliance_joined_at FROM bym."user" WHERE userid = ?`,
        [MEMBER]
      );
      expect(row!.alliance_left_at).not.toBeNull();
      expect(row!.alliance_joined_at).toBeNull();

      expect((await call(requestJoin, MEMBER, { alliance_id: allianceId })).refused).toContain("24 hours");
      expect((await found(MEMBER, { alliance_name: "zz_flow_other" })).refused).toContain("24 hours");

      await aDayAgo(MEMBER);
      expect((await call(requestJoin, MEMBER, { alliance_id: allianceId })).error).toBe(0);
    });

    test("a kicked player cannot be invited back for 24 hours; the invite names them", async () => {
      const allianceId = await foundWithMember();
      await call(kickMember, LEADER, { userid: MEMBER });

      expect((await call(inviteUser, LEADER, { userid: MEMBER })).refused).toBe(
        `zz_flow_${MEMBER} left an alliance less than 24 hours ago.`
      );
      expect(allianceId).toBeGreaterThan(0);
    });

    test("an accept already waiting is refused under the lock when the player left in between", async () => {
      const allianceId = await foundWithMember();
      await call(requestJoin, PLAYER, { alliance_id: allianceId });
      await sql(`UPDATE bym."user" SET alliance_left_at = now() WHERE userid = ?`, [PLAYER]);

      const answer = await call(changeInviteStatus, LEADER, { invite_id: await pendingInviteId(PLAYER), status: "accepted" });

      expect(answer.refused).toBe(`zz_flow_${PLAYER} left an alliance less than 24 hours ago.`);
      expect(await membership(PLAYER)).toEqual({ alliance_id: null, role: null });
    });

    test("joining records when, and the founder's join time is set too", async () => {
      await foundWithMember();
      const rows = await sql<{ userid: number; alliance_joined_at: Date | null }>(
        `SELECT userid, alliance_joined_at FROM bym."user" WHERE userid IN (?, ?)`,
        [LEADER, MEMBER]
      );
      expect(rows.every((row) => row.alliance_joined_at !== null)).toBe(true);
    });
  });

  describe("absent-leader takeover (design v5 §6)", () => {
    /** LEADER last played `days` ago; MEMBER and PLAYER are in, MEMBER the longer. */
    const setUp = async (days: number) => {
      const allianceId = await foundWithMember();
      await call(requestJoin, PLAYER, { alliance_id: allianceId });
      await call(changeInviteStatus, LEADER, { invite_id: await pendingInviteId(PLAYER), status: "accepted" });
      await sql(`UPDATE bym."user" SET alliance_joined_at = now() - interval '30 days' WHERE userid = ?`, [MEMBER]);
      await sql(`UPDATE bym."user" SET last_seen_at = now() - (? * interval '1 day') WHERE userid = ?`, [days, LEADER]);
      return allianceId;
    };

    test("an active leader cannot be taken over", async () => {
      await setUp(2);
      expect((await call(takeOverAlliance, MEMBER)).refused).toContain("played in the last 7 days");
      expect((await call(myAlliance, MEMBER)).alliance.can_take_over).toBe(false);
    });

    test("with no Officer, the longest-serving active Member takes over; the leader becomes a Member", async () => {
      await setUp(8);
      expect((await call(myAlliance, PLAYER)).alliance.can_take_over).toBe(false);
      expect((await call(takeOverAlliance, PLAYER)).refused).toContain("served longer");

      expect((await call(myAlliance, MEMBER)).alliance.can_take_over).toBe(true);
      expect((await call(takeOverAlliance, MEMBER)).error).toBe(0);
      expect((await membership(MEMBER)).role).toBe("leader");
      expect((await membership(LEADER)).role).toBe("member");
    });

    test("an active Officer comes before a longer-serving Member; an absent Officer is passed over", async () => {
      await setUp(8);
      await call(setMemberRank, LEADER, { userid: PLAYER, role: "officer" });
      expect((await call(takeOverAlliance, MEMBER)).refused).toContain("served longer");

      await sql(`UPDATE bym."user" SET last_seen_at = now() - interval '9 days' WHERE userid = ?`, [PLAYER]);
      expect((await call(takeOverAlliance, MEMBER)).error).toBe(0);
    });
  });

  describe("rename, report and admin actions (design v5 §6, §13)", () => {
    const adminEm = () => orm!.em.fork();
    const nameOf = async (id: number) =>
      (await sql<{ name: string; must_rename: boolean; description: string }>(
        `SELECT name, must_rename, description FROM bym.alliance WHERE id = ?`,
        [id]
      ))[0];

    test("the leader renames once per 7 days; an Officer may not", async () => {
      const allianceId = await foundWithMember();

      expect((await call(renameAllianceController, LEADER, { alliance_name: "zz_flow_renamed" })).error).toBe(0);
      expect((await nameOf(allianceId))!.name).toBe("zz_flow_renamed");
      expect((await call(renameAllianceController, LEADER, { alliance_name: "zz_flow_again" })).refused).toContain(
        "once every 7 days"
      );

      await sql(`UPDATE bym.alliance SET renamed_at = now() - interval '8 days' WHERE id = ?`, [allianceId]);
      await call(setMemberRank, LEADER, { userid: MEMBER, role: "officer" });
      expect((await call(renameAllianceController, MEMBER, { alliance_name: "zz_flow_officer" })).refused).toBeDefined();
      expect((await call(renameAllianceController, LEADER, { alliance_name: "zz_flow_again" })).error).toBe(0);
    });

    test("an admin rename gives '#Alliance {id}' and lets the leader rename at once", async () => {
      const allianceId = await foundWithMember();
      await call(renameAllianceController, LEADER, { alliance_name: "zz_flow_renamed" });

      expect(await adminAllianceAction(adminEm(), allianceId, BASE, "rename")).toMatchObject({ outcome: "done" });
      expect(await nameOf(allianceId)).toMatchObject({ name: `#Alliance ${allianceId}`, must_rename: true });
      expect((await call(myAlliance, LEADER)).alliance).toMatchObject({ must_rename: true, rename_available_at: null });

      // No player may pick a name shaped like the placeholder, with or without the "#".
      for (const alliance_name of [`Alliance ${allianceId + 1}`, `#Alliance ${allianceId + 1}`, "alliance-77"]) {
        expect((await call(renameAllianceController, LEADER, { alliance_name })).refused).toBe(
          "The alliance name is not allowed."
        );
      }

      expect((await call(renameAllianceController, LEADER, { alliance_name: "zz_flow_clean" })).error).toBe(0);
      expect(await nameOf(allianceId)).toMatchObject({ name: "zz_flow_clean", must_rename: false });
    });

    test("an admin rename whose placeholder an old alliance holds is refused cleanly, nothing changed", async () => {
      const allianceId = await foundWithMember();
      await call(renameAllianceController, LEADER, { alliance_name: "zz_flow_offensive" });
      // An alliance from before the rule already holds the name (in any case).
      await sql(
        `INSERT INTO bym.alliance (name, leader_userid, leader_name, world_id, created_at)
         VALUES (?, ?, 'zz_flow_old', ?, now())`,
        [`#ALLIANCE ${allianceId}`, OTHER_WORLD, WORLD]
      );

      try {
        expect(await adminAllianceAction(adminEm(), allianceId, BASE, "rename")).toEqual({
          outcome: "nameTaken",
          name: `#Alliance ${allianceId}`,
        });
        expect(await nameOf(allianceId)).toMatchObject({ name: "zz_flow_offensive", must_rename: false });
      } finally {
        await sql(`DELETE FROM bym.alliance WHERE name = ?`, [`#ALLIANCE ${allianceId}`]);
      }
    });

    test("a report lands once on the dashboard; clearing the ad closes it", async () => {
      const allianceId = await foundWithMember();

      expect((await call(reportAllianceController, MEMBER, { alliance_id: allianceId })).refused).toContain("your own");
      expect((await call(reportAllianceController, OTHER_WORLD, { alliance_id: allianceId, reason: "rude ad" })).error).toBe(0);
      expect((await call(reportAllianceController, OTHER_WORLD, { alliance_id: allianceId })).error).toBe(0);

      const listed = (await listAllianceReports(adminEm())).filter((row) => row.alliance_id === allianceId);
      expect(listed).toHaveLength(1);
      expect(listed[0]).toMatchObject({ reports: 1, reasons: ["rude ad"], reported_desc: "A test alliance" });

      expect(await adminAllianceAction(adminEm(), allianceId, BASE, "clear_ad")).toEqual({ outcome: "done", closed: 1 });
      expect((await nameOf(allianceId))!.description).toBe("");
      expect((await listAllianceReports(adminEm())).filter((row) => row.alliance_id === allianceId)).toEqual([]);
    });

    test("an admin disband frees every member without the 24-hour wait, and is logged", async () => {
      const allianceId = await foundWithMember();

      expect(await adminAllianceAction(adminEm(), allianceId, BASE, "disband")).toMatchObject({ outcome: "done" });
      expect(await allianceExists(allianceId)).toBe(false);
      expect(await membership(MEMBER)).toEqual({ alliance_id: null, role: null });

      const [row] = await sql<{ alliance_left_at: Date | null }>(
        `SELECT alliance_left_at FROM bym."user" WHERE userid = ?`,
        [MEMBER]
      );
      expect(row!.alliance_left_at).toBeNull();

      const log = await sql(`SELECT action FROM bym.alliance_admin_action WHERE alliance_id = ?`, [allianceId]);
      expect(log.map((entry) => entry.action)).toEqual(["disband"]);
      expect(await adminAllianceAction(adminEm(), allianceId, BASE, "disband")).toEqual({ outcome: "noAlliance" });
    });
  });

  describe("Officers", () => {
    /** Founds with MEMBER in, and makes MEMBER an Officer. */
    const foundWithOfficer = async () => {
      const allianceId = await foundWithMember();
      expect((await call(setMemberRank, LEADER, { userid: MEMBER, role: "officer" })).changed).toBe(true);
      return allianceId;
    };

    test("an Officer invites, and answers a join request", async () => {
      const allianceId = await foundWithOfficer();

      expect((await call(inviteUser, MEMBER, { userid: PLAYER })).error).toBe(0);
      await call(changeInviteStatus, PLAYER, { invite_id: await pendingInviteId(PLAYER), status: "declined" });

      await call(requestJoin, PLAYER, { alliance_id: allianceId });
      const body = await call(changeInviteStatus, MEMBER, { invite_id: await pendingInviteId(PLAYER), status: "accepted" });

      expect(body.error).toBe(0);
      expect(await membership(PLAYER)).toEqual({ alliance_id: allianceId, role: "member" });
    });

    test("an Officer kicks a Member but not the Leader; the Leader kicks an Officer", async () => {
      const allianceId = await foundWithOfficer();
      await call(requestJoin, PLAYER, { alliance_id: allianceId });
      await call(changeInviteStatus, LEADER, { invite_id: await pendingInviteId(PLAYER), status: "accepted" });

      expect((await call(kickMember, MEMBER, { userid: LEADER })).refused).toBe("You cannot kick members.");
      expect((await call(kickMember, MEMBER, { userid: PLAYER })).error).toBe(0);
      expect((await call(kickMember, LEADER, { userid: MEMBER })).error).toBe(0);
      expect(await membership(MEMBER)).toEqual({ alliance_id: null, role: null });
    });

    test("an Officer cannot kick another Officer", async () => {
      const allianceId = await foundWithOfficer();
      await call(requestJoin, PLAYER, { alliance_id: allianceId });
      await call(changeInviteStatus, LEADER, { invite_id: await pendingInviteId(PLAYER), status: "accepted" });
      await call(setMemberRank, LEADER, { userid: PLAYER, role: "officer" });

      expect((await call(kickMember, MEMBER, { userid: PLAYER })).refused).toBe("You cannot kick members.");
      expect(await membership(PLAYER)).toEqual({ alliance_id: allianceId, role: "officer" });
    });

    test("a Midas' Council has two Officer seats", async () => {
      const allianceId = await foundWithOfficer();
      await fill(allianceId, 2);
      const [first, second] = FILLERS;

      expect((await call(setMemberRank, LEADER, { userid: first, role: "officer" })).changed).toBe(true);
      expect((await call(setMemberRank, LEADER, { userid: second, role: "officer" })).refused).toBe(
        "Your alliance already has 2 Officers, the most its type allows."
      );

      expect((await call(setMemberRank, LEADER, { userid: first, role: "member" })).changed).toBe(true);
      expect((await call(setMemberRank, LEADER, { userid: second, role: "officer" })).changed).toBe(true);
    });

    test("only the Leader changes ranks", async () => {
      const allianceId = await foundWithOfficer();
      await fill(allianceId, 1);

      expect((await call(setMemberRank, MEMBER, { userid: FILLERS[0], role: "officer" })).refused).toBeDefined();
    });

    test("handing over to an Officer leaves the old Leader an Officer", async () => {
      const allianceId = await foundWithOfficer();

      expect((await call(promoteMember, LEADER, { userid: MEMBER })).error).toBe(0);
      expect(await membership(MEMBER)).toEqual({ alliance_id: allianceId, role: "leader" });
      expect(await membership(LEADER)).toEqual({ alliance_id: allianceId, role: "officer" });
    });

    test("an Officer edits the ad but not the shield", async () => {
      await foundWithOfficer();

      expect((await call(editAlliance, MEMBER, { alliance_image: 3, alliance_desc: "New ad" })).error).toBe(0);
      expect((await call(editAlliance, MEMBER, { alliance_image: 9, alliance_desc: "New ad" })).refused).toBeDefined();
    });

    describe("the marketplace ad: joining mode, language, time zone, minimum level (design v5 §7a)", () => {
      /** Makes `userid` a high-level player (far past level 40). */
      const raiseLevel = (userid: number) =>
        sql(`UPDATE bym.save SET points = '100000000000' WHERE userid = ? AND type = 'main'`, [userid]);

      test("founding saves the ad; myalliance and search send it back", async () => {
        const created = await found(LEADER, { join_mode: "open", language: "ph", time_zone: "8", min_level: "35" });

        expect(created.alliance).toMatchObject({ join_mode: "open", language: "PH", time_zone: 8, min_level: 35 });
        expect((await call(myAlliance, LEADER)).alliance).toMatchObject({
          join_mode: "open",
          language: "PH",
          time_zone: 8,
          min_level: 35,
        });

        const row = (await call(searchAlliances, PLAYER, { search: "zz_flow", page: 0 })).alliances[0];

        expect(row).toMatchObject({
          description: "A test alliance",
          join_mode: "open",
          language: "PH",
          time_zone: 8,
          min_level: 35,
        });
      });

      test("left out, the ad is Ask to join, any language, no time zone, level 30", async () => {
        const created = await found();

        expect(created.alliance).toMatchObject({ join_mode: "ask", language: null, time_zone: null, min_level: 30 });
      });

      test("an Open alliance takes the player at once, with no request left behind", async () => {
        const allianceId = (await found(LEADER, { join_mode: "open" })).alliance.alliance_id;

        const body = await call(requestJoin, PLAYER, { alliance_id: allianceId });

        expect(body).toEqual({ error: 0, joined: true });
        expect(await membership(PLAYER)).toEqual({ alliance_id: allianceId, role: "member" });
        expect(await pendingInviteId(PLAYER)).toBeNull();
      });

      test("Ask to join leaves a request for the Leader", async () => {
        const allianceId = (await found(LEADER, { join_mode: "ask" })).alliance.alliance_id;

        expect(await call(requestJoin, PLAYER, { alliance_id: allianceId })).toEqual({ error: 0, joined: false });
        expect(await membership(PLAYER)).toEqual({ alliance_id: null, role: null });
        expect(await pendingInviteId(PLAYER)).not.toBeNull();
      });

      test("an Open alliance with no seat left refuses", async () => {
        const allianceId = (await found(LEADER, { join_mode: "open" })).alliance.alliance_id;
        await fill(allianceId, 14);

        expect((await call(requestJoin, PLAYER, { alliance_id: allianceId })).refused).toBe("The alliance is already full.");
        expect((await membership(PLAYER)).alliance_id).toBeNull();
      });

      test("Invite only refuses an ask, but the Leader's invite still lets the player in", async () => {
        const allianceId = (await found(LEADER, { join_mode: "invite" })).alliance.alliance_id;

        expect((await call(requestJoin, PLAYER, { alliance_id: allianceId })).refused).toBe(
          "That alliance takes members by invite only."
        );
        expect(await pendingInviteId(PLAYER)).toBeNull();

        expect((await call(inviteUser, LEADER, { userid: PLAYER })).error).toBe(0);
        await call(changeInviteStatus, PLAYER, { invite_id: await pendingInviteId(PLAYER), status: "accepted" });

        expect(await membership(PLAYER)).toEqual({ alliance_id: allianceId, role: "member" });
      });

      test("a minimum level above 30 refuses a lower player, Open or Ask; a high enough one gets in", async () => {
        const open = (await found(LEADER, { join_mode: "open", min_level: "40" })).alliance.alliance_id;
        const ask = (await found(MEMBER, { alliance_name: "zz_flow_ask", min_level: "40" })).alliance.alliance_id;

        expect((await call(requestJoin, PLAYER, { alliance_id: open })).refused).toBe(
          "That alliance takes players from level 40."
        );
        expect((await call(requestJoin, PLAYER, { alliance_id: ask })).refused).toBe(
          "That alliance takes players from level 40."
        );
        expect((await membership(PLAYER)).alliance_id).toBeNull();
        expect(await pendingInviteId(PLAYER)).toBeNull();

        await raiseLevel(PLAYER);

        expect((await call(requestJoin, PLAYER, { alliance_id: ask })).joined).toBe(false);
        await sql(`DELETE FROM bym.alliance_invite WHERE user_id = ?`, [PLAYER]);
        expect((await call(requestJoin, PLAYER, { alliance_id: open })).joined).toBe(true);
        expect((await membership(PLAYER)).alliance_id).toBe(open);
      });

      test("level 30, the floor, takes a player of any level", async () => {
        const allianceId = (await found(LEADER, { join_mode: "open", min_level: "30" })).alliance.alliance_id;

        expect((await call(requestJoin, PLAYER, { alliance_id: allianceId })).joined).toBe(true);
      });

      test("an Officer edits the whole ad; fields left out stay; bad values are refused", async () => {
        await foundWithOfficer();
        const edit = (extra: Record<string, unknown>) =>
          call(editAlliance, MEMBER, { alliance_image: 3, alliance_desc: "New ad", ...extra });

        const saved = await edit({ join_mode: "invite", language: "de", time_zone: "-5", min_level: "50" });

        expect(saved.alliance).toMatchObject({ join_mode: "invite", language: "DE", time_zone: -5, min_level: 50 });
        expect((await edit({})).alliance).toMatchObject({ join_mode: "invite", language: "DE", time_zone: -5, min_level: 50 });
        expect((await edit({ language: "", time_zone: "" })).alliance).toMatchObject({ language: null, time_zone: null });

        for (const bad of [
          { join_mode: "closed" },
          { language: "XX" },
          { time_zone: "15" },
          { time_zone: "-13" },
          { min_level: "29" },
          { min_level: "61" },
        ]) {
          expect((await edit(bad)).refused).toBeDefined();
        }
        expect((await call(myAlliance, MEMBER)).alliance).toMatchObject({ join_mode: "invite", min_level: 50 });
      });

      test("a Member cannot change the ad", async () => {
        await foundWithMember();

        expect(
          (await call(editAlliance, MEMBER, { alliance_image: 3, alliance_desc: "x", join_mode: "open" })).refused
        ).toBeDefined();
      });

      test("search narrows to Open only, one language and one type", async () => {
        await found(LEADER, { join_mode: "open", language: "PH", alliance_type: "midas" });
        await found(MEMBER, { alliance_name: "zz_flow_ask", join_mode: "ask", language: "DE", alliance_type: "conquest" });
        const names = async (extra: Record<string, unknown>) =>
          (await call(searchAlliances, PLAYER, { search: "zz_flow", page: 0, ...extra })).alliances
            .map((row: { name: string }) => row.name)
            .sort();

        expect(await names({})).toEqual([NAME, "zz_flow_ask"]);
        expect(await names({ open: "true" })).toEqual([NAME]);
        expect(await names({ language: "de" })).toEqual(["zz_flow_ask"]);
        expect(await names({ type: "conquest" })).toEqual(["zz_flow_ask"]);
        expect(await names({ type: "nonsense", language: "XX" })).toEqual([NAME, "zz_flow_ask"]);
      });

      test("an Open alliance that turns Ask to join in between takes a request instead", async () => {
        const allianceId = (await found(LEADER, { join_mode: "open" })).alliance.alliance_id;
        await call(editAlliance, LEADER, { alliance_image: 3, alliance_desc: "A test alliance", join_mode: "ask" });

        expect((await call(requestJoin, PLAYER, { alliance_id: allianceId })).joined).toBe(false);
        expect((await membership(PLAYER)).alliance_id).toBeNull();
      });
    });

    test("myalliance tells an Officer what they may do", async () => {
      await foundWithOfficer();

      const mine = await call(myAlliance, MEMBER);

      expect(mine.alliance.role).toBe("officer");
      expect(mine.alliance.permissions).toContain("kickMember");
      expect(mine.alliance.permissions).not.toContain("kickOfficer");
    });
  });

  test("an attack on a member's outpost is stored as an under-attack line, read back with its cell", async () => {
    const allianceId = await foundWithMember();
    requestEm = orm!.em.fork();
    const defender = await requestEm.findOneOrFail(User, { userid: MEMBER });
    const alert = underAttackShout({
      defender,
      attacker: { userid: PLAYER, username: "Bob" },
      baseType: BaseType.OUTPOST,
      cell: { x: 12, y: 40 },
    });

    await emitShout({ ...alert!, em: requestEm });

    const last = (await getAllianceMessages(allianceId, orm!.em.fork())).at(-1)!;
    expect(String(last.messageType)).toBe("under_attack");
    expect(last.cell).toEqual({ x: 12, y: 40 });
    expect(last.body).toContain("(12, 40) is under attack by Bob!");
  });
});
