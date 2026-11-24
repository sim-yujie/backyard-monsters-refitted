import { describe, expect, mock, test } from "bun:test";

/**
 * The watched words reach the chat server without a restart (owner, 24 Nov
 * 2026: "applies within a minute"): a read of `bym.chat_watch_word` (every
 * minute, or on the dashboard's control message) replaces the list the next
 * line is checked against; a failed read keeps the last list.
 */

let rows: { id: number; word: string; kind: string }[] = [];
let fail = false;

mock.module("../server.js", () => ({
  postgres: {
    orm: {
      em: {
        fork: () => ({
          execute: async () => {
            if (fail) throw new Error("database down");
            return rows;
          },
        }),
      },
    },
  },
  redis: {},
}));

const { currentWatchList, refreshWatchWords } = await import("./chatWatchWords.js");
const { filterLine } = await import("../services/chat/chatFilter.js");

const NEW = { isNew: true, staff: false };

describe("the chat server's watched words", () => {
  test("start as the owner's list, then follow the table after a read", async () => {
    expect(filterLine("may tele ka?", NEW, currentWatchList()).hidden).toBe(true);
    rows = [{ id: 1, word: "pampa aliw", kind: "always" }];
    await refreshWatchWords();
    expect(filterLine("may tele ka?", NEW, currentWatchList()).hidden).toBe(false);
    expect(filterLine("may pampa aliw dito", NEW, currentWatchList())).toMatchObject({ hidden: true, words: ["pampa aliw"] });
  });

  test("a failed read keeps the last list", async () => {
    fail = true;
    await refreshWatchWords();
    expect(filterLine("may pampa aliw dito", NEW, currentWatchList()).hidden).toBe(true);
    fail = false;
  });
});
