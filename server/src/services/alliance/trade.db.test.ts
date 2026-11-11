import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { MikroORM } from "@mikro-orm/postgresql";

import ormConfig from "../../mikro-orm.config.js";
import { AllianceMessageType, AllianceType } from "../../enums/Alliance.js";
import { memoryRedis } from "../../testing/memoryRedis.js";
import { composeShout, shoutTradeRequest } from "./shoutText.js";

/**
 * Trading between alliance members (design v5 §12a, §12b; the 1:1 swap,
 * owner 11 Nov 2026) against a real Postgres (`trade.ts`). Opt-in: runs only
 * when ALLIANCE_TEST_DB names a throwaway copy with the 20261129 migration
 * run; refuses `bym`. Players are `zz_tr_*`, ids 993_950 and up, deleted
 * after. The pure sums and chat lines run always.
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

  test("a request carries up to 10% of storage, what is held, and what fits the room after the 10%", () => {
    expect(trade.carryCap(20_000_000, 50_000_000)).toBe(2_000_000);
    expect(trade.postCapOf(20_000_000, 5_000_000, 0)).toBe(2_000_000);
    expect(trade.postCapOf(20_000_000, 300_000, 0)).toBe(300_000);
    // 500,000 room for what you want: 555,556 sent, 500,000 arrive.
    expect(trade.postCapOf(20_000_000, 5_000_000, 19_500_000)).toBe(555_556);
    expect(trade.postCapOf(20_000_000, 5_000_000, 21_000_000)).toBe(0);
  });

  test("the chat lines: a request, a swap, a send; old lines say nothing", () => {
    const ask = JSON.stringify({ request: 7, give: "r1", want: "r4", amount: 1000 });
    expect(composeShout(AllianceMessageType.TRADE_ASK, "Gil", ask)).toBe("Gil gives 1K Twigs for 1K Goo.");
    expect(shoutTradeRequest(AllianceMessageType.TRADE_ASK, ask)).toBe(7);
    const swap = JSON.stringify({ with: "Tina", gave: { r4: 900 }, got: { r1: 900 } });
    expect(composeShout(AllianceMessageType.TRADE_DONE, "Gil", swap)).toBe("Gil and Tina traded: 900 Goo for 900 Twigs.");
    const send = JSON.stringify({ to: "Tina", arrived: { r3: 900 } });
    expect(composeShout(AllianceMessageType.TRADE_DONE, "Gil", send)).toBe("Gil gave Tina 900 Putty.");
    // The old Ask's line (what a mate gives, and what for): no longer shown.
    const old = JSON.stringify({ request: 3, amounts: { r3: 1000 }, for: "b:14:2" });
    expect(composeShout(AllianceMessageType.TRADE_ASK, "Gil", old)).toBe("");
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
const OTHER = BASE + 2; // an alliance made and disbanded in one test
const NOW = Date.parse("2026-11-11T12:00:00Z") / 1000;
const HALL = { id: 0, t: 14, x: -70, y: 0, l: 1 };
/** No silos: the base storage, 10,000; one trade carries up to 1,000 of each, 900 arrive. */
const STOCK = 5_000;

