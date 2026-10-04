import { describe, expect, test } from "bun:test";
import type { EntityManager } from "@mikro-orm/core";
import type { User } from "../../database/models/user.model.js";
import { listAnswer, readAllAnswer, readAnswer, unreadAnswer } from "../../controllers/notifications/notifications.js";
import {
  awayBatches,
  liveBatches,
  NOTIFICATION_LIMIT,
  NOTIFICATION_MAX_AGE_MS,
  notifyAndCount,
} from "./notifications.js";

/**
 * The notification list's rules without a database (issue #257): which rows a
 * catch-up makes, that every query names the caller, and that a failing table
 * never breaks the yard answer. `notifications.db.test.ts` runs the SQL.
 */

const job = (kind: string, id: number | string, at = 100) => ({ kind, id, t: null, at, detail: {} });

describe("liveBatches", () => {
  test("one row per kind, in the order each kind first finished, hatches left out", () => {
    const completed = [job("upgrade", 1), job("hatch", "C1"), job("build", 2), job("upgrade", 3), job("storeItem", "BST")];
    expect(liveBatches(completed)).toEqual([
      [job("upgrade", 1), job("upgrade", 3)],
      [job("build", 2)],
      [job("storeItem", "BST")],
    ]);
  });

  test("nothing for an answer of hatches only, or none", () => {
    expect(liveBatches([job("hatch", "C1"), job("hatch", "C2")])).toEqual([]);
    expect(liveBatches([])).toEqual([]);
  });
});

describe("awayBatches", () => {
  test("everything in one row, hatches and the outpost notices included", () => {
    const completed = [job("upgrade", 1), job("hatch", "C1"), job("outpostAttacked", "3511")];
    expect(awayBatches(completed)).toEqual([completed]);
  });

  test("no row for a load that finished nothing", () => {
    expect(awayBatches([])).toEqual([]);
  });
});

/** An entity manager that records every call and answers `count` with `unread`. */
const fakeEm = (options: { unread?: number; fail?: boolean; rows?: unknown[] } = {}) => {
  const calls: { method: string; args: unknown[] }[] = [];
  const record =
    (method: string, answer: (...args: unknown[]) => unknown = () => undefined) =>
    async (...args: unknown[]) => {
      calls.push({ method, args });
      if (options.fail) throw new Error('relation "bym.notification" does not exist');
      return answer(...args);
    };
  const em = {
    insertMany: record("insertMany"),
    nativeDelete: record("nativeDelete"),
    nativeUpdate: record("nativeUpdate"),
    count: record("count", () => options.unread ?? 0),
    find: record("find", () => options.rows ?? []),
    getConnection: () => ({ execute: record("execute") }),
  };
  return { em: em as unknown as EntityManager, calls };
};

const where = (call: { args: unknown[] }) => call.args[1] as Record<string, unknown>;

describe("notifyAndCount", () => {
  test("writes a live answer's rows for the caller, prunes, and counts", async () => {
    const { em, calls } = fakeEm({ unread: 4 });
    const unread = await notifyAndCount(em, 2505, null, "jobs", [job("upgrade", 1), job("build", 2)]);
    expect(unread).toBe(4);

    const insert = calls.find((call) => call.method === "insertMany")!;
    const rows = insert.args[1] as Record<string, unknown>[];
    expect(rows.map((row) => [row["userid"], row["baseid"], row["kind"], row["jobs"]])).toEqual([
      [2505, null, "jobs", [job("upgrade", 1)]],
      [2505, null, "jobs", [job("build", 2)]],
    ]);
    // Older than 7 days goes, then all but the newest 20, both for this player only.
    const dropOld = calls.find((call) => call.method === "nativeDelete")!;
    expect(where(dropOld)["userid"]).toBe(2505);
    const cutoff = (where(dropOld)["created_at"] as { $lt: Date }).$lt;
    const now = (rows[0]!["created_at"] as Date).getTime();
    expect(now - cutoff.getTime()).toBe(NOTIFICATION_MAX_AGE_MS);
    const keepNewest = calls.find((call) => call.method === "execute")!;
    expect(keepNewest.args[1]).toEqual([2505, 2505, NOTIFICATION_LIMIT]);
    expect(where(calls.find((call) => call.method === "count")!)).toMatchObject({ userid: 2505, read_at: null });
  });

  test("an outpost's away row names the outpost", async () => {
    const { em, calls } = fakeEm();
    await notifyAndCount(em, 2505, "3511", "away", [job("upgrade", 1), job("hatch", "C1")]);
    const rows = calls.find((call) => call.method === "insertMany")!.args[1] as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ baseid: "3511", kind: "away", jobs: [job("upgrade", 1), job("hatch", "C1")] });
  });

  test("nothing finished: no write, only the count", async () => {
    const { em, calls } = fakeEm({ unread: 2 });
    expect(await notifyAndCount(em, 2505, null, "jobs", [job("hatch", "C1")])).toBe(2);
    expect(calls.map((call) => call.method)).toEqual(["count"]);
  });

  test("a missing table never throws: the count is left out", async () => {
    const { em } = fakeEm({ fail: true });
    expect(await notifyAndCount(em, 2505, null, "away", [job("upgrade", 1)])).toBeUndefined();
  });
});

const user = { userid: 2505 } as User;

describe("the routes", () => {
  test("the list is the caller's, newest first, with its unread count", async () => {
    const created = new Date("2026-10-04T10:00:00Z");
    const rows = [
      { id: "9", kind: "jobs", baseid: null, jobs: [job("upgrade", 1)], read_at: null, created_at: created },
      { id: "8", kind: "away", baseid: "3511", jobs: [], read_at: created, created_at: created },
    ];
    const { em, calls } = fakeEm({ rows });
    const answer = await listAnswer(em, user);
    expect(answer.status).toBe(200);
    expect(answer.body).toEqual({
      error: 0,
      unread: 1,
      notifications: [
        { id: 9, kind: "jobs", baseid: null, at: created.getTime() / 1000, read: false, jobs: [job("upgrade", 1)] },
        { id: 8, kind: "away", baseid: "3511", at: created.getTime() / 1000, read: true, jobs: [] },
      ],
    });
    const find = calls.find((call) => call.method === "find")!;
    expect(where(find)["userid"]).toBe(2505);
    expect(find.args[2]).toMatchObject({ limit: NOTIFICATION_LIMIT, orderBy: { created_at: "DESC", id: "DESC" } });
  });

  test("marking one read touches only the caller's row of that id", async () => {
    const { em, calls } = fakeEm({ unread: 3 });
    const answer = await readAnswer(em, user, { id: "12" });
    expect(answer.body).toEqual({ error: 0, unread: 3 });
    const update = calls.find((call) => call.method === "nativeUpdate")!;
    expect(where(update)).toEqual({ id: 12, userid: 2505, read_at: null });
  });

  test("a read without a usable id is refused and marks nothing", async () => {
    for (const body of [{}, { id: "x" }, { id: -1 }, null]) {
      const { em, calls } = fakeEm();
      const answer = await readAnswer(em, user, body);
      expect(answer.status).toBe(400);
      expect(calls).toEqual([]);
    }
  });

  test("mark all read and the count are the caller's", async () => {
    const { em, calls } = fakeEm({ unread: 0 });
    expect((await readAllAnswer(em, user)).body).toEqual({ error: 0, unread: 0 });
    expect(where(calls.find((call) => call.method === "nativeUpdate")!)).toEqual({ userid: 2505, read_at: null });
    expect((await unreadAnswer(em, user)).body).toEqual({ error: 0, unread: 0 });
  });
});
