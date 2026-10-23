import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Context } from "koa";

/**
 * The mail routes with "The game team" in them (dashboard support tools):
 * threads from `userid` -1, the owner's replies to bug reports and Shiny
 * gifts. A player may answer only in their own report's thread, which the
 * server checks (`mayAnswerTeam`); the team is named and cannot be blocked.
 */

const PLAYER = 2505;
const REPORT_THREAD = 51;
const NOTICE_THREAD = 52;

let threads: Array<Record<string, unknown>> = [];
let written: unknown[] = [];
/** The threads `mayAnswerTeam` finds a report of the player's for. */
let reportThreads: number[] = [];

const em = {
  find: async (entity: { name: string }) => (entity.name === "Thread" ? threads : []),
  populate: async () => {},
  findOne: async (entity: { name: string }, where: Record<string, unknown>) => {
    if (entity.name === "Thread") return threads.find((thread) => thread.threadid === where.threadid) ?? null;
    return null;
  },
  create: (_entity: unknown, data: unknown) => {
    written.push(data);
    return data;
  },
  persist: (value: unknown) => {
    written.push(value);
  },
  flush: async () => {},
  count: async () => 0,
  execute: async (sql: string, params: unknown[] = []) =>
    /FROM bym\.bug_report r/.test(sql) && reportThreads.includes(params[0] as number) && params[1] === PLAYER
      ? [{ found: 1 }]
      : [],
  transactional: async <T>(work: (tx: unknown) => Promise<T>) => work(em),
};

// `redis` too: modules sendMessage reaches read it when they load.
mock.module("../../server.js", () => ({ postgres: { em }, redis: {} }));

const { getMessageTargets } = await import("./getMessageTargets.js");
const { reportMessageThread } = await import("./reportMessageThread.js");
const { sendMessage } = await import("./sendMessage.js");

const ctxFor = (authUser: Record<string, unknown>, body: Record<string, unknown> = {}) =>
  ({ authUser, request: { body } }) as unknown as Context & { body: Record<string, unknown> };

const player = () => ({ userid: PLAYER, username: "agenttester", blockedUsers: [] as number[] });

const answer = (threadid: number, type = "message") => ({
  subject: "About your bug report",
  type,
  message: "It was the map room",
  targetid: String(PLAYER),
  threadid: String(threadid),
  targetbaseid: "0",
});

beforeEach(() => {
  written = [];
  reportThreads = [REPORT_THREAD];
  threads = [
    { threadid: REPORT_THREAD, userid: -1, targetid: PLAYER, messagecount: 1, lastMessage: { userid: -1 } },
    { threadid: NOTICE_THREAD, userid: -1, targetid: PLAYER, messagecount: 1, lastMessage: { userid: -1 } },
  ];
});

describe("the game team in the mail routes", () => {
  test("an answer in the player's own report thread is kept for the dashboard", async () => {
    const ctx = ctxFor(player(), answer(REPORT_THREAD));
    await sendMessage(ctx);
    expect(ctx.body).toEqual({ error: 0, messageid: 0, threadid: REPORT_THREAD });
    expect(written[0]).toMatchObject({
      threadid: REPORT_THREAD,
      userid: PLAYER,
      targetid: -1,
      messagetype: "message",
      targetUnread: 1,
      message: "It was the map room",
    });
    expect(threads[0]!.messagecount).toBe(2);
  });

  test("an answer to a Shiny notice, or to someone else's report thread, is refused and writes nothing", async () => {
    const notice = ctxFor(player(), answer(NOTICE_THREAD));
    await sendMessage(notice);
    expect(notice.body).toEqual({ error: 1, message: "This message cannot be answered." });

    reportThreads = [];
    const other = ctxFor(player(), answer(REPORT_THREAD));
    await sendMessage(other);
    expect(other.body).toEqual({ error: 1, message: "This message cannot be answered." });
    expect(written).toEqual([]);
  });

  test("only a plain answer: a truce request to the team is refused", async () => {
    const ctx = ctxFor(player(), answer(REPORT_THREAD, "trucerequest"));
    await sendMessage(ctx);
    expect(ctx.body).toEqual({ error: 1, message: "This message cannot be answered." });
    expect(written).toEqual([]);
  });

  test("nobody can start a thread to the team or the game", async () => {
    for (const targetid of ["-1", "0"]) {
      const ctx = ctxFor(player(), { ...answer(0), targetid });
      await sendMessage(ctx);
      expect(ctx.body).toEqual({ error: 1, message: "This message cannot be answered." });
    }
    expect(written).toEqual([]);
  });

  test("blocking the team's thread blocks no one", async () => {
    const user = player();
    const ctx = ctxFor(user, { threadid: String(REPORT_THREAD), reason: "spam" });
    await reportMessageThread(ctx);
    expect(ctx.body).toEqual({ error: 0 });
    expect(user.blockedUsers).toEqual([]);
  });

  test("getmessagetargets names the team", async () => {
    const ctx = ctxFor(player());
    await getMessageTargets(ctx);
    const { targets } = ctx.body as { targets: Record<number, { first_name: string }> };
    expect(targets[-1]?.first_name).toBe("The game team");
  });
});
