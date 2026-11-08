import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { MikroORM } from "@mikro-orm/postgresql";

import ormConfig from "../../../mikro-orm.config.js";

/**
 * The hostile rule's query (`attackedBetween`, owner 8 Nov 2026) against a real Postgres: an
 * attack either way, however old, makes a player hostile; other players' attacks do not.
 *
 * Opt-in like the friends database tests: runs only when FRIENDS_TEST_DB names a throwaway
 * database with the `bym` schema, and refuses the shared `bym`. Its rows use user ids 997_001
 * to 997_005.
 */
const dbName = process.env.FRIENDS_TEST_DB;

mock.module("../../../server.js", () => ({ postgres: { em: null }, redis: {} }));
const { attackedBetween } = await import("./hostiles.js");

const ME = 997_001;
const ATTACKED_ME = 997_002;
const I_ATTACKED = 997_003;
const STRANGER = 997_004;
const ELSEWHERE = 997_005;
const list = [ME, ATTACKED_ME, I_ATTACKED, STRANGER, ELSEWHERE].join(",");

describe.skipIf(!dbName)("hostile players on a real database (owner, 8 Nov 2026)", () => {
  let orm: MikroORM;
  const em = () => orm.em.fork();
  const sql = (query: string, params: unknown[] = []) => em().execute(query, params);
  const attack = (attacker: number, defender: number, when: string) =>
    sql(
      `INSERT INTO bym.attack_logs (attacker_userid, attacker_username, defender_userid, defender_username, type, attacktime)
       VALUES (?, 'zz_a', ?, 'zz_d', 'main', ?)`,
      [attacker, defender, when],
    );
  const clear = () => sql(`DELETE FROM bym.attack_logs WHERE attacker_userid IN (${list}) OR defender_userid IN (${list})`);

  beforeAll(async () => {
    if (dbName === "bym") throw new Error("FRIENDS_TEST_DB must be a throwaway database, not bym");
    orm = await MikroORM.init({ ...ormConfig, dbName, debug: false, pool: { min: 0, max: 2 } });
  });
  beforeEach(clear);
  afterAll(async () => {
    if (!orm) return;
    await clear();
    await orm.close(true);
  });

  test("either direction, however long ago; never strangers or the viewer", async () => {
    await attack(ATTACKED_ME, ME, "2020-01-01T00:00:00Z");
    await attack(ME, I_ATTACKED, new Date().toISOString());
    await attack(STRANGER, ELSEWHERE, new Date().toISOString());
    const found = await attackedBetween(em(), ME, [ME, ATTACKED_ME, I_ATTACKED, STRANGER, ELSEWHERE]);
    expect([...found].sort()).toEqual([ATTACKED_ME, I_ATTACKED]);
    // The other side sees it too.
    expect([...(await attackedBetween(em(), I_ATTACKED, [ME, STRANGER]))]).toEqual([ME]);
  });
});
