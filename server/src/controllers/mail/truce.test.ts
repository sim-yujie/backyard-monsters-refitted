import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Context } from "koa";
import { matchesWhere } from "../../testing/matchesWhere.js";

/**
 * Truces through the mail routes (#203): proposed from the map
 * (`requesttruce`) or in a thread (`sendmessage` "trucerequest"), then
 * accepted or rejected by the recipient. An accepted truce runs 14 days; a
 * request waits 7 days for its answer and then lapses. The thread list says
 * when either ends. Driven over an in-memory stand-in for the rows.
 */

const ALICE = 2505;
const BOB = 77;
const BOB_MAIN = "2000245210";
const BOB_OUTPOST = "2000241208";
const CAMP = "2000240208";

type Row = Record<string, unknown>;
type Entity = { name: string; new (): object };

const now = () => Math.floor(Date.now() / 1000);

let tables: Map<string, Row[]>;
let nextTruceId = 1;

const table = (entity: Entity) => tables.get(entity.name) ?? [];

const em = {
  find: async (entity: Entity, where: Row, options: { orderBy?: Row; limit?: number } = {}) => {
    let rows = table(entity).filter((row) => matchesWhere(row, where));
    if (options.orderBy?.threadid === "DESC") rows = [...rows].sort((a, b) => (b.threadid as number) - (a.threadid as number));
    return options.limit ? rows.slice(0, options.limit) : rows;
  },
  findOne: async (entity: Entity, where: Row) => table(entity).find((row) => matchesWhere(row, where)) ?? null,
  count: async (entity: Entity, where: Row) => table(entity).filter((row) => matchesWhere(row, where)).length,
  create: (entity: Entity, data: Row) => {
    const row = Object.assign(new entity(), data) as Row;
    if (entity.name === "Truce") row.id = nextTruceId++;
    tables.get(entity.name)?.push(row);
    return row;
  },
  persist: (value: unknown) => {
    for (const one of [value].flat() as Row[]) {
      const rows = tables.get(one?.constructor?.name ?? "");
      if (rows && !rows.includes(one)) rows.push(one);
    }
  },
  flush: async () => {},
  populate: async () => {},
};

mock.module("../../server.js", () => ({ postgres: { em }, redis: {} }));

const { requestTruce } = await import("./requestTruce.js");
const { sendMessage } = await import("./sendMessage.js");
const { getMessageThreads } = await import("./getMessageThreads.js");
const { getTruces } = await import("../../services/maproom/getTruces.js");
const { TRUCE_DURATION, TRUCE_REQUEST_LIFETIME, TRUCE_RETRY_AFTER_REJECTION } = await import("../../services/mail/truceRules.js");

const user = (userid: number) => table({ name: "User" } as Entity).find((row) => row.userid === userid)!;

const run = async (controller: (ctx: Context) => Promise<void>, from: number, body: Row) => {
  const ctx = { authUser: user(from), request: { body }, status: 0, body: undefined as unknown };
  await controller(ctx as unknown as Context);
  return ctx.body as Row;
};

const request = (from: number, baseid: string, message = "Accept my truce.") =>
  run(requestTruce, from, { baseid, message });

const send = (from: number, threadid: number, type: string, targetid = 0) =>
  run(sendMessage, from, {
    threadid: String(threadid),
    targetid: String(targetid),
    subject: "Truce",
    type,
    message: "Words.",
    targetbaseid: "0",
  });

const truces = () => tables.get("Truce")!;
const threadOf = (threadid: number) => tables.get("Thread")!.find((row) => row.threadid === threadid)!;

/** A plain thread between Alice and Bob, as a player's "Message" starts one. */
const plainThread = async () => (await send(ALICE, 0, "message", BOB)).threadid as number;

beforeEach(() => {
  nextTruceId = 1;
  tables = new Map<string, Row[]>([
    ["Save", [
      { baseid: BOB_MAIN, saveuserid: BOB, type: "main" },
      { baseid: BOB_OUTPOST, saveuserid: BOB, type: "outpost" },
      { baseid: "2000241207", saveuserid: ALICE, type: "main" },
      { baseid: CAMP, saveuserid: 0, type: "tribe" },
    ]],
    ["User", [
      { userid: ALICE, username: "alice", blockedUsers: [], save: { unreadmessages: 0 } },
      { userid: BOB, username: "bob", blockedUsers: [], save: { unreadmessages: 0 } },
    ]],
    ["Truce", []],
    ["Thread", []],
    ["Message", []],
  ]);
});

