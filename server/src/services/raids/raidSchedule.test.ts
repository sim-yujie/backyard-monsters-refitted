import { afterEach, beforeEach, describe, expect, mock, setSystemTime, test } from "bun:test";
import { LockMode, type EntityManager } from "@mikro-orm/core";
import { memoryRedis } from "../../testing/memoryRedis.js";
import { experiencePoints } from "../../game-data/stats/experiencePoints.js";

/**
 * The wild monster raid schedule (#226 WP2, `docs/design/wild-raids.md` §4.1
 * and §8.1): Flash's timing, the due rule's gates one by one, the session
 * count on a yard load, and `aiattacks` out of the client's reach.
 */

const strings = new Map<string, string>();
const redis = memoryRedis(strings);

mock.module("../../server.js", () => ({
  postgres: { em: {} },
  redis,
}));

const { Save } = await import("../../database/models/save.model.js");
const {
  FIRST_RAID_DELAY_SECONDS,
  LONG_GAP_SECONDS,
  RAID_PREFERENCES,
  RECENT_RAIDS_KEPT,
  countRaidSession,
  parseRaidPreference,
  raidAlreadyApplied,
  raidDueCheck,
  raidDueNow,
  readSchedule,
  recordRaidFinished,
  setRaidFrequency,
  startSession,
} = await import("./raidSchedule.js");
const { openRaid, recordRaidScreen } = await import("./raidStore.js");
const { REAL_ACTION_WINDOW_SECONDS } = await import("../user/online.js");

type Facts = Parameters<typeof raidDueCheck>[0];

const USER = 2505;
const NOW = 1_900_000_000;
const DAY = 24 * 60 * 60;
const LEVEL_9_POINTS = String(experiencePoints[8]);

const at = (seconds: number) => setSystemTime(new Date(seconds * 1000));

/** A main yard that is due in every respect: level 9, 4 sessions, its time come, nothing damaged. */
const dueSave = (extra: Record<string, unknown> = {}) => ({
  type: "main",
  mapversion: 2,
  points: LEVEL_9_POINTS,
  basevalue: "0",
  aiattacks: { v: 2, lastattack: NOW - 3 * DAY, nextAttack: NOW - 10, sessionsSinceLastAttack: 4, attackPreference: 0, recent: [] },
  buildingdata: { "1": { x: 0, y: 0, t: 14, id: 1, l: 1 } },
  buildinghealthdata: {},
  ...extra,
});

const dueFacts = (extra: Partial<Facts> = {}): Facts => ({
  save: dueSave(),
  now: NOW,
  marks: { lastSeen: NOW - 5, lastAction: NOW - 30, challengePending: false },
  screen: { where: "yard", planner: false },
  underAttack: false,
  raidOpen: false,
  ...extra,
});

beforeEach(() => {
  redis.clear();
  at(NOW);
});

afterEach(() => setSystemTime());

describe("reading aiattacks", () => {
  test("nothing stored reads as a fresh schedule", () => {
    for (const raw of [null, undefined, {}, "junk", []]) {
      expect(readSchedule(raw)).toEqual({
        v: 2,
        lastattack: 0,
        sessionsSinceLastAttack: 0,
        attackPreference: 0,
        recent: [],
      });
    }
  });

  test("a Flash-era value keeps its numbers, loses its queued raid and keeps the Trojan's s1", () => {
    // `WMATTACK.as:255`, Flash's own example, with `nextAttack` written as Flash did (with a fraction).
    const flash = {
      sessionsSinceLastAttack: 45,
      attackPreference: 0,
      queued: { attack: { C10: 27, C7: 13 }, warned: 1, degrees: 180, attackTime: 1284677486 },
      lastattack: 1284676962,
      nextAttack: 1284612571.734,
      s1: [1, 1284676962, 1],
    };
    expect(readSchedule(flash)).toEqual({
      v: 2,
      lastattack: 1284676962,
      nextAttack: 1284612571,
      sessionsSinceLastAttack: 45,
      attackPreference: 0,
      recent: [],
      s1: [1, 1284676962, 1],
    });
  });

  test("numeric strings, out-of-range preferences and negative counts are tidied", () => {
    const schedule = readSchedule({ lastattack: "1703676451", sessionsSinceLastAttack: -3, attackPreference: 7 });
    expect(schedule.lastattack).toBe(1703676451);
    expect(schedule.sessionsSinceLastAttack).toBe(0);
    expect(schedule.attackPreference).toBe(1);
    expect(readSchedule({ attackPreference: "-1" }).attackPreference).toBe(-1);
  });

  test("recent keeps well-formed entries, newest 10", () => {
    const entries = Array.from({ length: 12 }, (_, i) => ({ id: `r_${i}`, at: i, tribe: "Kozu", health: 1, stolen: { r1: "5" }, shiny: 10 }));
    const schedule = readSchedule({ recent: [{ nope: 1 }, ...entries] });
    expect(schedule.recent).toHaveLength(RECENT_RAIDS_KEPT);
    expect(schedule.recent[0]).toEqual({ id: "r_0", at: 0, tribe: "Kozu", health: 1, stolen: { r1: 5 }, shiny: 10 });
  });
});

