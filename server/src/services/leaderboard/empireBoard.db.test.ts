import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { MikroORM } from "@mikro-orm/postgresql";

import ormConfig from "../../mikro-orm.config.js";
import { Save } from "../../database/models/save.model.js";
import { User } from "../../database/models/user.model.js";
import { STARTER_KITS } from "../../game-data/starterKits.js";
import { estimateMainPointsEarned } from "../maproom/v2/outpostEarned.js";
import { seedMainPointsEarned } from "../maproom/v2/outpostEarnedSeed.js";
import { tallyOutposts } from "../maproom/v2/outpostPoints.js";
import { kitBuildings } from "../yard/starterKit.js";
import { BOARD_SQL, OUTPOSTS_SQL, rankRows } from "./empireBoard.js";

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

  /** Our test players in board order, as the two queries rank them among everyone. */
  const ours = async () =>
    rankRows(await sql(BOARD_SQL), tallyOutposts(await sql(OUTPOSTS_SQL)))
      .filter((row) => row.name.startsWith(PREFIX))
      .map((row) => ({ name: row.name.slice(PREFIX.length), points: row.empirePoints, outposts: row.outposts }));

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

  /** A copy of the player's main yard row as another yard of `type` holding `buildingdata`. */
  const yardOf = async (id: number, type: string, i: number, buildingdata: object) => {
    const [main] = await sql<{ basesaveid: number }>(`SELECT basesaveid FROM bym.save WHERE userid = ? AND type = 'main'`, [id]);
    await sql(
      `INSERT INTO bym.save (baseid, userid, saveuserid, type, createtime, name, credits, attacks, takeover_date,
                            created_at, lastupdate_at, points, basevalue, empirepoints, buildingdata)
       SELECT ?, userid, saveuserid, ?, createtime, name, credits, attacks, takeover_date,
              created_at, lastupdate_at, '99999', '99999', 199998, ?::jsonb
         FROM bym.save WHERE basesaveid = ?`,
      [String(900000000 + id * 10 + i), type, JSON.stringify(buildingdata), main!.basesaveid],
    );
  };

  test("outposts add their points (not their saved points), an empty one adds 0, an Inferno yard nothing", async () => {
    const id = await player("outposter", "100");
    await yardOf(id, "outpost", 0, {});
    await yardOf(id, "outpost", 1, kitBuildings(STARTER_KITS[0]!, "shiny", {}).buildingdata);
    await yardOf(id, "inferno", 2, kitBuildings(STARTER_KITS[2]!, "shiny", {}).buildingdata);
    // 100 main yard points + the Regular Kit's 12,823,091.
    expect(await ours()).toEqual([{ name: "outposter", points: 100 + 12_823_091, outposts: 2 }]);
  });

  test("each outpost adds its points less the main points it paid, never below 0 (patch 8.1)", async () => {
    const id = await player("counted", "100");
    await yardOf(id, "outpost", 0, kitBuildings(STARTER_KITS[0]!, "shiny", {}).buildingdata);
    await yardOf(id, "outpost", 1, kitBuildings(STARTER_KITS[0]!, "shiny", {}).buildingdata);
    await sql(`UPDATE bym.save SET mainpointsearned = 2823091 WHERE baseid = ?`, [String(900000000 + id * 10)]);
    await sql(`UPDATE bym.save SET mainpointsearned = 99000000 WHERE baseid = ?`, [String(900000000 + id * 10 + 1)]);
    expect(await ours()).toEqual([{ name: "counted", points: 100 + 10_000_000, outposts: 2 }]);
  });

  test("the one-off seed fills the estimate, never lowers a value, and runs once unless forced", async () => {
    const id = await player("seeded", "100");
    const regular = kitBuildings(STARTER_KITS[0]!, "resources", {}).buildingdata;
    // Every prefab standing: each paid its level-1 build points.
    const standing = Object.fromEntries(
      Object.entries(regular).map(([key, b]) => {
        const { cB: _cB, cL: _cL, prefab, ...rest } = b as unknown as Record<string, unknown>;
        return [key, prefab ? { ...rest, l: prefab } : rest];
      }),
    );
    await yardOf(id, "outpost", 0, standing);
    await yardOf(id, "outpost", 1, standing);
    const [low, high] = [String(900000000 + id * 10), String(900000000 + id * 10 + 1)];
    await sql(`UPDATE bym.save SET mainpointsearned = 99000000 WHERE baseid = ?`, [high]);
    const estimate = estimateMainPointsEarned(standing as never, 0);
    expect(estimate).toBeGreaterThan(0);

    const earned = async () =>
      (await sql<{ baseid: string; mainpointsearned: string }>(
        `SELECT baseid, mainpointsearned FROM bym.save WHERE baseid IN (?, ?) ORDER BY baseid`,
        [low, high],
      )).map((row) => Number(row.mainpointsearned));

    const dry = await seedMainPointsEarned(orm.em.fork(), {});
    expect(dry.rows.find((row) => row.basesaveid > 0 && row.userid === id && row.before === 0)?.after).toBe(estimate);
    expect(await earned()).toEqual([0, 99_000_000]);

    await seedMainPointsEarned(orm.em.fork(), { apply: true, force: true });
    expect(await earned()).toEqual([estimate, 99_000_000]);
    await expect(seedMainPointsEarned(orm.em.fork(), { apply: true })).rejects.toThrow("already ran");
    await sql(`COMMENT ON COLUMN bym.save.mainpointsearned IS NULL`);
  });

  test("a big enough outpost lifts a player past one with a bigger main yard", async () => {
    await player("bigyard", "200000000");
    const kitter = await player("kitter", "1000");
    await yardOf(kitter, "outpost", 0, kitBuildings(STARTER_KITS[2]!, "resources", {}).buildingdata);
    expect(await ours()).toEqual([
      { name: "kitter", points: 1000 + 299_272_162, outposts: 1 },
      { name: "bigyard", points: 200_000_000, outposts: 0 },
    ]);
  });
});
