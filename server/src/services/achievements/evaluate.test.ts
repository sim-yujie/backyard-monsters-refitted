import { describe, expect, test } from "bun:test";
import { ACHIEVEMENTS, AVAILABLE_ACHIEVEMENTS, type AchievementStat } from "../../game-data/achievements.js";
import type { BuildingData, BuildingDataMap } from "../../types/BuildingData.js";
import {
  achievementMet,
  backfillAchievements,
  backfillStats,
  deriveStats,
  evaluateAchievements,
  type AchievementView,
} from "./evaluate.js";
import { emptyStats, readAchievements, type Achievements } from "./state.js";

/**
 * The pure evaluator and backfill (`docs/design/achievements.md` §7, §8, §12,
 * issue #204 WP1).
 */

const NOW = 1_791_200_000;
const THEN = 1_791_100_000;

/** A record already backfilled, with these stats. */
const worked = (stats: Partial<Record<AchievementStat, number>> = {}, c: Achievements["c"] = {}): Achievements => ({
  v: 1,
  s: { ...emptyStats(), ...stats },
  c,
  backfilledAt: THEN,
});

const building = (t: number, l = 1, extra: Partial<BuildingData> = {}): BuildingData => ({
  x: 0,
  y: 0,
  t,
  id: 0,
  l,
  ...extra,
});
/** A yard of these buildings, numbered from 1. */
const yard = (...buildings: BuildingData[]): BuildingDataMap =>
  Object.fromEntries(buildings.map((b, i) => [String(i + 1), { ...b, id: i + 1 }]));

const TOWN_HALL = 14;
const MAP_ROOM = 11;
const BLOCK = 17;
const HEAVY_TRAP = 117;

const ids = (evaluation: { unlocked: { id: number }[] }) => evaluation.unlocked.map((unlock) => unlock.id);

describe("evaluateAchievements: the rules", () => {
  test("every available entry unlocks at its target and not one below", () => {
    for (const entry of AVAILABLE_ACHIEVEMENTS) {
      const at = Object.fromEntries(entry.rules.map((rule) => [rule.stat, rule.target]));
      const below = Object.fromEntries(entry.rules.map((rule) => [rule.stat, rule.target - 1]));

      expect(ids(evaluateAchievements(worked(at), {}, NOW))).toContain(entry.id);
      expect(ids(evaluateAchievements(worked(below), {}, NOW))).not.toContain(entry.id);
    }
  });

  test("entry 4 needs any one champion, entry 5 all three", () => {
    const one = evaluateAchievements(worked({ upgrade_champ3: 1 }), {}, NOW);
    expect(ids(one)).toEqual([4]);

    const all = evaluateAchievements(worked({ upgrade_champ1: 1, upgrade_champ2: 1, upgrade_champ3: 1 }), {}, NOW);
    expect(ids(all)).toEqual([4, 5]);
  });

  test("unavailable entries never unlock, whatever the stats", () => {
    const evaluation = evaluateAchievements(
      worked({ hugerage: 9, alliance: 1, descent: 14, underhall: 5, infernoquests: 10 }),
      {},
      NOW
    );
    expect(evaluation.unlocked).toEqual([]);
    expect(evaluation.shiny).toBe(0);
  });

  test("everything met pays the 16 shown achievements, 220 Shiny, once", () => {
    const all = Object.fromEntries(
      ACHIEVEMENTS.flatMap((entry) => entry.rules.map((rule) => [rule.stat, 10_000]))
    );
    const first = evaluateAchievements(worked(all), {}, NOW);

    expect(first.unlocked).toHaveLength(16);
    expect(first.shiny).toBe(220);
    expect(first.unlocked.every((unlock) => unlock.backfill === undefined)).toBe(true);
    expect(first.record.c["22"]).toEqual({ at: NOW, shiny: 25 });

    const second = evaluateAchievements(first.record, {}, NOW + 60);
    expect(second.unlocked).toEqual([]);
    expect(second.shiny).toBe(0);
    expect(second.changed).toBe(false);
    expect(second.record).toEqual(first.record);
  });

  test("an entry already in c is never paid again, even one the catalogue gave more for", () => {
    const record = worked({ thlevel: 2 }, { "1": { at: THEN, shiny: 0, seen: 1 } });
    const evaluation = evaluateAchievements(record, {}, NOW);

    expect(evaluation.unlocked).toEqual([]);
    expect(evaluation.record.c["1"]).toEqual({ at: THEN, shiny: 0, seen: 1 });
  });

  test("stats never drop: a smaller Town Hall or fewer resources take nothing back", () => {
    const record = worked({ thlevel: 8, stockpile: 1 });
    const evaluation = evaluateAchievements(record, { buildingdata: yard(building(TOWN_HALL, 3)) }, NOW);

    expect(evaluation.record.s.thlevel).toBe(8);
    expect(evaluation.record.s.stockpile).toBe(1);
  });

  test("the input record is never mutated", () => {
    const record = worked({ thlevel: 1 });
    const before = structuredClone(record);
    evaluateAchievements(record, { buildingdata: yard(building(TOWN_HALL, 5)) }, NOW, { blocksbuilt: 3 });
    expect(record).toEqual(before);
  });

  test("achievementMet reads the rule against the stats", () => {
    const entry = ACHIEVEMENTS.find((e) => e.id === 8)!;
    expect(achievementMet(entry, { ...emptyStats(), playeroutpost: 4 })).toBe(false);
    expect(achievementMet(entry, { ...emptyStats(), playeroutpost: 5 })).toBe(true);
  });
});

