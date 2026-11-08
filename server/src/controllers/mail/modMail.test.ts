import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { Context } from "koa";

/**
 * Moderator mail (owner, beta 7; `services/mail/modMail.ts`): a player on the
 * chat moderators list may find any player and start a conversation with
 * them; every mail they send is copied into the owner's log; their new
 * conversations are capped. A normal player keeps the rules they had, and
 * nothing a client sends makes it a moderator. The player's side of a
 * moderator's conversation is logged too, so the dashboard shows it whole.
 * Every send tells the recipient's game (`mailNudge.ts`).
 *
 * `../../server.js` is replaced by a fake entity manager that answers the
 * moderators list, the log and the player lookup from arrays here.
 */

const MOD = 3101;
const PLAYER = 3102;
const STRANGER = 3103;

let moderators = new Set<number>();
let users: Array<{ userid: number; username: string; blockedUsers: number[]; save: { unreadmessages: number } }> = [];
let threads: Array<Record<string, unknown>> = [];
let logRows: unknown[][] = [];
let logCounts = { hour: 0, day: 0 };
let created: Array<Record<string, unknown>> = [];

const em = {
  find: async (entity: { name: string }, where: Record<string, unknown>) => {
    if (entity.name === "Thread") {
      const or = where.$or as Array<Record<string, number>> | undefined;
      if (!or) return [];
      return threads.filter((thread) => or.some((cond) => Object.entries(cond).every(([k, v]) => thread[k] === v)));
    }
    if (entity.name === "User") {
      const ids = (where.userid as { $in: number[] }).$in;
      return users.filter((user) => ids.includes(user.userid));
    }
    return [];
  },
  findOne: async (entity: { name: string }, where: Record<string, unknown>) => {
    if (entity.name === "Thread") return threads.find((thread) => thread.threadid === where.threadid) ?? null;
    if (entity.name === "User") return users.find((user) => user.userid === where.userid) ?? null;
    return null;
  },
  create: (_entity: unknown, data: Record<string, unknown>) => {
    created.push(data);
    return data;
  },
  persist: () => {},
  flush: async () => {},
  count: async () => 1,
  populate: async () => {},
  execute: async (sql: string, params: unknown[] = []) => {
    if (/FROM bym\.chat_moderator WHERE userid = \?/.test(sql)) {
      return moderators.has(params[0] as number) ? [{ userid: params[0] }] : [];
    }
    if (/FROM bym\.chat_moderator WHERE userid IN/.test(sql)) {
      return (params as number[]).filter((id) => moderators.has(id)).map((userid) => ({ userid }));
    }
    if (/INSERT INTO bym\.mod_mail_log/.test(sql)) {
      logRows.push(params);
      return [];
    }
    if (/FROM bym\.mod_mail_log WHERE threadid = \?/.test(sql)) {
      const first = logRows.find((row) => row[5] === params[0]);
      return first ? [{ moderator_id: first[1] }] : [];
    }
    if (/FROM bym\.mod_mail_log/.test(sql)) return [logCounts];
    if (/FROM bym\.message/.test(sql)) return [];
    if (/FROM bym\."user"/.test(sql)) {
      const [first, second] = params as [number | string, string | undefined];
      const byName = (name: unknown) =>
        users.find((user) => typeof name === "string" && user.username.toLowerCase() === name.toLowerCase());
      const found =
        typeof first === "number" ? (users.find((user) => user.userid === first) ?? byName(second)) : byName(first);
      return found ? [{ userid: found.userid, username: found.username }] : [];
    }
    return [];
  },
};

mock.module("../../server.js", () => ({ postgres: { em }, redis: {} }));

const { sendMessage } = await import("./sendMessage.js");
const { findMailPlayer, getMailStatus, NOT_MODERATOR_TEXT } = await import("./mailStatus.js");
const { getMessageTargets } = await import("./getMessageTargets.js");
const { setMailNudge } = await import("../../services/mail/mailNudge.js");
const { MOD_MAIL_LIMIT_TEXT, MOD_MAIL_LIMITS } = await import("../../services/mail/modMail.js");

type Ctx = Context & { body: Record<string, unknown>; status: number };

const ctxFor = (userid: number, body: Record<string, unknown> = {}) => {
  const self = users.find((user) => user.userid === userid)!;
  return {
    authUser: { userid, username: self.username, blockedUsers: self.blockedUsers },
    request: { body },
  } as unknown as Ctx;
};

