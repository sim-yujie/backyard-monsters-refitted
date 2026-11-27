import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { MikroORM } from "@mikro-orm/postgresql";

import ormConfig from "../../../mikro-orm.config.js";
import { markPrizePaid, readYardCopy, readYardState, readYardStates, writeYardCopyOnce, writeYardState } from "./yardStore.js";

/**
 * The Brukkarg event yards' store (beta 10) against a real Postgres, with the
 * migration `20261210_CreateEventYards.ts` applied: the yard state upserts, the
 * copy is made once, and a prize is marked paid once, never twice, also when
 * the wave events' fields share the row.
 *
 * Opt-in: runs only when EVENTS_TEST_DB names a throwaway database (never
 * `bym`). Its player is `zz_yard_995101`, user id 995_101.
 */
const dbName = process.env.EVENTS_TEST_DB;
const A = 995_101;
const RUN = "zz-brukwar-1";

describe.skipIf(!dbName)("event yard store on a real database", () => {
  let orm: MikroORM;
  const em = () => orm.em.fork();
  const sql = <R = Record<string, any>>(query: string, params: unknown[] = []) => em().execute<R[]>(query, params);

  beforeAll(async () => {
    if (dbName === "bym") throw new Error("EVENTS_TEST_DB must be a throwaway database, not bym");
    orm = await MikroORM.init({ ...ormConfig, dbName, debug: false, pool: { min: 0, max: 4 } });
    await sql(
      `INSERT INTO bym."user" (userid, username, email, password, blocked_users) VALUES (?, ?, ?, 'x', '[]') ON CONFLICT DO NOTHING`,
      [A, `zz_yard_${A}`, `zz_yard_${A}@test.invalid`]
    );
  });

  const clear = async () => {
    await sql(`DELETE FROM bym.event_yard WHERE userid = ?`, [A]);
    await sql(`DELETE FROM bym.event_yard_copy WHERE userid = ?`, [A]);
    await sql(`DELETE FROM bym.event_progress WHERE userid = ?`, [A]);
  };

  beforeEach(clear);

  afterAll(async () => {
    if (!orm) return;
    await clear();
    await sql(`DELETE FROM bym."user" WHERE userid = ?`, [A]);
    await orm.close();
  });

  test("a yard's state is written, then replaced by the next landing", async () => {
    const first = { health: { 3: 10 }, destroyed: false, damage: 12, firstAttackedAt: 1_000, looted: { r1: 5 } };
    await writeYardState(em(), A, RUN, "901", first);
    expect(await readYardState(em(), A, RUN, "901")).toEqual(first);
    await writeYardState(em(), A, RUN, "901", { ...first, destroyed: true, damage: 100, looted: { r1: 9 } });
    const states = await readYardStates(em(), A, RUN);
    expect(states.size).toBe(1);
    expect(states.get("901")).toMatchObject({ destroyed: true, damage: 100, looted: { r1: 9 }, firstAttackedAt: 1_000 });
  });

  test("the copy of the player's yard is made once per run", async () => {
    await writeYardCopyOnce(em(), A, RUN, { level: 10, buildingdata: { 0: { t: 14 } } });
    const kept = await writeYardCopyOnce(em(), A, RUN, { level: 99, buildingdata: {} });
    expect(kept).toMatchObject({ level: 10 });
    expect(await readYardCopy(em(), A, RUN)).toMatchObject({ level: 10 });
  });

  test("a prize is marked paid once; the wave events' counter and data on the row are kept", async () => {
    await sql(`INSERT INTO bym.event_progress (userid, event_id, counter, data) VALUES (?, ?, 7, '{"lost": 2}'::jsonb)`, [A, RUN]);
    expect(await markPrizePaid(em(), A, RUN, 3)).toBe(true);
    expect(await markPrizePaid(em(), A, RUN, 3)).toBe(false);
    expect(await markPrizePaid(em(), A, RUN, 4)).toBe(true);
    const [row] = await sql<{ counter: number; data: Record<string, unknown> }>(
      `SELECT counter, data FROM bym.event_progress WHERE userid = ? AND event_id = ?`,
      [A, RUN]
    );
    expect(row!.counter).toBe(7);
    expect(row!.data).toEqual({ lost: 2, yardPrizes: [3, 4] });
  });

  test("two landings racing for the same prize pay it once", async () => {
    const paid = await Promise.all([markPrizePaid(em(), A, RUN, 5), markPrizePaid(em(), A, RUN, 5)]);
    expect(paid.filter(Boolean)).toHaveLength(1);
  });
});
