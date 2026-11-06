import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { MikroORM } from "@mikro-orm/postgresql";

import ormConfig from "../../../mikro-orm.config.js";
import { noticeInfernoAttack, noticeYardAttack, takeOutpostNotices, writeOutpostNotice, YARD_ATTACKED } from "./outpostNotices.js";

/**
 * An attack notice's numbers against a real Postgres (less-text job 3, 28 Oct
 * 2026): the `message.attackstats` column the migration adds, written with
 * the notice, handed back with it on the next load, and absent on a notice
 * written without it (one from before the column), which keeps its sentence.
 *
 * Opt-in: runs only when NOTICES_TEST_DB names a throwaway database with the
 * `bym` schema and the migration applied, and refuses the shared `bym`
 * database. Each test clears its player's messages first.
 */
const dbName = process.env.NOTICES_TEST_DB;

const OWNER = 994_001;
const ATTACKER = 994_002;

describe.skipIf(!dbName)("attack notice numbers on a real database", () => {
  let orm: MikroORM;
  const em = () => orm.em.fork();
  const sql = <R = Record<string, any>>(query: string, params: unknown[] = []) => em().execute<R[]>(query, params);

  const clear = async () => {
    await sql(`DELETE FROM bym.message WHERE targetid = ?`, [OWNER]);
    await sql(`DELETE FROM bym.thread WHERE targetid = ?`, [OWNER]);
  };

  beforeAll(async () => {
    if (dbName === "bym") throw new Error("NOTICES_TEST_DB must be a throwaway database, not bym");
    orm = await MikroORM.init({ ...ormConfig, dbName, debug: false, pool: { min: 0, max: 2 } });
  });

  beforeEach(clear);

  afterAll(async () => {
    if (!orm) return;
    await clear();
    await orm.close(true);
  });

  test("a yard attack keeps its numbers in the column, and the next load hands them back", async () => {
    await noticeYardAttack(em(), {
      yard: { baseid: "99400101", saveuserid: OWNER, damage: 63.4 } as never,
      attacker: { userid: ATTACKER, username: "zz_bramble" },
      defenderDelta: { r1: -1234, r4: -500 },
      housedLost: 4,
      now: 1_790_000_000,
    });
    const [row] = await sql<{ attackstats: unknown; message: string }>(
      `SELECT attackstats, message FROM bym.message WHERE targetid = ?`,
      [OWNER],
    );
    expect(row!.attackstats).toEqual({ damage: 63, loot: { r1: 1234, r4: 500 }, housedLost: 4 });
    expect(row!.message).toBe("It was left 63% damaged. 1,234 Twigs and 500 Goo were looted.");

    const [notice] = await takeOutpostNotices(em(), OWNER);
    expect(notice!.detail).toMatchObject({
      subject: "zz_bramble attacked your yard",
      stats: { damage: 63, loot: { r1: 1234, r4: 500 } },
    });
  });

  test("an Inferno attack's numbers too", async () => {
    await noticeInfernoAttack(em(), {
      yard: { baseid: "99400102", saveuserid: OWNER, damage: 100 } as never,
      attacker: { userid: ATTACKER, username: "zz_bramble" },
      loot: { r1: 4837, r3: 1650 },
      housedLost: 0,
      now: 1_790_000_001,
    });
    const [row] = await sql<{ attackstats: unknown }>(`SELECT attackstats FROM bym.message WHERE targetid = ?`, [OWNER]);
    expect(row!.attackstats).toEqual({ damage: 100, loot: { r1: 4837, r3: 1650 }, housedLost: 0 });
  });

  test("a notice with no numbers, as an older one, leaves the column empty and keeps only its sentence", async () => {
    await writeOutpostNotice(em(), {
      ownerId: OWNER,
      byUserId: ATTACKER,
      type: YARD_ATTACKED,
      text: { subject: "Kai attacked your yard", message: "It was left 40% damaged, and 500 Goo were looted." },
      cell: null,
      baseid: "99400103",
      now: 1_790_000_002,
    });
    const [row] = await sql<{ attackstats: unknown }>(`SELECT attackstats FROM bym.message WHERE targetid = ?`, [OWNER]);
    expect(row!.attackstats).toBeNull();
    const [notice] = await takeOutpostNotices(em(), OWNER);
    expect(notice!.detail.text).toBe("Kai attacked your yard. It was left 40% damaged, and 500 Goo were looted.");
    expect(notice!.detail).not.toHaveProperty("stats");
  });
});
