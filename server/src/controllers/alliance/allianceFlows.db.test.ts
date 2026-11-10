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
const { changeInviteStatus } = await import("./changeInviteStatus.js");
const { leaveAlliance } = await import("./leaveAlliance.js");
const { kickMember } = await import("./kickMember.js");
const { promoteMember } = await import("./promoteMember.js");

const BASE = 993_800;
const LEADER = BASE + 1;
const PLAYER = BASE + 2;
const MEMBER = BASE + 3;
const OTHER_WORLD = BASE + 4;
const USERS = [LEADER, PLAYER, MEMBER, OTHER_WORLD];
const WORLD = "00000000-0000-4000-8000-000000993801";
const WORLD_2 = "00000000-0000-4000-8000-000000993802";
const NAME = "zz_flow_alliance";

const sql = <R = Record<string, any>>(query: string, params: unknown[] = []) =>
  orm!.em.fork().execute<R[]>(query, params);

const clear = async () => {
  await sql(`DELETE FROM bym.alliance WHERE name LIKE 'zz_flow_%'`);
  await sql(`DELETE FROM bym.alliance_invite WHERE user_id IN (${USERS.join(",")})`);
  await sql(`UPDATE bym."user" SET save_basesaveid = NULL WHERE userid IN (${USERS.join(",")})`);
  await sql(`DELETE FROM bym.save WHERE userid IN (${USERS.join(",")})`);
  await sql(`DELETE FROM bym."user" WHERE userid IN (${USERS.join(",")})`);
  await sql(`DELETE FROM bym.world WHERE uuid IN (?, ?)`, [WORLD, WORLD_2]);
};

/** A player with a Map Room 2 main yard in the given world. */
const addPlayer = async (userid: number, world = WORLD, buildings: Record<string, unknown> = {}) => {
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

  test("a declined invite joins no one", async () => {
    await found();
    await call(inviteUser, LEADER, { userid: PLAYER });

    await call(changeInviteStatus, PLAYER, { invite_id: await pendingInviteId(PLAYER), status: "declined" });

    expect(await membership(PLAYER)).toEqual({ alliance_id: null, role: null });
  });

  test("an ordinary member cannot invite", async () => {
    await foundWithMember();

    expect((await call(inviteUser, MEMBER, { userid: PLAYER })).refused).toBeDefined();
    expect(await pendingInviteId(PLAYER)).toBeNull();
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
});
