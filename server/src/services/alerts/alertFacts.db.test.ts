import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { MikroORM } from "@mikro-orm/postgresql";

import ormConfig from "../../mikro-orm.config.js";
import { joinedAt, namesOf, tellNewPhoto } from "./alertFacts.js";
import type { NewPhotoAlert } from "./moderationAlerts.js";

/**
 * What the moderation alerts read from a real Postgres: names, and when an
 * account joined (its main yard or its sign-up, whichever came first), so a
 * brand-new account's photo is said and an older one's is not.
 *
 * Opt-in, like the other database tests: runs only when DASHBOARD_TEST_DB
 * names a throwaway database with every migration applied (never `bym`).
 * Players are `alertfacts_*`, account numbers from 996401; deleted afterwards.
 */

const dbName = process.env.DASHBOARD_TEST_DB;
const NEW = 996401;
const OLD = 996402;
const UNKNOWN = 996403;
const LIST = [NEW, OLD, UNKNOWN].join(",");
const NOW = new Date("2026-11-24T12:00:00Z");

describe.skipIf(!dbName)("moderation alert facts on a real database", () => {
  let orm: MikroORM;
  const sql = (query: string, params: unknown[] = []) => orm.em.fork().execute(query, params);

  beforeAll(async () => {
    if (dbName === "bym") throw new Error("DASHBOARD_TEST_DB must be a throwaway database, not bym");
    orm = await MikroORM.init({ ...ormConfig, dbName, debug: false, pool: { min: 0, max: 2 } });
    await sql(`DELETE FROM bym."user" WHERE userid IN (${LIST})`);
    for (const [userid, joined] of [
      [NEW, new Date(NOW.getTime() - 20 * 60_000)],
      [OLD, new Date(NOW.getTime() - 3 * 3_600_000)],
      [UNKNOWN, null],
    ] as const) {
      await sql(
        `INSERT INTO bym."user" (userid, username, email, password, blocked_users, terms_accepted_at) VALUES (?, ?, ?, 'x', '[]', ?)`,
        [userid, `alertfacts_${userid}`, `alertfacts_${userid}@test.invalid`, joined],
      );
    }
  });

  afterAll(async () => {
    if (!orm) return;
    await sql(`DELETE FROM bym."user" WHERE userid IN (${LIST})`);
    await orm.close();
  });

  test("names by account number; a gone account has none", async () => {
    const names = await namesOf(orm.em.fork(), [NEW, 996499]);
    expect(names.get(NEW)).toEqual({ userid: NEW, username: `alertfacts_${NEW}` });
    expect(names.get(996499)).toEqual({ userid: 996499, username: null });
  });

  test("the join time is read, and only an account under an hour old is said", async () => {
    expect((await joinedAt(orm.em.fork(), NEW))?.joined?.getTime()).toBe(NOW.getTime() - 20 * 60_000);
    expect(await joinedAt(orm.em.fork(), UNKNOWN)).toEqual({ username: `alertfacts_${UNKNOWN}`, joined: null });

    const said: NewPhotoAlert[] = [];
    for (const userid of [NEW, OLD, UNKNOWN]) await tellNewPhoto(orm.em.fork(), userid, NOW, async (u) => void said.push(u));
    expect(said).toEqual([{ userid: NEW, username: `alertfacts_${NEW}`, age: 20 * 60_000 }]);
  });
});
