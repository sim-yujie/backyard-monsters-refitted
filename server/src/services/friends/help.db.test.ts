import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { MikroORM } from "@mikro-orm/postgresql";

import ormConfig from "../../mikro-orm.config.js";
import type { User } from "../../database/models/user.model.js";
import { memoryRedis } from "../../testing/memoryRedis.js";

/**
 * The help engine (issue #373, `docs/design/friends.md` §4, §6.3 and §7)
 * against a real Postgres: `POST /bm/friends/help` end to end, with the saves
 * locked, caught up and written, the `friend_help` rows, the notifications,
 * the friends list's `help` and `helpsLeft`, and the help-mode load's block.
 *
 * Opt-in: runs only when FRIENDS_TEST_DB names a throwaway database with the
 * `bym` schema and the friends migrations applied, and refuses the shared
 * `bym`. Its players are `zz_fh_*`, user ids 993_000 and up.
 */
const dbName = process.env.FRIENDS_TEST_DB;

const redis = memoryRedis();
const postgres = { em: null as unknown };
mock.module("../../server.js", () => ({ postgres, redis }));

const { helpAnswer } = await import("../../controllers/friends/help.js");
const { friendsAnswer } = await import("../../controllers/friends/friends.js");
const { helpBlock } = await import("./helpFacts.js");

/** Six helpers, the owner, and a stranger who is nobody's friend. */
const HELPERS = [993_001, 993_002, 993_003, 993_004, 993_005, 993_006];
const [H1, H2] = HELPERS as [number, number];
const OWNER = 993_010;
const STRANGER = 993_011;
const EVERYONE = [...HELPERS, OWNER, STRANGER];
const LIST = EVERYONE.join(",");

const DAY = 24 * 60 * 60;
/** 12:00 UTC on a day well after every account was made. */
const T0 = Math.floor(Date.UTC(2026, 9, 19, 12) / 1000);
const CANNON = 20;
/** Level 5 needs 7,500 points (`experiencePoints`). */
const LEVEL_5_POINTS = "20000";
/** No silos: every yard has the base storage, 10,000 here. */
const BASE_CAP = 10_000;

