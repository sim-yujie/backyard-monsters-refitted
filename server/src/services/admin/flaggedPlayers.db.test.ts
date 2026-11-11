import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { MikroORM } from "@mikro-orm/postgresql";

import ormConfig from "../../mikro-orm.config.js";
import { flaggedPlayer, listFlaggedPlayers } from "./flaggedPlayers.js";

/**
 * The dashboard's Flagged list against a real Postgres: one row per
 * `bym.report` row, newest entry first, the yards each entry names resolved
 * to their owner now (a bot marked, a seeded dev player not), a gone account
 * still listed under its report name, and one player's whole history.
 *
 * Opt-in, like the other database tests: runs only when DASHBOARD_TEST_DB
 * names a throwaway database with every migration applied (never `bym`).
 * Players are `flagtest_*`, account numbers from 997301; everything is
 * deleted afterwards.
 */

const dbName = process.env.DASHBOARD_TEST_DB;

const CHEAT = 997301;
const SAVER = 997302;
const BOT = 997303;
const SEEDED = 997304;
const GONE = 997305;
const USERS = [CHEAT, SAVER, BOT, SEEDED];
const LIST = [...USERS, GONE].join(",");
const BOT_BASE = "99730301";
const SEEDED_BASE = "99730401";
const SAVER_BASE = "99730201";

