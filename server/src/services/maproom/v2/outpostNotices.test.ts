import { beforeEach, describe, expect, test } from "bun:test";
import type { EntityManager } from "@mikro-orm/core";
import {
  OUTPOST_ATTACKED,
  attackNoticeText,
  noticeOutpostAttack,
  takeOutpostNotices,
  takenNoticeText,
  writeOutpostNotice,
} from "./outpostNotices.js";

/**
 * Outposts WP8 (#187): the owner of a Map Room 2 outpost is told when it is
 * attacked or taken, through the mailbox and, once, the away notice; the
 * attacker and everyone else are told nothing. Driven over an in-memory
 * stand-in for the two mail tables.
 */

type Row = Record<string, unknown>;

const OWNER = 77;
const ATTACKER = 2505;
const OTHER = 3000;
const OUTPOST = "22913802243206";

let messages: Row[];
let threads: Row[];
let unread: Map<number, number>;

const matches = (row: Row, where: Row): boolean =>
  Object.entries(where).every(([key, value]) => {
    if (key === "$or") return (value as Row[]).some((branch) => matches(row, branch));
    if (value && typeof value === "object" && "$in" in (value as Row)) {
      return ((value as { $in: unknown[] }).$in).includes(row[key]);
    }
    return row[key] === value;
  });

const em = {
  find: async (entity: { name: string }, where: Row) =>
    (entity.name === "Thread" ? threads : messages).filter((row) => matches(row, where)),
  create: (_entity: unknown, data: Row) => {
    const row = { ...data };
    messages.push(row);
    return row;
  },
  persist: (row: Row) => {
    if (!threads.includes(row)) threads.push(row);
  },
  flush: async () => {},
  count: async (_entity: unknown, where: Row) => messages.filter((row) => matches(row, where)).length,
  nativeUpdate: async (_entity: unknown, where: Row, data: Row) => {
    unread.set(where.saveuserid as number, data.unreadmessages as number);
    return 1;
  },
} as unknown as EntityManager;

beforeEach(() => {
  messages = [];
  threads = [];
  unread = new Map();
});

const outpost = (overrides: Row = {}) =>
  ({ baseid: OUTPOST, saveuserid: OWNER, type: "outpost", damage: 63, mapversion: 2, ...overrides }) as never;

describe("the words", () => {
  test("an attack: who, where, the damage and the loot", () => {
    expect(attackNoticeText("Bramble", { x: 243, y: 206 }, 63.4, { r1: 1234, r4: 500 })).toEqual({
      subject: "Bramble attacked your outpost at (243, 206)",
      message: "It was left 63% damaged, and 1,234 Twigs and 500 Goo were looted.",
    });
    expect(attackNoticeText("Bramble", { x: 1, y: 2 }, 10, {}).message).toBe(
      "It was left 10% damaged, and nothing was looted.",
    );
  });

  test("a takeover: who and where", () => {
    expect(takenNoticeText("Bramble", { x: 243, y: 206 })).toEqual({
      subject: "Bramble took your outpost at (243, 206)",
      message: "It is theirs now, with every building on it.",
    });
  });
});

describe("at attack end", () => {
  test("the owner, and only the owner, gets one unread message from the game", async () => {
    await noticeOutpostAttack(em, {
      outpost: outpost(),
      attacker: { userid: ATTACKER, username: "Bramble" },
      defenderDelta: { r1: -1234, r2: 0, r3: -20_000_000, r4: 0 },
      now: 1_000,
    });
    expect(messages).toEqual([
      expect.objectContaining({
        userid: 0,
        targetid: OWNER,
        messagetype: OUTPOST_ATTACKED,
        targetUnread: 1,
        userUnread: 0,
        subject: "Bramble attacked your outpost at (243, 206)",
        // Loot capped at 10,000,000 a resource, as the defender's loss is.
        message: "It was left 63% damaged, and 1,234 Twigs and 10,000,000 Putty were looted.",
        coords: [243, 206],
        baseid: OUTPOST,
      }),
    ]);
    expect(threads).toEqual([expect.objectContaining({ userid: 0, targetid: OWNER, messagecount: 1 })]);
    expect(unread.get(OWNER)).toBe(1);
    expect(unread.has(ATTACKER)).toBe(false);
  });

  test("no notice for a main yard, a Map Room 3 outpost, or the owner's own attack", async () => {
    const attacker = { userid: ATTACKER, username: "Bramble" };
    await noticeOutpostAttack(em, { outpost: outpost({ type: "main" }), attacker, defenderDelta: {}, now: 1 });
    await noticeOutpostAttack(em, { outpost: outpost({ mapversion: 3 }), attacker, defenderDelta: {}, now: 1 });
    await noticeOutpostAttack(em, {
      outpost: outpost({ saveuserid: ATTACKER }),
      attacker,
      defenderDelta: {},
      now: 1,
    });
    expect(messages).toEqual([]);
  });
});

describe("on the owner's next load", () => {
  const leave = async (owner: number, at: number, subject = "X attacked your outpost at (1, 2)") =>
    writeOutpostNotice(em, {
      ownerId: owner,
      byUserId: ATTACKER,
      type: OUTPOST_ATTACKED,
      text: { subject, message: "It was left 5% damaged, and nothing was looted." },
      cell: { x: 1, y: 2 },
      baseid: OUTPOST,
      now: at,
    });

  test("hands the notices back once, oldest first, and marks them read", async () => {
    await leave(OWNER, 20, "B attacked your outpost at (1, 2)");
    await leave(OWNER, 10, "A attacked your outpost at (1, 2)");
    messages.sort((a, b) => (a.updatetime as number) - (b.updatetime as number));

    const first = await takeOutpostNotices(em, OWNER);
    expect(first.map((notice) => notice.detail.text)).toEqual([
      "A attacked your outpost at (1, 2). It was left 5% damaged, and nothing was looted.",
      "B attacked your outpost at (1, 2). It was left 5% damaged, and nothing was looted.",
    ]);
    expect(first[0]).toMatchObject({ kind: "outpostAttacked", id: OUTPOST, t: null, at: 10 });
    expect(first[0]!.detail).toMatchObject({ x: 1, y: 2 });
    expect(unread.get(OWNER)).toBe(0);
    // Kept in the mailbox, read.
    expect(messages.every((message) => message.targetUnread === 0)).toBe(true);

    expect(await takeOutpostNotices(em, OWNER)).toEqual([]);
  });

  test("nobody else sees them: not the attacker, not a third player", async () => {
    await leave(OWNER, 10);
    expect(await takeOutpostNotices(em, ATTACKER)).toEqual([]);
    expect(await takeOutpostNotices(em, OTHER)).toEqual([]);
    expect(messages[0]).toMatchObject({ targetUnread: 1 });
  });
});
