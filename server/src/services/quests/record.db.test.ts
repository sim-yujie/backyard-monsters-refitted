import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { MikroORM } from "@mikro-orm/postgresql";

import ormConfig from "../../mikro-orm.config.js";
import { utcDay, utcWeek } from "./period.js";
import { sqlCountsAsNewFriend, sqlHasFriend } from "./friends.js";
import { recordNewFriendship, recordUserQuestEvents } from "./record.js";
import { emptyQuests, questsJson, readQuests } from "./state.js";

/**
 * The quests' SQL against a real Postgres: whether a player has a friend to
 * help (the weekly social pick), whether a new friend counts (level 5+, seen
 * in 7 days, never friends before, owner decision 6), and counting events on
 * a player's main row under its lock (`record.ts`).
 *
 * Opt-in: runs only when FRIENDS_TEST_DB names a throwaway database with the
 * `bym` schema and migrations applied (CI's `bym_ci`), and refuses the shared
 * `bym`. Its players are `zz_qu_*`, user ids 997_101 to 997_105.
 */
const dbName = process.env.FRIENDS_TEST_DB;

const ME = 997_101;
const ACTIVE = 997_102;
const LOW = 997_103;
const AWAY = 997_104;
const NO_YARD = 997_105;
const EVERYONE = [ME, ACTIVE, LOW, AWAY, NO_YARD];
const LIST = EVERYONE.join(",");

const DAY = 24 * 60 * 60;
/** Monday 2026-11-02 12:00 UTC. */
const T0 = Math.floor(Date.UTC(2026, 10, 2, 12) / 1000);
/** Level 5 and up (`experiencePoints`). */
const LEVEL_5_POINTS = "20000";
const HALL = { id: 0, t: 14, x: 0, y: 0, l: 3 };