describe.skipIf(!dbName)("the dashboard's Flagged list on a real database", () => {
  let orm: MikroORM;
  /** Each yard's save id, by owner, as the database gave it. */
  const saveIds = new Map<number, number>();
  const sql = <R = Record<string, any>>(text: string, params: unknown[] = []) => orm.em.fork().execute<R[]>(text, params);

  const report = (userid: number, username: string, entries: { message: string; timestamp: string }[], updated: string) =>
    sql(
      `INSERT INTO bym.report (userid, username, report, ban_reason, violations, attack_violations, created_at, lastupdate_at)
       VALUES (?, ?, ?::jsonb, '{}'::jsonb, ?, 0, ?, ?)`,
      [userid, username, JSON.stringify(entries), entries.length, updated, updated],
    );

  const clean = async () => {
    await sql(`DELETE FROM bym.report WHERE userid IN (${LIST})`);
    await sql(`DELETE FROM bym.save WHERE saveuserid IN (${LIST})`);
    await sql(`DELETE FROM bym.bot WHERE userid IN (${LIST})`);
    await sql(`DELETE FROM bym."user" WHERE userid IN (${LIST})`);
  };

  beforeAll(async () => {
    if (dbName === "bym") throw new Error("DASHBOARD_TEST_DB must be a throwaway database, not bym");
    orm = await MikroORM.init({ ...ormConfig, dbName, debug: false, pool: { min: 0, max: 4 } });
    await clean();
    for (const userid of USERS) {
      const name = `flagtest_${userid}`;
      await sql(
        `INSERT INTO bym."user" (userid, username, email, password, blocked_users, banned) VALUES (?, ?, ?, 'x', '[]', ?)`,
        [userid, name, `${name}@test.invalid`, userid === SAVER],
      );
    }
    await sql(`INSERT INTO bym.bot (userid, seed, persona, level, level_since, state) VALUES (?, 1, 'army', 24, now(), 'active')`, [BOT]);
    await sql(`INSERT INTO bym.bot (userid, seed, persona, level, level_since, state) VALUES (?, 2, 'army', 24, now(), 'seeded')`, [SEEDED]);
    for (const [userid, baseid] of [
      [BOT, BOT_BASE],
      [SEEDED, SEEDED_BASE],
      [SAVER, SAVER_BASE],
    ] as const) {
      const [saved] = await sql<{ basesaveid: number }>(
        `INSERT INTO bym.save (userid, saveuserid, baseid, type, points, basevalue, createtime, name, credits, attacks,
                               takeover_date, created_at, lastupdate_at)
         VALUES (?, ?, ?, 'main', '0', '0', 0, 'yard', 0, '[]', now(), now(), now())
         RETURNING basesaveid`,
        [userid, userid, baseid],
      );
      saveIds.set(userid, Number(saved!.basesaveid));
    }

    await report(
      CHEAT,
      `flagtest_${CHEAT}`,
      [
        {
          message: `Attack save on base ${BOT_BASE} rejected (reject): disagrees with the replay on damage, buildinghealthdata, attackloot [save ${saveIds.get(BOT)}]`,
          timestamp: "2026-11-10T00:04:51.000Z",
        },
        {
          message: `Attack save on base ${SEEDED_BASE} rejected (reject): disagrees with the replay on buildinghealthdata, attackerchampion [save ${saveIds.get(SEEDED)}]`,
          timestamp: "2026-11-10T10:27:00.000Z",
        },
        // Written before the yard tag: the bot's base id, but not read as its yard.
        {
          message: `Attack save on base ${BOT_BASE} flagged (log): disagrees with the replay on attackersiege`,
          timestamp: "2026-11-09T00:00:00.000Z",
        },
        {
          message: "Attack save on base 201 flagged (log): disagrees with the replay on attackersiege [descent]",
          timestamp: "2026-11-09T00:01:00.000Z",
        },
      ],
      "2026-11-10T10:27:00Z",
    );
    await report(
      SAVER,
      `flagtest_${SAVER}`,
      [{ message: `ECONOMY SAVE REJECTED (mode=reject): base ${SAVER_BASE}, 30s since the last save — overCap [12]`, timestamp: "2026-11-09T08:00:00.000Z" }],
      "2026-11-09T08:00:00Z",
    );
    await report(GONE, "flagtest_gone", [{ message: "ATTACK VIOLATION: Attack payload was missing. Client modified.", timestamp: "2026-11-08T08:00:00.000Z" }], "2026-11-08T08:00:00Z");
  });

  afterAll(async () => {
    if (!orm) return;
    await clean();
    await orm.close();
  });

  test("every flagged player, newest entry first, with the yards' owners", async () => {
    const players = (await listFlaggedPlayers(orm.em.fork())).filter((p) => [CHEAT, SAVER, GONE].includes(p.userid));
    expect(players.map((p) => p.userid)).toEqual([CHEAT, SAVER, GONE]);

    const [cheat, saver, gone] = players;
    expect(cheat).toMatchObject({
      username: `flagtest_${CHEAT}`,
      banned: false,
      gone: false,
      counts: { fight: { refused: 2, flagged: 2 }, economy: { refused: 0, flagged: 0 }, attack: 0, other: 0 },
      last: "2026-11-10T10:27:00.000Z",
      entries: 4,
    });
    expect(cheat!.fields).toContainEqual({ name: "buildinghealthdata", count: 2 });
    const yards = Object.fromEntries(cheat!.yards.map((yard) => [yard.key, yard]));
    expect(yards[`save:${saveIds.get(BOT)}`]).toMatchObject({
      kind: "yard",
      baseid: BOT_BASE,
      type: "main",
      owner: { userid: BOT, username: `flagtest_${BOT}`, bot: true },
      count: 1,
    });
    // A seeded dev player is not a bot.
    expect(yards[`save:${saveIds.get(SEEDED)}`]).toMatchObject({ owner: { userid: SEEDED, bot: false } });
    // An untagged old entry names only a base id: no owner is guessed from it.
    expect(yards[`base:${BOT_BASE}`]).toMatchObject({ kind: "unknown", baseid: BOT_BASE, owner: null });
    expect(yards["descent:201"]).toMatchObject({ kind: "descent", baseid: "201", owner: null });

    expect(saver).toMatchObject({ banned: true, counts: { economy: { refused: 1, flagged: 0 } }, fields: [{ name: "overCap", count: 1 }] });
    expect(saver!.yards[0]).toMatchObject({ kind: "yard", baseid: SAVER_BASE, owner: { userid: SAVER, bot: false } });

    expect(gone).toMatchObject({ username: "flagtest_gone", gone: true, counts: { attack: 1 }, yards: [] });
  });

  test("one player's history, newest first, each entry with its yard", async () => {
    const detail = (await flaggedPlayer(orm.em.fork(), CHEAT))!;
    expect(detail.player.userid).toBe(CHEAT);
    expect(detail.history.map((entry) => entry.time)).toEqual([
      "2026-11-10T10:27:00.000Z",
      "2026-11-10T00:04:51.000Z",
      "2026-11-09T00:01:00.000Z",
      "2026-11-09T00:00:00.000Z",
    ]);
    expect(detail.history[1]).toMatchObject({
      kind: "fight",
      outcome: "refused",
      fields: ["damage", "buildinghealthdata", "attackloot"],
      yard: { kind: "yard", baseid: BOT_BASE, owner: { userid: BOT, bot: true } },
    });
    expect(detail.history[3]!.yard).toMatchObject({ kind: "unknown", baseid: BOT_BASE, owner: null });
    expect(await flaggedPlayer(orm.em.fork(), BOT)).toBeNull();
  });
});