/** A new message from the compose box: thread 0. */
const newMail = (to: number, extra: Record<string, unknown> = {}) => ({
  subject: "Hello",
  type: "message",
  message: "Please stop spamming chat.",
  targetid: String(to),
  threadid: "0",
  targetbaseid: "0",
  ...extra,
});

let nudged: number[] = [];

beforeEach(() => {
  moderators = new Set([MOD]);
  users = [
    { userid: MOD, username: "ModMolly", blockedUsers: [], save: { unreadmessages: 0 } },
    { userid: PLAYER, username: "PlainPete", blockedUsers: [], save: { unreadmessages: 0 } },
    { userid: STRANGER, username: "Stranger", blockedUsers: [], save: { unreadmessages: 0 } },
  ];
  threads = [];
  logRows = [];
  logCounts = { hour: 0, day: 0 };
  created = [];
  nudged = [];
  setMailNudge(async (userId) => void nudged.push(userId));
});

afterEach(() => setMailNudge(null));

describe("a moderator's mail", () => {
  test("a moderator starts a conversation with a stranger who is not a friend, and it is logged", async () => {
    const ctx = ctxFor(MOD, newMail(STRANGER));
    await sendMessage(ctx);
    expect(ctx.body).toMatchObject({ error: 0 });
    expect(created.some((m) => m.targetid === STRANGER && m.userid === MOD)).toBe(true);
    expect(logRows).toHaveLength(1);
    const [, moderatorId, moderatorName, recipientId, recipientName, , newThread, type, subject, message, written, sender] =
      logRows[0]!;
    expect({ moderatorId, moderatorName, recipientId, recipientName, newThread, type, subject, message, written, sender }).toEqual({
      sender: "moderator",
      moderatorId: MOD,
      moderatorName: "ModMolly",
      recipientId: STRANGER,
      recipientName: "Stranger",
      newThread: true,
      type: "message",
      subject: "Hello",
      message: "Please stop spamming chat.",
      written: null,
    });
    expect(nudged).toEqual([STRANGER]);
  });

  test("a moderator's reply in an old thread is logged too, not as a new conversation", async () => {
    threads = [{ threadid: 9, userid: STRANGER, targetid: MOD, messagecount: 1 }];
    const ctx = ctxFor(MOD, newMail(MOD, { threadid: "9" }));
    await sendMessage(ctx);
    expect(ctx.body).toMatchObject({ error: 0, threadid: 9 });
    expect(logRows).toHaveLength(1);
    expect(logRows[0]![3]).toBe(STRANGER);
    expect(logRows[0]![6]).toBe(false);
  });

  test("a moderator past the new-conversation cap is refused, and nothing is written", async () => {
    logCounts = { hour: MOD_MAIL_LIMITS.perHour, day: MOD_MAIL_LIMITS.perHour };
    const ctx = ctxFor(MOD, newMail(STRANGER));
    await sendMessage(ctx);
    expect(ctx.status).toBe(429);
    expect(ctx.body).toMatchObject({ message: MOD_MAIL_LIMIT_TEXT.hour, reason: "rateLimited" });
    expect(created).toEqual([]);
    expect(logRows).toEqual([]);
    expect(nudged).toEqual([]);
  });

  test("the day's cap is told apart from the hour's", async () => {
    logCounts = { hour: 0, day: MOD_MAIL_LIMITS.perDay };
    const ctx = ctxFor(MOD, newMail(STRANGER));
    await sendMessage(ctx);
    expect(ctx.body).toMatchObject({ message: MOD_MAIL_LIMIT_TEXT.day });
  });

  test("the cap does not stop a moderator's reply", async () => {
    logCounts = { hour: 99, day: 99 };
    threads = [{ threadid: 9, userid: STRANGER, targetid: MOD, messagecount: 1 }];
    const ctx = ctxFor(MOD, newMail(MOD, { threadid: "9" }));
    await sendMessage(ctx);
    expect(ctx.body).toMatchObject({ error: 0 });
  });

  test("a player's block does not stop a moderator (owner, 8 Nov)", async () => {
    users.find((user) => user.userid === STRANGER)!.blockedUsers = [MOD];
    const ctx = ctxFor(MOD, newMail(STRANGER));
    await sendMessage(ctx);
    expect(ctx.body).toMatchObject({ error: 0 });
    expect(logRows.length).toBeGreaterThan(0);
  });

  test("a moderator's own block does not stop a player answering them", async () => {
    users.find((user) => user.userid === MOD)!.blockedUsers = [STRANGER];
    const ctx = ctxFor(STRANGER, newMail(MOD));
    await sendMessage(ctx);
    expect(ctx.body).toMatchObject({ error: 0 });
  });

  test("a block of someone taken off the moderators list counts again", async () => {
    moderators = new Set();
    users.find((user) => user.userid === STRANGER)!.blockedUsers = [MOD];
    const ctx = ctxFor(MOD, newMail(STRANGER));
    await sendMessage(ctx);
    expect(ctx.body).toEqual({ error: 1, message: "Cannot send message to this user" });
  });

  test("a moderator taken off the list is a normal player at the next send", async () => {
    moderators = new Set();
    const ctx = ctxFor(MOD, newMail(STRANGER));
    await sendMessage(ctx);
    expect(ctx.body).toMatchObject({ error: 0 });
    expect(logRows).toEqual([]);
  });
});

