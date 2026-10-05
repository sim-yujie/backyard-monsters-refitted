import { afterEach, describe, expect, test } from "bun:test";
import type { EntityManager } from "@mikro-orm/core";
import { achievementConfig } from "../../config/AchievementConfig.js";
import { Maproom } from "../../database/models/maproom.model.js";
import type { Save } from "../../database/models/save.model.js";
import { kozu, legionnaire } from "../../game-data/tribes/v1/index.js";
import {
  achievementBatches,
  addEvents,
  builtEvents,
  placedFinishedEvents,
  recordAchievements,
  settleAchievements,
  unseenAchievements,
} from "./record.js";
import { readAchievements, type Achievements } from "./state.js";

/**
 * The yard's side of achievements (issue #204, WP2): event counts from
 * finished jobs, the payout switch, the bell rows, what the answers carry,
 * and `recordAchievements` against a stand-in entity manager that records
 * every read and insert.
 */

const NOW = 1_791_200_000;
const startingRewards = achievementConfig.rewards;

afterEach(() => {
  achievementConfig.rewards = startingRewards;
});

/** A record already backfilled, with these unlocks. */
const recordOf = (c: Achievements["c"] = {}, s: Partial<Achievements["s"]> = {}): Achievements => {
  const record = readAchievements({ achievements: { s, c, backfilledAt: NOW - 100 } });
  return record;
};

describe("builtEvents", () => {
  test("one per build job of a Block or Heavy Trap; upgrades and other types are not builds", () => {
    expect(
      builtEvents([
        { kind: "build", t: 17 },
        { kind: "build", t: 17 },
        { kind: "build", t: 117 },
        { kind: "upgrade", t: 17 },
        { kind: "build", t: 20 },
        { kind: "unlock", t: "C2" },
      ])
    ).toEqual({ blocksbuilt: 2, heavytraps: 1 });
  });

  test("nothing for no jobs; a placed Block or Heavy Trap is one build", () => {
    expect(builtEvents([])).toEqual({});
    expect(placedFinishedEvents(17)).toEqual({ blocksbuilt: 1 });
    expect(placedFinishedEvents(117)).toEqual({ heavytraps: 1 });
    expect(placedFinishedEvents(20)).toEqual({});
  });

  test("addEvents sums the sets and drops what is not a positive count", () => {
    expect(addEvents({ blocksbuilt: 2 }, undefined, { blocksbuilt: 1, starterkit: 1, heavytraps: -3 })).toEqual({
      blocksbuilt: 3,
      starterkit: 1,
    });
  });
});

describe("settleAchievements", () => {
  const owed = () =>
    recordOf({
      "1": { at: NOW - 50, shiny: 5, unpaid: 1, backfill: 1 },
      "6": { at: NOW - 50, shiny: 10, unpaid: 1, backfill: 1 },
      "13": { at: NOW - 10, shiny: 5, unpaid: 1 },
      "17": { at: NOW - 200, shiny: 5 },
    });

  test("with rewards off nothing is paid and the record is as it was", () => {
    const record = owed();
    const settled = settleAchievements(record, false);

    expect(settled).toEqual({ record, paid: [], shiny: 0 });
  });

  test("with rewards on every owed unlock is paid once, oldest first; the input is untouched", () => {
    const record = owed();
    const settled = settleAchievements(record, true);

    expect(settled.shiny).toBe(20);
    expect(settled.paid).toEqual([
      { id: 1, name: "Moving Up", shiny: 5, backfill: true },
      { id: 6, name: "Brave New World", shiny: 10, backfill: true },
      { id: 13, name: "Instant Outpost", shiny: 5 },
    ]);
    expect(Object.values(settled.record.c).some((unlock) => unlock.unpaid)).toBe(false);
    expect(record.c["13"]!.unpaid).toBe(1);

    expect(settleAchievements(settled.record, true)).toMatchObject({ paid: [], shiny: 0 });
  });
});

describe("achievementBatches", () => {
  test("the backfill's unlocks share one row; every other unlock has its own", () => {
    const batches = achievementBatches(
      [
        { id: 1, name: "Moving Up", shiny: 5, backfill: true },
        { id: 13, name: "Instant Outpost", shiny: 5 },
        { id: 6, name: "Brave New World", shiny: 10, backfill: true },
        { id: 17, name: "New Recruit", shiny: 5 },
      ],
      NOW
    );

    expect(batches.map((batch) => batch.map((job) => job.id))).toEqual([[1, 6], [13], [17]]);
    expect(batches[0]![0]).toEqual({
      kind: "achievement",
      id: 1,
      t: null,
      at: NOW,
      detail: { name: "Moving Up", shiny: 5, backfill: true },
    });
    expect(batches[1]![0]!.detail).toEqual({ name: "Instant Outpost", shiny: 5 });
  });

  test("no rows for nothing paid", () => {
    expect(achievementBatches([], NOW)).toEqual([]);
  });
});

