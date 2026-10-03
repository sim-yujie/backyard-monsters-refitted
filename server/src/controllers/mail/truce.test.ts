import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Context } from "koa";
import { matchesWhere } from "../../testing/matchesWhere.js";

/**
 * Truces through the mail routes (#203): proposed from the map
 * (`requesttruce`) or in a thread (`sendmessage` "trucerequest"), then
 * accepted or rejected by the recipient. An accepted truce runs 7 days; a
 * request waits 7 days for its answer and then lapses. The thread list says
 * when either ends. Driven over an in-memory stand-in for the rows.
 */

const ALICE = 2505;
const BOB = 77;
const BOB_MAIN = "2000245210";
/** A Map Room 1 bot neighbour (#245): she answers every truce request herself, some hours later. */
const CAROL = 88;
const CAROL_MAIN = "2000245300";
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
  // `isBot` reads through the request's context (#245).
  getContext: () => em,
};

mock.module("../../server.js", () => ({ postgres: { em }, redis: {} }));

const { requestTruce } = await import("./requestTruce.js");
const { sendMessage } = await import("./sendMessage.js");
const { getMessageThreads } = await import("./getMessageThreads.js");
const { getMessageThread } = await import("./getMessageThread.js");
const { getTruces } = await import("../../services/maproom/getTruces.js");
const { isTruceActive } = await import("../../services/mail/isTruceActive.js");
const { TRUCE_DURATION, TRUCE_REQUEST_LIFETIME, TRUCE_RETRY_AFTER_REJECTION } = await import("../../services/mail/truceRules.js");
const { DECLINE_TRUCE_HOURS, TRUCE_REJECT_TEXT, declineTruce } = await import("../../services/bots/truceDecline.js");

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
      { baseid: CAROL_MAIN, saveuserid: CAROL, type: "main" },
      { baseid: CAMP, saveuserid: 0, type: "tribe" },
    ]],
    ["User", [
      { userid: ALICE, username: "alice", blockedUsers: [], save: { unreadmessages: 0 } },
      { userid: BOB, username: "bob", blockedUsers: [], save: { unreadmessages: 0 } },
      { userid: CAROL, username: "carol", blockedUsers: [], save: { unreadmessages: 0 } },
    ]],
    ["Bot", [{ userid: CAROL }]],
    ["BotJob", []],
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
  test("the recipient accepts: a truce of 7 days, on the truce and the thread", async () => {
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

  test("a rejection's future expires_at (the proposer's wait) is no truce, on the map or anywhere", async () => {
    const { threadid } = (await request(ALICE, BOB_MAIN)) as { threadid: number };
    await send(BOB, threadid, "trucereject");
    expect(truces()[0]!.expires_at as number).toBeGreaterThan(now());

    // No cell `t` either way.
    expect((await getTruces(ALICE, [BOB])).has(BOB)).toBe(false);
    expect((await getTruces(BOB, [ALICE])).has(ALICE)).toBe(false);
    // Not the attack load's active truce.
    expect(await isTruceActive(ALICE, BOB)).toBe(false);
    expect(await isTruceActive(BOB, ALICE)).toBe(false);
    // The thread list gives it as rejected, with the wait's end, not as a running truce.
    const listedForAlice = (await run(getMessageThreads, ALICE, {})).threads as Record<string, Row>;
    expect(listedForAlice[threadid]).toMatchObject({ trucestate: "rejected", truceexpire: truces()[0]!.expires_at });
    // Not a live truce for the pair: the other player may ask at once, and that request can be accepted.
    const { threadid: again } = (await request(BOB, "2000241207")) as { threadid: number };
    await send(ALICE, again, "truceaccept");
    expect(truces()[1]).toMatchObject({ status: "accepted" });
  });
});