describe("evaluateAchievements: derived stats", () => {
  test("Town Hall: the main yard's finished level", () => {
    const evaluation = evaluateAchievements(worked(), { buildingdata: yard(building(TOWN_HALL, 5)) }, NOW);
    expect(evaluation.record.s.thlevel).toBe(5);
    expect(ids(evaluation)).toEqual([1, 2]);
    expect(evaluation.shiny).toBe(15);

    // A hall still being built is level 0.
    const building0 = deriveStats({ buildingdata: yard(building(TOWN_HALL, 1, { cB: 100 })) });
    expect(building0.thlevel).toBe(0);
  });

  test("Map Room 2: a level 2 Map Room, or a save on Map Room 2 or 3", () => {
    expect(deriveStats({ buildingdata: yard(building(MAP_ROOM, 1)) }).map2).toBe(0);
    expect(deriveStats({ buildingdata: yard(building(MAP_ROOM, 2)) }).map2).toBe(1);
    expect(deriveStats({ mapversion: 1 }).map2).toBe(0);
    expect(deriveStats({ mapversion: 2 }).map2).toBe(1);
    expect(deriveStats({ mapversion: 3 }).map2).toBe(1);
  });

  test("champions: Gorgo, Drull and Fomor at level 6, frozen ones included", () => {
    const stats = deriveStats({
      champion: [
        { t: 1, l: 6, status: 1 },
        { t: 2, l: 5 },
        { t: 3, l: 6 },
        { t: 4, l: 6 },
      ],
    });
    expect(stats.upgrade_champ1).toBe(1);
    expect(stats.upgrade_champ2).toBe(0);
    expect(stats.upgrade_champ3).toBe(1);
    expect(deriveStats({ champion: "nonsense" }).upgrade_champ1).toBe(0);
  });

  test("Locker: any monster unlocked but the free Pokey", () => {
    expect(deriveStats({ lockerdata: { C1: { t: 2 } } }).unlock_monster).toBe(0);
    expect(deriveStats({ lockerdata: { C1: { t: 2 }, C2: { t: 1, s: 1, e: 2 } } }).unlock_monster).toBe(0);
    expect(deriveStats({ lockerdata: { C1: { t: 2 }, C2: { t: 2 } } }).unlock_monster).toBe(1);
  });

  test("stockpile: more than 25,000,000 of all four at once", () => {
    const over = { r1: 25_000_001, r2: 25_000_001, r3: 25_000_001, r4: 25_000_001 };
    expect(deriveStats({ resources: over }).stockpile).toBe(1);
    expect(deriveStats({ resources: { ...over, r3: 25_000_000 } }).stockpile).toBe(0);
    expect(deriveStats({ resources: { r1: 30_000_000 } }).stockpile).toBe(0);
  });

  test("juiced and Kozu come from onboarding's server counters", () => {
    const onboarding = { v: 1, guide: { state: "done" }, counters: { juiced: 5000, tribes: { kozu: 1 } } };
    const evaluation = evaluateAchievements(worked(), { onboarding }, NOW);

    expect(evaluation.record.s.monstersblended).toBe(5000);
    expect(evaluation.record.s.wm2hall).toBe(1);
    expect(ids(evaluation)).toEqual([10, 11]);
  });
});

