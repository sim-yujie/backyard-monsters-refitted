import { describe, expect, mock, test } from "bun:test";
import type { EntityManager } from "@mikro-orm/postgresql";

mock.module("../../server.js", () => ({ postgres: { em: {} } }));

const { isBot } = await import("./isBot.js");
const { Bot } = await import("../../database/models/bot.model.js");

/** A stand-in entity manager over a set of bot userids, counting its reads. */
const fakeEm = (bots: number[], global = false) => {
  const reads: unknown[] = [];
  const em = {
    global,
    getContext: () => em,
    findOne: async (entity: unknown, where: { userid: number }) => {
      reads.push(entity);
      return bots.includes(where.userid) ? { userid: where.userid } : null;
    },
  };
  return { em: em as unknown as EntityManager, reads };
};

describe("isBot", () => {
  test("is true only for a user with a bot row, read from bym.bot", async () => {
    const { em, reads } = fakeEm([41]);
    expect(await isBot(41, em)).toBe(true);
    expect(await isBot(42, em)).toBe(false);
    expect(reads).toEqual([Bot, Bot]);
  });

  test("asks once per user per request", async () => {
    const { em, reads } = fakeEm([41]);
    await isBot(41, em);
    await isBot(42, em);
    expect(await isBot(41, em)).toBe(true);
    expect(await isBot(42, em)).toBe(false);
    expect(reads).toHaveLength(2);
  });

  test("a new request asks again", async () => {
    const first = fakeEm([41]);
    const second = fakeEm([]);
    expect(await isBot(41, first.em)).toBe(true);
    expect(await isBot(41, second.em)).toBe(false);
  });

  test("the global entity manager is never cached", async () => {
    const { em, reads } = fakeEm([41], true);
    await isBot(41, em);
    await isBot(41, em);
    expect(reads).toHaveLength(2);
  });
});