describe("the player's side of a moderator's conversation", () => {
  /** A log row as `logModMail` writes it, for a thread already in the log. */
  const logged = (threadid: number, moderatorId: number, playerId: number) => [
    new Date(),
    moderatorId,
    "ModMolly",
    playerId,
    "Stranger",
    threadid,
    true,
    "message",
    "Hello",
    "Please stop spamming chat.",
    null,
    "moderator",
  ];

  test("the player's answer in a moderator's thread is logged, as the player's", async () => {
    threads = [{ threadid: 9, userid: MOD, targetid: STRANGER, messagecount: 1 }];
    logRows = [logged(9, MOD, STRANGER)];
    const ctx = ctxFor(STRANGER, newMail(STRANGER, { threadid: "9", message: "Sorry, I will stop." }));
    await sendMessage(ctx);
    expect(ctx.body).toMatchObject({ error: 0, threadid: 9 });
    expect(logRows).toHaveLength(2);
    const [, moderatorId, moderatorName, playerId, playerName, threadid, newThread, , , message, , sender] = logRows[1]!;
    expect({ moderatorId, moderatorName, playerId, playerName, threadid, newThread, message, sender }).toEqual({
      moderatorId: MOD,
      moderatorName: "ModMolly",
      playerId: STRANGER,
      playerName: "Stranger",
      threadid: 9,
      newThread: false,
      message: "Sorry, I will stop.",
      sender: "player",
    });
  });

  test("a player writing to a moderator starts a logged conversation", async () => {
    const ctx = ctxFor(PLAYER, newMail(MOD, { message: "Someone is spamming." }));
    await sendMessage(ctx);
    expect(ctx.body).toMatchObject({ error: 0 });
    expect(logRows).toHaveLength(1);
    expect(logRows[0]![1]).toBe(MOD);
    expect(logRows[0]![3]).toBe(PLAYER);
    expect(logRows[0]![6]).toBe(true);
    expect(logRows[0]![11]).toBe("player");
  });

  test("a thread already in the log stays logged after the moderator is taken off the list", async () => {
    moderators = new Set();
    threads = [{ threadid: 9, userid: MOD, targetid: STRANGER, messagecount: 1 }];
    logRows = [logged(9, MOD, STRANGER)];
    const reply = ctxFor(MOD, newMail(MOD, { threadid: "9", message: "Thanks." }));
    await sendMessage(reply);
    const answer = ctxFor(STRANGER, newMail(STRANGER, { threadid: "9", message: "No problem." }));
    await sendMessage(answer);
    expect(logRows.slice(1).map((row) => [row[1], row[3], row[11], row[9]])).toEqual([
      [MOD, STRANGER, "moderator", "Thanks."],
      [MOD, STRANGER, "player", "No problem."],
    ]);
  });

  test("a player's answer in a thread with no moderator is not logged", async () => {
    threads = [{ threadid: 9, userid: PLAYER, targetid: STRANGER, messagecount: 1 }];
    const ctx = ctxFor(STRANGER, newMail(STRANGER, { threadid: "9" }));
    await sendMessage(ctx);
    expect(ctx.body).toMatchObject({ error: 0 });
    expect(logRows).toEqual([]);
  });
});