describe.skipIf(!dbName)("the help engine on a real database (issue #373)", () => {
  let orm: MikroORM;
  const em = () => orm.em.fork();
  const sql = <R = Record<string, any>>(query: string, params: unknown[] = []) => em().execute<R[]>(query, params);
  const as = (userid: number) => ({ userid, blockedUsers: [] }) as unknown as User;

  const help = (helper: number, buildingId: number, kind: "speedup" | "repair", now = T0, owner = OWNER) =>
    helpAnswer(em() as never, as(helper), { userid: owner, buildingId, kind }, now) as Promise<any>;

  /** `reason` (and `from`) of a 409, or what else happened. */
  const refusalOf = async (call: Promise<unknown>): Promise<any> => {
    try {
      await call;
    } catch (err) {
      const refusal = err as { status?: number; data?: { reason?: string; from?: number } };
      return refusal.status === 409 ? refusal.data : `status ${refusal.status}: ${String(err)}`;
    }
    return "not refused";
  };
  const reasonOf = async (call: Promise<unknown>) => (await refusalOf(call))?.reason ?? (await refusalOf(call));

  const yardOf = async (userid: number) => {
    const [row] = await sql(
      `SELECT s.buildingdata, s.buildinghealthdata, s.resources, s.savetime, s.damage
         FROM bym.save s JOIN bym."user" u ON u.save_basesaveid = s.basesaveid WHERE u.userid = ?`,
      [userid]
    );
    return row!;
  };
  const helpRows = (helper?: number) =>
    sql(`SELECT * FROM bym.friend_help WHERE ${helper ? `helper_userid = ${helper}` : `owner_userid IN (${LIST})`} ORDER BY id`);

  /** A cannon with an upgrade running, `left` seconds to go. */
  const upgrading = (id: number, left: number) => ({ id, t: CANNON, x: id, y: 0, l: 2, cU: left, cL: left });

  /** Every test yard has a Town Hall, or the catch-up lays a starter base over the empty yard. */
  const HALL = { id: 0, t: 14, x: -70, y: 0, l: 1 };

  const setYard = (userid: number, given: Record<string, unknown>) => {
    const fields = given.buildingdata ? { ...given, buildingdata: { "0": HALL, ...(given.buildingdata as object) } } : given;
    const sets = Object.keys(fields).map((key) => `${key} = ?`);
    const values = Object.values(fields).map((value) => (typeof value === "object" && value !== null ? JSON.stringify(value) : value));
    return sql(`UPDATE bym.save SET ${sets.join(", ")} WHERE userid = ? AND type = 'main'`, [...values, userid]);
  };

  const befriend = (a: number, b: number, since = T0 - 2 * DAY) =>
    sql(`INSERT INTO bym.friend (userid, friend_userid, created_at) VALUES (?, ?, ?), (?, ?, ?) ON CONFLICT DO NOTHING`, [
      a,
      b,
      new Date(since * 1000),
      b,
      a,
      new Date(since * 1000),
    ]);

  const reset = async () => {
    await sql(`DELETE FROM bym.friend_help WHERE helper_userid IN (${LIST}) OR owner_userid IN (${LIST})`);
    await sql(`DELETE FROM bym.friend WHERE userid IN (${LIST}) OR friend_userid IN (${LIST})`);
    await sql(`DELETE FROM bym.notification WHERE userid IN (${LIST})`);
    await sql(`UPDATE bym."user" SET blocked_users = '[]', banned = false WHERE userid IN (${LIST})`);
    await sql(
      `UPDATE bym.save SET buildingdata = ?, buildinghealthdata = '{}', resources = '{"r1":0,"r2":0,"r3":0,"r4":0}',
              savetime = ?, createtime = ?, points = ?, basevalue = '0', type = 'main', attackid = 0, attacks = '[]', damage = 0
        WHERE userid IN (${LIST})`,
      [JSON.stringify({ "0": HALL }), T0, T0 - 30 * DAY, LEVEL_5_POINTS]
    );
    for (const helper of HELPERS) await befriend(helper, OWNER);
  };

  beforeAll(async () => {
    if (dbName === "bym") throw new Error("FRIENDS_TEST_DB must be a throwaway database, not bym");
    orm = await MikroORM.init({ ...ormConfig, dbName, debug: false, pool: { min: 0, max: 10 } });
    for (const userid of EVERYONE) {
      const name = `zz_fh_${userid}`;
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
             VALUES (?, ?, ?, 'main', ?, '0', ?, 'yard', 0, '[]', now(), now(), now()) RETURNING basesaveid`,
            [userid, userid, `${userid}00`, LEVEL_5_POINTS, T0 - 30 * DAY]
          )
        )[0]!.basesaveid;
      await sql(`UPDATE bym."user" SET save_basesaveid = ? WHERE userid = ?`, [basesaveid, userid]);
    }
  });

  beforeEach(reset);

  afterAll(async () => {
    if (!orm) return;
    await reset();
    await sql(`DELETE FROM bym.friend WHERE userid IN (${LIST}) OR friend_userid IN (${LIST})`);
    await sql(`UPDATE bym."user" SET save_basesaveid = NULL WHERE userid IN (${LIST})`);
    await sql(`DELETE FROM bym.save WHERE userid IN (${LIST})`);
    await sql(`DELETE FROM bym."user" WHERE userid IN (${LIST})`);
    await orm.close(true);
  });

  test("a speed-up takes floor(5%) off the countdown, keeps hl, pays the reward, writes the row and a notice", async () => {
    await setYard(OWNER, { buildingdata: { "1": upgrading(1, 10_000) } });
    const answer = await help(H1, 1, "speedup");
    expect(answer).toMatchObject({ error: 0, secondsSaved: 500, helpsLeft: 19, reward: { r1: 25, r2: 25, r3: 25, r4: 25 } });
    expect(answer.building).toMatchObject({ id: 1, cU: 9500, hl: [H1] });

    const owner = await yardOf(OWNER);
    expect(owner.buildingdata["1"]).toMatchObject({ cU: 9500, hl: [H1] });
    expect(Number(owner.savetime)).toBe(T0);
    expect((await yardOf(H1)).resources).toMatchObject({ r1: 25, r2: 25, r3: 25, r4: 25 });

    const [row] = await helpRows(H1);
    expect(row).toMatchObject({ owner_userid: OWNER, building_id: 1, kind: "speedup", seconds_saved: 500, reward: { r1: 25 } });

    const [notice] = await sql(`SELECT jobs FROM bym.notification WHERE userid = ? AND kind = 'friend'`, [OWNER]);
    expect(notice!.jobs[0]).toEqual({ event: "helpSpeedup", userid: H1, username: `zz_fh_${H1}`, building: CANNON, buildingId: 1, seconds: 500 });
  });

  test("the countdown is caught up first: 5% of the time left now, not at the last save", async () => {
    await setYard(OWNER, { buildingdata: { "1": upgrading(1, 10_000) }, savetime: T0 - 2000 });
    expect((await help(H1, 1, "speedup")).secondsSaved).toBe(400);
    expect((await yardOf(OWNER)).buildingdata["1"].cU).toBe(7600);
  });

  test("five helpers per job, each once; a sixth and a repeat are refused and not counted", async () => {
    await setYard(OWNER, { buildingdata: { "1": upgrading(1, 100_000) } });
    for (const helper of HELPERS.slice(0, 5)) await help(helper, 1, "speedup");
    expect((await yardOf(OWNER)).buildingdata["1"]).toMatchObject({ cU: 77_380, hl: HELPERS.slice(0, 5) });

    expect(await reasonOf(help(HELPERS[5]!, 1, "speedup"))).toBe("helpersFull");
    expect(await reasonOf(help(H1, 1, "speedup"))).toBe("alreadyHelped");
    expect(await helpRows()).toHaveLength(5);
    expect(await helpRows(HELPERS[5]!)).toHaveLength(0);
  });

  test("hl goes when the job finishes; a refused help writes nothing, a counted one saves the catch-up", async () => {
    await setYard(OWNER, {
      buildingdata: { "1": upgrading(1, 1000), "2": { id: 2, t: CANNON, x: 2, y: 0, l: 2, hp: 10 } },
      buildinghealthdata: { "2": 10 },
    });
    await help(H1, 1, "speedup");
    // The job has ended by the next help: nothing to speed up, and the refusal rolls the catch-up back.
    expect(await reasonOf(help(H2, 1, "speedup", T0 + 2000))).toBe("nothingToHelp");
    expect((await yardOf(OWNER)).buildingdata["1"]).toMatchObject({ l: 2, hl: [H1] });
    // A help that lands commits the owner's catch-up: the upgrade done, hl gone.
    await help(H2, 2, "repair", T0 + 2000);
    const after = (await yardOf(OWNER)).buildingdata["1"];
    expect(after.l).toBe(3);
    expect(after.cU).toBeUndefined();
    expect(after.hl).toBeUndefined();
  });

  test("a repair heals the building to full at once, once per damage", async () => {
    await setYard(OWNER, {
      buildingdata: { "1": { id: 1, t: CANNON, x: 1, y: 0, l: 2, hp: 10, rE: 1 } },
      buildinghealthdata: { "1": 10 },
    });
    expect(await help(H1, 1, "repair")).toMatchObject({ error: 0, healed: true, helpsLeft: 19 });
    const owner = await yardOf(OWNER);
    expect(owner.buildingdata["1"].hp).toBeUndefined();
    expect(owner.buildingdata["1"].rE).toBeUndefined();
    expect(owner.buildinghealthdata).toEqual({});
    expect(await reasonOf(help(H2, 1, "repair"))).toBe("nothingToHelp");

    const [notice] = await sql(`SELECT jobs FROM bym.notification WHERE userid = ? AND kind = 'friend'`, [OWNER]);
    expect(notice!.jobs[0]).toMatchObject({ event: "helpRepair", userid: H1, buildingId: 1 });
  });

  test("the daily cap counts speed-ups and repairs together and turns over at 00:00 UTC", async () => {
    const buildings: Record<string, unknown> = {};
    for (let id = 1; id <= 21; id++) buildings[String(id)] = upgrading(id, 100_000);
    buildings["30"] = { id: 30, t: CANNON, x: 30, y: 0, l: 2, hp: 10 };
    await setYard(OWNER, { buildingdata: buildings, buildinghealthdata: { "30": 10 } });

    const lastSecond = T0 + 12 * 60 * 60 - 1; // 23:59:59 UTC
    await help(H1, 30, "repair", lastSecond - 100);
    for (let id = 1; id <= 19; id++) await help(H1, id, "speedup", lastSecond - 100 + id);
    expect(await refusalOf(help(H1, 20, "speedup", lastSecond))).toEqual({ reason: "dailyCap" });
    expect(await helpRows(H1)).toHaveLength(20);

    expect((await help(H1, 20, "speedup", lastSecond + 1)).helpsLeft).toBe(19);
  });

  test("the gates: not friends, blocked, banned, friends under a day, a new account, a low level; with from", async () => {
    await setYard(OWNER, { buildingdata: { "1": upgrading(1, 10_000) } });
    await setYard(STRANGER, { buildingdata: { "1": upgrading(1, 10_000) } });

    expect(await reasonOf(help(H1, 1, "speedup", T0, STRANGER))).toBe("notFriends");
    expect(await reasonOf(help(H1, 1, "speedup", T0, H1))).toBe("self");
    expect(await reasonOf(help(H1, 1, "speedup", T0, 993_999))).toBe("noSuchPlayer");

    await sql(`UPDATE bym."user" SET blocked_users = ? WHERE userid = ?`, [JSON.stringify([H1]), OWNER]);
    expect(await reasonOf(help(H1, 1, "speedup"))).toBe("cannotSend");
    await sql(`UPDATE bym."user" SET blocked_users = '[]' WHERE userid = ?`, [OWNER]);
    await sql(`UPDATE bym."user" SET banned = true WHERE userid = ?`, [OWNER]);
    expect(await reasonOf(help(H1, 1, "speedup"))).toBe("cannotSend");
    await sql(`UPDATE bym."user" SET banned = false WHERE userid = ?`, [OWNER]);

    await befriend(H1, STRANGER, T0 - 3600);
    expect(await refusalOf(help(H1, 1, "speedup", T0, STRANGER))).toEqual({ reason: "tooNew", from: T0 - 3600 + DAY });

    await setYard(OWNER, { createtime: T0 - DAY });
    expect(await refusalOf(help(H1, 1, "speedup"))).toEqual({ reason: "tooNew", from: T0 + 2 * DAY });
    await setYard(OWNER, { createtime: T0 - 30 * DAY, points: "100" });
    expect(await refusalOf(help(H1, 1, "speedup"))).toEqual({ reason: "tooNew" });

    expect(await helpRows()).toHaveLength(0);
    expect((await yardOf(OWNER)).buildingdata["1"].hl).toBeUndefined();
  });

  test("a yard under attack is refused, and only the main yard can be helped", async () => {
    await setYard(OWNER, { buildingdata: { "1": upgrading(1, 10_000) } });
    const realNow = Math.floor(Date.now() / 1000);
    await setYard(OWNER, { attackid: 1, attacks: [{ starttime: realNow }] });
    expect(await reasonOf(help(H1, 1, "speedup"))).toBe("underAttack");
    // A stranger is told only that they are not friends.
    expect(await reasonOf(help(STRANGER, 1, "speedup"))).toBe("notFriends");
    await setYard(OWNER, { attackid: 0, attacks: [] });

    await sql(`UPDATE bym.save SET type = 'outpost' WHERE userid = ? AND type = 'main'`, [OWNER]);
    expect(await reasonOf(help(H1, 1, "speedup"))).toBe("nothingToHelp");
    await sql(`UPDATE bym.save SET type = 'main' WHERE userid = ?`, [OWNER]);
    expect(await helpRows()).toHaveLength(0);
  });

  test("the reward is clamped to the helper's cap, and an unknown building is nothing to help", async () => {
    await setYard(OWNER, { buildingdata: { "1": upgrading(1, 10_000) } });
    await setYard(H1, { resources: { r1: BASE_CAP - 10, r2: BASE_CAP, r3: 0, r4: 0 } });
    const answer = await help(H1, 1, "speedup");
    expect(answer.reward).toEqual({ r1: 10, r2: 0, r3: 25, r4: 25 });
    expect((await yardOf(H1)).resources).toMatchObject({ r1: BASE_CAP, r2: BASE_CAP, r3: 25, r4: 25 });
    expect(await reasonOf(help(H2, 99, "speedup"))).toBe("nothingToHelp");
  });

  test("six helpers at once on one job: exactly five land, and the countdown matches five in a row", async () => {
    await setYard(OWNER, { buildingdata: { "1": upgrading(1, 100_000) } });
    const results = await Promise.all(HELPERS.map((helper) => refusalOf(help(helper, 1, "speedup"))));
    expect(results.filter((result) => result === "not refused")).toHaveLength(5);
    expect(results.filter((result) => result?.reason === "helpersFull")).toHaveLength(1);
    const after = (await yardOf(OWNER)).buildingdata["1"];
    expect(after.cU).toBe(77_380);
    expect(after.hl).toHaveLength(5);
    expect(await helpRows()).toHaveLength(5);
  });

  test("a double submit counts once", async () => {
    await setYard(OWNER, {
      buildingdata: { "1": upgrading(1, 10_000), "2": { id: 2, t: CANNON, x: 2, y: 0, l: 2, hp: 10 } },
      buildinghealthdata: { "2": 10 },
    });
    const speedups = await Promise.all([refusalOf(help(H1, 1, "speedup")), refusalOf(help(H1, 1, "speedup"))]);
    expect(speedups.map((result) => result?.reason ?? result).sort()).toEqual(["alreadyHelped", "not refused"]);
    const repairs = await Promise.all([refusalOf(help(H1, 2, "repair")), refusalOf(help(H2, 2, "repair"))]);
    expect(repairs.map((result) => result?.reason ?? result).sort()).toEqual(["not refused", "nothingToHelp"]);
    expect(await helpRows()).toHaveLength(2);
    expect((await yardOf(OWNER)).buildingdata["1"].cU).toBe(9500);
  });

  test("the friends list says who could be helped, and helpsLeft counts today's helps", async () => {
    await setYard(OWNER, {
      buildingdata: { "1": upgrading(1, 10_000), "2": { id: 2, t: CANNON, x: 2, y: 0, l: 2, hp: 10 } },
      buildinghealthdata: { "2": 10 },
    });
    await befriend(H1, STRANGER, T0 - 3600);
    let list = (await friendsAnswer(em() as never, as(H1), T0)) as any;
    expect(list.helpsLeft).toBe(20);
    const byId = (id: number) => list.friends.find((friend: { userid: number }) => friend.userid === id);
    expect(byId(OWNER).help).toEqual({ speedup: true, repair: true });
    expect(byId(STRANGER).help).toBeNull();

    await help(H1, 1, "speedup");
    await help(H1, 2, "repair");
    list = (await friendsAnswer(em() as never, as(H1), T0)) as any;
    expect(list.helpsLeft).toBe(18);
    expect(byId(OWNER).help).toEqual({ speedup: false, repair: false });
  });

  test("the help-mode load's block: per building, true or the reason", async () => {
    await setYard(OWNER, {
      buildingdata: { "1": upgrading(1, 10_000), "2": { id: 2, t: CANNON, x: 2, y: 0, l: 2, hp: 10 }, "3": { id: 3, t: CANNON, x: 3, y: 0, l: 2 } },
      buildinghealthdata: { "2": 10 },
    });
    const owner = { userid: OWNER, type: "main", savetime: T0, ...(await yardOf(OWNER)) };
    expect(await helpBlock(em() as never, H1, owner, T0)).toEqual({
      helpsLeft: 20,
      buildings: { "1": { speedup: true }, "2": { repair: true } },
    });
    expect(await helpBlock(em() as never, STRANGER, owner, T0)).toEqual({
      helpsLeft: 20,
      buildings: { "1": { speedup: "notFriends" }, "2": { repair: "notFriends" } },
    });
  });
});
