import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Context } from "koa";

/**
 * The mail routes with the game's own notices in them (#187): a thread from
 * `userid` 0, which has no user row. It lists and reads like any thread, is
 * named "Backyard Monsters", and can be neither answered nor blocked.
 */

const OWNER = 2505;
const OTHER = 7;
const SYSTEM_THREAD = 41;
const PLAYER_THREAD = 42;

const noticeMessage = () =>
  Object.assign(new Message(), {
    threadid: SYSTEM_THREAD,
    userid: 0,
    targetid: OWNER,
    messagetype: "outpostattacked",
    userUnread: 0,
    targetUnread: 1,
    subject: "Bramble attacked your outpost at (243, 206)",
    message: "It was left 40% damaged, and nothing was looted.",
    updatetime: 100,
  });

let threads: Array<Record<string, unknown>> = [];
let users: Array<Record<string, unknown>> = [];
let written: unknown[] = [];

const em = {
  find: async (entity: { name: string }, where: Record<string, unknown>) => {
    if (entity.name === "Thread") return threads;
    if (entity.name === "User") {
      const ids = (where.userid as { $in: number[] }).$in;
      return users.filter((user) => ids.includes(user.userid as number));
    }
    return [];
  },
  findOne: async (entity: { name: string }, where: Record<string, unknown>) => {
    if (entity.name === "Thread") return threads.find((thread) => thread.threadid === where.threadid) ?? null;
    if (entity.name === "User") return users.find((user) => user.userid === where.userid) ?? null;
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
};

mock.module("../../server.js", () => ({ postgres: { em } }));

const { Message } = await import("../../database/models/message.model.js");
const { getMessageTargets } = await import("./getMessageTargets.js");
const { getMessageThreads } = await import("./getMessageThreads.js");
const { reportMessageThread } = await import("./reportMessageThread.js");
const { sendMessage } = await import("./sendMessage.js");

const ctxFor = (authUser: Record<string, unknown>, body: Record<string, unknown> = {}) =>
  ({ authUser, request: { body } }) as unknown as Context & { body: Record<string, unknown> };

const owner = () => ({ userid: OWNER, username: "agenttester", blockedUsers: [] as number[] });

beforeEach(() => {
  written = [];
  threads = [
    { threadid: SYSTEM_THREAD, userid: 0, targetid: OWNER, messagecount: 1, lastMessage: noticeMessage() },
    { threadid: PLAYER_THREAD, userid: OTHER, targetid: OWNER, messagecount: 1, lastMessage: null },
  ];
  users = [{ userid: OTHER, username: "Bramble", last_name: "", pic_square: null, blockedUsers: [] }];
});

describe("the game's notices in the mail routes", () => {
  test("getmessagetargets names the game, alongside real players", async () => {
    const ctx = ctxFor(owner());
    await getMessageTargets(ctx);
    const { targets } = ctx.body as { targets: Record<number, { first_name: string }> };
    expect(targets[0]?.first_name).toBe("Backyard Monsters");
    expect(targets[OTHER]?.first_name).toBe("Bramble");
  });

  test("getmessagetargets adds no game entry when the game never wrote", async () => {
    threads = threads.filter((thread) => thread.userid !== 0);
    const ctx = ctxFor(owner());
    await getMessageTargets(ctx);
    expect(Object.keys((ctx.body as { targets: object }).targets)).toEqual([String(OTHER)]);
  });

  test("getmessagethreads lists the notice, from userid 0, unread", async () => {
    const ctx = ctxFor(owner());
    await getMessageThreads(ctx);
    const listed = (ctx.body as { threads: Record<number, Record<string, unknown>> }).threads[SYSTEM_THREAD];
    expect(listed).toMatchObject({ userid: 0, unread: 1, messagetype: "outpostattacked" });
  });

  test("a reply to the game is refused and writes nothing", async () => {
    const ctx = ctxFor(owner(), {
      subject: "",
      type: "message",
      message: "who are you?",
      targetid: String(OWNER),
      threadid: String(SYSTEM_THREAD),
      targetbaseid: "0",
    });
    await sendMessage(ctx);
    expect(ctx.body).toEqual({ error: 1 });
    expect(written).toEqual([]);
  });

  test("reporting the notice's thread does not block the game", async () => {
    const user = owner();
    const ctx = ctxFor(user, { threadid: String(SYSTEM_THREAD), reason: "spam" });
    await reportMessageThread(ctx);
    expect(ctx.body).toEqual({ error: 0 });
    expect(user.blockedUsers).toEqual([]);
    expect(written).toEqual([]);
  });

  test("reporting a player's thread still blocks the player", async () => {
    const user = owner();
    await reportMessageThread(ctxFor(user, { threadid: String(PLAYER_THREAD), reason: "spam" }));
    expect(user.blockedUsers).toEqual([OTHER]);
  });
});
