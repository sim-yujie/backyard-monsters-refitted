import { describe, expect, test } from "bun:test";
import type { EntityManager } from "@mikro-orm/core";
import {
  categoryOf,
  GAME_NOTICES,
  MUTABLE_CATEGORIES,
  mutedAfter,
  mutedSetOf,
  NOTIFICATION_CATEGORIES,
  visibleEntries,
} from "./notificationCategories.js";
import {
  listNotifications,
  NOTIFICATION_LIMIT,
  notifyAndCount,
  pruneNotifications,
  recordNotifications,
  unreadNotificationCount,
} from "./notifications.js";
import { notifyFriend } from "../friends/friendNotifications.js";
import { UpdateSettingsSchema } from "../../schemas/AuthSchemas.js";

/**
 * The bell's categories (owner 11 Nov 2026): which category each entry is
 * in, and that a category turned off is stored but never shown, never lights
 * the bell, and never pushes the shown rows out of the list.
 */

const job = (kind: string, id: number | string = 1) => ({ kind, id, t: null, at: 100, detail: {} });

describe("categoryOf", () => {
  test("every job kind the catch-up and the attack notices write has its category", () => {
    const expected: Record<string, string> = {
      yardAttacked: "attacks",
      infernoAttacked: "attacks",
      outpostAttacked: "attacks",
      outpostTaken: "attacks",
      build: "buildings",
      upgrade: "buildings",
      fortify: "buildings",
      repair: "buildings",
      unlock: "monsters",
      train: "monsters",
      research: "monsters",
      hatch: "monsters",
      cull: "monsters",
      queueRefund: "monsters",
      siege: "monsters",
      championHatch: "monsters",
      starve: "monsters",
      storeItem: "boosts",
      radioRemoved: GAME_NOTICES,
      mapRoomAdded: GAME_NOTICES,
      starterBase: GAME_NOTICES,
    };
    for (const rowKind of ["jobs", "away"]) {
      for (const [kind, category] of Object.entries(expected)) expect<string>(categoryOf(rowKind, job(kind))).toBe(category);
    }
  });

  test("friend and achievement rows are their own categories, whatever their entries say", () => {
    for (const event of ["request", "accepted", "gift", "helpSpeedup", "helpRepair"]) {
      expect(categoryOf("friend", { event, userid: 2, username: "Bob" })).toBe("friends");
    }
    expect(categoryOf("achievement", { kind: "achievement", id: 3 })).toBe("achievements");
  });

  test("a kind nobody listed yet is a game notice, so it is never hidden by accident", () => {
    expect(categoryOf("jobs", job("somethingNew"))).toBe(GAME_NOTICES);
    expect(categoryOf("jobs", null)).toBe(GAME_NOTICES);
    expect(categoryOf("someNewRowKind", {})).toBe(GAME_NOTICES);
  });

  test("no kind is in two categories, and game notices cannot be turned off", () => {
    const kinds = NOTIFICATION_CATEGORIES.flatMap((category) => [...category.jobKinds, ...category.rowKinds]);
    expect(new Set(kinds).size).toBe(kinds.length);
    expect(MUTABLE_CATEGORIES).not.toContain(GAME_NOTICES as never);
  });

  test("the stored list keeps only categories that can be turned off", () => {
    expect([...mutedSetOf(["attacks", "game", "nope", 3, "friends"])]).toEqual(["attacks", "friends"]);
    expect(mutedSetOf(null).size).toBe(0);
    expect(mutedSetOf("attacks").size).toBe(0);
  });

  test("visibleEntries leaves out only the muted categories", () => {
    const away = [job("upgrade"), job("yardAttacked"), job("hatch"), job("mapRoomAdded")];
    expect(visibleEntries("away", away, new Set())).toEqual(away);
    expect(visibleEntries("away", away, new Set(["attacks", "monsters"]))).toEqual([job("upgrade"), job("mapRoomAdded")]);
  });
});

