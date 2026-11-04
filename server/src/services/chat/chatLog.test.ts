import { describe, expect, test } from "bun:test";

import { ChatLogWriter, insertChatLogLines, type ChatLogLine } from "./chatLog.js";

/**
 * The chat log's writer: lines are queued and saved in batches; a failed
 * save is logged and dropped, and never reaches the caller.
 */

const line = (n: number): ChatLogLine => ({
  userid: 100 + n,
  channel: "chat:mr2-global",
  message: `line ${n}`,
  shown: `line ${n}`,
  flagged: null,
  at: new Date(1_000_000 + n),
});

describe("ChatLogWriter", () => {
  test("saves queued lines in batches, oldest first", async () => {
    const saved: number[][] = [];
    const writer = new ChatLogWriter(async (lines) => void saved.push(lines.map((l) => l.userid - 100)), () => {}, {
      batch: 3,
      flushMs: 60_000,
    });
    for (let n = 0; n < 7; n++) writer.add(line(n));
    await writer.flush();
    expect(saved).toEqual([[0, 1, 2], [3, 4, 5], [6]]);
    expect(writer.queued).toBe(0);
  });

  test("a part batch is saved after the wait", async () => {
    const saved: ChatLogLine[] = [];
    const writer = new ChatLogWriter(async (lines) => void saved.push(...lines), () => {}, { flushMs: 5 });
    writer.add(line(1));
    writer.add(line(2));
    expect(saved).toEqual([]);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(saved.map((l) => l.message)).toEqual(["line 1", "line 2"]);
  });

  test("a failed save is logged, its lines dropped, and later lines still saved", async () => {
    const warnings: string[] = [];
    let fail = true;
    const saved: string[] = [];
    const writer = new ChatLogWriter(
      async (lines) => {
        if (fail) throw new Error("database down");
        saved.push(...lines.map((l) => l.message));
      },
      (message) => void warnings.push(message),
      { flushMs: 60_000 },
    );

    expect(() => writer.add(line(1))).not.toThrow();
    expect(await writer.flush()).toBe(0);
    expect(warnings).toEqual(["Chat log: 1 lines not saved: Error: database down"]);

    fail = false;
    writer.add(line(2));
    expect(await writer.flush()).toBe(1);
    expect(saved).toEqual(["line 2"]);
  });

  test("a full queue drops new lines with one warning instead of growing", () => {
    const warnings: string[] = [];
    const writer = new ChatLogWriter(() => new Promise(() => {}), (message) => void warnings.push(message), {
      maxQueue: 2,
      batch: 100,
      flushMs: 60_000,
    });
    for (let n = 0; n < 5; n++) writer.add(line(n));
    expect(writer.queued).toBe(2);
    expect(warnings.length).toBe(1);
  });
});

describe("insertChatLogLines", () => {
  test("one INSERT for the whole batch, with the player's words and the masked copy", async () => {
    const calls: { sql: string; params: unknown[] }[] = [];
    const em = { execute: async (sql: string, params: unknown[]) => void calls.push({ sql, params }) };
    await insertChatLogLines(em as never, [line(1), { ...line(2), message: "fuck", shown: "****", flagged: "swear" }]);
    expect(calls.length).toBe(1);
    expect(calls[0]!.sql).toContain("VALUES (?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?)");
    expect(calls[0]!.params.slice(6)).toEqual([102, "chat:mr2-global", "fuck", "****", "swear", new Date(1_000_002)]);

    await insertChatLogLines(em as never, []);
    expect(calls.length).toBe(1);
  });
});