describe("unseenAchievements", () => {
  test("paid unlocks not yet seen, oldest first; owed and seen ones left out", () => {
    const record = recordOf({
      "17": { at: NOW - 10, shiny: 5 },
      "1": { at: NOW - 50, shiny: 5, backfill: 1 },
      "6": { at: NOW - 50, shiny: 10, seen: 1 },
      "13": { at: NOW - 5, shiny: 5, unpaid: 1 },
    });

    expect(unseenAchievements({ achievements: record })).toEqual([
      { id: 1, name: "Moving Up", shiny: 5, backfill: true },
      { id: 17, name: "New Recruit", shiny: 5 },
    ]);
  });

  test("nothing for a record never worked out", () => {
    expect(unseenAchievements({ achievements: null })).toEqual([]);
  });
});

/** A stand-in entity manager: canned rows, every call recorded. */
const standIn = (rows: { outposts?: Partial<Save>[]; maproom?: Partial<Maproom> | null } = {}) => {
  const calls = {
    find: [] as unknown[],
    findOptions: [] as unknown[],
    findOne: [] as unknown[],
    inserted: [] as Record<string, unknown>[],
    pruned: 0,
  };
  const em = {
    async find(_entity: unknown, where: { baseid: { $in: string[] } }, options?: unknown) {
      calls.find.push(where);
      calls.findOptions.push(options);
      return (rows.outposts ?? []).filter((row) => where.baseid.$in.includes(String(row.baseid)));
    },
    async findOne(entity: unknown, where: unknown) {
      calls.findOne.push({ entity, where });
      return entity === Maproom ? (rows.maproom ?? null) : null;
    },
    async insertMany(_entity: unknown, data: Record<string, unknown>[]) {
      calls.inserted.push(...data);
    },
    async nativeDelete() {
      calls.pruned++;
    },
    getConnection: () => ({ execute: async () => [] }),
  };
  return { em: em as unknown as EntityManager, calls };
};

/** A main save: Town Hall level 3 (unlocks "Moving Up"), 100 Shiny. */
const mainOf = (overrides: Partial<Save> = {}): Save =>
  ({
    basesaveid: 7,
    baseid: "700",
    userid: 2503,
    type: "main",
    credits: 100,
    buildingdata: { "1": { id: 1, t: 14, X: 0, Y: 0, l: 3 } },
    champion: [],
    lockerdata: {},
    resources: { r1: 0, r2: 0, r3: 0, r4: 0 },
    outposts: [],
    wmstatus: [],
    onboarding: null,
    achievements: null,
    ...overrides,
  }) as unknown as Save;

const stored = (save: Save) => readAchievements(save);

