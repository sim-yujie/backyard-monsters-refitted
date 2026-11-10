import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { MikroORM } from "@mikro-orm/postgresql";

import ormConfig from "../../mikro-orm.config.js";
import { AllianceType } from "../../enums/Alliance.js";
import { memoryRedis } from "../../testing/memoryRedis.js";

/**
 * Trading between alliance members (design v5 §12a, §12b) against a real
 * Postgres (`trade.ts`). Opt-in: runs only when ALLIANCE_TEST_DB names a
 * throwaway copy with the 20261126 migration run; refuses `bym`. Players are
 * `zz_tr_*`, ids 993_950 and up, deleted after. The pure sums run always.
 */
const dbName = process.env.ALLIANCE_TEST_DB;
const enabled = Boolean(dbName) && dbName !== "bym";

const orm = enabled ? await MikroORM.init({ ...ormConfig, dbName, debug: false, pool: { min: 0, max: 5 } }) : null;
mock.module("../../server.js", () => ({
  postgres: {
    orm,
    get em() {
      if (!orm) throw new Error("ALLIANCE_TEST_DB is not set");
      return orm.em.fork();
    },
  },
  redis: { ...memoryRedis(), publish: async () => 0 },
}));

const trade = await import("./trade.js");

describe("trade sums", () => {
  test("10% lost on the way; what must leave for an amount to arrive", () => {
    expect(trade.arriveFor(1000)).toBe(900);
    expect(trade.arriveFor(10)).toBe(9);
    expect(trade.sentFor(2_000_000)).toBe(2_222_223);
    expect(trade.arriveFor(trade.sentFor(2_000_000))).toBe(2_000_000);
    for (const n of [1, 9, 10, 899, 900, 901, 123_457]) {
      const sent = trade.sentFor(n);
      expect(trade.arriveFor(sent)).toBeGreaterThanOrEqual(n);
      expect(trade.arriveFor(sent - 1)).toBeLessThan(n);
    }
  });
  test("cap: 10% of the smaller storage; an ask (what a mate gives) fits the free room after the 10%", () => {
    expect(trade.carryCap(20_000_000, 50_000_000)).toBe(2_000_000);
    expect(trade.askCapOf(20_000_000, 0)).toBe(2_000_000);
    // 500,000 room: 555,556 given, 500,000 arrive.
    expect(trade.askCapOf(20_000_000, 19_500_000)).toBe(555_556);
    expect(trade.arriveFor(555_556)).toBe(500_000);
    expect(trade.arriveFor(555_557)).toBe(500_001);
    expect(trade.askCapOf(20_000_000, 21_000_000)).toBe(0);
  });
});

const BASE = 993_950;
const A = BASE + 1; // leader
const B = BASE + 2; // member
const C = BASE + 3; // member
const OUT = BASE + 4; // not in the alliance
const USERS = [A, B, C, OUT];
const LIST = USERS.join(",");
const ALLIANCE = BASE + 1;
const NOW = Date.parse("2026-11-11T12:00:00Z") / 1000;
const HALL = { id: 0, t: 14, x: -70, y: 0, l: 1 };
/** No silos: the base storage, 10,000; one trade carries up to 1,000 of each, 900 arrive. */
const STOCK = 5_000;

