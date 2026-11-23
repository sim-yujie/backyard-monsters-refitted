import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { MikroORM, RequestContext } from "@mikro-orm/postgresql";

import ormConfig from "../../mikro-orm.config.js";
import { AllianceType } from "../../enums/Alliance.js";
import { memoryRedis } from "../../testing/memoryRedis.js";

/**
 * The goal lines in the alliance feed and chat (patch 8.3). From beta 7 to
 * 8.2 "Goal set" and "Goal done" were said inside the goal's transaction, and
 * the shout was written through the server's entity manager after that
 * transaction had committed ("Transaction is already committed"): no feed row
 * and no live line. Here `postgres.em` is the global entity manager, as on the
 * server (it resolves to the open transaction or request), not a fresh fork.
 *
 * Opt-in like `allianceProgress.db.test.ts`: runs only when ALLIANCE_TEST_DB
 * names a throwaway copy; refuses `bym`. Rows use ids 993_950 and up.
 */
const dbName = process.env.ALLIANCE_TEST_DB;
const enabled = Boolean(dbName) && dbName !== "bym";

const orm = enabled ? await MikroORM.init({ ...ormConfig, dbName, debug: false, pool: { min: 0, max: 5 } }) : null;

const published: { channel: string; payload: string }[] = [];

mock.module("../../server.js", () => ({
  postgres: {
    orm,
    get em() {
      if (!orm) throw new Error("ALLIANCE_TEST_DB is not set");
      return orm.em;
    },
  },
  redis: {
    ...memoryRedis(),
    publish: async (channel: string, payload: string) => {
      published.push({ channel, payload });
      return 1;
    },
  },
}));

const progress = await import("./allianceProgress.js");
const { progressFeedLine } = await import("./progressFeed.js");

const BASE = 993_950;
const LEADER = BASE + 1;
const MEMBER = BASE + 2;
const USERS = [LEADER, MEMBER];
const ALLIANCE = BASE + 1;
// A Wednesday, so the week has begun (Monday 2026-11-09).
const NOW = Date.parse("2026-11-11T12:00:00Z") / 1000;

const sql = <R = Record<string, any>>(query: string, params: unknown[] = []) =>
  orm!.em.fork().execute<R[]>(query, params);

/** Runs `work` as a request does: in a request context on the global entity manager. */
const asRequest = <T>(work: () => Promise<T>) => RequestContext.create(orm!.em, work);

const clear = async () => {
  await sql(`DELETE FROM bym.alliance_message WHERE alliance_id = ?`, [ALLIANCE]);
  await sql(`DELETE FROM bym.alliance_contribution WHERE alliance_id = ?`, [ALLIANCE]);
  await sql(`DELETE FROM bym.alliance_goal WHERE alliance_id = ?`, [ALLIANCE]);
  await sql(`DELETE FROM bym.alliance WHERE id = ?`, [ALLIANCE]);
  await sql(`DELETE FROM bym."user" WHERE userid IN (${USERS.join(",")})`);
};

/** The feed rows of one type, waiting up to 3 s for the line, which is said without being awaited. */
const feedRows = async (type: string, want: number) => {
  for (let tries = 0; ; tries += 1) {
    const rows = await sql<{ body: string; user_id: number }>(
      `SELECT body, user_id FROM bym.alliance_message WHERE alliance_id = ? AND message_type = ? ORDER BY id`,
      [ALLIANCE, type]
    );
    if (rows.length >= want || tries >= 30) return rows;
    await Bun.sleep(100);
  }
};

/** The live lines published to the alliance's chat channel with this message type. */
const liveLines = (type: string) =>
  published.filter(({ channel, payload }) => channel.includes(String(ALLIANCE)) && JSON.parse(payload).messageType === type);

describe.skipIf(!enabled)("goal lines in the alliance feed (patch 8.3)", () => {
  beforeEach(async () => {
    await clear();
    published.length = 0;
    progress.setProgressFeed(progressFeedLine(orm!.em));
    for (const userid of USERS) {
      await sql(
        `INSERT INTO bym."user" (userid, username, email, password, blocked_users, last_seen_at)
         VALUES (?, ?, ?, 'x', '[]', now())`,
        [userid, `zz_gl_${userid}`, `zz_gl_${userid}@test.invalid`]
      );
    }
    await sql(
      `INSERT INTO bym.alliance (id, name, leader_userid, leader_name, world_id, created_at, type)
       VALUES (?, ?, ?, ?, 'w', now(), ?)`,
      [ALLIANCE, `zz_gl_${ALLIANCE}`, LEADER, `zz_gl_${LEADER}`, AllianceType.MIDAS]
    );
    await sql(`UPDATE bym."user" SET alliance_id = ?, alliance_role = 'leader' WHERE userid = ?`, [ALLIANCE, LEADER]);
    await sql(`UPDATE bym."user" SET alliance_id = ?, alliance_role = 'member' WHERE userid = ?`, [ALLIANCE, MEMBER]);
  });

  afterAll(async () => {
    await clear();
    await orm?.close();
  });

  test("setting a goal writes a goal_set feed row and sends it live", async () => {
    await asRequest(() => progress.setGoal(orm!.em, LEADER, "tribeDestroy", "easy", NOW));
    const rows = await feedRows("goal_set", 1);
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0]!.body)).toEqual({ kind: "tribeDestroy", tier: "easy" });
    expect(Number(rows[0]!.user_id)).toBe(LEADER);
    expect(liveLines("goal_set")).toHaveLength(1);
  });

  test("a goal finished by queued progress (the 5 s flush) writes a goal_done row and sends it live", async () => {
    await asRequest(() => progress.setGoal(orm!.em, LEADER, "tribeDestroy", "easy", NOW));
    progress.noteAllianceEvents(MEMBER, { tribeDestroy: 250 });
    await progress.flushAllianceEvents(orm!.em, NOW);
    const rows = await feedRows("goal_done", 1);
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0]!.body)).toEqual({ kind: "tribeDestroy", tier: "easy", points: 15 });
    expect(Number(rows[0]!.user_id)).toBe(MEMBER);
    expect(liveLines("goal_done")).toHaveLength(1);
  });

  test("a goal finished inside a yard action's transaction is said once it commits, never when it rolls back", async () => {
    await asRequest(() => progress.setGoal(orm!.em, LEADER, "dailyQuests", "easy", NOW));
    await sql(`UPDATE bym.alliance_goal SET progress = target - 1 WHERE alliance_id = ?`, [ALLIANCE]);
    // A claim that rolls back: the goal is not finished and nothing is said.
    await expect(
      asRequest(() =>
        progress.countAfterCommit(() =>
          orm!.em.transactional(async (tx) => {
            await progress.creditDailyQuest(tx, MEMBER, NOW);
            throw new Error("refused");
          })
        )
      )
    ).rejects.toThrow("refused");
    // The claim that commits (as `yardAction.ts` runs a quest claim).
    await asRequest(() =>
      progress.countAfterCommit(() => orm!.em.transactional((tx) => progress.creditDailyQuest(tx, MEMBER, NOW)))
    );
    const rows = await feedRows("goal_done", 1);
    await Bun.sleep(300);
    expect(await feedRows("goal_done", 1)).toHaveLength(1);
    expect(JSON.parse(rows[0]!.body)).toMatchObject({ kind: "dailyQuests", tier: "easy" });
    expect(liveLines("goal_done")).toHaveLength(1);
  });
});
