import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { MikroORM } from "@mikro-orm/postgresql";

import ormConfig from "../../mikro-orm.config.js";
import type { User } from "../../database/models/user.model.js";
import type { AbandonedInput, AbandonedOutcome } from "../base/combat/abandonedAttack.js";
import { memoryRedis } from "../../testing/memoryRedis.js";

/**
 * Friend tests of a yard on a real database (beta 9 feature #4): who may be
 * invited, how long an invite lasts, the cap, the Results list and its
 * pruning, and that a test changes nothing real for anyone. Runs on the
 * friends suite's throwaway database (`FRIENDS_TEST_DB`, as CI sets it).
 */

const dbName = process.env.FRIENDS_TEST_DB;

mock.module("../../server.js", () => ({ postgres: { em: null }, redis: memoryRedis() }));

const flow = await import("./baiterTests.js");
const { memoryRunTickets } = await import("./baiterRunStore.js");
const { RESULT_LIMIT } = await import("./baiterTestRules.js");

const INVITER = 995_001;
const FRIEND = 995_002;
const MATE = 995_003;
const STRANGER = 995_004;
const BLOCKER = 995_005;
const NO_BAITER = 995_006;
const EVERYONE = [INVITER, FRIEND, MATE, STRANGER, BLOCKER, NO_BAITER];
const LIST = EVERYONE.join(",");
const NAMES: Record<number, string> = {
  [INVITER]: "zz_bt_inviter",
  [FRIEND]: "zz_bt_friend",
  [MATE]: "zz_bt_mate",
  [STRANGER]: "zz_bt_stranger",
  [BLOCKER]: "zz_bt_blocker",
  [NO_BAITER]: "zz_bt_nobaiter",
};
const HOUR = 60 * 60;
const DAY = 24 * HOUR;
const T0 = Math.floor(Date.UTC(2026, 10, 23, 12) / 1000);

/** The inviter's yard: a level 3 Baiter (cap 1,200) and a Town Hall, a little damaged. */
const YARD = {
  1: { t: 14, X: 0, Y: 0, l: 3 },
  2: { t: 19, X: 100, Y: 100, l: 3 },
  3: { t: 1, X: -100, Y: 100, l: 2 },
};

