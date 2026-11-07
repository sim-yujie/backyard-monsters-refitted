import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { MikroORM } from "@mikro-orm/postgresql";

import ormConfig from "../../mikro-orm.config.js";
import { addModerator, listModerators, readModeratorIds, removeModerator, type ModeratorEffects } from "./chatModerators.js";

/**
 * The dashboard's Moderators list against a real Postgres: add by name
 * (any case) or account number, a clear refusal for an unknown name, a game
 * team account or a second add, remove, and the chat gateway told of each
 * change.
 *
 * Opt-in, like the other database tests: runs only when DASHBOARD_TEST_DB
 * names a throwaway database with every migration applied (never `bym`).
 * Players are `cmodtest_*`, account numbers from 997101; everything is
 * deleted afterwards.
 */

const dbName = process.env.DASHBOARD_TEST_DB;

const PLAYER = 997101;
const OTHER = 997102;
const OWNER = 997109;
const ALL = [PLAYER, OTHER, OWNER];
const LIST = ALL.join(",");
const NOW = new Date("2026-11-07T10:00:00Z");

describe.skipIf(!dbName)("the dashboard's chat moderators on a real database", () => {
  let orm: MikroORM;
  let changes = 0;
  const effects: ModeratorEffects = { changed: async () => void (changes += 1) };
  const sql = <R = Record<string, any>>(query: string, params: unknown[] = []) => orm.em.fork().execute<R[]>(query, params);
  const savedAdmins = process.env.ADMIN_USER_IDS;

  beforeAll(async () => {
    if (dbName === "bym") throw new Error("DASHBOARD_TEST_DB must be a throwaway database, not bym");
    orm = await MikroORM.init({ ...ormConfig, dbName, debug: false, pool: { min: 0, max: 4 } });
    for (const userid of ALL) {
      const name = `cmodtest_${userid}`;
      await sql(
        `INSERT INTO bym."user" (userid, username, email, password, blocked_users) VALUES (?, ?, ?, 'x', '[]') ON CONFLICT DO NOTHING`,
        [userid, name, `${name}@test.invalid`],
      );
    }
  });

  beforeEach(async () => {
    process.env.ADMIN_USER_IDS = String(OWNER);
    await sql(`DELETE FROM bym.chat_moderator WHERE userid IN (${LIST})`);
    changes = 0;
  });

  afterEach(() => {
    if (savedAdmins === undefined) delete process.env.ADMIN_USER_IDS;
    else process.env.ADMIN_USER_IDS = savedAdmins;
  });

  afterAll(async () => {
    if (!orm) return;
    await sql(`DELETE FROM bym.chat_moderator WHERE userid IN (${LIST})`);
    await sql(`DELETE FROM bym."user" WHERE userid IN (${LIST})`);
    await orm.close();
  });

  test("adds a player by name, in any case, and lists them with who added them", async () => {
    const done = await addModerator(orm.em.fork(), `CModTest_${PLAYER}`, OWNER, effects, NOW);
    expect(done).toEqual({
      outcome: "added",
      moderator: {
        userid: PLAYER,
        username: `cmodtest_${PLAYER}`,
        addedBy: OWNER,
        addedByName: `cmodtest_${OWNER}`,
        addedAt: NOW.toISOString(),
      },
    });
    expect(changes).toBe(1);
    expect((await listModerators(orm.em.fork())).filter((m) => ALL.includes(m.userid)).map((m) => m.userid)).toEqual([PLAYER]);
    expect(await readModeratorIds(orm.em.fork())).toContain(PLAYER);
  });

  test("adds a player by account number, with or without #", async () => {
    expect((await addModerator(orm.em.fork(), String(PLAYER), OWNER, effects, NOW)).outcome).toBe("added");
    expect((await addModerator(orm.em.fork(), `#${OTHER}`, OWNER, effects, NOW)).outcome).toBe("added");
    expect(changes).toBe(2);
  });

  test("an unknown name is refused and nothing changes", async () => {
    expect(await addModerator(orm.em.fork(), "cmodtest_nobody_here", OWNER, effects, NOW)).toEqual({ outcome: "noPlayer" });
    expect(changes).toBe(0);
  });

  test("a second add of the same player is refused, saying so", async () => {
    await addModerator(orm.em.fork(), `cmodtest_${PLAYER}`, OWNER, effects, NOW);
    expect(await addModerator(orm.em.fork(), String(PLAYER), OWNER, effects, NOW)).toEqual({
      outcome: "already",
      username: `cmodtest_${PLAYER}`,
    });
    expect(changes).toBe(1);
    const [row] = await sql<{ n: string | number }>(`SELECT count(*) AS n FROM bym.chat_moderator WHERE userid = ?`, [PLAYER]);
    expect(Number(row!.n)).toBe(1);
  });

  test("a game team account is refused: it already shows GM", async () => {
    expect((await addModerator(orm.em.fork(), `cmodtest_${OWNER}`, OWNER, effects, NOW)).outcome).toBe("gameTeam");
    expect(await readModeratorIds(orm.em.fork())).not.toContain(OWNER);
  });

  test("removes a moderator; removing someone not on the list says so", async () => {
    await addModerator(orm.em.fork(), String(PLAYER), OWNER, effects, NOW);
    expect(await removeModerator(orm.em.fork(), PLAYER, OWNER, effects)).toBe(true);
    expect(await readModeratorIds(orm.em.fork())).not.toContain(PLAYER);
    expect(changes).toBe(2);
    expect(await removeModerator(orm.em.fork(), PLAYER, OWNER, effects)).toBe(false);
    expect(changes).toBe(2);
  });

  test("a deleted account leaves the list with it", async () => {
    await addModerator(orm.em.fork(), String(OTHER), OWNER, effects, NOW);
    await sql(`DELETE FROM bym."user" WHERE userid = ?`, [OTHER]);
    expect(await readModeratorIds(orm.em.fork())).not.toContain(OTHER);
    await sql(
      `INSERT INTO bym."user" (userid, username, email, password, blocked_users) VALUES (?, ?, ?, 'x', '[]') ON CONFLICT DO NOTHING`,
      [OTHER, `cmodtest_${OTHER}`, `cmodtest_${OTHER}@test.invalid`],
    );
  });
});