describe("Flash's timing", () => {
  test("each session adds one", () => {
    const schedule = readSchedule({ lastattack: NOW - DAY, nextAttack: NOW + DAY, sessionsSinceLastAttack: 2 });
    expect(startSession(schedule, NOW)).toMatchObject({ sessionsSinceLastAttack: 3, nextAttack: NOW + DAY });
  });

  test("the first raid ever is due 60 seconds into the session", () => {
    expect(startSession(readSchedule({}), NOW).nextAttack).toBe(NOW + FIRST_RAID_DELAY_SECONDS);
  });

  test("a last raid over 4 days ago makes the next due 60 seconds into the session, renewed each load", () => {
    const old = readSchedule({ lastattack: NOW - LONG_GAP_SECONDS - 1, nextAttack: NOW - DAY, sessionsSinceLastAttack: 9 });
    expect(startSession(old, NOW).nextAttack).toBe(NOW + 60);
    expect(startSession(startSession(old, NOW), NOW + 500).nextAttack).toBe(NOW + 560);
    // Exactly 4 days is not "over".
    const edge = readSchedule({ lastattack: NOW - LONG_GAP_SECONDS, nextAttack: NOW - DAY });
    expect(startSession(edge, NOW).nextAttack).toBe(NOW - DAY);
  });

  test("with no time set, the preference's wait after the last raid", () => {
    const last = NOW - DAY;
    expect(startSession(readSchedule({ lastattack: last, attackPreference: 1 }), NOW).nextAttack).toBe(last + 2 * DAY);
    expect(startSession(readSchedule({ lastattack: last, attackPreference: 0 }), NOW).nextAttack).toBe(last + 3 * DAY);
    expect(startSession(readSchedule({ lastattack: last, attackPreference: -1 }), NOW).nextAttack).toBe(last + 4 * DAY);
  });

  test("more / same / less set 2 / 3 / 4 days after the last raid, with Flash's size and hits", () => {
    const schedule = readSchedule({ lastattack: NOW - DAY, nextAttack: NOW + 5 });
    expect(setRaidFrequency(schedule, 1)).toMatchObject({ attackPreference: 1, nextAttack: NOW + DAY });
    expect(setRaidFrequency(schedule, 0)).toMatchObject({ attackPreference: 0, nextAttack: NOW + 2 * DAY });
    expect(setRaidFrequency(schedule, -1)).toMatchObject({ attackPreference: -1, nextAttack: NOW + 3 * DAY });
    expect(RAID_PREFERENCES).toEqual({
      [-1]: { waitSeconds: 4 * DAY, amplifier: 0.5, hitLimit: 20 },
      0: { waitSeconds: 3 * DAY, amplifier: 1, hitLimit: 30 },
      1: { waitSeconds: 2 * DAY, amplifier: 1.3, hitLimit: 50 },
    });
  });

  test("a preference with no raid yet leaves the time to the 4-day rule", () => {
    expect(setRaidFrequency(readSchedule({ nextAttack: NOW + 60 }), 1)).toMatchObject({ nextAttack: NOW + 60 });
  });

  test("the frequency popup's answers", () => {
    expect([parseRaidPreference("more"), parseRaidPreference("same"), parseRaidPreference("less")]).toEqual([1, 0, -1]);
    expect([parseRaidPreference(1), parseRaidPreference(0), parseRaidPreference(-1)]).toEqual([1, 0, -1]);
    expect([parseRaidPreference("x"), parseRaidPreference(2), parseRaidPreference(undefined)]).toEqual([null, null, null]);
  });

  test("a finished raid restarts the wait from the fight's start and is applied once", () => {
    const before = readSchedule({ lastattack: NOW - 5 * DAY, sessionsSinceLastAttack: 7, attackPreference: 1 });
    const record = { id: "r_a", at: NOW - 100, tribe: "Legionnaire", health: 0.93, stolen: { r1: 40 }, shiny: 10 };
    const after = recordRaidFinished(before, record);
    expect(after).toMatchObject({
      lastattack: NOW - 100,
      nextAttack: NOW - 100 + 2 * DAY,
      sessionsSinceLastAttack: 0,
      attackPreference: 1,
      lastRaidId: "r_a",
      recent: [record],
    });
    expect(raidAlreadyApplied(after, "r_a")).toBe(true);
    expect(raidAlreadyApplied(after, "r_b")).toBe(false);
    // The column round-trips.
    expect(readSchedule(JSON.parse(JSON.stringify(after)))).toEqual(after);
  });
});