describe("a normal player's mail", () => {
  test("is sent as before, never logged, and the recipient's game is told", async () => {
    const ctx = ctxFor(PLAYER, newMail(STRANGER));
    await sendMessage(ctx);
    expect(ctx.body).toMatchObject({ error: 0 });
    expect(logRows).toEqual([]);
    expect(nudged).toEqual([STRANGER]);
  });

  test("a block still stops them", async () => {
    users.find((user) => user.userid === STRANGER)!.blockedUsers = [PLAYER];
    const ctx = ctxFor(PLAYER, newMail(STRANGER));
    await sendMessage(ctx);
    expect(ctx.body).toEqual({ error: 1, message: "Cannot send message to this user" });
    expect(nudged).toEqual([]);
  });

  test("claiming to be a moderator in the request changes nothing", async () => {
    const ctx = ctxFor(PLAYER, newMail(STRANGER, { mod: 1, moderator: true, isModerator: "1" }));
    await sendMessage(ctx);
    expect(ctx.body).toMatchObject({ error: 0 });
    expect(logRows).toEqual([]);
    expect(created.every((message) => !("mod" in message) && !("moderator" in message))).toBe(true);
  });
});

describe("finding any player to write to", () => {
  test("a moderator finds a player by name in any case, or by account number", async () => {
    const byName = ctxFor(MOD, { player: "stranger" });
    await findMailPlayer(byName);
    expect(byName.body).toEqual({ error: 0, player: { userid: STRANGER, username: "Stranger" } });
    const byNumber = ctxFor(MOD, { player: `#${PLAYER}` });
    await findMailPlayer(byNumber);
    expect(byNumber.body).toEqual({ error: 0, player: { userid: PLAYER, username: "PlainPete" } });
  });

  test("a moderator is told when no one has that name, and cannot pick themself", async () => {
    const nobody = ctxFor(MOD, { player: "Nobody" });
    await findMailPlayer(nobody);
    expect(nobody.body).toMatchObject({ error: 1 });
    const self = ctxFor(MOD, { player: "ModMolly" });
    await findMailPlayer(self);
    expect(self.body).toMatchObject({ error: 1 });
  });

  test("an admin (ADMIN_USER_IDS) finds any player too, and mailstatus says so (patch 6.11)", async () => {
    const saved = process.env.ADMIN_USER_IDS;
    process.env.ADMIN_USER_IDS = String(PLAYER);
    try {
      const ctx = ctxFor(PLAYER, { player: "stranger" });
      await findMailPlayer(ctx);
      expect(ctx.body).toEqual({ error: 0, player: { userid: STRANGER, username: "Stranger" } });
      const status = ctxFor(PLAYER);
      await getMailStatus(status);
      expect(status.body).toMatchObject({ error: 0, mod: 1 });
    } finally {
      if (saved === undefined) delete process.env.ADMIN_USER_IDS;
      else process.env.ADMIN_USER_IDS = saved;
    }
  });

  test("a normal player is refused with 403, whatever they claim", async () => {
    const ctx = ctxFor(PLAYER, { player: "Stranger", mod: 1 });
    await findMailPlayer(ctx);
    expect(ctx.status).toBe(403);
    expect(ctx.body).toMatchObject({ message: NOT_MODERATOR_TEXT, reason: "notModerator" });
  });
});

describe("the Mod badge and the mail check", () => {
  test("getmessagetargets marks a moderator partner with mod: 1, and no one else", async () => {
    threads = [
      { threadid: 1, userid: MOD, targetid: STRANGER, messagecount: 1 },
      { threadid: 2, userid: PLAYER, targetid: STRANGER, messagecount: 1 },
    ];
    const ctx = ctxFor(STRANGER);
    await getMessageTargets(ctx);
    const { targets } = ctx.body as { targets: Record<number, { mod?: number }> };
    expect(targets[MOD]?.mod).toBe(1);
    expect(targets[PLAYER]?.mod).toBeUndefined();
  });

  test("mailstatus says whether the player is a moderator", async () => {
    const mod = ctxFor(MOD);
    await getMailStatus(mod);
    expect(mod.body).toMatchObject({ error: 0, mod: 1, latest: null });
    const plain = ctxFor(PLAYER);
    await getMailStatus(plain);
    expect(plain.body).toMatchObject({ error: 0, mod: 0 });
  });
});