describe.skipIf(!enabled)("alliance trading on a real database", () => {
  const em = () => orm!.em.fork() as never;
  const sql = <R = Record<string, any>>(query: string, params: unknown[] = []) => orm!.em.fork().execute<R[]>(query, params);
  const held = async (userid: number) =>
    (await sql(`SELECT resources FROM bym.save WHERE userid = ? AND type = 'main'`, [userid]))[0]!.resources;
  const setHeld = (userid: number, resources: Record<string, number>) =>
    sql(`UPDATE bym.save SET resources = ? WHERE userid = ? AND type = 'main'`, [
      JSON.stringify({ r1: STOCK, r2: STOCK, r3: STOCK, r4: STOCK, ...resources }),
      userid,
    ]);
  const statusOf = async (id: number) => (await sql(`SELECT status FROM bym.alliance_trade_request WHERE id = ?`, [id]))[0]?.status;
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

  // Trading's switch (`ALLIANCE_TRADE_ENABLED`, off by default): these tests trade, so it is on unless a test turns it off.
  const savedSwitch = process.env.ALLIANCE_TRADE_ENABLED;
  const setSwitch = (value: string | undefined) => {
    if (value === undefined) delete process.env.ALLIANCE_TRADE_ENABLED;
    else process.env.ALLIANCE_TRADE_ENABLED = value;
  };

  beforeAll(async () => {
    await sql(`DELETE FROM bym.alliance WHERE id IN (?, ?)`, [ALLIANCE, OTHER]);
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
  });

  beforeEach(async () => {
    setSwitch("on");
    await clear();
    await sql(`UPDATE bym."user" SET alliance_id = ?, alliance_role = 'member' WHERE userid IN (?, ?, ?)`, [ALLIANCE, A, B, C]);
    await sql(`UPDATE bym."user" SET alliance_id = NULL, alliance_role = NULL WHERE userid = ?`, [OUT]);
    await sql(
      `UPDATE bym.save SET buildingdata = ?, buildinghealthdata = '{}', resources = ?, outposts = '[]',
              savetime = ?, type = 'main', attackid = 0, attacks = '[]', damage = 0
        WHERE userid IN (${LIST})`,
      [JSON.stringify({ "0": HALL }), JSON.stringify({ r1: STOCK, r2: STOCK, r3: STOCK, r4: STOCK }), NOW]
    );
  });

  afterAll(async () => {
    setSwitch(savedSwitch);
    await clear();
    await sql(`DELETE FROM bym.save WHERE userid IN (${LIST})`);
    await sql(`DELETE FROM bym."user" WHERE userid IN (${LIST})`);
    await sql(`DELETE FROM bym.alliance_message WHERE alliance_id IN (?, ?)`, [ALLIANCE, OTHER]);
    await sql(`DELETE FROM bym.alliance WHERE id IN (?, ?)`, [ALLIANCE, OTHER]);
    await orm!.close(true);
  });

  test("post holds what is given; a mate accepts; each side gets 90%; the day is used", async () => {
    const posted = await trade.postRequest(em(), B, "r1", "r4", 1000, NOW);
    expect(posted).toMatchObject({ give: "r1", want: "r4", amount: 1000, gets: 900 });
    expect(posted.resources.r1).toBe(STOCK - 1000);
    expect((await held(B)).r1).toBe(STOCK - 1000);
    expect(await reasonOf(trade.postRequest(em(), B, "r2", "r3", 100, NOW))).toBe("requestOpen");

    const seen = await trade.tradeView(em(), A, NOW);
    expect(seen.today).toMatchObject({ sendsLeft: 1, receivesLeft: 1 });
    expect(seen.requests.find((r) => r.id === posted.id)).toMatchObject({
      userid: B,
      give: "r1",
      want: "r4",
      amount: 1000,
      gets: 900,
      status: "open",
      ready: true,
    });
    const mine = await trade.tradeView(em(), B, NOW);
    expect(mine.myRequest?.id).toBe(posted.id);
    expect(mine.today.postsLeft).toBe(2);

    // Your own request cannot be accepted.
    expect(await reasonOf(trade.acceptRequest(em(), B, posted.id, NOW))).toBe("self");

    const done = await trade.acceptRequest(em(), A, posted.id, NOW);
    expect(done).toMatchObject({ gave: { r4: 1000 }, got: { r1: 900 }, with: { userid: B } });
    expect(await held(A)).toMatchObject({ r1: STOCK + 900, r4: STOCK - 1000 });
    expect(await held(B)).toMatchObject({ r1: STOCK - 1000, r4: STOCK + 900 });
    expect(await statusOf(posted.id)).toBe("done");
    expect(await reasonOf(trade.acceptRequest(em(), C, posted.id, NOW))).toBe("requestGone");

    const after = await trade.tradeView(em(), C, NOW);
    expect(after.requests.find((r) => r.id === posted.id)).toMatchObject({ status: "done", taken_by: `zz_tr_${A}` });
    expect(after.recent).toHaveLength(2);

    // A swap is both players' send and receive of the day.
    expect(await reasonOf(trade.sendToMate(em(), A, C, { r1: 100 }, NOW))).toBe("sentToday");
    expect(await reasonOf(trade.sendToMate(em(), C, B, { r1: 100 }, NOW))).toBe("receivedToday");
    expect(await reasonOf(trade.postRequest(em(), B, "r1", "r4", 100, NOW))).toBe("tradedToday");
    // A new UTC day resets both.
    expect((await trade.sendToMate(em(), A, B, { r1: 100 }, NOW + 86_400)).arrived).toEqual({ r1: 90 });
  });

  test("two mates accepting at once: exactly one swap", async () => {
    const posted = await trade.postRequest(em(), B, "r2", "r3", 1000, NOW);
    const results = await Promise.allSettled([
      trade.acceptRequest(em(), A, posted.id, NOW),
      trade.acceptRequest(em(), C, posted.id, NOW),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const lost = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect((lost.reason as { data?: { reason?: string } }).data?.reason).toBe("requestGone");
    expect((await held(B)).r3).toBe(STOCK + 900);
    const [row] = await sql<{ n: number }>(`SELECT count(*)::int AS n FROM bym.alliance_trade WHERE request_id = ?`, [posted.id]);
    expect(row!.n).toBe(2);
  });

  test("cancel gives back all of it; nothing to cancel is no change", async () => {
    const posted = await trade.postRequest(em(), C, "r4", "r1", 800, NOW);
    expect((await held(C)).r4).toBe(STOCK - 800);
    const cancelled = await trade.cancelRequest(em(), C, NOW);
    expect(cancelled.cancelled).toBe(1);
    expect(cancelled.resources?.r4).toBe(STOCK);
    expect((await held(C)).r4).toBe(STOCK);
    expect(await statusOf(posted.id)).toBe("cancelled");
    expect(await reasonOf(trade.acceptRequest(em(), A, posted.id, NOW))).toBe("requestGone");
    expect((await trade.cancelRequest(em(), C, NOW)).cancelled).toBe(0);
    expect((await held(C)).r4).toBe(STOCK);
    // Cancel then post again, up to 3 a day.
    await trade.postRequest(em(), C, "r4", "r1", 100, NOW);
    await trade.cancelRequest(em(), C, NOW);
    await trade.postRequest(em(), C, "r4", "r1", 100, NOW);
    await trade.cancelRequest(em(), C, NOW);
    expect(await reasonOf(trade.postRequest(em(), C, "r4", "r1", 100, NOW))).toBe("asksToday");
    expect((await held(C)).r4).toBe(STOCK);
  });

  test("after 24 hours a request lapses and gives back all of it, on a mate's view or a load", async () => {
    const one = await trade.postRequest(em(), B, "r1", "r2", 500, NOW);
    expect(await reasonOf(trade.acceptRequest(em(), A, one.id, NOW + 86_400))).toBe("requestGone");
    // A mate opening the Trade tab gives it back.
    expect((await trade.tradeView(em(), C, NOW + 86_400)).requests.find((r) => r.id === one.id)).toBeUndefined();
    expect(await statusOf(one.id)).toBe("expired");
    expect((await held(B)).r1).toBe(STOCK);

    const two = await trade.postRequest(em(), C, "r3", "r2", 400, NOW);
    expect(await trade.refundStaleRequests(em(), C, NOW + 3_600)).toBe(0);
    expect(await trade.refundStaleRequests(em(), C, NOW + 86_400)).toBe(1);
    expect(await statusOf(two.id)).toBe("expired");
    expect((await held(C)).r3).toBe(STOCK);
  });

  test("switched off: the next load gives back every open request, and a cancel still finds none left", async () => {
    const open = await trade.postRequest(em(), B, "r1", "r2", 500, NOW);
    expect((await held(B)).r1).toBe(STOCK - 500);
    setSwitch(undefined);
    // Within the 24 h and still in the alliance: only the switch closes it.
    expect(await trade.refundStaleRequests(em(), B, NOW + 60)).toBe(1);
    expect(await statusOf(open.id)).toBe("expired");
    expect((await held(B)).r1).toBe(STOCK);
    expect(await trade.refundStaleRequests(em(), B, NOW + 120)).toBe(0);
  });

  test("leaving the alliance, or it disbanding, gives back what the request holds", async () => {
    const left = await trade.postRequest(em(), B, "r1", "r4", 600, NOW);
    await sql(`UPDATE bym."user" SET alliance_id = NULL, alliance_role = NULL WHERE userid = ?`, [B]);
    expect(await trade.refundStaleRequests(em(), B, NOW + 60)).toBe(1);
    expect(await statusOf(left.id)).toBe("expired");
    expect((await held(B)).r1).toBe(STOCK);

    await sql(
      `INSERT INTO bym.alliance (id, name, leader_userid, leader_name, world_id, created_at, type)
       VALUES (?, ?, ?, ?, 'w', now(), ?)`,
      [OTHER, `zz_tr_${OTHER}`, OUT, `zz_tr_${OUT}`, AllianceType.MIDAS]
    );
    await sql(`UPDATE bym."user" SET alliance_id = ?, alliance_role = 'leader' WHERE userid = ?`, [OTHER, OUT]);
    const disbanded = await trade.postRequest(em(), OUT, "r2", "r3", 700, NOW);
    await sql(`UPDATE bym."user" SET alliance_id = NULL, alliance_role = NULL WHERE userid = ?`, [OUT]);
    await sql(`DELETE FROM bym.alliance_message WHERE alliance_id = ?`, [OTHER]);
    await sql(`DELETE FROM bym.alliance WHERE id = ?`, [OTHER]);
    // The request outlives its alliance (no cascade), so it can give back.
    expect((await sql(`SELECT alliance_id FROM bym.alliance_trade_request WHERE id = ?`, [disbanded.id]))[0]?.alliance_id).toBeNull();
    expect(await trade.refundStaleRequests(em(), OUT, NOW + 60)).toBe(1);
    expect((await held(OUT)).r2).toBe(STOCK);
  });

  test("posting: one resource for another, held, within 10% of storage and the room for what comes back", async () => {
    expect(await reasonOf(trade.postRequest(em(), B, "r1", "r1", 100, NOW))).toBe("badPair");
    expect(await reasonOf(trade.postRequest(em(), B, "r5", "r1", 100, NOW))).toBe("badPair");
    expect(await reasonOf(trade.postRequest(em(), B, "r1", "r2", 0, NOW))).toBe("nothingAsked");
    expect(await reasonOf(trade.postRequest(em(), B, "r1", "r2", 1001, NOW))).toBe("overCap");
    expect(await reasonOf(trade.postRequest(em(), OUT, "r1", "r2", 100, NOW))).toBe("notMember");
    await setHeld(B, { r1: 400, r2: 9_800 });
    expect(await reasonOf(trade.postRequest(em(), B, "r1", "r3", 401, NOW))).toBe("notEnough");
    // 200 room of Pebbles: 223 sent, 200 arrive; 224 would bring 201.
    expect(await reasonOf(trade.postRequest(em(), B, "r1", "r2", 224, NOW))).toBe("overRoom");
    expect((await trade.postRequest(em(), B, "r1", "r2", 223, NOW)).gets).toBe(200);
    expect((await held(B)).r1).toBe(400 - 223);
  });

  test("accepting: the accepter must hold it, both need room, neither traded today", async () => {
    const posted = await trade.postRequest(em(), B, "r1", "r4", 1000, NOW);

    await setHeld(A, { r4: 999 });
    expect(await reasonOf(trade.acceptRequest(em(), A, posted.id, NOW))).toBe("notEnough");
    // A's Twigs: 9,500 of 10,000, no room for 900.
    await setHeld(A, { r1: 9_500 });
    expect(await reasonOf(trade.acceptRequest(em(), A, posted.id, NOW))).toBe("noRoom");
    await setHeld(A, {});
    // B's Goo filled up after posting: no room for 900.
    await setHeld(B, { r1: STOCK - 1000, r4: 9_200 });
    expect(await reasonOf(trade.acceptRequest(em(), A, posted.id, NOW))).toBe("mateNoRoom");
    await setHeld(B, { r1: STOCK - 1000 });
    expect(await reasonOf(trade.acceptRequest(em(), OUT, posted.id, NOW))).toBe("notMember");

    // C sent today: C cannot accept.
    await trade.sendToMate(em(), C, A, { r2: 100 }, NOW);
    expect(await reasonOf(trade.acceptRequest(em(), C, posted.id, NOW))).toBe("tradedToday");
    // B got a send today: the request waits for tomorrow, shown not ready.
    await sql(`DELETE FROM bym.alliance_trade WHERE from_userid = ?`, [C]);
    await trade.sendToMate(em(), C, B, { r2: 100 }, NOW);
    expect(await reasonOf(trade.acceptRequest(em(), A, posted.id, NOW))).toBe("mateTradedToday");
    expect((await trade.tradeView(em(), A, NOW)).requests.find((r) => r.id === posted.id)?.ready).toBe(false);
    // Nothing moved on a refusal (A got C's 90 Pebbles only).
    expect(await held(A)).toMatchObject({ r1: STOCK, r4: STOCK });
    expect((await held(B)).r1).toBe(STOCK - 1000);
    // The next UTC day it goes through.
    const done = await trade.acceptRequest(em(), A, posted.id, NOW + 3_600 * 13);
    expect(done.got).toEqual({ r1: 900 });
  });
});
