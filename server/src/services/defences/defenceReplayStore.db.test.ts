import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes, randomUUID } from "node:crypto";
import { MikroORM } from "@mikro-orm/postgresql";

import ormConfig from "../../mikro-orm.config.js";
import {
  decodeReplay,
  DEFENCE_REPLAY_LIMIT,
  type DefenceReplayPayload,
  type DefenceReplayRecord,
  storeDefenceReplay,
} from "./defenceReplayStore.js";
import { RULES_VERSION } from "./rulesVersion.js";

/**
 * Defence replay storage against a real Postgres (issue #358): the migration's
 * table, the insert, the prune to the newest 20 per defender, the payload as
 * stored, and the notice's `replayid` cleared when its replay is pruned.
 *
 * Opt-in: runs only when DEFENCES_TEST_DB names a throwaway database with the
 * `bym` schema and the defence replay migration applied, and refuses the
 * shared `bym` database. Each test clears its players' rows first.
 */
const dbName = process.env.DEFENCES_TEST_DB;

const DEFENDER = 993_001;
const OTHER = 993_002;
const ATTACKER = 993_003;
const MINUTE = 60_000;
const T0 = Date.UTC(2026, 9, 16, 12);

const payload = (seed: number): DefenceReplayPayload => ({
  v: 1,
  load: { buildingdata: { "1": { t: 14, X: 0, Y: 0 } }, buildinghealthdata: { "1": 1200 } },
  seed,
  events: [],
  tick: 2400,
  levels: { C1: 2 },
  declareWar: false,
});

const record = (defenderUserid: number, minute: number, extra: Partial<DefenceReplayRecord> = {}): DefenceReplayRecord => ({
  defenderUserid,
  baseid: `${defenderUserid}01`,
  mapVersion: 2,
  attacker: { userid: ATTACKER, username: "zz_drp_attacker", picSquare: "https://pic.invalid/a.png" },
  attackedAt: new Date(T0 + minute * MINUTE - 3 * MINUTE),
  landedAt: new Date(T0 + minute * MINUTE),
  damageBefore: 10,
  damageAfter: 45,
  loot: { r1: 1234, r2: 0 },
  housedLost: 2,
  left: false,
  payload: payload(minute),
  ...extra,
});