describe.skipIf(!dbName)("friend tests of a yard on a real database (beta 9 #4)", () => {
  let orm: MikroORM;
  const em = () => orm.em.fork();
  const sql = <R = Record<string, any>>(query: string, params: unknown[] = []) => em().execute<R[]>(query, params);
  const as = (userid: number) => ({ userid, username: NAMES[userid], pic_square: null }) as unknown as User;

  const fought: AbandonedInput[] = [];
  let damage = 42;
  const notices: { userid: number; notice: unknown }[] = [];
  let tickets = memoryRunTickets();
  let tokens = 0;
  const deps = () => ({
    tickets,
    forces: async () => ({ bunkers: [] }) as never,
    fight: async (input: AbandonedInput) => {
      fought.push(input);
      return { tick: input.tick, damage, attackreport: "report", destroyed: undefined } as unknown as AbandonedOutcome;
    },
    notify: async (_em: unknown, userid: number, notice: unknown) => {
      notices.push({ userid, notice });
    },
    rulesVersion: "rules-test",
    makeToken: () => `token-${++tokens}-abcdef`,
    makeSeed: () => 777,
  });

  const reasonOf = async (call: Promise<unknown>): Promise<unknown> => {
    try {
      await call;
    } catch (err) {
      const refusal = err as { status?: number; data?: { reason?: string } };
      return refusal.data?.reason ?? `status ${refusal.status}: ${String(err)}`;
    }
    return "not refused";
  };

  const invite = (userids: number[], now = T0, from = INVITER) => flow.inviteAnswer(em(), as(from), { userids }, now, deps()) as Promise<any>;
  const tests = (userid: number, now = T0) => flow.testsAnswer(em(), as(userid), now, deps()) as Promise<any>;
  const start = (tester: number, now = T0, inviter = INVITER) => flow.startAnswer(em(), as(tester), { inviter }, now, deps()) as Promise<any>;
  const ARMY = { monsters: { C1: { count: 40, level: 2 } }, champions: [] };
  const finish = (tester: number, token: string, extra: Record<string, unknown> = {}, now = T0 + 60) =>
    flow.finishAnswer(
      em(),
      as(tester),
      {
        token,
        army: ARMY,
        flinglog: { v: 1, seed: 777, events: [{ kind: "fling", t: 400, x: 10, y: 10, r: 0, monsters: { C1: 40 } }] },
        tick: 400 + 80 * 90,
        report: { result: "held", resultLine: "held", damagePercent: damage },
        ...extra,
      },
      now,
      deps()
    ) as Promise<any>;
  const saveRows = () =>
    sql(
      `SELECT userid, resources, buildinghealthdata, buildingdata, monsters, champion, damage, protected, attacks
         FROM bym.save WHERE userid IN (${LIST}) ORDER BY userid`
    );

  const clear = async () => {
    await sql(`DELETE FROM bym.baiter_invite WHERE inviter_userid IN (${LIST}) OR tester_userid IN (${LIST})`);
    await sql(`DELETE FROM bym.baiter_test WHERE inviter_userid IN (${LIST})`);
    await sql(`DELETE FROM bym.friend WHERE userid IN (${LIST}) OR friend_userid IN (${LIST})`);
    await sql(`UPDATE bym."user" SET blocked_users = '[]', alliance_id = NULL, banned = false WHERE userid IN (${LIST})`);
    await sql(`DELETE FROM bym.alliance WHERE name LIKE 'zz_bt_alliance%'`);
    for (const [a, b] of [
      [INVITER, FRIEND],
      [INVITER, BLOCKER],
      [NO_BAITER, FRIEND],
    ] as const) {
      await sql(`INSERT INTO bym.friend (userid, friend_userid, created_at) VALUES (?, ?, now()), (?, ?, now())`, [a, b, b, a]);
    }
    // The mate shares an alliance with the inviter; the stranger is in another.
    const alliance = async (name: string, leader: number): Promise<number> =>
      Number(
        (
          await sql<{ id: number }>(
            `INSERT INTO bym.alliance (name, leader_userid, leader_name, world_id, created_at)
             VALUES (?, ?, ?, '00000000-0000-4000-8000-0000000f71e0', now()) RETURNING id`,
            [name, leader, NAMES[leader]]
          )
        )[0]!.id
      );
    await sql(`UPDATE bym."user" SET alliance_id = ? WHERE userid IN (?, ?)`, [await alliance("zz_bt_alliance1", INVITER), INVITER, MATE]);
    await sql(`UPDATE bym."user" SET alliance_id = ? WHERE userid = ?`, [await alliance("zz_bt_alliance2", STRANGER), STRANGER]);
    await sql(`UPDATE bym."user" SET blocked_users = ?::jsonb WHERE userid = ?`, [JSON.stringify([INVITER]), BLOCKER]);
    fought.length = 0;
    notices.length = 0;
    tickets = memoryRunTickets();
    damage = 42;
  };

  beforeAll(async () => {
    if (dbName === "bym") throw new Error("FRIENDS_TEST_DB must be a throwaway database, not bym");
    orm = await MikroORM.init({ ...ormConfig, dbName, debug: false, pool: { min: 0, max: 4 } });
    for (const userid of EVERYONE) {
      const name = NAMES[userid]!;
      await sql(
        `INSERT INTO bym."user" (userid, username, email, password, blocked_users) VALUES (?, ?, ?, 'x', '[]') ON CONFLICT DO NOTHING`,
        [userid, name, `${name}@test.invalid`]
      );
      const [existing] = await sql(`SELECT basesaveid FROM bym.save WHERE userid = ? AND type = 'main'`, [userid]);
      const basesaveid =
        existing?.basesaveid ??
        (
          await sql(
            `INSERT INTO bym.save (userid, saveuserid, baseid, type, points, basevalue, createtime, name, credits, attacks,
                                   takeover_date, created_at, lastupdate_at)
             VALUES (?, ?, ?, 'main', '0', '0', ?, 'yard', 0, '[]', now(), now(), now()) RETURNING basesaveid`,
            [userid, userid, `${userid}00`, T0 - 30 * DAY]
          )
        )[0]!.basesaveid;
      await sql(`UPDATE bym."user" SET save_basesaveid = ? WHERE userid = ?`, [basesaveid, userid]);
      const yard = userid === NO_BAITER ? { 1: { t: 14, X: 0, Y: 0, l: 3 } } : YARD;
      await sql(
        `UPDATE bym.save SET buildingdata = ?::jsonb, buildinghealthdata = ?::jsonb, resources = ?::jsonb WHERE basesaveid = ?`,
        [JSON.stringify(yard), JSON.stringify({ 1: 900 }), JSON.stringify({ r1: 5000, r2: 6000 }), basesaveid]
      );
    }
  });

  beforeEach(clear);

  afterAll(async () => {
    if (!orm) return;
    await clear();
    await sql(`UPDATE bym."user" SET alliance_id = NULL WHERE userid IN (${LIST})`);
    await sql(`DELETE FROM bym.alliance WHERE name LIKE 'zz_bt_alliance%'`);
    await sql(`DELETE FROM bym.friend WHERE userid IN (${LIST}) OR friend_userid IN (${LIST})`);
    await sql(`DELETE FROM bym.save WHERE userid IN (${LIST})`);
    await sql(`DELETE FROM bym."user" WHERE userid IN (${LIST})`);
    await orm.close(true);
  });

  test("invites go to friends and alliance mates only, once each, for 24 hours, with a notice", async () => {
    const sent = await invite([FRIEND, MATE, STRANGER, BLOCKER, INVITER]);
    expect(sent).toMatchObject({ error: 0, invited: 2, skipped: 2, expiresAt: T0 + DAY });
    expect(notices).toEqual([
      { userid: FRIEND, notice: { event: "baiterInvite", userid: INVITER, username: "zz_bt_inviter", expires: T0 + DAY } },
      { userid: MATE, notice: { event: "baiterInvite", userid: INVITER, username: "zz_bt_inviter", expires: T0 + DAY } },
    ]);
    expect(await reasonOf(invite([STRANGER]))).toBe("notFriend");
    expect(await reasonOf(invite([FRIEND], T0, NO_BAITER))).toBe("noBaiter");

    // Sent again later: renewed for 24 h from then, and no second notice.
    await invite([FRIEND], T0 + 5 * HOUR);
    expect(notices).toHaveLength(2);
    const mine = await tests(INVITER, T0 + 5 * HOUR);
    expect(mine.invited.map((one: any) => [one.userid, one.expiresAt, one.tests])).toEqual([
      [FRIEND, T0 + 5 * HOUR + DAY, 0],
      [MATE, T0 + DAY, 0],
    ]);
  });

  test("the Invite tab lists friends and mates once each, never a stranger or someone who blocked you", async () => {
    const mine = await tests(INVITER);
    expect(mine).toMatchObject({ error: 0, baiterLevel: 3, cap: 1200, inviteSeconds: DAY, keepSeconds: 7 * DAY });
    expect(mine.candidates.map((one: any) => [one.userid, one.friend, one.alliance])).toEqual([
      [FRIEND, true, false],
      [MATE, false, true],
    ]);
    // A player with no Baiter gets no one to invite, but still sees their own invites.
    expect((await tests(NO_BAITER)).candidates).toEqual([]);
  });

  test("Invited me: the inviter, the cap from THEIR Baiter, the time left; gone when it lapses or is cancelled", async () => {
    await invite([FRIEND, MATE]);
    const friend = await tests(FRIEND, T0 + HOUR);
    expect(friend.invitedMe).toEqual([
      expect.objectContaining({ userid: INVITER, username: "zz_bt_inviter", cap: 1200, expiresAt: T0 + DAY }),
    ]);
    expect((await tests(FRIEND, T0 + DAY)).invitedMe).toEqual([]);
    expect(await reasonOf(start(FRIEND, T0 + DAY))).toBe("noInvite");

    expect(await flow.cancelAnswer(em(), as(INVITER), { userid: MATE }, T0 + HOUR)).toEqual({ error: 0, cancelled: true });
    expect((await tests(MATE, T0 + HOUR)).invitedMe).toEqual([]);
    expect(await reasonOf(start(MATE, T0 + HOUR))).toBe("noInvite");
    expect(await reasonOf(start(STRANGER))).toBe("noInvite");
  });

  test("a test: served the inviter's yard without its pool, fought again by the server, kept for the inviter", async () => {
    await invite([FRIEND]);
    const before = await saveRows();
    const started = await start(FRIEND);
    expect(started).toMatchObject({ error: 0, seed: 777, cap: 1200, baiterLevel: 3, inviter: { userid: INVITER, name: "zz_bt_inviter" } });
    expect(started.load.buildingdata).toEqual(YARD);
    expect(started.load.resources).toEqual({});
    expect(started.load.baseid).toBe(`${INVITER}00`);

    const done = await finish(FRIEND, started.token);
    expect(done).toMatchObject({ error: 0, damage: 42, result: "held", reportKept: true });
    expect(fought).toHaveLength(1);
    expect(fought[0]!.defender).toMatchObject({ type: "main", kind: "main", buildingdata: YARD, resources: {} });
    expect(fought[0]!.attacker.academy).toMatchObject({ C1: { level: 2 } });
    expect(fought[0]!.log.seed).toBe(777);

    // Nothing real moved for anyone: every save row is as it was.
    expect(await saveRows()).toEqual(before);

    expect(notices.at(-1)).toEqual({
      userid: INVITER,
      notice: { event: "baiterTest", userid: FRIEND, username: "zz_bt_friend", damage: 42, result: "held", testid: done.id },
    });
    const mine = await tests(INVITER, T0 + 120);
    expect(mine.invited[0]).toMatchObject({ userid: FRIEND, tests: 1 });
    expect(mine.results).toEqual([
      expect.objectContaining({
        id: done.id,
        tester: expect.objectContaining({ userid: FRIEND, name: "zz_bt_friend" }),
        foughtAt: T0 + 60,
        damage: 42,
        result: "held",
        seconds: 90,
        hasReport: true,
        hasReplay: true,
        playable: true,
      }),
    ]);
    // Test results are the inviter's own list: never the tester's.
    expect((await tests(FRIEND, T0 + 120)).results).toEqual([]);

    const replay = await flow.testAnswer(em(), as(INVITER), { id: done.id }, T0 + 120, deps());
    expect(replay.status).toBe(200);
    expect((replay.body as any).replay).toMatchObject({ v: 1, seed: 777, levels: { C1: 2 }, report: { result: "held" } });
    expect((replay.body as any).replay.load.buildingdata).toEqual(YARD);
    expect((await flow.testAnswer(em(), as(FRIEND), { id: done.id }, T0 + 120, deps())).status).toBe(404);
  });

  test("a JSON body's lists and objects arrive as strings (middleware/jsonBody.ts) and are read all the same", async () => {
    expect(await flow.inviteAnswer(em(), as(INVITER), { userids: JSON.stringify([FRIEND]) }, T0, deps())).toMatchObject({ invited: 1 });
    const started = await start(FRIEND);
    const done = await flow.finishAnswer(
      em(),
      as(FRIEND),
      {
        token: started.token,
        army: JSON.stringify(ARMY),
        flinglog: JSON.stringify({ v: 1, seed: 777, events: [{ kind: "fling", t: 400, x: 10, y: 10, r: 0, monsters: { C1: 40 } }] }),
        tick: String(400 + 80 * 90),
        report: JSON.stringify({ result: "time", resultLine: "x", damagePercent: 42 }),
      },
      T0 + 60,
      deps()
    );
    expect(done).toMatchObject({ error: 0, damage: 42, result: "time", reportKept: true });
  });

  test("the ticket is spent once, and a test cannot be sent without one", async () => {
    await invite([FRIEND]);
    const started = await start(FRIEND);
    expect(await reasonOf(finish(FRIEND, "not-the-token"))).toBe("noTicket");
    // The wrong token spent it: the real one is no good now either.
    expect(await reasonOf(finish(FRIEND, started.token))).toBe("noTicket");
    const again = await start(FRIEND);
    await finish(FRIEND, again.token);
    expect(await reasonOf(finish(FRIEND, again.token))).toBe("noTicket");
    expect(fought).toHaveLength(1);
  });

  test("the cap is the inviter's, checked on the server; drops must fit the army and the seed", async () => {
    await invite([FRIEND]);
    // 121 Bolts at 10 space = 1,210 > 1,200.
    let started = await start(FRIEND);
    expect(await reasonOf(finish(FRIEND, started.token, { army: { monsters: { C2: { count: 121, level: 1 } } } }))).toBe("overCap");
    started = await start(FRIEND);
    expect(
      await reasonOf(
        finish(FRIEND, started.token, { flinglog: { v: 1, seed: 777, events: [{ kind: "fling", t: 400, x: 0, y: 0, r: 0, monsters: { C1: 41 } }] } })
      )
    ).toBe("badEvents");
    started = await start(FRIEND);
    expect(await reasonOf(finish(FRIEND, started.token, { flinglog: { v: 1, seed: 778, events: [] } }))).toBe("badEvents");
    expect(fought).toHaveLength(0);
  });

  test("a friendship that ends mid-test ends the test", async () => {
    await invite([FRIEND]);
    const started = await start(FRIEND);
    await sql(`DELETE FROM bym.friend WHERE userid IN (?, ?) AND friend_userid IN (?, ?)`, [INVITER, FRIEND, INVITER, FRIEND]);
    expect(await reasonOf(finish(FRIEND, started.token))).toBe("notFriend");
    expect((await tests(FRIEND)).invitedMe).toEqual([]);
  });

  test("a report that disagrees with the server is not kept, and the result falls back", async () => {
    await invite([MATE]);
    const started = await start(MATE);
    const done = await finish(MATE, started.token, { report: { result: "flattened", resultLine: "x", damagePercent: 100 } });
    expect(done).toMatchObject({ damage: 42, result: "stopped", reportKept: false });
    const [row] = (await tests(INVITER, T0 + 120)).results;
    expect(row).toMatchObject({ hasReport: false, hasReplay: true });
  });

  test("results are kept 7 days, the newest 50, and only playable under the same rules", async () => {
    await sql(
      `INSERT INTO bym.baiter_test (inviter_userid, tester_userid, tester_username, baseid, fought_at, damage, result, seconds,
                                    rules_version, has_report, replay, replay_bytes)
       SELECT ?, ?, 'zz_bt_friend', 'b', to_timestamp(? - g * 60), 10, 'held', 60, 'old-rules', false, NULL, 0
         FROM generate_series(1, 60) g`,
      [INVITER, FRIEND, T0]
    );
    await sql(
      `INSERT INTO bym.baiter_test (inviter_userid, tester_userid, tester_username, baseid, fought_at, damage, result, seconds,
                                    rules_version, has_report, replay, replay_bytes)
       VALUES (?, ?, 'zz_bt_friend', 'b', to_timestamp(?), 10, 'held', 60, 'rules-test', false, NULL, 0)`,
      [INVITER, FRIEND, T0 - 8 * DAY]
    );
    const listed = (await tests(INVITER)).results;
    expect(listed).toHaveLength(RESULT_LIMIT);
    expect(listed.every((one: any) => one.playable === false && one.hasReplay === false)).toBe(true);

    // A new test prunes: the 8-day-old row and everything past the newest 50 go.
    await invite([FRIEND]);
    const started = await start(FRIEND);
    await finish(FRIEND, started.token);
    const [{ count }] = await sql<{ count: string }>(`SELECT count(*) FROM bym.baiter_test WHERE inviter_userid = ?`, [INVITER]);
    expect(Number(count)).toBe(RESULT_LIMIT);
    const newest = (await tests(INVITER, T0 + 120)).results[0];
    expect(newest).toMatchObject({ playable: true, hasReplay: true });
  });
});