describe("proposing a truce", () => {
  test("from the map: a waiting truce, a new thread holding the request, and its id", async () => {
    const body = await request(ALICE, BOB_OUTPOST);

    expect(body).toEqual({ error: 0, threadid: 1 });
    expect(truces()).toMatchObject([{ initiator_userid: ALICE, recipient_userid: BOB, status: "requested" }]);
    expect(threadOf(1)).toMatchObject({ truce_id: 1, trucestate: "requested", userid: ALICE, targetid: BOB });
    expect(tables.get("Message")).toMatchObject([{ messagetype: "trucerequest", userid: ALICE, targetid: BOB }]);
    expect(user(BOB).save).toEqual({ unreadmessages: 1 });
  });

  test("in a thread: the thread takes the truce", async () => {
    const threadid = await plainThread();
    await send(ALICE, threadid, "trucerequest");

    expect(threadOf(threadid)).toMatchObject({ truce_id: 1, trucestate: "requested" });
  });

  test("a second request while one waits is refused, whoever asks and however", async () => {
    await request(ALICE, BOB_MAIN);

    await expect(request(ALICE, BOB_MAIN)).rejects.toMatchObject({ status: 409 });
    await expect(request(BOB, "2000241207")).rejects.toMatchObject({ status: 409 });
    const threadid = await plainThread();
    await expect(send(BOB, threadid, "trucerequest")).rejects.toMatchObject({ status: 409 });
    expect(truces()).toHaveLength(1);
  });

  test("not to oneself, not to a wild camp, and not across a block", async () => {
    await expect(request(ALICE, "2000241207")).rejects.toMatchObject({ status: 403 });
    await expect(request(ALICE, CAMP)).rejects.toMatchObject({ status: 404 });

    user(BOB).blockedUsers = [ALICE];
    expect(await request(ALICE, BOB_MAIN)).toEqual({ error: 1, message: "Cannot send message to this user" });
    expect(truces()).toHaveLength(0);
  });
});

describe("answering a truce request", () => {
  test("the recipient accepts: a truce of 14 days, on the truce and the thread", async () => {
    const { threadid } = (await request(ALICE, BOB_MAIN)) as { threadid: number };
    await send(BOB, threadid, "truceaccept");

    const [truce] = truces();
    expect(truce).toMatchObject({ status: "accepted" });
    expect(truce!.expires_at).toBeGreaterThanOrEqual(now() + TRUCE_DURATION - 1);
    expect(truce!.expires_at).toBeLessThanOrEqual(now() + TRUCE_DURATION);
    expect(threadOf(threadid).trucestate).toBe("accepted");
  });

  test("the recipient rejects: no truce, and the one who asked waits 2 days to ask again", async () => {
    const { threadid } = (await request(ALICE, BOB_MAIN)) as { threadid: number };
    await send(BOB, threadid, "trucereject");

    const [rejected] = truces();
    expect(rejected).toMatchObject({ status: "rejected" });
    expect(rejected!.expires_at as number).toBeGreaterThanOrEqual(now() + TRUCE_RETRY_AFTER_REJECTION - 1);
    expect(rejected!.expires_at as number).toBeLessThanOrEqual(now() + TRUCE_RETRY_AFTER_REJECTION);

    // A soft refusal, from the map or in the thread, that says when; nothing is written.
    const refusal = {
      error: 1,
      message: "They rejected your last truce request. You can ask them again in 2 days.",
      retryat: rejected!.expires_at,
    };
    expect(await request(ALICE, BOB_OUTPOST)).toEqual(refusal);
    expect(await send(ALICE, threadid, "trucerequest")).toEqual(refusal);
    expect(truces()).toHaveLength(1);
    expect(tables.get("Message")!.filter((one) => one.messagetype === "trucerequest")).toHaveLength(1);

    rejected!.expires_at = now() + 5 * 3_600;
    expect((await request(ALICE, BOB_MAIN)).message).toBe(
      "They rejected your last truce request. You can ask them again in 5 h.",
    );

    rejected!.expires_at = now() - 1;
    expect(await request(ALICE, BOB_MAIN)).toMatchObject({ error: 0 });
  });

  test("after a rejection the other player may still ask at once", async () => {
    const { threadid } = (await request(ALICE, BOB_MAIN)) as { threadid: number };
    await send(BOB, threadid, "trucereject");

    expect(await request(BOB, "2000241207")).toMatchObject({ error: 0 });
  });

  test("the one who asked cannot answer", async () => {
    const { threadid } = (await request(ALICE, BOB_MAIN)) as { threadid: number };

    await expect(send(ALICE, threadid, "truceaccept")).rejects.toMatchObject({ status: 403 });
    expect(truces()[0]).toMatchObject({ status: "requested" });
  });

  test("a request is answered once", async () => {
    const { threadid } = (await request(ALICE, BOB_MAIN)) as { threadid: number };
    await send(BOB, threadid, "trucereject");

    await expect(send(BOB, threadid, "truceaccept")).rejects.toMatchObject({ status: 409 });
    expect(truces()[0]).toMatchObject({ status: "rejected" });
  });

  test("a request lapses after 7 days: it cannot be answered, and no longer stands in the way", async () => {
    const { threadid } = (await request(ALICE, BOB_MAIN)) as { threadid: number };
    truces()[0]!.created_at = new Date((now() - TRUCE_REQUEST_LIFETIME - 1) * 1000);

    await expect(send(BOB, threadid, "truceaccept")).rejects.toMatchObject({ status: 409 });
    expect(await request(ALICE, BOB_MAIN)).toMatchObject({ error: 0 });
  });

  test("once an accepted truce expires, a new one may be asked for", async () => {
    const { threadid } = (await request(ALICE, BOB_MAIN)) as { threadid: number };
    await send(BOB, threadid, "truceaccept");
    await expect(request(BOB, "2000241207")).rejects.toMatchObject({ status: 409 });

    truces()[0]!.expires_at = now() - 1;
    expect(await request(BOB, "2000241207")).toMatchObject({ error: 0 });
  });
});

