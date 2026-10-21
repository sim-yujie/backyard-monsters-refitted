import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { MikroORM } from "@mikro-orm/postgresql";

import ormConfig from "../../mikro-orm.config.js";
import { Save } from "../../database/models/save.model.js";
import { User } from "../../database/models/user.model.js";
import { BOARD_SQL } from "./empireBoard.js";

/**
 * The leaderboard's query against a real Postgres (beta.4): the order, the
 * tie break, who is left out and the outpost count, and the `Save` hook that
 * keeps `empirepoints` in step through the ORM.
 *
 * Opt-in, like `friendDecline.db.test.ts`: runs only when BOTS_TEST_DB names
 * a throwaway database with the `bym` schema and the `AddEmpirePointsToSave`
 * migration, and refuses the shared `bym`.
 */
const dbName = process.env.BOTS_TEST_DB;
const PREFIX = "lbtest_";

describe.skipIf(!dbName)("the empire leaderboard query (beta.4)", () => {
  let orm: MikroORM;

  const sql = <R = Record<string, any>>(query: string, params: unknown[] = []) => orm.em.fork().execute<R[]>(query, params);

  const removePlayers = async () => {
    const users = await sql<{ userid: number }>(`SELECT userid FROM bym."user" WHERE username LIKE ?`, [`${PREFIX}%`]);
    for (const { userid } of users) {
      await sql(`DELETE FROM bym.bot WHERE userid = ?`, [userid]);
      await sql(`UPDATE bym."user" SET save_basesaveid = NULL WHERE userid = ?`, [userid]);
      await sql(`DELETE FROM bym.save WHERE userid = ?`, [userid]);
      await sql(`DELETE FROM bym."user" WHERE userid = ?`, [userid]);
    }
  };

  /** A player with a main yard on `points` + `basevalue`; returns their user id. */
  const player = async (name: string, points: string, basevalue = "0"): Promise<number> => {
    const em = orm.em.fork();
    const user = em.create(User, { username: `${PREFIX}${name}`, email: `${PREFIX}${name}@test.com`, password: "x" });
    await em.flush();
    const save = await Save.createMainSave(em, user);
    save.points = points;
    save.basevalue = basevalue;
    await em.flush();
    return user.userid;
  };

  /** Our test players in board order, as the query ranks them among everyone. */
  const ours = async () =>
    (await sql<{ username: string; empirepoints: string; outposts: number }>(BOARD_SQL))
      .filter((row) => row.username.startsWith(PREFIX))
      .map((row) => ({ name: row.username.slice(PREFIX.length), points: Number(row.empirepoints), outposts: Number(row.outposts) }));

  beforeAll(async () => {
    if (dbName === "bym") throw new Error("BOTS_TEST_DB must be a throwaway database, not bym");
    orm = await MikroORM.init({ ...ormConfig, dbName, debug: false, pool: { min: 0, max: 4 } });
  });

  beforeEach(removePlayers);

  afterAll(async () => {
    if (!orm) return;
    await removePlayers();
    await orm.close(true);
  });

  test("the Save hook stores points + basevalue, and stamps the time only when the score moves", async () => {
    const id = await player("hook", "100", "50");
    const [first] = await sql(`SELECT empirepoints, empirepointsat FROM bym.save WHERE userid = ? AND type = 'main'`, [id]);
    expect(Number(first!.empirepoints)).toBe(150);
    expect(Number(first!.empirepointsat)).toBeGreaterThan(0);

    await sql(`UPDATE bym.save SET empirepointsat = 5 WHERE userid = ? AND type = 'main'`, [id]);
    const em = orm.em.fork();
    const save = await em.findOneOrFail(Save, { userid: id, type: "main" });
    save.basevalue = "250";
    await em.flush();
    const [moved] = await sql(`SELECT empirepoints, empirepointsat FROM bym.save WHERE userid = ? AND type = 'main'`, [id]);
    expect(Number(moved!.empirepoints)).toBe(350);
    expect(Number(moved!.empirepointsat)).toBeGreaterThan(5);
  });

  test("most points first; a tie goes to whoever reached the score first", async () => {
    const low = await player("low", "100");
    const late = await player("late", "500");
    const early = await player("early", "400", "100");
    const top = await player("top", "900");
    await sql(`UPDATE bym.save SET empirepointsat = 2000 WHERE userid = ? AND type = 'main'`, [late]);
    await sql(`UPDATE bym.save SET empirepointsat = 1000 WHERE userid = ? AND type = 'main'`, [early]);
    expect((await ours()).map((row) => row.name)).toEqual(["top", "early", "late", "low"]);
    expect(top).toBeGreaterThan(low);
  });

  test("a tie on score and time goes to the lower user id, so the order is stable", async () => {
    const first = await player("first", "300");
    const second = await player("second", "300");
    await sql(`UPDATE bym.save SET empirepointsat = 1000 WHERE userid IN (?, ?) AND type = 'main'`, [first, second]);
    expect((await ours()).map((row) => row.name)).toEqual(["first", "second"]);
  });

  test("bots of any state (seeded dev players too) and banned players are left out", async () => {
    await player("real", "100");
    const bot = await player("bot", "9000");
    const seeded = await player("seeded", "8000");
    const banned = await player("banned", "7000");
    await sql(
      `INSERT INTO bym.bot (userid, seed, persona, level, level_since, state) VALUES (?, 1, 'towers', 10, now(), 'active'), (?, 2, 'towers', 10, now(), 'seeded')`,
      [bot, seeded],
    );
    await sql(`UPDATE bym."user" SET banned = true WHERE userid = ?`, [banned]);
    expect((await ours()).map((row) => row.name)).toEqual(["real"]);
  });

  test("only the main yard counts towards the score, and outposts are counted", async () => {
    const id = await player("outposter", "100");
    const [main] = await sql<{ basesaveid: number }>(`SELECT basesaveid FROM bym.save WHERE userid = ? AND type = 'main'`, [id]);
    for (let i = 0; i < 2; i++) {
      await sql(
        `INSERT INTO bym.save (baseid, userid, saveuserid, type, createtime, name, credits, attacks, takeover_date,
                              created_at, lastupdate_at, points, basevalue, empirepoints)
         SELECT ?, userid, saveuserid, 'outpost', createtime, name, credits, attacks, takeover_date,
                created_at, lastupdate_at, '99999', '99999', 199998
           FROM bym.save WHERE basesaveid = ?`,
        [String(900000000 + id * 10 + i), main!.basesaveid],
      );
    }
    expect(await ours()).toEqual([{ name: "outposter", points: 100, outposts: 2 }]);
  });
});