describe.skipIf(!dbName)("the quests on a real database", () => {
  let orm: MikroORM;
  const em = () => orm.em.fork();
  const sql = <R = Record<string, any>>(query: string, params: unknown[] = []) => em().execute<R[]>(query, params);

  const befriend = (a: number, b: number, since: number) =>
    sql(`INSERT INTO bym.friend (userid, friend_userid, created_at) VALUES (?, ?, ?), (?, ?, ?) ON CONFLICT DO NOTHING`, [
      a,
      b,
      new Date(since * 1000),
      b,
      a,
      new Date(since * 1000),
    ]);
  const accepted = (from: number, to: number, at: number) =>
    sql(`INSERT INTO bym.friend_request (from_userid, to_userid, status, created_at, answered_at) VALUES (?, ?, 'accepted', ?, ?)`, [
      from,
      to,
      new Date(at * 1000),
      new Date(at * 1000),
    ]);
  /** ME's quests: this week's "make 5 new friends" and today's mushroom quest. */
  const giveQuests = (userid: number) =>
    sql(`UPDATE bym.save SET dailyquests = ? WHERE userid = ? AND type = 'main'`, [
      JSON.stringify(
        questsJson({
          ...emptyQuests(),
          daily: { period: utcDay(T0), quests: [{ slot: 0, kind: "mushroom", need: 3, have: 0, claimed: false, rewards: [] }], bonus: false, swaps: 0 },
          weekly: { period: utcWeek(T0), quests: [{ slot: 0, kind: "weeklyNewFriends", need: 5, have: 0, claimed: false, rewards: [] }], bonus: false, swaps: 0 },
        })
      ),
      userid,
    ]);
  const questsOf = async (userid: number) => {
    const [row] = await sql(`SELECT dailyquests FROM bym.save WHERE userid = ? AND type = 'main'`, [userid]);
    return readQuests(row?.dailyquests);
  };

  const reset = async () => {
    await sql(`DELETE FROM bym.friend WHERE userid IN (${LIST}) OR friend_userid IN (${LIST})`);
    await sql(`DELETE FROM bym.friend_request WHERE from_userid IN (${LIST}) OR to_userid IN (${LIST})`);
    await sql(`UPDATE bym."user" SET last_seen_at = ? WHERE userid IN (${LIST})`, [new Date((T0 - 3600) * 1000)]);
    await sql(`UPDATE bym."user" SET last_seen_at = ? WHERE userid = ?`, [new Date((T0 - 30 * DAY) * 1000), AWAY]);
    await sql(
      `UPDATE bym.save SET buildingdata = ?, points = ?, basevalue = '0', type = 'main', dailyquests = NULL WHERE userid IN (${LIST})`,
      [JSON.stringify({ "0": HALL }), LEVEL_5_POINTS]
    );
    await sql(`UPDATE bym.save SET points = '0' WHERE userid = ?`, [LOW]);
  };

  beforeAll(async () => {
    if (dbName === "bym") throw new Error("FRIENDS_TEST_DB must be a throwaway database, not bym");
    orm = await MikroORM.init({ ...ormConfig, dbName, debug: false, pool: { min: 0, max: 4 } });
    for (const userid of EVERYONE) {
      const name = `zz_qu_${userid}`;
      await sql(
        `INSERT INTO bym."user" (userid, username, email, password, blocked_users) VALUES (?, ?, ?, 'x', '[]') ON CONFLICT DO NOTHING`,
        [userid, name, `${name}@test.invalid`]
      );
      if (userid === NO_YARD) continue;
      const [existing] = await sql(`SELECT basesaveid FROM bym.save WHERE userid = ? AND type = 'main'`, [userid]);
      const basesaveid =
        existing?.basesaveid ??
        (
          await sql(
            `INSERT INTO bym.save (userid, saveuserid, baseid, type, points, basevalue, createtime, name, credits, attacks,
                                   takeover_date, created_at, lastupdate_at)
             VALUES (?, ?, ?, 'main', ?, '0', ?, 'yard', 0, '[]', now(), now(), now()) RETURNING basesaveid`,
            [userid, userid, `${userid}00`, LEVEL_5_POINTS, T0 - 30 * DAY]
          )
        )[0]!.basesaveid;
      await sql(`UPDATE bym."user" SET save_basesaveid = ? WHERE userid = ?`, [basesaveid, userid]);
    }
  });

  beforeEach(reset);

  afterAll(async () => {
    if (!orm) return;
    await reset();
    await sql(`UPDATE bym."user" SET save_basesaveid = NULL WHERE userid IN (${LIST})`);
    await sql(`DELETE FROM bym.save WHERE userid IN (${LIST})`);
    await sql(`DELETE FROM bym."user" WHERE userid IN (${LIST})`);
    await orm.close(true);
  });

  test("a friend to help: level 5+ on both sides, friends long enough", async () => {
    expect(await sqlHasFriend(em(), ME, T0)).toBe(false);
    await befriend(ME, LOW, T0 - 5 * DAY);
    expect(await sqlHasFriend(em(), ME, T0)).toBe(false);
    await befriend(ME, ACTIVE, T0 - 60);
    expect(await sqlHasFriend(em(), ME, T0)).toBe(false);
    expect(await sqlHasFriend(em(), ME, T0 + 5 * DAY)).toBe(true);
    // A level 1 player has no friend to help, whoever their friends are.
    expect(await sqlHasFriend(em(), LOW, T0 + 5 * DAY)).toBe(false);
  });

  test("a new friend counts: level 5+, seen in the last 7 days, never friends before", async () => {
    await accepted(ME, ACTIVE, T0);
    expect(await sqlCountsAsNewFriend(em(), ME, ACTIVE, T0)).toBe(true);
    await accepted(ME, LOW, T0);
    expect(await sqlCountsAsNewFriend(em(), ME, LOW, T0)).toBe(false);
    await accepted(AWAY, ME, T0);
    expect(await sqlCountsAsNewFriend(em(), ME, AWAY, T0)).toBe(false);
    // Friends once before (an older accepted request, either way): no longer new.
    await accepted(ACTIVE, ME, T0 - 20 * DAY);
    expect(await sqlCountsAsNewFriend(em(), ME, ACTIVE, T0)).toBe(false);
  });

  test("events count on the player's main row; a player with no yard counts nothing", async () => {
    await giveQuests(ME);
    expect(await recordUserQuestEvents(em(), ME, { mushroom: 2 }, T0)).toBe(true);
    expect((await questsOf(ME)).daily!.quests[0]).toMatchObject({ kind: "mushroom", have: 2 });
    expect(await recordUserQuestEvents(em(), ME, { nonsense: 2 }, T0)).toBe(false);
    expect(await recordUserQuestEvents(em(), NO_YARD, { mushroom: 1 }, T0)).toBe(false);
  });

  test("a new friendship moves each side's new-friends quest when the other counts", async () => {
    await giveQuests(ME);
    await giveQuests(ACTIVE);
    await giveQuests(LOW);
    await accepted(ME, ACTIVE, T0);
    await recordNewFriendship(em(), ME, ACTIVE, T0);
    expect((await questsOf(ME)).weekly!.quests[0]!.have).toBe(1);
    expect((await questsOf(ACTIVE)).weekly!.quests[0]!.have).toBe(1);

    // LOW is level 1: ME's quest does not move; ME counts for LOW.
    await accepted(LOW, ME, T0);
    await recordNewFriendship(em(), LOW, ME, T0);
    expect((await questsOf(ME)).weekly!.quests[0]!.have).toBe(1);
    expect((await questsOf(LOW)).weekly!.quests[0]!.have).toBe(1);
  });
});