describe("what the thread list and the map say", () => {
  const listed = async (userid: number) =>
    (await run(getMessageThreads, userid, {})).threads as Record<string, Row>;

  test("a waiting request ends when it lapses; an accepted truce when it expires", async () => {
    const { threadid } = (await request(ALICE, BOB_MAIN)) as { threadid: number };
    const created = Math.floor((truces()[0]!.created_at as Date).getTime() / 1000);

    expect((await listed(BOB))[threadid]).toMatchObject({
      trucestate: "requested",
      truceexpire: created + TRUCE_REQUEST_LIFETIME,
    });

    await send(BOB, threadid, "truceaccept");
    expect((await listed(ALICE))[threadid]).toMatchObject({
      trucestate: "accepted",
      truceexpire: truces()[0]!.expires_at,
    });
  });

  test("a rejected truce ends when its proposer may ask again; a thread with none gives no end", async () => {
    const plain = await plainThread();
    const { threadid } = (await request(ALICE, BOB_MAIN)) as { threadid: number };
    await send(BOB, threadid, "trucereject");

    const threads = await listed(ALICE);
    expect(threads[threadid]).toMatchObject({ trucestate: "rejected", truceexpire: truces()[0]!.expires_at });
    expect(threads[plain]!.truceexpire).toBeUndefined();
  });

  test("the map's cells carry an accepted truce's expiry, until it expires", async () => {
    const { threadid } = (await request(ALICE, BOB_MAIN)) as { threadid: number };
    expect((await getTruces(ALICE, [BOB])).get(BOB)?.expires_at).toBeUndefined();

    await send(BOB, threadid, "truceaccept");
    expect((await getTruces(ALICE, [BOB])).get(BOB)?.expires_at).toBe(truces()[0]!.expires_at as number);
    expect((await getTruces(BOB, [ALICE])).get(ALICE)?.expires_at).toBe(truces()[0]!.expires_at as number);

    truces()[0]!.expires_at = now() - 1;
    expect((await getTruces(ALICE, [BOB])).has(BOB)).toBe(false);
  });

  test("a lapsed request beside a running truce does not hide it", async () => {
    await request(ALICE, BOB_MAIN);
    truces()[0]!.created_at = new Date((now() - TRUCE_REQUEST_LIFETIME - 1) * 1000);
    const { threadid } = (await request(BOB, "2000241207")) as { threadid: number };
    await send(ALICE, threadid, "truceaccept");

    expect((await getTruces(ALICE, [BOB])).get(BOB)?.expires_at).toBe(truces()[1]!.expires_at as number);
  });
});
