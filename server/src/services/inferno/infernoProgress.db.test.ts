import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { MikroORM } from "@mikro-orm/postgresql";

import { CreateInfernoProgressTable } from "../../database/migrations/20261025_CreateInfernoProgressTable.js";
import { AddDescentYardsToInfernoProgress } from "../../database/migrations/20261026_AddDescentYardsToInfernoProgress.js";
import ormConfig from "../../mikro-orm.config.js";
import { raiseEmergence } from "./emergenceOnLoad.js";
import { readInfernoProgress } from "./infernoProgress.js";

/**
 * `bym.inferno_progress` against a real Postgres: the migration (shape, run
 * twice, its checks, the foreign key) and the entity reading what it wrote.
 *
 * Then the emergence's level-up statement (`raiseEmergence`): it raises the
 * cave once however many loads race, and never inside the 12 hours.
 *
 * Opt-in: runs only when INFERNO_TEST_DB names a throwaway database with the
 * `bym` schema and the migrations applied, and refuses the shared `bym`.
 * Its player is `zz_inf_*`, user id 996_001.
 */
const dbName = process.env.INFERNO_TEST_DB;

const A = 996_001;

describe.skipIf(!dbName)("Inferno progress on a real database", () => {
  let orm: MikroORM;
  const em = () => orm.em.fork();
  const sql = <R = Record<string, any>>(query: string, params: unknown[] = []) => em().execute<R[]>(query, params);
  const addPlayer = () =>
    sql(
      `INSERT INTO bym."user" (userid, username, email, password, blocked_users) VALUES (?, ?, ?, 'x', '[]') ON CONFLICT DO NOTHING`,
      [A, `zz_inf_${A}`, `zz_inf_${A}@test.invalid`]
    );

  beforeAll(async () => {
    if (dbName === "bym") throw new Error("INFERNO_TEST_DB must be a throwaway database, not bym");
    orm = await MikroORM.init({ ...ormConfig, dbName, debug: false, pool: { min: 0, max: 4 } });
    await addPlayer();
  });

  beforeEach(async () => {
    await sql(`DELETE FROM bym.inferno_progress WHERE userid = ?`, [A]);
  });

  afterAll(async () => {
    if (!orm) return;
    await sql(`DELETE FROM bym."user" WHERE userid = ?`, [A]);
    await orm.close();
  });

  test("the migrations are additive and can run again", async () => {
    for (const Step of [CreateInfernoProgressTable, AddDescentYardsToInfernoProgress]) {
      const migration = new Step(orm.em.getDriver(), orm.config);
      await migration.up();
      for (const query of migration.getQueries()) await sql(String(query));
    }

    const columns = await sql<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'bym' AND table_name = 'inferno_progress' ORDER BY ordinal_position`
    );
    expect(columns.map((one) => one.column_name)).toEqual([
      "userid",
      "emergence_level",
      "emergence_last_at",
      "descent_destroyed",
      "descent_best",
      "descent_passed_at",
      "inferno_baseid",
      "korath_unlocked_at",
      "korath_notice_at",
      "popups_seen",
      "created_at",
      "updated_at",
      "descent_yards",
    ]);
  });

  test("a Descent yard's kept damage comes back as written; anything but an object is refused", async () => {
    await sql(
      `INSERT INTO bym.inferno_progress (userid, descent_yards) VALUES (?, '{"201":{"health":{"1":0,"2":"120"},"looted":{"r1":40}}}'::jsonb)`,
      [A]
    );
    const record = await readInfernoProgress(em(), A);
    expect(record.descentYards).toEqual({ "201": { health: { "1": 0, "2": 120 }, looted: { r1: 40, r2: 0, r3: 0, r4: 0 } } });

    await sql(`DELETE FROM bym.inferno_progress WHERE userid = ?`, [A]);
    await expect(sql(`INSERT INTO bym.inferno_progress (userid, descent_yards) VALUES (?, '[]'::jsonb)`, [A])).rejects.toThrow();
  });

  test("a bare row takes the defaults, and the entity reads it", async () => {
    await sql(`INSERT INTO bym.inferno_progress (userid) VALUES (?)`, [A]);
    const record = await readInfernoProgress(em(), A);
    expect(record.emergenceLevel).toBe(0);
    expect(record.emergenceLastAt).toBeNull();
    expect(record.descentDestroyed).toEqual([]);
    expect(record.popupsSeen).toEqual({});
  });

  test("times and flags written come back as unix seconds and numbers", async () => {
    await sql(
      `INSERT INTO bym.inferno_progress (userid, emergence_level, emergence_last_at, descent_destroyed, inferno_baseid)
       VALUES (?, 3, to_timestamp(1800000000), '[1,1]'::jsonb, '42')`,
      [A]
    );
    const record = await readInfernoProgress(em(), A);
    expect(record.emergenceLevel).toBe(3);
    expect(record.emergenceLastAt).toBe(1_800_000_000);
    expect(record.descentDestroyed).toEqual([1, 1]);
    expect(record.infernoBaseid).toBe("42");
  });

  test("the cave's level stays 0-5", async () => {
    await expect(sql(`INSERT INTO bym.inferno_progress (userid, emergence_level) VALUES (?, 6)`, [A])).rejects.toThrow();
    await expect(sql(`INSERT INTO bym.inferno_progress (userid, emergence_level) VALUES (?, -1)`, [A])).rejects.toThrow();
  });

  test("no row reads as no progress", async () => {
    expect((await readInfernoProgress(em(), A)).emergenceLevel).toBe(0);
  });

  test("the row goes with the account", async () => {
    await sql(`INSERT INTO bym.inferno_progress (userid) VALUES (?)`, [A]);
    await sql(`DELETE FROM bym."user" WHERE userid = ?`, [A]);
    const [left] = await sql<{ n: string }>(`SELECT count(*) AS n FROM bym.inferno_progress WHERE userid = ?`, [A]);
    expect(Number(left.n)).toBe(0);
    await addPlayer();
  });

  test("the first level-up makes the row: level 1, at now", async () => {
    const NOW = 1_800_000_000;
    expect(await raiseEmergence(em(), A, 0, NOW)).toBe(1);
    const record = await readInfernoProgress(em(), A);
    expect(record.emergenceLevel).toBe(1);
    expect(record.emergenceLastAt).toBe(NOW);
  });

  test("loads racing raise the cave once", async () => {
    const NOW = 1_800_000_000;
    const results = await Promise.all(Array.from({ length: 6 }, () => raiseEmergence(em(), A, 0, NOW)));
    expect(results.filter((level) => level === 1)).toHaveLength(1);
    expect(results.filter((level) => level === null)).toHaveLength(5);
    expect((await readInfernoProgress(em(), A)).emergenceLevel).toBe(1);
  });

  test("not within 12 hours of the last; from 12 hours on, the next", async () => {
    const NOW = 1_800_000_000;
    await raiseEmergence(em(), A, 0, NOW);
    expect(await raiseEmergence(em(), A, 1, NOW + 43_199)).toBeNull();
    expect(await raiseEmergence(em(), A, 1, NOW + 43_200)).toBe(2);
    expect((await readInfernoProgress(em(), A)).emergenceLastAt).toBe(NOW + 43_200);
  });

  test("a stale level read loses: the cave is not raised twice from the same level", async () => {
    const NOW = 1_800_000_000;
    await raiseEmergence(em(), A, 0, NOW);
    expect(await raiseEmergence(em(), A, 0, NOW + 100_000)).toBeNull();
    expect((await readInfernoProgress(em(), A)).emergenceLevel).toBe(1);
  });

  test("a row made for something else is raised from level 0 too", async () => {
    await sql(`INSERT INTO bym.inferno_progress (userid, popups_seen) VALUES (?, '{"x":1}'::jsonb)`, [A]);
    expect(await raiseEmergence(em(), A, 0, 1_800_000_000)).toBe(1);
    expect((await readInfernoProgress(em(), A)).popupsSeen).toEqual({ x: 1 });
  });
});
