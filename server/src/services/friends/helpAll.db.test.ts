import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { MikroORM } from "@mikro-orm/postgresql";

import ormConfig from "../../mikro-orm.config.js";
import type { User } from "../../database/models/user.model.js";
import { memoryRedis } from "../../testing/memoryRedis.js";

/**
 * Help all as one request (owner, 26 Nov 2026), `POST /bm/friends/help/all`,
 * against a real Postgres: the same rules as one help at a time
 * (`help.db.test.ts`), counted across the request, in one transaction.
 *
 * Opt-in: runs only when FRIENDS_TEST_DB names a throwaway database with the
 * `bym` schema and the friends migrations applied, and refuses the shared
 * `bym`. Its players are `zz_fa_*`, user ids 993_400 and up.
 */
const dbName = process.env.FRIENDS_TEST_DB;

const redis = memoryRedis();
const postgres = { em: null as unknown };
mock.module("../../server.js", () => ({ postgres, redis }));

const { helpAnswer } = await import("../../controllers/friends/help.js");
const { helpAllAnswer } = await import("../../controllers/friends/helpAll.js");
const { HELP_ALL_MAX_TARGETS } = await import("./helpConfig.js");

/** Six helpers, two owners with the same yard, and a stranger who is nobody's friend. */
const HELPERS = [993_401, 993_402, 993_403, 993_404, 993_405, 993_406];
const [H1, H2] = HELPERS as [number, number];
const OWNER = 993_410;
const TWIN = 993_412;
const STRANGER = 993_411;
const EVERYONE = [...HELPERS, OWNER, TWIN, STRANGER];
const LIST = EVERYONE.join(",");

const DAY = 24 * 60 * 60;
/** 12:00 UTC on a day well after every account was made. */
const T0 = Math.floor(Date.UTC(2026, 9, 19, 12) / 1000);
const CANNON = 20;
const LEVEL_5_POINTS = "20000";
/** 0.25% of the base 10,000 storage, in each resource. */
const PAY = { r1: 25, r2: 25, r3: 25, r4: 25 };
const NONE = { r1: 0, r2: 0, r3: 0, r4: 0 };

type Kind = "speedup" | "repair";
const speedups = (...ids: number[]) => ids.map((buildingId) => ({ buildingId, kind: "speedup" as Kind }));

