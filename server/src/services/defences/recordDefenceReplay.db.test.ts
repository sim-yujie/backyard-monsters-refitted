import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { MikroORM } from "@mikro-orm/postgresql";

/**
 * Recording a defence replay against a real Postgres (issue #359): the row the
 * landing writes, its payload as stored, and the notice that carries its id
 * in `message.replayid` for the Watch button.
 *
 * Opt-in: runs only when DEFENCES_TEST_DB names a throwaway database with the
 * `bym` schema and the defence replay migration applied, and refuses the
 * shared `bym` database. Redis is in memory.
 */
const dbName = process.env.DEFENCES_TEST_DB;

const SANDBOX = fileURLToPath(new URL("../../../../web/test/fixtures/baseload-sandbox-yard.json", import.meta.url));
const sandbox = JSON.parse(readFileSync(SANDBOX, "utf8"));

const store = new Map<string, string>();
mock.module("../../server.js", () => ({
  postgres: { em: {}, orm: { em: {} } },
  redis: {
    get: async (key: string) => store.get(key) ?? null,
    setex: async (key: string, _ttl: number, value: string) => {
      store.set(key, value);
      return "OK";
    },
    del: async (key: string) => (store.delete(key) ? 1 : 0),
  },
}));

const { default: ormConfig } = await import("../../mikro-orm.config.js");
const { defenceReplayLoadOf, keepDefenceReplayLoad } = await import("./defenceReplayLoad.js");
const { decodeReplay } = await import("./defenceReplayStore.js");
const { recordDefenceReplay } = await import("./recordDefenceReplay.js");
const { noticeYardAttack } = await import("../maproom/v2/outpostNotices.js");

const DEFENDER = 993_101;
const ATTACKER = 993_102;
const BASESAVEID = 993_177;
const ATTACK_ID = 4242;
const NOW = 1_800_000_000;

const landed = () => ({
  yard: { basesaveid: BASESAVEID, baseid: `${DEFENDER}01`, saveuserid: DEFENDER, type: "main", mapversion: 2, damage: 47 },
  attacker: { userid: ATTACKER, username: "zz_drr_attacker", pic_square: null },
  session: { attackid: ATTACK_ID, startedat: NOW - 90, entryHoused: { home: { C1: 300 } } },
  input: {
    defender: { type: "main", buildingdata: sandbox.buildingdata, buildinghealthdata: { "0": 100 }, resources: sandbox.resources },
    attacker: { academy: { C1: { level: 3 } }, champion: null, siege: null },
    log: { v: 1 as const, seed: 9, events: [{ kind: "fling" as const, t: 480, x: 0, y: 0, r: 300, monsters: { C1: 300 } }] },
    tick: 2400,
    declareWar: false,
    left: true,
  },
  report: "zz_drr_attacker attacked",
  damageBefore: 12,
  damageAfter: 47,
  defenderDelta: { r1: -1234, r2: 0, r3: 0, r4: 0 },
  housedLost: 0,
  now: NOW,
});

describe.skipIf(!dbName)("defence replay recording on a real database (issue #359)", () => {
  let orm: MikroORM;
  const sql = <R = Record<string, any>>(query: string, params: unknown[] = []) => orm.em.fork().execute<R[]>(query, params);
  const players = [DEFENDER, ATTACKER];
  const clear = async () => {
    await sql(`DELETE FROM bym.message WHERE targetid IN (?, ?)`, players);
    await sql(`DELETE FROM bym.thread WHERE targetid IN (?, ?)`, players);
    await sql(`DELETE FROM bym.defence_replay WHERE defender_userid IN (?, ?)`, players);
  };

  beforeAll(async () => {
    if (dbName === "bym") throw new Error("DEFENCES_TEST_DB must be a throwaway database, not bym");
    orm = await MikroORM.init({ ...ormConfig, dbName, debug: false, pool: { min: 0, max: 2 } });
    for (const userid of players) {
      await sql(
        `INSERT INTO bym."user" (userid, username, email, password, blocked_users)
         VALUES (?, ?, ?, 'x', '[]') ON CONFLICT DO NOTHING`,
        [userid, `zz_drr_${userid}`, `zz_drr_${userid}@test.invalid`],
      );
    }
  });

  beforeEach(async () => {
    store.clear();
    await clear();
  });

  afterAll(async () => {
    if (!orm) return;
    await clear();
    await sql(`DELETE FROM bym."user" WHERE userid IN (?, ?)`, players);
    await orm.close(true);
  });

  test("the landing's row, then the notice that opens it", async () => {
    await keepDefenceReplayLoad(BASESAVEID, ATTACK_ID, defenceReplayLoadOf(sandbox));
    const attack = landed();
    const em = orm.em.fork();

    const replayId = await recordDefenceReplay(em, attack as never);
    expect(replayId).toBeGreaterThan(0);
    await noticeYardAttack(em, { ...attack, replayId });

    const [row] = await sql(`SELECT * FROM bym.defence_replay WHERE id = ?`, [replayId]);
    expect(row).toMatchObject({
      defender_userid: DEFENDER,
      map_version: 2,
      attacker_userid: ATTACKER,
      damage_before: 12,
      damage_after: 47,
      loot: { r1: 1234, r2: 0, r3: 0, r4: 0 },
      attacker_left: true,
    });
    const payload = decodeReplay(row!.replay);
    expect(payload.load.buildinghealthdata).toEqual({ "0": 100 });
    expect(payload.load).not.toHaveProperty("credits");
    expect(payload).toMatchObject({ seed: 9, tick: 2400, levels: { C1: 3 } });

    const [message] = await sql(`SELECT replayid, messagetype FROM bym.message WHERE targetid = ?`, [DEFENDER]);
    expect(Number(message!.replayid)).toBe(replayId!);
  });

  test("a notice with no replay carries none", async () => {
    const attack = landed();
    await noticeYardAttack(orm.em.fork(), attack);

    const [message] = await sql(`SELECT replayid FROM bym.message WHERE targetid = ?`, [DEFENDER]);
    expect(message!.replayid).toBeNull();
  });
});