describe("recordAchievements", () => {
  test("rewards off: the backfill unlocks owed, nothing paid, no bell line, nothing to show", async () => {
    achievementConfig.rewards = false;
    const main = mainOf();
    const { em, calls } = standIn();

    const result = await recordAchievements(em, main, NOW);

    expect(result.unlocked).toEqual([{ id: 1, name: "Moving Up", shiny: 5, backfill: true }]);
    expect(result.paid).toEqual([]);
    expect(stored(main).c).toEqual({ "1": { at: NOW, shiny: 5, backfill: 1, unpaid: 1 } });
    expect(stored(main).backfilledAt).toBe(NOW);
    expect(main.credits).toBe(100);
    expect(calls.inserted).toEqual([]);
    expect(unseenAchievements(main)).toEqual([]);
  });

  test("rewards turned on later: what was owed is paid once, with one bell row", async () => {
    achievementConfig.rewards = false;
    const main = mainOf();
    const { em, calls } = standIn();
    await recordAchievements(em, main, NOW);

    achievementConfig.rewards = true;
    const result = await recordAchievements(em, main, NOW + 60);

    expect(result.unlocked).toEqual([]);
    expect(result.paid).toEqual([{ id: 1, name: "Moving Up", shiny: 5, backfill: true }]);
    expect(main.credits).toBe(105);
    expect(stored(main).c["1"]).toEqual({ at: NOW, shiny: 5, backfill: 1 });
    expect(calls.inserted).toHaveLength(1);
    expect(calls.inserted[0]).toMatchObject({
      userid: 2503,
      baseid: null,
      kind: "achievement",
      jobs: [{ kind: "achievement", id: 1, detail: { name: "Moving Up", shiny: 5, backfill: true } }],
    });
    expect(unseenAchievements(main)).toEqual([{ id: 1, name: "Moving Up", shiny: 5, backfill: true }]);

    await recordAchievements(em, main, NOW + 120);
    expect(main.credits).toBe(105);
    expect(calls.inserted).toHaveLength(1);
  });

  test("rewards on: an event's unlock is paid at once, in its own bell row", async () => {
    achievementConfig.rewards = true;
    const main = mainOf({ achievements: recordOf({ "1": { at: NOW - 100, shiny: 5, seen: 1 } }) as never });
    const { em, calls } = standIn();

    const result = await recordAchievements(em, main, NOW, { starterkit: 1 });

    expect(result.paid).toEqual([{ id: 13, name: "Instant Outpost", shiny: 5 }]);
    expect(main.credits).toBe(105);
    expect(stored(main).s.starterkit).toBe(1);
    expect(calls.inserted).toHaveLength(1);
    expect(calls.inserted[0]!.jobs).toEqual([
      { kind: "achievement", id: 13, t: null, at: NOW, detail: { name: "Instant Outpost", shiny: 5 } },
    ]);
    // A backfilled record reads nothing from other rows.
    expect(calls.find).toEqual([]);
    expect(calls.findOne).toEqual([]);
  });

  test("an unchanged record is not written again", async () => {
    const main = mainOf();
    const { em } = standIn();
    await recordAchievements(em, main, NOW);
    const written = main.achievements;

    await recordAchievements(em, main, NOW + 60);

    expect(main.achievements).toBe(written);
  });

  test("events add after the backfill: each Block and Heavy Trap build counts", async () => {
    const main = mainOf({ achievements: recordOf({}, { blocksbuilt: 198, heavytraps: 7 }) as never });
    const { em } = standIn();

    const result = await recordAchievements(em, main, NOW, { blocksbuilt: 2, heavytraps: 1 });

    expect(stored(main).s).toMatchObject({ blocksbuilt: 200, heavytraps: 8 });
    expect(result.unlocked.map((unlock) => unlock.id).sort((a, b) => a - b)).toEqual([1, 12, 16]);
  });

  test("the backfill counts Blocks in every outpost: the acted-on one as it stands, the rest as stored", async () => {
    const block = (id: number) => ({ id, t: 17, X: id * 10, Y: 0, l: 1 });
    const blocks = (count: number) =>
      Object.fromEntries(Array.from({ length: count }, (_, i) => [String(i + 10), block(i + 10)])) as unknown as Save["buildingdata"];
    const main = mainOf({
      buildingdata: { "1": { id: 1, t: 14, X: 0, Y: 0, l: 3 }, ...blocks(2) } as unknown as Save["buildingdata"],
      outposts: [
        [1, 1, "900"],
        [2, 2, "901"],
      ],
    });
    const current = { baseid: "900", buildingdata: blocks(3) } as unknown as Save;
    const { em, calls } = standIn({
      outposts: [
        { baseid: "900", buildingdata: {} },
        { baseid: "901", buildingdata: blocks(4) },
      ],
    });

    await recordAchievements(em, main, NOW, { blocksbuilt: 1 }, current);

    expect(calls.find).toEqual([{ baseid: { $in: ["901"] }, userid: 2503, type: "outpost" }]);
    // Only the column the backfill counts, not the whole outpost row.
    expect(calls.findOptions).toEqual([{ fields: ["buildingdata"] }]);
    // 2 + 3 + 4 standing; the event's Block is already one of them.
    expect(stored(main).s.blocksbuilt).toBe(9);
    // An outpost owned: most first outposts are camps (§8).
    expect(stored(main).s.wmoutpost).toBe(1);
  });

  test("the backfill reads Map Room 1 Kozu records only when wmstatus shows one destroyed; the record decides", async () => {
    const kozuBase = Number(Object.values(kozu)[0]!.baseid);
    const legionBase = Number(Object.values(legionnaire)[0]!.baseid);

    const quiet = standIn({ maproom: { tribedata: [{ baseid: String(kozuBase), destroyed: 1 }] } as never });
    await recordAchievements(quiet.em, mainOf({ wmstatus: [[legionBase, 0, 1]] }), NOW);
    expect(quiet.calls.findOne).toEqual([]);

    const hinted = mainOf({ wmstatus: [[kozuBase, 0, 1]] });
    const confirmed = standIn({ maproom: { tribedata: [{ baseid: String(kozuBase), destroyed: 1 }] } as never });
    await recordAchievements(confirmed.em, hinted, NOW);
    expect(confirmed.calls.findOne).toEqual([{ entity: Maproom, where: { userid: 2503 } }]);
    expect(stored(hinted).s.wm2hall).toBe(1);
    expect(stored(hinted).c["10"]).toMatchObject({ backfill: 1 });

    const forged = mainOf({ wmstatus: [[kozuBase, 0, 1]] });
    const respawned = standIn({ maproom: { tribedata: [{ baseid: String(kozuBase) }] } as never });
    await recordAchievements(respawned.em, forged, NOW);
    expect(stored(forged).s.wm2hall).toBe(0);
  });
});