/** An entity manager that records every call; `muted` is the player's stored list. */
const fakeEm = (options: { muted?: unknown; rows?: unknown[]; scan?: unknown[]; unread?: number } = {}) => {
  const calls: { method: string; args: unknown[] }[] = [];
  const record =
    (method: string, answer: (...args: unknown[]) => unknown = () => undefined) =>
    async (...args: unknown[]) => {
      calls.push({ method, args });
      return answer(...args);
    };
  const em = {
    insertMany: record("insertMany"),
    nativeDelete: record("nativeDelete"),
    count: record("count", () => options.unread ?? 0),
    find: record("find", () => options.rows ?? []),
    getConnection: () => ({
      execute: record("execute", (sql) => {
        const text = String(sql);
        if (text.includes(`"notifications_off"`)) return [{ notifications_off: options.muted ?? [] }];
        if (text.startsWith("SELECT")) return options.scan ?? [];
        return undefined;
      }),
    }),
    fork() {
      return em;
    },
  };
  return { em: em as unknown as EntityManager, calls };
};

const inserted = (calls: { method: string; args: unknown[] }[]) =>
  calls.find((call) => call.method === "insertMany")!.args[1] as Record<string, unknown>[];

describe("writing with categories turned off", () => {
  const now = new Date("2026-11-11T10:00:00Z");

  test("a row with nothing the player wants is stored already read; one with something left stays unread", async () => {
    const { em, calls } = fakeEm({ muted: ["buildings", "attacks"] });
    await recordNotifications(em, 2503, null, "away", [[job("upgrade"), job("yardAttacked")]], now);
    await recordNotifications(em, 2503, null, "away", [[job("upgrade"), job("train")]], now);
    const rows = calls.filter((call) => call.method === "insertMany").map((call) => (call.args[1] as never[])[0]!);
    expect(rows.map((row: Record<string, unknown>) => row["read_at"])).toEqual([now, null]);
    // Stored whole either way: turning the category back on brings it back.
    expect(rows.map((row: Record<string, unknown>) => row["jobs"])).toEqual([
      [job("upgrade"), job("yardAttacked")],
      [job("upgrade"), job("train")],
    ]);
  });

  test("with nothing muted, every row is written unread as before", async () => {
    const { em, calls } = fakeEm();
    await recordNotifications(em, 2503, null, "jobs", [[job("upgrade")], [job("storeItem", "BST")]], now);
    expect(inserted(calls).map((row) => row["read_at"])).toEqual([null, null]);
  });

  test("a friend's notice to a player who turned Friends and gifts off is stored read", async () => {
    const { em, calls } = fakeEm({ muted: ["friends"] });
    await notifyFriend(em, 2503, { event: "gift", userid: 2504, username: "Bob" }, now);
    expect(inserted(calls)).toEqual([
      {
        userid: 2503,
        baseid: null,
        kind: "friend",
        jobs: [{ event: "gift", userid: 2504, username: "Bob" }],
        read_at: now,
        created_at: now,
      },
    ]);
  });

  test("the prune keeps the newest 20 shown rows and, apart, the newest 20 hidden ones", async () => {
    // 30 hidden (all buildings) rows, newest first, then 25 shown ones.
    const scan = [
      ...Array.from({ length: 30 }, (_, at) => ({ id: 100 - at, kind: "jobs", jobs: [job("upgrade")] })),
      ...Array.from({ length: 25 }, (_, at) => ({ id: 50 - at, kind: "friend", jobs: [{ event: "gift" }] })),
    ];
    const { em, calls } = fakeEm({ muted: ["buildings"], scan });
    await pruneNotifications(em, 2503, now);
    const deletes = calls.filter((call) => call.method === "nativeDelete").map((call) => call.args[1]);
    expect(deletes[0]).toMatchObject({ userid: 2503 });
    expect(deletes[1]).toEqual({
      userid: 2503,
      id: { $in: [...Array.from({ length: 10 }, (_, at) => 80 - at), ...Array.from({ length: 5 }, (_, at) => 30 - at)] },
    });
    // The scan names the player.
    const scanCall = calls.find((call) => call.method === "execute" && String(call.args[0]).includes(`"jobs"`))!;
    expect(scanCall.args[1]).toEqual([2503]);
  });
});

