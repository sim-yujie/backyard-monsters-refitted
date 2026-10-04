import { beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { EntityManager } from "@mikro-orm/postgresql";

import { YARD_ATTACKED } from "../maproom/v2/outpostNotices.js";
import { afterYardDefended, type YardDefence } from "./afterYardDefended.js";

/**
 * The after-defence hook (issue #241, `docs/design/bot-neighbours.md` §4.5,
 * §4.8): every Map Room 1 main-yard defence tells a real defender, whoever
 * attacked, and an attacked bot books its jobs instead. Driven over an
 * in-memory stand-in for the mail tables, `bym.bot` and `bym.bot_job`.
 */

type Row = Record<string, unknown>;

const PLAYER = 7;
const OTHER_PLAYER = 8;
const BOT = 41;
const OTHER_BOT = 42;
const NOW = 1_790_000_000;

let messages: Row[];
let threads: Row[];
let jobs: Row[];
let bots: Set<number>;

const matches = (row: Row, where: Row): boolean =>
  Object.entries(where).every(([key, value]) => {
    if (key === "$or") return (value as Row[]).some((branch) => matches(row, branch));
    return row[key] === value;
  });

const em = {
  global: false,
  getContext: () => em,
  fork: () => em,
  transactional: async <T>(body: (tx: unknown) => Promise<T>) => body(em),
  findOne: async (_entity: unknown, where: { userid: number }) => (bots.has(where.userid) ? where : null),
  find: async (entity: { name: string }) => (entity.name === "Thread" ? threads : messages),
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
  nativeUpdate: async () => 1,
  execute: async (sql: string, params: unknown[]) => {
    if (sql.startsWith("INSERT")) {
      jobs.push({ sql, params });
      return [{ id: jobs.length }];
    }
    return [];
  },
};

/** A fresh request's manager each test, so `isBot` asks again. */
let request: EntityManager;

beforeEach(() => {
  messages = [];
  threads = [];
  jobs = [];
  bots = new Set([BOT, OTHER_BOT]);
  request = { ...em, getContext: () => request } as unknown as EntityManager;
});

type YardOverrides = Omit<Partial<YardDefence>, "yard"> & { yard?: Partial<YardDefence["yard"]> };

const defence = (overrides: YardOverrides = {}): YardDefence => ({
  attacker: { userid: OTHER_PLAYER, username: "Bramble" },
  defenderDelta: { r1: -1234, r4: -500 },
  housedLost: 0,
  now: NOW,
  ...overrides,
  yard: { baseid: "70001", saveuserid: PLAYER, type: "main", mapversion: 1, damage: 47, ...overrides.yard },
});

describe("a real defender", () => {
  test("is sent the defence notice when a real player attacked", async () => {
    await afterYardDefended(request, defence());
    expect(messages).toEqual([
      expect.objectContaining({
        userid: 0,
        targetid: PLAYER,
        messagetype: YARD_ATTACKED,
        subject: "Bramble attacked your yard",
        message: "It was left 47% damaged, and 1,234 Twigs and 500 Goo were looted.",
        coords: null,
        baseid: "70001",
        targetUnread: 1,
        updatetime: NOW,
      }),
    ]);
    expect(jobs).toEqual([]);
  });

  test("is sent the very same notice when a bot attacked", async () => {
    await afterYardDefended(request, defence());
    const fromPlayer = messages[0];
    threads = [];
    messages = [];
    await afterYardDefended(request, defence({ attacker: { userid: BOT, username: "Bramble" } }));
    const fromBot = messages[0];
    expect(fromBot).toEqual(fromPlayer);
    expect(jobs).toEqual([]);
  });

  test("hears of housed monsters lost", async () => {
    await afterYardDefended(request, defence({ housedLost: 3, defenderDelta: null }));
    expect(messages[0]!.message).toBe("It was left 47% damaged, nothing was looted, and 3 housed monsters were lost.");
  });
});

describe("nothing outside a Map Room 1 main yard", () => {
  test("not an outpost, not a Map Room 2 or 3 yard, not an Inferno yard", async () => {
    await afterYardDefended(request, defence({ yard: { type: "outpost" } }));
    await afterYardDefended(request, defence({ yard: { mapversion: 2 } }));
    await afterYardDefended(request, defence({ yard: { mapversion: 3 } }));
    await afterYardDefended(request, defence({ yard: { type: "inferno" } }));
    await afterYardDefended(request, defence({ yard: { saveuserid: BOT, mapversion: 2 } }));
    expect(messages).toEqual([]);
    expect(jobs).toEqual([]);
  });

  test("not the owner attacking their own yard", async () => {
    await afterYardDefended(request, defence({ attacker: { userid: PLAYER, username: "Me" } }));
    expect(messages).toEqual([]);
  });
});

describe("a bot defender", () => {
  test("attacked by a real player books its repair, and gets no notice", async () => {
    // Revenge is a random roll (issue #269); hold it off so this case always
    // sees the one repair job, whatever the environment's BOTS_REVENGE is.
    const before = process.env.BOTS_REVENGE;
    try {
      process.env.BOTS_REVENGE = "off";
      await afterYardDefended(request, defence({ yard: { saveuserid: BOT } }));
    } finally {
      if (before === undefined) delete process.env.BOTS_REVENGE;
      else process.env.BOTS_REVENGE = before;
    }
    expect(messages).toEqual([]);
    expect(jobs).toEqual([expect.objectContaining({ params: [BOT, expect.any(Date)] })]);
    expect(String(jobs[0]!.sql)).toContain("'repair'");
    const due = (jobs[0]!.params as [number, Date])[1].getTime();
    expect(due).toBeGreaterThanOrEqual((NOW + 3600) * 1000);
    expect(due).toBeLessThan((NOW + 4 * 3600) * 1000);
  });

  test("attacked by a real player books both its repair and a revenge, when the roll allows it", async () => {
    const before = process.env.BOTS_REVENGE;
    const roll = spyOn(Math, "random").mockReturnValue(0);
    try {
      process.env.BOTS_REVENGE = "on";
      await afterYardDefended(request, defence({ yard: { saveuserid: BOT } }));
    } finally {
      roll.mockRestore();
      if (before === undefined) delete process.env.BOTS_REVENGE;
      else process.env.BOTS_REVENGE = before;
    }
    expect(messages).toEqual([]);
    expect(jobs).toEqual([
      expect.objectContaining({ params: [BOT, expect.any(Date)] }),
      expect.objectContaining({ params: [BOT, OTHER_PLAYER, expect.any(Date), expect.any(Date)] }),
    ]);
    expect(String(jobs[0]!.sql)).toContain("'repair'");
    expect(String(jobs[1]!.sql)).toContain("'revenge'");
  });

  test("attacked by another bot books nothing", async () => {
    await afterYardDefended(request, defence({ yard: { saveuserid: BOT }, attacker: { userid: OTHER_BOT, username: "Kai" } }));
    expect(messages).toEqual([]);
    expect(jobs).toEqual([]);
  });

  test("a failure to book is logged, never thrown into the landing", async () => {
    const failing = {
      ...request,
      getContext: () => failing,
      fork: () => failing,
      transactional: async () => {
        throw new Error("database gone");
      },
    } as unknown as EntityManager;
    await afterYardDefended(failing, defence({ yard: { saveuserid: BOT } }));
    expect(jobs).toEqual([]);
  });
});
