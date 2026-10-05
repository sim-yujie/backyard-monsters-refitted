import { describe, expect, test } from "bun:test";
import type { EntityManager } from "@mikro-orm/postgresql";
import type { HistoryEntry } from "../../chat/chatProtocol.js";
import type { User } from "../../database/models/user.model.js";
import { AllianceMessageType } from "../../enums/Alliance.js";
import { reportAnswer, yardAnswer } from "./chat.js";

/**
 * The chat box's routes without a database or Redis (issue #282): what a
 * report stores and when it is refused, and the yard lookup behind "View
 * their yard".
 */

const REPORTER = { userid: 2505 } as User;
const CHANNEL = "chat:mr2-global";

const line = (userId: number, body: string, ts: number): HistoryEntry => ({
  userId,
  displayName: `[12] player${userId}`,
  picSquare: null,
  allianceImage: null,
  body,
  messageType: AllianceMessageType.MESSAGE,
  ts,
});

/** An entity manager that records raw SQL and answers `findOne` with `player`. */
const fakeEm = (options: { inserted?: boolean; player?: unknown } = {}) => {
  const executed: { sql: string; params: unknown[] }[] = [];
  const found: unknown[][] = [];
  const em = {
    execute: async (sql: string, params: unknown[]) => {
      executed.push({ sql, params });
      return options.inserted === false ? [] : [{ id: 1 }];
    },
    findOne: async (...args: unknown[]) => {
      found.push(args);
      return options.player ?? null;
    },
  };
  return { em: em as unknown as EntityManager, executed, found };
};

const history = (entries: HistoryEntry[]) => {
  const asked: string[] = [];
  return { asked, read: async (channel: string) => (asked.push(channel), entries) };
};

describe("reportAnswer", () => {
  test("a line still in the history is stored with the server's own words, verified", async () => {
    const { em, executed } = fakeEm();
    const channel = history([line(77, "the real words", 1_700_000_000_123)]);
    const answer = await reportAnswer(
      em,
      REPORTER,
      { userid: "77", channel: CHANNEL, message: "words the client made up", ts: "1700000000123" },
      channel.read,
    );

    expect(answer).toEqual({ status: 200, body: { error: 0, stored: true, verified: true } });
    expect(channel.asked).toEqual([CHANNEL]);
    expect(executed).toHaveLength(1);
    expect(executed[0]!.sql).toContain("INSERT INTO bym.chat_report");
    expect(executed[0]!.sql).toContain("ON CONFLICT DO NOTHING");
    expect(executed[0]!.params).toEqual([2505, 77, CHANNEL, "the real words", 1_700_000_000_123, true]);
  });

  test("a line gone from the history keeps the reporter's words, unverified", async () => {
    const { em, executed } = fakeEm();
    const answer = await reportAnswer(
      em,
      REPORTER,
      { userid: 77, channel: CHANNEL, message: "  rude words  ", ts: 1_700_000_000_123 },
      history([line(77, "something else", 1_700_000_000_999), line(78, "same time", 1_700_000_000_123)]).read,
    );

    expect(answer.body).toEqual({ error: 0, stored: true, verified: false });
    expect(executed[0]!.params).toEqual([2505, 77, CHANNEL, "rude words", 1_700_000_000_123, false]);
  });

  test("an overlong line is cut to what chat could ever have carried", async () => {
    const { em, executed } = fakeEm();
    await reportAnswer(em, REPORTER, { userid: 77, channel: CHANNEL, message: "x".repeat(300), ts: 5 }, history([]).read);
    expect((executed[0]!.params[3] as string).length).toBe(200);
  });

  test("the same line reported again stores nothing new and is still an answer", async () => {
    const { em } = fakeEm({ inserted: false });
    const answer = await reportAnswer(em, REPORTER, { userid: 77, channel: CHANNEL, message: "hi", ts: 5 }, history([]).read);
    expect(answer).toEqual({ status: 200, body: { error: 0, stored: false, verified: false } });
  });

  test("a player cannot report themselves", async () => {
    const { em, executed } = fakeEm();
    const answer = await reportAnswer(em, REPORTER, { userid: 2505, channel: CHANNEL, message: "hi", ts: 5 }, history([]).read);
    expect(answer.status).toBe(400);
    expect(answer.body["reason"]).toBe("self");
    expect(executed).toHaveLength(0);
  });

  test.each([
    ["an alliance room", { userid: 77, channel: "chat:alliance:4", message: "hi", ts: 5 }],
    ["an unknown room", { userid: 77, channel: "chat:somewhere", message: "hi", ts: 5 }],
    ["no words", { userid: 77, channel: CHANNEL, message: "   ", ts: 5 }],
    ["no time", { userid: 77, channel: CHANNEL, message: "hi" }],
    ["no player", { channel: CHANNEL, message: "hi", ts: 5 }],
  ])("%s is refused before anything is read or written", async (_name, body) => {
    const { em, executed } = fakeEm();
    const channel = history([]);
    const answer = await reportAnswer(em, REPORTER, body, channel.read);
    expect(answer.status).toBe(400);
    expect(answer.body["reason"]).toBe("badRequest");
    expect(channel.asked).toEqual([]);
    expect(executed).toHaveLength(0);
  });
});

describe("yardAnswer", () => {
  test("answers a player's main yard and name", async () => {
    const { em, found } = fakeEm({ player: { userid: 77, username: "Rex", banned: false, save: { baseid: "1234" } } });
    const answer = await yardAnswer(em, { userid: "77" });
    expect(answer).toEqual({ status: 200, body: { error: 0, baseid: "1234", name: "Rex" } });
    expect(found[0]![1]).toEqual({ userid: 77 });
  });

  test.each([
    ["no such player", null],
    ["a banned player", { userid: 77, username: "Rex", banned: true, save: { baseid: "1234" } }],
    ["a player with no yard", { userid: 77, username: "Rex", banned: false, save: null }],
  ])("%s is not found", async (_name, player) => {
    const { em } = fakeEm({ player });
    const answer = await yardAnswer(em, { userid: 77 });
    expect(answer.status).toBe(404);
    expect(answer.body["reason"]).toBe("notFound");
  });

  test("a bad id is refused without a lookup", async () => {
    const { em, found } = fakeEm();
    expect((await yardAnswer(em, { userid: "abc" })).status).toBe(400);
    expect(found).toHaveLength(0);
  });
});