describe("a truce request to a bot (#245)", () => {
  const jobs = () => tables.get("BotJob")!;
  const HOUR = 3_600;

  /** The reply the web mailbox sends when its player presses Reject (`MailboxScreen.answerTruce`). */
  const rejectInMailbox = (from: number, threadid: number) =>
    run(sendMessage, from, {
      threadid: String(threadid),
      targetid: "0",
      subject: threadOf(threadid).lastMessage ? (threadOf(threadid).lastMessage as Row).subject : "(no subject)",
      type: "trucereject",
      message: TRUCE_REJECT_TEXT,
      targetbaseid: "0",
    });

  /** Runs the bot's booked answer, as the sweep would when it is due. */
  const runDecline = async (at = now()) => {
    const [job] = jobs();
    return declineTruce(em as never, job as never, at);
  };

  /** A row with its own ids and times taken out, to compare a bot's with a player's. */
  const bare = (row: Row) => {
    const { id: _id, threadid: _thread, userid: _user, targetid: _target, updatetime: _at, createdAt: _made, ...rest } = row;
    return rest;
  };

  test("from the map or in a thread, the request books one decline, 2-8 hours on; the answer is the same", async () => {
    const before = now();
    const fromMap = await request(ALICE, CAROL_MAIN);
    expect(fromMap).toEqual({ error: 0, threadid: 1 });
    expect(jobs()).toHaveLength(1);
    const [job] = jobs();
    expect(job).toMatchObject({ bot_userid: CAROL, kind: "declineTruce", target_userid: ALICE, payload: { truce: 1 } });
    const due = (job!.due_at as Date).getTime() / 1000;
    expect(due).toBeGreaterThanOrEqual(before + DECLINE_TRUCE_HOURS.min * HOUR);
    expect(due).toBeLessThanOrEqual(now() + DECLINE_TRUCE_HOURS.max * HOUR);

    // Lapse it, then ask in a thread: the same answer as to a player, and a second job.
    truces()[0]!.created_at = new Date((now() - TRUCE_REQUEST_LIFETIME - 1) * 1000);
    const threadid = (await send(ALICE, 0, "message", CAROL)).threadid as number;
    expect(await send(ALICE, threadid, "trucerequest")).toEqual({ error: 0, messageid: 0, threadid });
    expect(jobs()).toHaveLength(2);
    expect(jobs()[1]).toMatchObject({ payload: { truce: 2 } });
  });

  test("a request to a player books nothing", async () => {
    await request(ALICE, BOB_MAIN);
    const threadid = await plainThread();
    truces()[0]!.created_at = new Date((now() - TRUCE_REQUEST_LIFETIME - 1) * 1000);
    await send(ALICE, threadid, "trucerequest");
    expect(jobs()).toHaveLength(0);
  });

  test("the bot's decline writes exactly what a player's Reject writes", async () => {
    const toPlayer = (await request(ALICE, BOB_MAIN)).threadid as number;
    const toBot = (await request(ALICE, CAROL_MAIN)).threadid as number;

    // Bob opens the thread and presses Reject; Carol's job runs.
    await run(getMessageThread, BOB, { threadid: String(toPlayer) });
    await rejectInMailbox(BOB, toPlayer);
    expect(await runDecline()).toBe("rejected");

    const [playerTruce, botTruce] = truces();
    expect(botTruce).toMatchObject({ status: "rejected" });
    const terms = ({ status, initiator_userid }: Row) => ({ status, initiator_userid });
    expect(Object.keys(botTruce!).sort()).toEqual(Object.keys(playerTruce!).sort());
    expect(terms(botTruce!)).toEqual(terms(playerTruce!));
    expect(Math.abs((botTruce!.expires_at as number) - (playerTruce!.expires_at as number))).toBeLessThanOrEqual(1);

    const messageOf = (threadid: number, type: string) =>
      tables.get("Message")!.find((one) => one.threadid === threadid && one.messagetype === type)!;
    const replyOf = (threadid: number) => messageOf(threadid, "trucereject");
    expect(bare(replyOf(toBot))).toEqual(bare(replyOf(toPlayer)));
    // The request read by both, and neither left with anything unread.
    // Only the stored columns: opening a thread also sets its view-only fields on the rows.
    const stored = (row: Row) => {
      const { messageid: _index, unread: _unread, ...rest } = bare(row);
      return rest;
    };
    expect(stored(messageOf(toBot, "trucerequest"))).toEqual(stored(messageOf(toPlayer, "trucerequest")));
    expect(messageOf(toBot, "trucerequest")).toMatchObject({ targetUnread: 0 });
    expect(user(CAROL).save).toEqual(user(BOB).save);
    expect(replyOf(toBot)).toMatchObject({ userid: CAROL, targetid: ALICE, message: "I reject your truce." });

    const { lastMessage: playerLast, ...playerThread } = threadOf(toPlayer);
    const { lastMessage: botLast, ...botThread } = threadOf(toBot);
    expect(bare(botThread)).toEqual({ ...bare(playerThread), truce_id: botTruce!.id });
    expect(botLast).toBe(replyOf(toBot));
    expect(playerLast).toBe(replyOf(toPlayer));

    // Alice's mailbox: both replies unread, both threads listed alike.
    expect(user(ALICE).save).toEqual({ unreadmessages: 2 });
    const threads = (await run(getMessageThreads, ALICE, {})).threads as Record<string, Row>;
    expect(Object.keys(threads[toBot]!).sort()).toEqual(Object.keys(threads[toPlayer]!).sort());
    const listing = (row: Row) => {
      const { messageid: _index, truceexpire: _end, ...rest } = bare(row);
      return rest;
    };
    expect(listing(threads[toBot]!)).toEqual(listing(threads[toPlayer]!));

    // And the 2-day wait before asking her again, as after a player's rejection.
    expect((await request(ALICE, CAROL_MAIN)).message).toBe(
      "They rejected your last truce request. You can ask them again in 2 days.",
    );
  });

  test("a request no longer open is left alone: lapsed, or answered already", async () => {
    await request(ALICE, CAROL_MAIN);
    truces()[0]!.created_at = new Date((now() - TRUCE_REQUEST_LIFETIME - 1) * 1000);
    expect(await runDecline()).toBe("closed");
    expect(truces()[0]).toMatchObject({ status: "requested" });
    expect(tables.get("Message")!.filter((one) => one.messagetype === "trucereject")).toHaveLength(0);

    truces()[0]!.created_at = new Date();
    truces()[0]!.status = "accepted";
    expect(await runDecline()).toBe("closed");
    expect(truces()[0]).toMatchObject({ status: "accepted" });
  });

  test("after a block either way it is not answered, as a player could not answer it", async () => {
    await request(ALICE, CAROL_MAIN);
    user(ALICE).blockedUsers = [CAROL];
    expect(await runDecline()).toBe("blocked");
    expect(truces()[0]).toMatchObject({ status: "requested" });
  });
});