describe.skipIf(!enabled)("alliance trading on a real database", () => {
  const em = () => orm!.em.fork() as never;
  const sql = <R = Record<string, any>>(query: string, params: unknown[] = []) => orm!.em.fork().execute<R[]>(query, params);
  const held = async (userid: number) =>
    (await sql(`SELECT resources FROM bym.save WHERE userid = ? AND type = 'main'`, [userid]))[0]!.resources;
  const reasonOf = async (call: Promise<unknown>) => {
    try {
      await call;
    } catch (err) {
      return (err as { data?: { reason?: string } }).data?.reason ?? String(err);
    }
    return "not refused";
  };

  const clear = async () => {
    await sql(`DELETE FROM bym.alliance_trade WHERE from_userid IN (${LIST}) OR to_userid IN (${LIST})`);
    await sql(`DELETE FROM bym.alliance_trade_request WHERE userid IN (${LIST})`);
  };

  beforeAll(async () => {
    await sql(`DELETE FROM bym.alliance WHERE id = ?`, [ALLIANCE]);
    for (const userid of USERS) {
      const name = `zz_tr_${userid}`;
      await sql(
        `INSERT INTO bym."user" (userid, username, email, password, blocked_users) VALUES (?, ?, ?, 'x', '[]') ON CONFLICT DO NOTHING`,
        [userid, name, `${name}@test.invalid`]
      );
      const [existing] = await sql(`SELECT basesaveid FROM bym.save WHERE userid = ? AND type = 'main'`, [userid]);
      const basesaveid =
        existing?.basesaveid ??
        (
          await sql(
            `INSERT INTO bym.save (userid, saveuserid, baseid, type, points, basevalue, createtime, name, credits, attacks,
                                   takeover_date, created_at, lastupdate_at)
             VALUES (?, ?, ?, 'main', 20000, '0', ?, 'yard', 0, '[]', now(), now(), now()) RETURNING basesaveid`,
            [userid, userid, `${userid}00`, NOW - 30 * 86_400]
          )
        )[0]!.basesaveid;
      await sql(`UPDATE bym."user" SET save_basesaveid = ?, alliance_id = NULL WHERE userid = ?`, [basesaveid, userid]);
    }
    await sql(
      `INSERT INTO bym.alliance (id, name, leader_userid, leader_name, world_id, created_at, type)
       VALUES (?, ?, ?, ?, 'w', now(), ?)`,
      [ALLIANCE, `zz_tr_${ALLIANCE}`, A, `zz_tr_${A}`, AllianceType.MIDAS]
    );
    await sql(`UPDATE bym."user" SET alliance_id = ?, alliance_role = 'member' WHERE userid IN (?, ?, ?)`, [ALLIANCE, A, B, C]);
  });

  beforeEach(async () => {
    await clear();
    await sql(
      `UPDATE bym.save SET buildingdata = ?, buildinghealthdata = '{}', resources = ?, outposts = '[]',
              savetime = ?, type = 'main', attackid = 0, attacks = '[]', damage = 0
        WHERE userid IN (${LIST})`,
      [JSON.stringify({ "0": HALL }), JSON.stringify({ r1: STOCK, r2: STOCK, r3: STOCK, r4: STOCK }), NOW]
    );
  });

  afterAll(async () => {
    await clear();
    await sql(`DELETE FROM bym.save WHERE userid IN (${LIST})`);
    await sql(`DELETE FROM bym."user" WHERE userid IN (${LIST})`);
    await sql(`DELETE FROM bym.alliance_message WHERE alliance_id = ?`, [ALLIANCE]);
    await sql(`DELETE FROM bym.alliance WHERE id = ?`, [ALLIANCE]);
    await orm!.close(true);
  });

  test("ask, mates see it, give fills it 1:1 less 10%, the day's limits hold", async () => {
    const asked = await trade.askForResources(em(), B, { r3: 1000 }, "b:14:2", NOW);
    expect(asked.amounts).toEqual({ r3: 1000 });
    expect(asked.for).toEqual({ kind: "building", type: 14, level: 2 });
    expect(await reasonOf(trade.askForResources(em(), B, { r3: 100 }, null, NOW))).toBe("requestOpen");

    const seen = await trade.tradeView(em(), A, NOW);
    expect(seen.today).toMatchObject({ sendsLeft: 1, receivesLeft: 1 });
    const row = seen.requests.find((r) => r.id === asked.id)!;
    expect(row).toMatchObject({ userid: B, amounts: { r3: 1000 }, for: { kind: "building", type: 14, level: 2 }, status: "open" });
    expect(row.storage?.cap).toBe(10_000);
    expect((await trade.tradeView(em(), B, NOW)).myRequest?.id).toBe(asked.id);

    const given = await trade.giveToRequest(em(), A, asked.id, NOW);
    expect(given.sent).toEqual({ r3: 1000 });
    expect(given.arrived).toEqual({ r3: 900 });
    expect((await held(A)).r3).toBe(STOCK - 1000);
    expect((await held(B)).r3).toBe(STOCK + 900);

    const after = await trade.tradeView(em(), C, NOW);
    expect(after.requests.find((r) => r.id === asked.id)).toMatchObject({ status: "given", given_by: `zz_tr_${A}` });
    expect(after.recent[0]).toMatchObject({ from: `zz_tr_${A}`, to: `zz_tr_${B}`, arrived: { r3: 900 } });

    // A has sent today; B has received today.
    expect(await reasonOf(trade.sendToMate(em(), A, C, { r1: 100 }, NOW))).toBe("sentToday");
    expect(await reasonOf(trade.sendToMate(em(), C, B, { r1: 100 }, NOW))).toBe("receivedToday");
    expect(await reasonOf(trade.askForResources(em(), B, { r1: 100 }, null, NOW))).toBe("receivedToday");
    // A new UTC day resets both.
    const sent = await trade.sendToMate(em(), A, B, { r1: 100 }, NOW + 86_400);
    expect(sent.arrived).toEqual({ r1: 90 });
  });

  test("a direct send drops what has no room; caps and mates hold", async () => {
    await sql(`UPDATE bym.save SET resources = ? WHERE userid = ? AND type = 'main'`, [
      JSON.stringify({ r1: 9_500, r2: 0, r3: 0, r4: 0 }),
      C,
    ]);
    expect(await reasonOf(trade.sendToMate(em(), A, C, { r1: 1001 }, NOW))).toBe("overCap");
    expect(await reasonOf(trade.sendToMate(em(), A, OUT, { r1: 100 }, NOW))).toBe("notMate");
    expect(await reasonOf(trade.sendToMate(em(), OUT, A, { r1: 100 }, NOW))).toBe("notMember");
    expect(await reasonOf(trade.sendToMate(em(), A, A, { r1: 100 }, NOW))).toBe("self");

    const done = await trade.sendToMate(em(), A, C, { r1: 1000, r2: 200 }, NOW);
    expect(done.arrived).toEqual({ r1: 500, r2: 180 });
    expect(done.lostFull).toEqual({ r1: 400 });
    expect((await held(C)).r1).toBe(10_000);
    expect(done.resources.r1).toBe(STOCK - 1000);
  });

  test("asks fit the free room after the 10%; give is all of it or nothing; cancel", async () => {
    await sql(`UPDATE bym.save SET resources = ? WHERE userid = ? AND type = 'main'`, [
      JSON.stringify({ r1: 9_800, r2: 0, r3: 0, r4: 0 }),
      B,
    ]);
    // 200 room: 223 given, 200 arrive; 224 would bring 201.
    expect(await reasonOf(trade.askForResources(em(), B, { r1: 224 }, null, NOW))).toBe("overRoom");
    expect(await reasonOf(trade.askForResources(em(), B, { r2: 1001 }, null, NOW))).toBe("overRoom");
    const asked = await trade.askForResources(em(), B, { r1: 223, r2: 1000 }, null, NOW);
    // A giver short of what was asked is refused: no part gifts.
    await sql(`UPDATE bym.save SET resources = ? WHERE userid = ? AND type = 'main'`, [
      JSON.stringify({ r1: STOCK, r2: 999, r3: STOCK, r4: STOCK }),
      A,
    ]);
    expect(await reasonOf(trade.giveToRequest(em(), A, asked.id, NOW))).toBe("notEnough");
    expect((await held(A)).r2).toBe(999);
    const all = await trade.giveToRequest(em(), C, asked.id, NOW);
    expect(all.sent).toEqual({ r1: 223, r2: 1000 });
    expect(all.arrived).toEqual({ r1: 200, r2: 900 });
    expect(all.lostFull).toEqual({});
    expect(await reasonOf(trade.giveToRequest(em(), A, asked.id, NOW))).toBe("requestGone");

    await clear();
    const again = await trade.askForResources(em(), C, { r4: 100 }, "m:C1", NOW);
    expect(again.for).toEqual({ kind: "monster", id: "C1" });
    expect((await trade.cancelRequest(em(), C, NOW)).cancelled).toBe(1);
    expect(await reasonOf(trade.giveToRequest(em(), A, again.id, NOW))).toBe("requestGone");
  });

  test("what for: only the asker's own buildings' next levels and unlocked monsters", async () => {
    const choices = (await trade.tradeView(em(), B, NOW)).choices;
    expect(choices.buildings).toContainEqual({ type: 14, level: 2 });
    expect(choices.monsters).toEqual(["C1"]);
    // Not in the yard, a level the hall would not reach next, a locked monster, an old word, junk.
    for (const bad of ["b:15:1", "b:14:3", "m:C5", "upgrade", "b:14"]) {
      expect(await reasonOf(trade.askForResources(em(), B, { r1: 100 }, bad, NOW))).toBe("badFor");
    }
    expect((await trade.tradeView(em(), B, NOW)).myRequest).toBeNull();
  });

  test("a request lapses after 24 hours", async () => {
    const asked = await trade.askForResources(em(), B, { r1: 100 }, null, NOW);
    expect(await reasonOf(trade.giveToRequest(em(), A, asked.id, NOW + 86_400))).toBe("requestGone");
    expect((await trade.tradeView(em(), B, NOW + 86_400)).myRequest).toBeNull();
  });
});
