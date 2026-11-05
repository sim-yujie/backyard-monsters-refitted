import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { MikroORM } from "@mikro-orm/postgresql";

import ormConfig from "../../mikro-orm.config.js";
import { User } from "../../database/models/user.model.js";
import { searchPlayers } from "../admin/shinyAwards.js";
import { playerModeration } from "../admin/moderation.js";
import { recordLook } from "../user/lookReport.js";
import { lookTotals } from "./lookStats.js";

/**
 * Modern vs Classic on a real Postgres: `POST /player/look`'s write, the
 * dashboard's counts and the look in its player lists.
 *
 * Opt-in, like the other database tests: runs only when DASHBOARD_TEST_DB
 * names a throwaway database with every migration applied (never `bym`).
 * Account numbers from 996101; everything is deleted afterwards.
 */

const dbName = process.env.DASHBOARD_TEST_DB;

const MODERN = 996101;
const CLASSIC = 996102;
const OLD = 996103;
const TEST_ACCOUNT = 996104;
const SILENT = 996105;
const ALL = [MODERN, CLASSIC, OLD, TEST_ACCOUNT, SILENT];

const NOW = Date.parse("2026-11-10T12:00:00Z");
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

describe.skipIf(!dbName)("look reports on a real database", () => {
  let orm: MikroORM;

  const sql = <R = Record<string, unknown>>(query: string, params: unknown[] = []) => orm.em.fork().execute<R[]>(query, params);

  const reset = () => sql(`DELETE FROM bym."user" WHERE userid IN (${ALL.join(",")})`);

  const player = (userid: number, username: string) =>
    sql(
      `INSERT INTO bym."user" (userid, username, email, password, blocked_users, terms_accepted_at)
       VALUES (?, ?, ?, 'x', '[]', now())`,
      [userid, username, `${username}@test.com`],
    );

  const load = (userid: number) => orm.em.fork().findOneOrFail(User, { userid });

  beforeAll(async () => {
    orm = await MikroORM.init({ ...ormConfig, dbName, debug: false });
  });

  beforeEach(async () => {
    await reset();
    await player(MODERN, "looktest_modern");
    await player(CLASSIC, "looktest_classic");
    await player(OLD, "looktest_old");
    await player(TEST_ACCOUNT, "zz_looktest");
    await player(SILENT, "looktest_silent");
  });

  afterAll(async () => {
    await reset();
    await orm.close(true);
  });

  test("a report is stored, and an unchanged one within the hour is not written again", async () => {
    const at = new Date(NOW);
    expect(await recordLook(orm.em.fork(), await load(MODERN), { style: "modern", music: "new", quality: "medium", font: "clear" }, at)).toBe(true);
    const stored = await load(MODERN);
    expect(stored).toMatchObject({ look_style: "modern", look_music: "new", look_quality: "medium", look_font: "clear" });
    expect(stored.look_seen_at?.getTime()).toBe(NOW);

    const later = new Date(NOW + 10 * 60 * 1000);
    expect(await recordLook(orm.em.fork(), stored, { style: "modern", music: "new", quality: "medium", font: "clear" }, later)).toBe(false);
    expect((await load(MODERN)).look_seen_at?.getTime()).toBe(NOW);

    // A change is written at once; the choices left out keep their values.
    expect(await recordLook(orm.em.fork(), await load(MODERN), { style: "classic" }, later)).toBe(true);
    expect(await load(MODERN)).toMatchObject({ look_style: "classic", look_music: "new", look_quality: "medium", look_font: "clear" });
  });

  test("the dashboard counts real players seen in the last week, and lists each one's look", async () => {
    await recordLook(orm.em.fork(), await load(MODERN), { style: "modern", music: "style", quality: "high", font: "game" }, new Date(NOW - HOUR));
    await recordLook(orm.em.fork(), await load(CLASSIC), { style: "classic", music: "flash", quality: "low", font: "readable" }, new Date(NOW - 2 * DAY));
    // Seen too long ago, and a test account: neither counts.
    await recordLook(orm.em.fork(), await load(OLD), { style: "classic" }, new Date(NOW - 8 * DAY));
    await recordLook(orm.em.fork(), await load(TEST_ACCOUNT), { style: "classic" }, new Date(NOW - HOUR));

    const before = await lookTotals(orm.em.fork(), NOW);
    // Other rows in the copy may have looks too; only ours are known, so compare with them added.
    await sql(`UPDATE bym."user" SET look_seen_at = NULL WHERE userid IN (${MODERN}, ${CLASSIC})`);
    const without = await lookTotals(orm.em.fork(), NOW);
    expect(before.reported - without.reported).toBe(2);
    expect(before.style.modern - without.style.modern).toBe(1);
    expect(before.style.classic - without.style.classic).toBe(1);
    expect(before.music.flash - without.music.flash).toBe(1);
    expect(before.quality.low - without.quality.low).toBe(1);
    expect(before.font.readable - without.font.readable).toBe(1);

    const found = await searchPlayers(orm.em.fork(), "looktest_");
    const lookOf = (userid: number) => found.find((p) => p.userid === userid)?.look;
    expect(lookOf(MODERN)).toBe("modern");
    expect(lookOf(CLASSIC)).toBe("classic");
    expect(lookOf(SILENT)).toBeNull();

    expect((await playerModeration(orm.em.fork(), CLASSIC))?.look).toBe("classic");
    expect((await playerModeration(orm.em.fork(), SILENT))?.look).toBeNull();
  });
});