describe("the due rule", () => {
  test("due when every gate is open", () => {
    expect(raidDueCheck(dueFacts())).toBeNull();
  });

  test("only a main yard", () => {
    expect(raidDueCheck(dueFacts({ save: dueSave({ type: "outpost" }) }))).toBe("notMainYard");
    expect(raidDueCheck(dueFacts({ save: dueSave({ type: "inferno" }) }))).toBe("notMainYard");
  });

  test("only Map Room 1 or 2", () => {
    expect(raidDueCheck(dueFacts({ save: dueSave({ mapversion: 1 }) }))).toBeNull();
    expect(raidDueCheck(dueFacts({ save: dueSave({ mapversion: 3 }) }))).toBe("mapRoom");
  });

  test("level 9 and up", () => {
    const level8 = String(experiencePoints[8]! - 1);
    expect(raidDueCheck(dueFacts({ save: dueSave({ points: level8 }) }))).toBe("level");
  });

  test("4 sessions since the last raid", () => {
    const save = dueSave();
    const aiattacks = { ...(save.aiattacks as object), sessionsSinceLastAttack: 3 };
    expect(raidDueCheck(dueFacts({ save: { ...save, aiattacks } }))).toBe("sessions");
  });

  test("not before its time; with no time set, the preference's wait after the last raid", () => {
    const save = dueSave();
    const base = save.aiattacks as Record<string, unknown>;
    expect(raidDueCheck(dueFacts({ save: { ...save, aiattacks: { ...base, nextAttack: NOW + 1 } } }))).toBe("notYet");
    expect(raidDueCheck(dueFacts({ save: { ...save, aiattacks: { ...base, nextAttack: NOW } } }))).toBeNull();

    const { nextAttack: _, ...unset } = base;
    expect(raidDueCheck(dueFacts({ save: { ...save, aiattacks: { ...unset, lastattack: NOW - 3 * DAY } } }))).toBeNull();
    expect(raidDueCheck(dueFacts({ save: { ...save, aiattacks: { ...unset, lastattack: NOW - 2 * DAY } } }))).toBe("notYet");
    // Never a raid and no session to set a time: not yet.
    expect(raidDueCheck(dueFacts({ save: { ...save, aiattacks: { ...unset, lastattack: 0 } } }))).toBe("notYet");
  });

  test("nothing damaged or repairing (owner, Q5)", () => {
    const damaged = dueSave({ buildinghealthdata: { "1": 10 } });
    expect(raidDueCheck(dueFacts({ save: damaged }))).toBe("damaged");
    const repairing = dueSave({ buildingdata: { "1": { x: 0, y: 0, t: 14, id: 1, l: 1, hp: 10, rE: 1 } } });
    expect(raidDueCheck(dueFacts({ save: repairing }))).toBe("damaged");
  });

  test("not under attack, and not while a raid is open", () => {
    expect(raidDueCheck(dueFacts({ underAttack: true }))).toBe("underAttack");
    expect(raidDueCheck(dueFacts({ raidOpen: true }))).toBe("raidOpen");
  });

  test("online by #271's rule with the attack load's minute", () => {
    expect(raidDueCheck(dueFacts({ marks: { lastSeen: NOW - 61, lastAction: NOW, challengePending: false } }))).toBe("offline");
    expect(raidDueCheck(dueFacts({ marks: { lastSeen: null, lastAction: NOW, challengePending: false } }))).toBe("offline");
    const idle = { lastSeen: NOW, lastAction: NOW - REAL_ACTION_WINDOW_SECONDS - 1, challengePending: false };
    expect(raidDueCheck(dueFacts({ marks: idle }))).toBe("offline");
    expect(raidDueCheck(dueFacts({ marks: { lastSeen: NOW, lastAction: NOW, challengePending: true } }))).toBe("offline");
  });

  test("only on the yard with the Planner closed; a ping that said nothing never gets one", () => {
    expect(raidDueCheck(dueFacts({ screen: { where: "yard", planner: true } }))).toBe("screen");
    expect(raidDueCheck(dueFacts({ screen: { where: "other", planner: false } }))).toBe("screen");
    expect(raidDueCheck(dueFacts({ screen: null }))).toBe("screen");
  });

  test("protection does not stop a raid (owner, Q6)", () => {
    expect(raidDueCheck(dueFacts({ save: dueSave({ protected: 1, protectedUntil: NOW + DAY }) }))).toBeNull();
  });

  test("raidDueNow reads presence, screen and open raid from Redis", async () => {
    const save = dueSave({ attackid: 0, attacks: [] }) as unknown as InstanceType<typeof Save>;
    expect(await raidDueNow(USER, save, NOW)).toBe("offline");

    await redis.setex(`last-seen:main:${USER}`, 120, String(NOW));
    await redis.setex(`last-action:${USER}`, 600, String(NOW));
    expect(await raidDueNow(USER, save, NOW)).toBe("screen");

    await recordRaidScreen(USER, { where: "yard", planner: false });
    expect(await raidDueNow(USER, save, NOW)).toBeNull();

    await openRaid(USER, { id: "r_1", phase: "warning", tribe: "Kozu", plan: null, seed: 1, attackAt: NOW + 300, warned: 0 }, NOW);
    expect(await raidDueNow(USER, save, NOW)).toBe("raidOpen");

    const attacked = dueSave({ attackid: 9, attacks: [{ starttime: NOW - 10 }] }) as unknown as InstanceType<typeof Save>;
    expect(await raidDueNow(USER, attacked, NOW)).toBe("underAttack");
  });
});

