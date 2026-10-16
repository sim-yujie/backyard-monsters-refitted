import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { MikroORM } from "@mikro-orm/postgresql";

import type { User } from "../../database/models/user.model.js";
import ormConfig from "../../mikro-orm.config.js";
import {
  DEFENCE_REPLAY_LIMIT,
  type DefenceReplayPayload,
  type DefenceReplayRecord,
  storeDefenceReplay,
} from "../../services/defences/defenceReplayStore.js";
import { RULES_VERSION } from "../../services/defences/rulesVersion.js";
import { listAnswer, replayAnswer } from "./defences.js";

/**
 * The Defences routes against a real Postgres (issue #360): rows written by the
 * real store, read back through the ORM as the routes read them, so a column the
 * list forgets, a payload it loads when it should not, or one the replay fails
 * to load (the column is lazy) shows here.
 *
 * Opt-in: runs only when DEFENCES_TEST_DB names a throwaway database with the
 * `bym` schema and the defence replay migration applied, and refuses the
 * shared `bym` database. Each test clears its players' rows first.
 */
const dbName = process.env.DEFENCES_TEST_DB;

const DEFENDER = 993_101;
const OTHER = 993_102;
const ATTACKER = 993_103;
const MINUTE = 60_000;
const T0 = Date.UTC(2026, 9, 16, 12);

const payload = (seed: number): DefenceReplayPayload => ({
  v: 1,
  load: { type: "main", buildingdata: { "1": { t: 14, X: 0, Y: 0 } }, buildinghealthdata: { "1": 1200 } },
  seed,
  events: [{ tick: 40, type: "fling", code: "C1", x: 100, y: 120 }] as unknown as DefenceReplayPayload["events"],
  tick: 2400,
  levels: { C1: 2 },
  declareWar: false,
  report: "report",
});

const record = (defenderUserid: number, minute: number, extra: Partial<DefenceReplayRecord> = {}): DefenceReplayRecord => ({
  defenderUserid,
  baseid: `${defenderUserid}01`,
  mapVersion: 2,
  attacker: { userid: ATTACKER, username: "zz_dra_attacker", picSquare: "https://pic.invalid/a.png" },
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

const as = (userid: number) => ({ userid }) as User;

describe.skipIf(!dbName)("the Defences routes on a real database (issue #360)", () => {
  let orm: MikroORM;
  const em = () => orm.em.fork();
  const sql = <R = Record<string, any>>(query: string, params: unknown[] = []) => em().execute<R[]>(query, params);

  const players = [DEFENDER, OTHER, ATTACKER];
  const clear = () => sql(`DELETE FROM bym.defence_replay WHERE defender_userid IN (?, ?, ?)`, players);

  beforeAll(async () => {
    if (dbName === "bym") throw new Error("DEFENCES_TEST_DB must be a throwaway database, not bym");
    orm = await MikroORM.init({ ...ormConfig, dbName, debug: false, pool: { min: 0, max: 2 } });
    for (const userid of players) {
      await sql(
        `INSERT INTO bym."user" (userid, username, email, password, blocked_users)
         VALUES (?, ?, ?, 'x', '[]') ON CONFLICT DO NOTHING`,
        [userid, `zz_dra_${userid}`, `zz_dra_${userid}@test.invalid`],
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

  test("the list: the defender's newest 20, newest landing first, every figure, no payload", async () => {
    // Landed out of order, and more than the limit (the store prunes to 20 as well).
    const minutes = [5, 1, 30, ...Array.from({ length: 20 }, (_, i) => 100 + i)];
    const ids = new Map<number, number>();
    for (const minute of minutes) ids.set(minute, await storeDefenceReplay(orm.em, record(DEFENDER, minute)));
    await storeDefenceReplay(orm.em, record(OTHER, 200));

    const answer = await listAnswer(em(), as(DEFENDER));
    expect(answer.status).toBe(200);
    const defences = answer.body.defences as Record<string, any>[];
    expect(defences).toHaveLength(DEFENCE_REPLAY_LIMIT);
    expect(defences.map((one) => one.id)).toEqual(
      Array.from({ length: 20 }, (_, i) => ids.get(119 - i)),
    );
    expect(defences[0]).toEqual({
      id: ids.get(119),
      attacker: { name: "zz_dra_attacker", pic: "https://pic.invalid/a.png" },
      attackedAt: (T0 + 116 * MINUTE) / 1000,
      landedAt: (T0 + 119 * MINUTE) / 1000,
      damageDone: 35,
      damageAfter: 45,
      loot: { r1: 1234, r2: 0 },
      housedLost: 2,
      left: false,
      rulesVersion: RULES_VERSION,
      hasReplay: true,
      playable: true,
    });
  });

  test("a row without its inputs is listed without a replay, and its replay is a 410", async () => {
    const id = await storeDefenceReplay(orm.em, record(DEFENDER, 1, { payload: null, left: true }));
    const [defence] = (await listAnswer(em(), as(DEFENDER))).body.defences as Record<string, any>[];
    expect(defence).toMatchObject({ id, hasReplay: false, playable: false, left: true });
    expect((await replayAnswer(em(), as(DEFENDER), { id: String(id) })).status).toBe(410);
  });

  test("the replay: the stored payload unzipped from the lazy column, with its figures", async () => {
    const id = await storeDefenceReplay(orm.em, record(DEFENDER, 1));
    const answer = await replayAnswer(em(), as(DEFENDER), { id: String(id) });
    expect(answer.status).toBe(200);
    expect(answer.body.replay).toEqual(payload(1));
    expect(answer.body.defence).toMatchObject({ id, damageDone: 35, rulesVersion: RULES_VERSION, playable: true });
  });

  test("another player's replay is a 404, the same as a missing one", async () => {
    const id = await storeDefenceReplay(orm.em, record(OTHER, 1));
    const theirs = await replayAnswer(em(), as(DEFENDER), { id: String(id) });
    expect(theirs.status).toBe(404);
    expect(theirs).toEqual(await replayAnswer(em(), as(DEFENDER), { id: String(id + 1_000_000) }));
    expect((await replayAnswer(em(), as(OTHER), { id: String(id) })).status).toBe(200);
    expect((await listAnswer(em(), as(DEFENDER))).body.defences).toEqual([]);
  });

  test("a player with no Map Room 2 defences gets an empty list; Map Room 1 rows wait for #246", async () => {
    expect((await listAnswer(em(), as(DEFENDER))).body).toEqual({ error: 0, defences: [] });
    const id = await storeDefenceReplay(orm.em, record(DEFENDER, 1, { mapVersion: 1 }));
    expect((await listAnswer(em(), as(DEFENDER))).body).toEqual({ error: 0, defences: [] });
    expect((await replayAnswer(em(), as(DEFENDER), { id: String(id) })).status).toBe(404);
  });

  test("an older rules version is listed and sent, but not playable", async () => {
    const id = await storeDefenceReplay(orm.em, record(DEFENDER, 1), "0123456789abcdef");
    const [defence] = (await listAnswer(em(), as(DEFENDER))).body.defences as Record<string, any>[];
    expect(defence).toMatchObject({ rulesVersion: "0123456789abcdef", hasReplay: true, playable: false });
    expect((await replayAnswer(em(), as(DEFENDER), { id: String(id) })).status).toBe(200);
  });
});