describe.skipIf(!dbName)("defence replays on a real database (issue #358)", () => {
  let orm: MikroORM;
  const em = () => orm.em.fork();
  const sql = <R = Record<string, any>>(query: string, params: unknown[] = []) => em().execute<R[]>(query, params);

  const players = [DEFENDER, OTHER, ATTACKER];
  const clear = async () => {
    await sql(`DELETE FROM bym.message WHERE targetid IN (?, ?, ?)`, players);
    await sql(`DELETE FROM bym.defence_replay WHERE defender_userid IN (?, ?, ?)`, players);
  };

  /** The defender's rows, newest first, as the list will read them. */
  const listOf = (userid: number) =>
    sql<{ id: number; landed_at: Date; attacked_at: Date }>(
      `SELECT id, landed_at, attacked_at FROM bym.defence_replay WHERE defender_userid = ? ORDER BY landed_at DESC, id DESC`,
      [userid],
    );

  beforeAll(async () => {
    if (dbName === "bym") throw new Error("DEFENCES_TEST_DB must be a throwaway database, not bym");
    orm = await MikroORM.init({ ...ormConfig, dbName, debug: false, pool: { min: 0, max: 2 } });
    for (const userid of players) {
      await sql(
        `INSERT INTO bym."user" (userid, username, email, password, blocked_users)
         VALUES (?, ?, ?, 'x', '[]') ON CONFLICT DO NOTHING`,
        [userid, `zz_drp_${userid}`, `zz_drp_${userid}@test.invalid`],
      );
    }
  });

  beforeEach(clear);

  afterAll(async () => {
    if (!orm) return;
    await clear();
    await sql(`DELETE FROM bym."user" WHERE userid IN (?, ?, ?)`, players);
    await orm.close(true);
  });

  test("a landed attack is one row, with every figure and the payload as stored", async () => {
    const id = await storeDefenceReplay(orm.em, record(DEFENDER, 1, { left: true }));
    expect(id).toBeGreaterThan(0);

    const [row] = await sql(`SELECT * FROM bym.defence_replay WHERE id = ?`, [id]);
    expect(row).toMatchObject({
      defender_userid: DEFENDER,
      baseid: `${DEFENDER}01`,
      map_version: 2,
      attacker_userid: ATTACKER,
      attacker_username: "zz_drp_attacker",
      attacker_pic_square: "https://pic.invalid/a.png",
      damage_before: 10,
      damage_after: 45,
      loot: { r1: 1234, r2: 0 },
      housed_lost: 2,
      attacker_left: true,
      rules_version: RULES_VERSION,
    });
    expect(new Date(row!.landed_at).getTime()).toBe(T0 + MINUTE);
    expect(new Date(row!.attacked_at).getTime()).toBe(T0 - 2 * MINUTE);
    expect(Buffer.isBuffer(row!.replay)).toBe(true);
    expect(row!.replay_bytes).toBe(row!.replay.byteLength);
    expect(decodeReplay(row!.replay)).toEqual(payload(1));
  });

  test("inputs that went missing still give a row, with no replay", async () => {
    const id = await storeDefenceReplay(orm.em, record(DEFENDER, 1, { payload: null }));
    const [row] = await sql(`SELECT replay, replay_bytes, damage_after FROM bym.defence_replay WHERE id = ?`, [id]);
    expect(row).toEqual({ replay: null, replay_bytes: 0, damage_after: 45 });
  });

  test("a payload over the size limit gives a row with no replay", async () => {
    const huge = { ...payload(1), load: { noise: randomBytes(300 * 1024).toString("base64") } };
    const id = await storeDefenceReplay(orm.em, record(DEFENDER, 1, { payload: huge }));
    const [row] = await sql(`SELECT replay, replay_bytes FROM bym.defence_replay WHERE id = ?`, [id]);
    expect(row).toEqual({ replay: null, replay_bytes: 0 });
  });

  test("a defender keeps exactly their newest 20; other defenders are untouched", async () => {
    for (let minute = 1; minute <= 5; minute++) await storeDefenceReplay(orm.em, record(OTHER, minute));
    // Landed out of order: the prune goes by landing time, not by insert.
    const minutes = Array.from({ length: 25 }, (_, i) => ((i * 7) % 25) + 1);
    for (const minute of minutes) await storeDefenceReplay(orm.em, record(DEFENDER, minute));

    const kept = await listOf(DEFENDER);
    expect(kept).toHaveLength(DEFENCE_REPLAY_LIMIT);
    expect(kept.map((row) => (new Date(row.landed_at).getTime() - T0) / MINUTE)).toEqual(
      Array.from({ length: 20 }, (_, i) => 25 - i),
    );
    expect(await listOf(OTHER)).toHaveLength(5);
  });

  test("at the same landing time the later row is the newer", async () => {
    const ids: number[] = [];
    for (let i = 0; i < DEFENCE_REPLAY_LIMIT + 2; i++) ids.push(await storeDefenceReplay(orm.em, record(DEFENDER, 1)));
    expect((await listOf(DEFENDER)).map((row) => Number(row.id))).toEqual(ids.slice(2).reverse());
  });

  test("a notice loses its replay id once the replay is pruned", async () => {
    const first = await storeDefenceReplay(orm.em, record(DEFENDER, 1));
    await sql(
      `INSERT INTO bym.message (id, threadid, updatetime, userid, targetid, messagetype, user_unread, target_unread, message, subject, created_at, replayid)
       VALUES (?, 0, 0, 0, ?, 'yardattacked', 0, 1, 'x attacked your yard', 'Attacked', now(), ?)`,
      [randomUUID(), DEFENDER, first],
    );
    const replayidOf = async () =>
      (await sql<{ replayid: number | null }>(`SELECT replayid FROM bym.message WHERE targetid = ?`, [DEFENDER]))[0]!.replayid;
    expect(Number(await replayidOf())).toBe(first);

    for (let minute = 2; minute <= DEFENCE_REPLAY_LIMIT + 1; minute++) await storeDefenceReplay(orm.em, record(DEFENDER, minute));
    expect(await replayidOf()).toBeNull();
    expect(await listOf(DEFENDER)).toHaveLength(DEFENCE_REPLAY_LIMIT);
  });

  test("a failed insert writes nothing and prunes nothing", async () => {
    for (let minute = 1; minute <= DEFENCE_REPLAY_LIMIT; minute++) await storeDefenceReplay(orm.em, record(DEFENDER, minute));
    // No such defender: the foreign key refuses the row.
    await expect(storeDefenceReplay(orm.em, record(993_999, 30))).rejects.toThrow();
    expect(await listOf(DEFENDER)).toHaveLength(DEFENCE_REPLAY_LIMIT);
  });

  test("the rows go with the defender's account", async () => {
    const userid = 993_004;
    await sql(
      `INSERT INTO bym."user" (userid, username, email, password, blocked_users) VALUES (?, 'zz_drp_gone', 'zz_drp_gone@test.invalid', 'x', '[]')`,
      [userid],
    );
    await storeDefenceReplay(orm.em, record(userid, 1));
    await sql(`DELETE FROM bym."user" WHERE userid = ?`, [userid]);
    expect(await listOf(userid)).toHaveLength(0);
  });
});