describe("evaluateAchievements: events", () => {
  test("event stats add up across calls", () => {
    let record = worked({ blocksbuilt: 198 });
    let evaluation = evaluateAchievements(record, {}, NOW, { blocksbuilt: 1 });
    expect(evaluation.unlocked).toEqual([]);
    expect(evaluation.changed).toBe(true);

    record = evaluation.record;
    evaluation = evaluateAchievements(record, {}, NOW, { blocksbuilt: 1, playeroutpost: 1, starterkit: 1 });
    expect(evaluation.record.s).toMatchObject({ blocksbuilt: 200, playeroutpost: 1, starterkit: 1 });
    expect(ids(evaluation)).toEqual([12, 13]);
  });

  test("nonsense deltas are ignored", () => {
    const evaluation = evaluateAchievements(worked({ heavytraps: 3 }), {}, NOW, {
      heavytraps: -5,
      blocksbuilt: Number.NaN,
      wmoutpost: 0,
      playeroutpost: 1.9,
    });
    expect(evaluation.record.s).toMatchObject({ heavytraps: 3, blocksbuilt: 0, wmoutpost: 0, playeroutpost: 1 });
  });
});

describe("the backfill (§8)", () => {
  /** A main save that proves a lot. */
  const veteran: AchievementView = {
    buildingdata: yard(
      building(TOWN_HALL, 8),
      building(MAP_ROOM, 2),
      building(BLOCK, 3),
      building(BLOCK, 1),
      building(BLOCK, 1, { cB: 50 }),
      building(HEAVY_TRAP, 1)
    ),
    champion: [{ t: 2, l: 6 }],
    lockerdata: { C1: { t: 2 }, C5: { t: 2 } },
    resources: { r1: 1, r2: 1, r3: 1, r4: 1 },
    mapversion: 2,
    outposts: [[10, 10, "abc"]],
    onboarding: { v: 1, guide: { state: "legacy" }, counters: { juiced: 40 } },
    outpostBuildings: [yard(building(BLOCK, 1), building(HEAVY_TRAP, 1)), null],
    mr1KozuDestroyed: true,
  };

  test("a NULL record is worked out once: what the save proves unlocks, marked backfill", () => {
    const evaluation = evaluateAchievements(readAchievements({ achievements: null }), veteran, NOW);

    // Town Hall 2, 5, 8; one champion; Map Room 2; a camp; Kozu; a Locker unlock.
    expect(ids(evaluation)).toEqual([1, 2, 3, 4, 6, 7, 10, 17]);
    expect(evaluation.unlocked.every((unlock) => unlock.backfill === true)).toBe(true);
    expect(evaluation.shiny).toBe(5 + 10 + 15 + 15 + 10 + 10 + 10 + 5);
    expect(evaluation.record.backfilledAt).toBe(NOW);
    expect(evaluation.record.c["6"]).toEqual({ at: NOW, shiny: 10, backfill: 1 });
    // Standing Blocks and Heavy Traps, main yard and outposts, finished only: a lower bound.
    expect(evaluation.record.s).toMatchObject({ blocksbuilt: 3, heavytraps: 2, monstersblended: 40, wmoutpost: 1 });
    // No trace of these.
    expect(evaluation.record.s).toMatchObject({ playeroutpost: 0, starterkit: 0 });

    // It runs once.
    const again = evaluateAchievements(evaluation.record, veteran, NOW + 1);
    expect(again.unlocked).toEqual([]);
    expect(again.record.backfilledAt).toBe(NOW);
  });

  test("a fresh account unlocks nothing, but the backfill is marked done", () => {
    const fresh: AchievementView = {
      buildingdata: yard(building(TOWN_HALL, 1)),
      lockerdata: { C1: { t: 2 } },
      resources: { r1: 1000, r2: 1000, r3: 0, r4: 0 },
      outposts: [],
      onboarding: { v: 1, guide: { state: "pending" } },
    };
    const evaluation = evaluateAchievements(readAchievements({}), fresh, NOW);

    expect(evaluation.unlocked).toEqual([]);
    expect(evaluation.shiny).toBe(0);
    expect(evaluation.changed).toBe(true);
    expect(evaluation.record.backfilledAt).toBe(NOW);
  });

  test("Flash-era blobs the client wrote are never read, even when they claim everything", () => {
    const forged = {
      buildingdata: yard(building(TOWN_HALL, 1)),
      stats: { achievements: { s: { thlevel: 10, monstersblended: 9999 }, c: { 1: 1, 22: 1 } } },
      quests: { UG1: 1, UG2: 1, UG3: 1, WM2: 1, _global: { monstersblended: 9999 } },
      wmstatus: [[1, 2, 3]],
      achieved: [1, 2, 3],
    } as AchievementView;
    const evaluation = evaluateAchievements(readAchievements({}), forged, NOW);

    expect(evaluation.unlocked).toEqual([]);
    expect(evaluation.record.s.thlevel).toBe(1);
    expect(evaluation.record.s.monstersblended).toBe(0);
  });

  test("an event in the backfill run is not counted twice; an unlock only it brings is an ordinary one", () => {
    // The Block that just finished is one of the 199 standing.
    const blocks = yard(...Array.from({ length: 199 }, () => building(BLOCK, 1)));
    const evaluation = evaluateAchievements(readAchievements({}), { buildingdata: blocks }, NOW, {
      blocksbuilt: 1,
      starterkit: 1,
    });

    expect(evaluation.record.s.blocksbuilt).toBe(199);
    expect(evaluation.unlocked).toEqual([{ id: 13, name: "Instant Outpost", shiny: 5 }]);
    expect(evaluation.record.c["13"]).toEqual({ at: NOW, shiny: 5 });
  });

  test("after the backfill the same event adds", () => {
    const blocks = yard(...Array.from({ length: 199 }, () => building(BLOCK, 1)));
    const first = evaluateAchievements(readAchievements({}), { buildingdata: blocks }, NOW);
    const next = evaluateAchievements(first.record, { buildingdata: blocks }, NOW + 1, { blocksbuilt: 1 });

    expect(next.record.s.blocksbuilt).toBe(200);
    expect(next.unlocked).toEqual([{ id: 12, name: "Great Wall", shiny: 10 }]);
  });

  test("backfillStats reads only what the backfill may", () => {
    expect(backfillStats({})).toEqual({ blocksbuilt: 0, heavytraps: 0, wmoutpost: 0, wm2hall: 0 });
  });

  test("backfillAchievements works out a NULL record for the public view without a record", () => {
    const evaluation = backfillAchievements(veteran, NOW);
    expect(ids(evaluation)).toEqual([1, 2, 3, 4, 6, 7, 10, 17]);
    expect(evaluation.record.backfilledAt).toBe(NOW);
  });
});