describe("the session count on a yard load", () => {
  const db = { row: null as Record<string, unknown> | null, options: [] as unknown[], flushed: 0 };
  const em = {
    transactional: async <T>(run: (tx: unknown) => Promise<T>) =>
      run({
        findOne: async (_entity: unknown, _where: unknown, options: unknown) => {
          db.options.push(options);
          return db.row;
        },
        flush: async () => {
          db.flushed++;
        },
      }),
  } as unknown as EntityManager;

  beforeEach(() => {
    db.options = [];
    db.flushed = 0;
  });

  test("counts under the row lock and writes a Flash-era value back in the server's shape", async () => {
    db.row = { basesaveid: 7, type: "main", aiattacks: { sessionsSinceLastAttack: 2, lastattack: NOW - DAY, attackPreference: 1, queued: {} } };

    const written = await countRaidSession(em, 7, NOW);

    expect(written).toBe(db.row as never);
    expect(db.options).toEqual([{ lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true }]);
    expect(db.flushed).toBe(1);
    expect(db.row!.aiattacks).toEqual({
      v: 2,
      lastattack: NOW - DAY,
      nextAttack: NOW + DAY,
      sessionsSinceLastAttack: 3,
      attackPreference: 1,
      recent: [],
    });
  });

  test("leaves anything but a main yard alone", async () => {
    db.row = { basesaveid: 8, type: "outpost", aiattacks: {} };
    expect(await countRaidSession(em, 8, NOW)).toBeNull();
    expect(db.flushed).toBe(0);
    expect(db.row.aiattacks).toEqual({});
  });
});

describe("the column", () => {
  test("a client save can never write aiattacks", () => {
    expect(Save.saveKeys).not.toContain("aiattacks");
    expect(Save.attackSaveKeys).not.toContain("aiattacks");
  });
});