describe.skipIf(!dbName)("Help all as one request on a real database", () => {
  let orm: MikroORM;
  const em = () => orm.em.fork();
  const sql = <R = Record<string, any>>(query: string, params: unknown[] = []) => em().execute<R[]>(query, params);
  const as = (userid: number) => ({ userid, blockedUsers: [] }) as unknown as User;

  const help = (helper: number, buildingId: number, kind: Kind, now = T0, owner = OWNER) =>
    helpAnswer(em() as never, as(helper), { userid: owner, buildingId, kind }, now) as Promise<any>;
  const helpAll = (helper: number, targets: { buildingId: number; kind: Kind }[], now = T0, owner = OWNER) =>
    helpAllAnswer(em() as never, as(helper), { userid: owner, targets }, now) as Promise<any>;

  /** `reason` of a 409, or what else happened. */
  const reasonOf = async (call: Promise<unknown>): Promise<any> => {
    try {
      await call;
    } catch (err) {
      const refusal = err as { status?: number; data?: { reason?: string } };
      return refusal.status === 409 ? refusal.data?.reason : `status ${refusal.status}: ${String(err)}`;
    }
    return "not refused";
  };

  const yardOf = async (userid: number) => {
    const [row] = await sql(
      `SELECT s.buildingdata, s.buildinghealthdata, s.resources, s.savetime, s.dailyquests
         FROM bym.save s JOIN bym."user" u ON u.save_basesaveid = s.basesaveid WHERE u.userid = ?`,
      [userid]
    );
    return row!;
  };
  const helpRows = (helper?: number) =>
    sql(`SELECT * FROM bym.friend_help WHERE ${helper ? `helper_userid = ${helper}` : `owner_userid IN (${LIST})`} ORDER BY id`);
  const notices = (userid: number) =>
    sql(`SELECT jobs FROM bym.notification WHERE userid = ? AND kind = 'friend' ORDER BY id`, [userid]);

  /** A cannon with an upgrade running, `left` seconds to go. */
  const upgrading = (id: number, left: number) => ({ id, t: CANNON, x: id, y: 0, l: 2, cU: left, cL: left });
  const hurt = (id: number) => ({ id, t: CANNON, x: id, y: 0, l: 2, hp: 10 });
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
              savetime = ?, createtime = ?, points = ?, basevalue = '0', type = 'main', attackid = 0, attacks = '[]', damage = 0,
              dailyquests = NULL
        WHERE userid IN (${LIST})`,
      [JSON.stringify({ "0": HALL }), T0, T0 - 30 * DAY, LEVEL_5_POINTS]
    );
    for (const helper of HELPERS) {
      await befriend(helper, OWNER);
      await befriend(helper, TWIN);
    }
    for (const userid of [OWNER, TWIN]) await redis.del(`friend-helped:${userid}`);
  };

  beforeAll(async () => {
    if (dbName === "bym") throw new Error("FRIENDS_TEST_DB must be a throwaway database, not bym");
    orm = await MikroORM.init({ ...ormConfig, dbName, debug: false, pool: { min: 0, max: 10 } });
    for (const userid of EVERYONE) {
      const name = `zz_fa_${userid}`;
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

  test("three speed-ups in one request: each 5% off, hl kept, a row, a reward and a bell line each, in order", async () => {
    await setYard(OWNER, { buildingdata: { "1": upgrading(1, 10_000), "2": upgrading(2, 20_000), "3": upgrading(3, 40_000) } });
    const answer = await helpAll(H1, speedups(1, 2, 3));
    expect(answer).toMatchObject({ error: 0, rewardsLeft: 2 });
    expect(answer.helps).toHaveLength(3);
    expect(answer.helps[0]).toMatchObject({ buildingId: 1, kind: "speedup", ok: true, secondsSaved: 500, reward: PAY, rewardsLeft: 4 });
    expect(answer.helps[1]).toMatchObject({ buildingId: 2, ok: true, secondsSaved: 1000, rewardsLeft: 3 });
    expect(answer.helps[2]).toMatchObject({ buildingId: 3, ok: true, secondsSaved: 2000, rewardsLeft: 2 });
    expect(answer.helps[2].building).toMatchObject({ id: 3, cU: 38_000, hl: [H1] });

    const owner = await yardOf(OWNER);
    expect(owner.buildingdata["1"]).toMatchObject({ cU: 9500, hl: [H1] });
    expect(owner.buildingdata["2"]).toMatchObject({ cU: 19_000, hl: [H1] });
    expect(owner.buildingdata["3"]).toMatchObject({ cU: 38_000, hl: [H1] });
    expect(Number(owner.savetime)).toBe(T0);
    expect((await yardOf(H1)).resources).toMatchObject({ r1: 75, r2: 75, r3: 75, r4: 75 });

    const rows = await helpRows(H1);
    expect(rows.map((row) => [row.building_id, row.seconds_saved])).toEqual([
      [1, 500],
      [2, 1000],
      [3, 2000],
    ]);
    const bell = await notices(OWNER);
    expect(bell.map((row) => row.jobs[0])).toEqual([1, 2, 3].map((buildingId, i) => ({
      event: "helpSpeedup",
      userid: H1,
      username: `zz_fa_${H1}`,
      building: CANNON,
      buildingId,
      seconds: [500, 1000, 2000][i],
    })));
    expect(await redis.get(`friend-helped:${OWNER}`)).toBe(String(T0));
  });

  test("gives exactly what the same helps one at a time give (owner and twin, same yard)", async () => {
    const yard = {
      buildingdata: { "1": upgrading(1, 12_345), "2": upgrading(2, 99_999), "3": hurt(3), "4": upgrading(4, 777) },
      buildinghealthdata: { "3": 10 },
      savetime: T0 - 600,
    };
    await setYard(OWNER, yard);
    await setYard(TWIN, yard);
    const targets = [...speedups(1, 2), { buildingId: 3, kind: "repair" as Kind }, ...speedups(4)];

    const singles: any[] = [];
    for (const target of targets) singles.push(await help(H1, target.buildingId, target.kind, T0, OWNER));
    const batch = await helpAll(H2, targets, T0, TWIN);

    batch.helps.forEach((item: any, i: number) => {
      const { error: _error, helpsLeft: _left, ...single } = singles[i];
      const { buildingId: _id, kind: _kind, ok, ...rest } = item;
      expect(ok).toBe(true);
      expect({ ...rest, building: { ...rest.building, hl: undefined } }).toEqual({ ...single, building: { ...single.building, hl: undefined } });
    });
    const [a, b] = [await yardOf(OWNER), await yardOf(TWIN)];
    const noHelpers = (data: Record<string, any>) =>
      Object.fromEntries(Object.entries(data).map(([key, value]) => [key, { ...value, hl: undefined }]));
    expect(noHelpers(b.buildingdata)).toEqual(noHelpers(a.buildingdata));
    expect(b.buildinghealthdata).toEqual(a.buildinghealthdata);
    expect((await yardOf(H2)).resources).toEqual((await yardOf(H1)).resources);
    // The daily quest counts each help, as singles do.
    expect(JSON.stringify((await yardOf(H2)).dailyquests)).toBe(JSON.stringify((await yardOf(H1)).dailyquests));
  });

  test("only the first 5 helps of a UTC day pay, counted across the request and the helps before it", async () => {
    const buildings: Record<string, unknown> = {};
    for (let id = 1; id <= 8; id++) buildings[String(id)] = upgrading(id, 100_000);
    await setYard(OWNER, { buildingdata: buildings });
    for (const id of [1, 2, 3]) await help(H1, id, "speedup");

    const answer = await helpAll(H1, speedups(4, 5, 6, 7));
    expect(answer.helps.map((item: any) => [item.reward, item.rewardsLeft])).toEqual([
      [PAY, 1],
      [PAY, 0],
      [NONE, 0],
      [NONE, 0],
    ]);
    expect(answer.rewardsLeft).toBe(0);
    expect(answer.helps.every((item: any) => item.ok && item.secondsSaved === 5000)).toBe(true);
    expect((await yardOf(H1)).resources).toMatchObject({ r1: 5 * 25, r4: 5 * 25 });
    expect(await helpRows(H1)).toHaveLength(7);
  });

  test("a refusal about one building passes it over, repairedToday too, as the web's Help all did", async () => {
    const full = { ...upgrading(2, 100_000), hl: HELPERS.slice(1, 6) };
    await setYard(OWNER, {
      buildingdata: { "1": upgrading(1, 100_000), "2": full, "3": upgrading(3, 100_000), "10": hurt(10), "11": hurt(11), "4": upgrading(4, 100_000) },
      buildinghealthdata: { "10": 10, "11": 10 },
    });
    await help(H1, 1, "speedup");

    const passed = await helpAll(H1, speedups(1, 2, 99, 3));
    expect(passed.helps.map((item: any) => item.ok || item.reason)).toEqual(["alreadyHelped", "helpersFull", "nothingToHelp", true]);
    expect(await helpRows(H1)).toHaveLength(2);

    // One repair a yard a day: the second is passed over, and the speed-up after it still lands.
    const repairs = await helpAll(H1, [
      { buildingId: 10, kind: "repair" },
      { buildingId: 11, kind: "repair" },
      { buildingId: 4, kind: "speedup" },
    ]);
    expect(repairs.helps.map((item: any) => item.ok || item.reason)).toEqual([true, "repairedToday", true]);
    expect((await yardOf(OWNER)).buildingdata["4"].hl).toEqual([H1]);
    expect((await yardOf(OWNER)).buildinghealthdata).toEqual({ "11": 10 });
    expect(await helpRows(H1)).toHaveLength(4);

    // The same building twice in one request: the second is already helped.
    const twice = await helpAll(H2, speedups(3, 3));
    expect(twice.helps.map((item: any) => item.ok || item.reason)).toEqual([true, "alreadyHelped"]);
  });

  test("when nothing goes through, nothing is written: not even the catch-up", async () => {
    await setYard(OWNER, { buildingdata: { "1": upgrading(1, 1000), "2": upgrading(2, 1000) } });
    await help(H1, 1, "speedup");
    await help(H1, 2, "speedup");
    const before = await yardOf(OWNER);

    // Both jobs have ended by now: nothing to help, and the catch-up that finished them rolls back.
    const answer = await helpAll(H2, speedups(1, 2), T0 + 2000);
    expect(answer).toEqual({
      error: 0,
      rewardsLeft: 5,
      helps: [
        { buildingId: 1, kind: "speedup", ok: false, reason: "nothingToHelp" },
        { buildingId: 2, kind: "speedup", ok: false, reason: "nothingToHelp" },
      ],
    });
    expect(await yardOf(OWNER)).toEqual(before);
    expect(await helpRows(H2)).toHaveLength(0);
    expect(await notices(OWNER)).toHaveLength(2);
  });

  test("a refusal about the whole visit refuses the whole request and writes nothing", async () => {
    await setYard(OWNER, { buildingdata: { "1": upgrading(1, 10_000) } });
    await setYard(STRANGER, { buildingdata: { "1": upgrading(1, 10_000) } });
    expect(await reasonOf(helpAll(H1, speedups(1), T0, STRANGER))).toBe("notFriends");
    expect(await reasonOf(helpAll(H1, speedups(1), T0, H1))).toBe("self");

    await sql(`UPDATE bym."user" SET blocked_users = ? WHERE userid = ?`, [JSON.stringify([H1]), OWNER]);
    expect(await reasonOf(helpAll(H1, speedups(1)))).toBe("cannotSend");
    await sql(`UPDATE bym."user" SET blocked_users = '[]' WHERE userid = ?`, [OWNER]);

    await befriend(H1, STRANGER, T0 - 3600);
    expect(await reasonOf(helpAll(H1, speedups(1), T0, STRANGER))).toBe("tooNew");

    const realNow = Math.floor(Date.now() / 1000);
    await setYard(OWNER, { attackid: 1, attacks: [{ starttime: realNow }] });
    expect(await reasonOf(helpAll(H1, speedups(1)))).toBe("underAttack");
    await setYard(OWNER, { attackid: 0, attacks: [] });
    await setYard(H1, { attackid: 1, attacks: [{ starttime: realNow }] });
    expect(await reasonOf(helpAll(H1, speedups(1)))).toBe("helperUnderAttack");
    await setYard(H1, { attackid: 0, attacks: [] });

    expect(await helpRows()).toHaveLength(0);
    expect((await yardOf(OWNER)).buildingdata["1"].hl).toBeUndefined();
  });

  test("a request with no targets, too many, or a bad kind is refused before anything is read", async () => {
    expect(await reasonOf(helpAll(H1, []))).toMatch(/status/);
    expect(await reasonOf(helpAll(H1, speedups(...Array.from({ length: HELP_ALL_MAX_TARGETS + 1 }, (_, i) => i + 1))))).toMatch(/status/);
    expect(await reasonOf(helpAll(H1, [{ buildingId: 1, kind: "build" as Kind }]))).toMatch(/status/);
    // As a JSON string, as a form body sends it.
    await setYard(OWNER, { buildingdata: { "1": upgrading(1, 10_000) } });
    const answer = (await helpAllAnswer(em() as never, as(H1), { userid: OWNER, targets: JSON.stringify(speedups(1)) }, T0)) as any;
    expect(answer.helps[0]).toMatchObject({ ok: true, secondsSaved: 500 });
  });

  test("a single help and Help all at once on the same jobs: each job helped once, no deadlock", async () => {
    await setYard(OWNER, { buildingdata: { "1": upgrading(1, 100_000), "2": upgrading(2, 100_000), "3": upgrading(3, 100_000) } });
    const [single, batch] = await Promise.all([reasonOf(help(H1, 2, "speedup")), helpAll(H1, speedups(1, 2, 3)).catch(String)]);
    const reasons = batch.helps.map((item: any) => item.ok || item.reason);
    // Whichever went first, the other found building 2 helped.
    if (single === "not refused") expect(reasons).toEqual([true, "alreadyHelped", true]);
    else expect([single, reasons]).toEqual(["alreadyHelped", [true, true, true]]);
    expect(await helpRows(H1)).toHaveLength(3);
    expect((await yardOf(H1)).resources).toMatchObject({ r1: 75 });
    for (const id of ["1", "2", "3"]) expect((await yardOf(OWNER)).buildingdata[id].hl).toEqual([H1]);
  });

  test("six helpers press Help all at once on the same jobs: five land on each, a double press counts once", async () => {
    await setYard(OWNER, { buildingdata: { "1": upgrading(1, 100_000), "2": upgrading(2, 100_000) } });
    const answers = await Promise.all([...HELPERS, H1].map((helper) => helpAll(helper, speedups(1, 2))));
    const landed = answers.flatMap((answer) => answer.helps.filter((item: any) => item.ok));
    expect(landed).toHaveLength(10);
    const after = await yardOf(OWNER);
    for (const id of ["1", "2"]) {
      expect(after.buildingdata[id].cU).toBe(77_380);
      expect(after.buildingdata[id].hl).toHaveLength(5);
    }
    expect(await helpRows()).toHaveLength(10);
    expect((await helpRows(H1)).length).toBeLessThanOrEqual(2);
  });

  test("a speed-up on a Flinger drops the owner's cached sight, once for the request", async () => {
    const flinger = { id: 2, t: 5, x: 2, y: 0, l: 3, cU: 10_000, cL: 10_000 };
    await setYard(OWNER, { buildingdata: { "1": upgrading(1, 10_000), "2": flinger }, flinger: 3 });
    postgres.em = em();
    await redis.set(`sight:${OWNER}`, "{}");
    await helpAll(H1, speedups(1));
    expect(await redis.get(`sight:${OWNER}`)).toBe("{}");
    await helpAll(H2, speedups(1, 2));
    expect(await redis.get(`sight:${OWNER}`)).toBeNull();
  });
});