describe("listing with categories turned off", () => {
  const created = new Date("2026-11-11T09:00:00Z");
  const row = (id: number, kind: string, jobs: unknown[], read = false) => ({
    id: String(id),
    kind,
    baseid: null,
    jobs,
    read_at: read ? created : null,
    created_at: created,
  });

  test("leaves out the muted entries of each row and the rows with nothing left, and counts what is shown", async () => {
    const rows = [
      row(5, "jobs", [job("upgrade")]),
      row(4, "away", [job("upgrade"), job("yardAttacked"), job("train")]),
      row(3, "friend", [{ event: "request", userid: 2, username: "Bob" }]),
      row(2, "achievement", [{ kind: "achievement", id: 7 }]),
      row(1, "away", [job("yardAttacked"), job("radioRemoved")]),
    ];
    const { em, calls } = fakeEm({ muted: ["buildings", "friends"], rows });
    const list = await listNotifications(em, 2503, created);
    expect(list.map((view) => [view.id, view.jobs])).toEqual([
      [4, [job("yardAttacked"), job("train")]],
      [2, [{ kind: "achievement", id: 7 }]],
      [1, [job("yardAttacked"), job("radioRemoved")]],
    ]);
    // Every row of the week is read, so the 20 shown are picked from them.
    expect(calls.find((call) => call.method === "find")!.args[2]).not.toHaveProperty("limit");
    expect(await unreadNotificationCount(em, 2503, created)).toBe(3);
  });

  test("shows at most 20 rows", async () => {
    const rows = Array.from({ length: 35 }, (_, at) => row(100 - at, "jobs", [job("train")]));
    const { em } = fakeEm({ muted: ["buildings"], rows });
    expect(await listNotifications(em, 2503, created)).toHaveLength(NOTIFICATION_LIMIT);
  });

  test("with nothing muted, the list and the count take the plain queries", async () => {
    const { em, calls } = fakeEm({ unread: 25 });
    await listNotifications(em, 2503, created);
    expect(calls.find((call) => call.method === "find")!.args[2]).toMatchObject({ limit: NOTIFICATION_LIMIT });
    expect(await unreadNotificationCount(em, 2503, created)).toBe(NOTIFICATION_LIMIT);
  });

  test("the yard answer's count leaves out what is muted", async () => {
    const rows = [row(2, "jobs", [job("upgrade")]), row(1, "jobs", [job("train")])];
    const { em } = fakeEm({ muted: ["buildings"], rows });
    expect(await notifyAndCount(em, 2503, null, "jobs", [job("upgrade", 9)])).toBe(1);
  });
});

describe("the setting", () => {
  test("switches categories on and off and keeps the rest as stored, in the Settings order", () => {
    expect(mutedAfter([], { friends: false })).toEqual(["friends"]);
    expect(mutedAfter(["friends", "attacks"], { boosts: false, attacks: true })).toEqual(["boosts", "friends"]);
    expect(mutedAfter(["friends", "bogus"], {})).toEqual(["friends"]);
  });

  test("accepts only categories that can be turned off", () => {
    expect(UpdateSettingsSchema.safeParse({ notifications: { attacks: false, friends: true } }).success).toBe(true);
    expect(UpdateSettingsSchema.safeParse({ notifications: { game: false } }).success).toBe(false);
    expect(UpdateSettingsSchema.safeParse({ notifications: { nope: false } }).success).toBe(false);
    expect(UpdateSettingsSchema.safeParse({ notifications: { attacks: "off" } }).success).toBe(false);
  });
});
