import { describe, expect, test } from "bun:test";

import { MUSHROOM_TYPE } from "../../game-data/buildingFootprints.js";
import type { BuildingData, BuildingDataMap } from "../../types/BuildingData.js";
import { storageCap } from "../base/economy/resourceBudget.js";
import { calculateBaseLevel } from "../base/calculateBaseLevel.js";
import { BUNKER_TYPE } from "../yard/bunker.js";
import { catchUpYard } from "../yard/catchUp.js";
import { housingCapacity, housingUsedBy } from "../yard/housing.js";
import { rectOf } from "../yardplanner/layoutGeometry.js";
import { levelOf } from "../yardplanner/costs.js";
import {
  anchorFor,
  applyGrowth,
  FAST_PACE,
  holdLootInBand,
  pacePosition,
  planRebalance,
  rearmFiredTraps,
  refillArmy,
  SLOW_PACE,
  targetAt,
  tendChampion,
  type BrainSave,
  type GrowthReport,
} from "./brain.js";
import { TRAP_TYPES } from "./layout.js";
import { levelBand, type Persona } from "./progression.js";
import { generateBotYard, LOOT_BAND, type BotYard } from "./yardGenerator.js";

/** The bot brain's pure decisions (issue #240, `docs/design/bot-neighbours.md` §4.4-§4.6). */

const NOW = 1_800_000_000;
const DAY = 24 * 60 * 60;
const T = 3;

const yardFor = (seed: number, persona: Persona, position: number, now = NOW): BotYard =>
  generateBotYard({ seed, persona, targetPoints: targetAt(position), now });

/** A bot's save as the factory writes it from a generated yard (`botSaveData`). */
const saveOf = (yard: BotYard, now = NOW): BrainSave & { savetime: number } => ({
  type: "main",
  savetime: now,
  points: yard.points,
  basevalue: yard.basevalue,
  buildingdata: Object.fromEntries(
    [...yard.buildings, ...yard.decorations].map((building) => [String(building.id), { ...building }])
  ) as unknown as BuildingDataMap,
  buildinghealthdata: {},
  storedata: { ...yard.storedata },
  mushrooms: { l: [], s: now },
  resources: { ...yard.resources },
  monsters: { housed: { ...yard.monsters.housed } },
  lockerdata: { ...yard.lockerdata },
  academy: structuredClone(yard.academy),
  champion: yard.champion.map((champion) => ({ ...champion })),
  firedtraps: [],
});

const grown = (result: ReturnType<typeof applyGrowth>): GrowthReport => {
  if ("refused" in result) throw new Error(`refused: ${JSON.stringify(result.refused)}`);
  return result;
};

/** Every building id with its type, level and spot, as a finished yard holds it. */
const shape = (buildingdata: BuildingDataMap | null | undefined) =>
  Object.values(buildingdata ?? {})
    .map((building) => ({
      id: Number(building.id),
      t: Number(building.t),
      l: levelOf(building),
      X: Number(building.X),
      Y: Number(building.Y),
    }))
    .sort((a, b) => a.id - b.id);

const wantedShape = (yard: BotYard) =>
  [
    ...yard.buildings.map(({ id, t, l, X, Y }) => ({ id, t, l, X, Y })),
    // A decoration has no level; it reads as 1, as a finished building with no `l` does.
    ...yard.decorations.map(({ id, t, X, Y }) => ({ id, t, l: 1, X, Y })),
  ].sort((a, b) => a.id - b.id);

describe("the pace", () => {
  test("a bot climbs one level every T days, from the bottom of its band to the top", () => {
    const bot = { level: 12, level_since: new Date((NOW - DAY) * 1000) };
    expect(pacePosition(bot, NOW, T)).toBeCloseTo(12 + 1 / 3, 9);
    expect(pacePosition(bot, NOW + 2 * DAY, T)).toBeCloseTo(13, 9);
    // A nudged pace counts the same days faster or slower.
    expect(pacePosition(bot, NOW, T, 1.5)).toBeCloseTo(12.5, 9);

    const band = levelBand(12);
    expect(targetAt(12)).toBe(band.min);
    expect(targetAt(12.5)).toBe(Math.floor(band.min + (band.max - band.min) * 0.5));
  });

  test("a new anchor keeps the bot where it stands on the climb", () => {
    const bot = { level: 12, level_since: new Date((NOW - 4 * DAY) * 1000) };
    const position = pacePosition(bot, NOW, T);
    const anchored = { level: 13, level_since: anchorFor(position, 13, NOW, T) };
    expect(pacePosition(anchored, NOW, T)).toBeCloseTo(position, 6);

    const nudged = { level: 13, level_since: anchorFor(position, 13, NOW, T, SLOW_PACE) };
    expect(pacePosition(nudged, NOW, T, SLOW_PACE)).toBeCloseTo(position, 6);
    // Never in the future, even for a bot behind its level.
    expect(anchorFor(12.5, 13, NOW, T).getTime()).toBe(NOW * 1000);
  });
});

describe("growth (§4.4)", () => {
  const cases: [number, Persona, number, number][] = [
    [1101, "economy", 3.2, 6.7],
    [2202, "towers", 14.5, 15.4],
    [3303, "army", 22.1, 24.9],
    [4404, "towers", 36.3, 38.8],
  ];

  test.each(cases)("seed %i (%s) from %d to %d: the generator's yard, the last step left running", (seed, persona, from, to) => {
    const before = yardFor(seed, persona, from);
    const after = yardFor(seed, persona, to);
    const save = saveOf(before);
    const report = grown(applyGrowth(save, after, 3 * 60 * 60));

    expect(report.built.length + report.upgraded.length).toBeGreaterThan(0);
    expect(report.running).not.toBeNull();
    const running = save.buildingdata![String(report.running)]!;
    const countdown = Number(running.cU ?? running.cB);
    expect(countdown).toBeGreaterThan(0);
    expect(countdown).toBeLessThanOrEqual(3 * 60 * 60);
    expect(Number(running.cL)).toBe(countdown);

    // Once the countdown has run out the yard is the generator's, points and all.
    catchUpYard(save as Parameters<typeof catchUpYard>[0], NOW + 4 * 60 * 60);
    expect(shape(save.buildingdata)).toEqual(wantedShape(after));
    expect(save.points).toBe(after.points);
    expect(calculateBaseLevel(save.points!, after.basevalue)).toBe(after.level);
    expect(after.level).toBe(Math.floor(to));
  });

  test("a yard already at its target is left alone", () => {
    const yard = yardFor(77, "army", 18.4);
    const save = saveOf(yard);
    const before = structuredClone(save);
    expect(grown(applyGrowth(save, yard, 3600))).toEqual({ built: [], upgraded: [], running: null, points: 0, picked: 0 });
    expect(save).toEqual(before);
  });

  test("a mushroom on a new spot is picked; one elsewhere stays", () => {
    const before = yardFor(5150, "economy", 9.1);
    const after = yardFor(5150, "economy", 11.9);
    const save = saveOf(before);
    const liveIds = new Set(before.buildings.map((building) => building.id));
    const fresh = after.buildings.find((building) => !liveIds.has(building.id))!;
    // A mushroom right on the new building's spot, and one in a far corner.
    save.mushrooms = { l: [[2, fresh.X, fresh.Y], [3, 9_000, 9_000]], s: NOW };

    const report = grown(applyGrowth(save, after, 3600));
    expect(report.picked).toBe(1);
    expect(report.built).toContain(fresh.id);
    expect(save.mushrooms).toEqual({ l: [[3, 9_000, 9_000]], s: NOW });
    expect(rectOf(MUSHROOM_TYPE, 9_000, 9_000)).toBeDefined();
  });

  test("anything else in the way refuses the growth and changes nothing", () => {
    const before = yardFor(6262, "towers", 9.1);
    const after = yardFor(6262, "towers", 11.9);
    const save = saveOf(before);
    const liveIds = new Set(before.buildings.map((building) => building.id));
    const fresh = after.buildings.find((building) => !liveIds.has(building.id))!;
    save.buildingdata = {
      ...save.buildingdata,
      "999": { id: 999, t: 28, X: fresh.X, Y: fresh.Y } as unknown as BuildingData,
    };
    const untouched = structuredClone(save);

    const result = applyGrowth(save, after, 3600);
    expect("refused" in result && result.refused.id).toBe(fresh.id);
    expect(save).toEqual(untouched);
  });

  test("a building the yard holds as another type refuses the growth", () => {
    const before = yardFor(7373, "army", 9.1);
    const after = yardFor(7373, "army", 11.9);
    const save = saveOf(before);
    const [id, building] = Object.entries(save.buildingdata!).find(([, one]) => one.t !== 14)!;
    save.buildingdata![id] = { ...building, t: 999 } as BuildingData;
    expect(applyGrowth(save, after, 3600)).toMatchObject({ refused: { problem: { placement: "typeMismatch" } } });
  });

  test("a step still running from the last grow is finished by the next one, its points counted once", () => {
    const first = yardFor(8484, "economy", 20.2);
    const second = yardFor(8484, "economy", 20.9);
    const third = yardFor(8484, "economy", 21.6);
    const save = saveOf(first);
    grown(applyGrowth(save, second, 3600));
    // The next grow comes before the countdown has run out.
    grown(applyGrowth(save, third, 3600));
    catchUpYard(save as Parameters<typeof catchUpYard>[0], NOW + 2 * 3600);
    expect(shape(save.buildingdata)).toEqual(wantedShape(third));
    expect(save.points).toBe(third.points);
  });
});

describe("refills (§4.5, §4.6)", () => {
  test("an emptied bunker and Housing go back to the generator's; a full enough one is kept", () => {
    const yard = yardFor(9595, "army", 36.5);
    const save = saveOf(yard);
    const bunkers = Object.entries(save.buildingdata!).filter(([, building]) => building.t === BUNKER_TYPE);
    expect(bunkers.length).toBeGreaterThan(1);
    const [[emptied], [kept]] = bunkers;
    save.buildingdata![emptied!] = { ...save.buildingdata![emptied!]!, m: {} };
    const keptBefore = save.buildingdata![kept!]!.m;
    save.monsters = { housed: {} };

    const refilled = refillArmy(save, yard);
    expect(refilled).toEqual({ bunkers: 1, housing: true });
    const generated = yard.buildings.find((building) => String(building.id) === emptied)!;
    expect(save.buildingdata![emptied!]!.m).toEqual(generated.m);
    expect(save.buildingdata![kept!]!.m).toEqual(keptBefore);
    expect(save.monsters!.housed).toEqual(yard.monsters.housed);
  });

  test("the army is cut to a Housing that is still upgrading", () => {
    const yard = yardFor(1212, "army", 26.3);
    const save = saveOf(yard);
    const housingKey = Object.keys(save.buildingdata!).find((key) => save.buildingdata![key]!.t === 15)!;
    save.buildingdata![housingKey] = { ...save.buildingdata![housingKey]!, l: 1 };
    save.monsters = { housed: {} };
    refillArmy(save, yard);
    const levels = Object.fromEntries(Object.entries(yard.academy).map(([id, { level }]) => [id, level]));
    const room = housingCapacity({ buildingdata: save.buildingdata }, false);
    expect(housingUsedBy(save.monsters!.housed, levels)).toBeLessThanOrEqual(room);
  });

  test("loot outside its band moves inside it; loot inside stays", () => {
    const yard = yardFor(3434, "economy", 17.5);
    const save = saveOf(yard);
    const cap = storageCap(save);
    save.resources = { ...save.resources, r1: 0, r2: cap, r3: Math.floor(cap * 0.5) };
    const moved = holdLootInBand(save, () => 0.5);
    expect(moved).toEqual(expect.arrayContaining(["r1", "r2"]));
    expect(moved).not.toContain("r3");
    for (const key of ["r1", "r2", "r3", "r4"]) {
      expect(save.resources![key]).toBeGreaterThanOrEqual(Math.floor(cap * LOOT_BAND.min));
      expect(save.resources![key]).toBeLessThanOrEqual(cap * LOOT_BAND.max);
      expect(save.resources![`${key}max`]).toBe(cap);
    }
    expect(save.resources!.r3).toBe(Math.floor(cap * 0.5));
  });

  test("a trap that went off is put back under its own id, its stale health gone", () => {
    const yard = yardFor(5656, "towers", 30.5);
    const save = saveOf(yard);
    const trap = yard.buildings.find((building) => TRAP_TYPES.has(building.t))!;
    delete save.buildingdata![String(trap.id)];
    save.buildinghealthdata = { [String(trap.id)]: 0 };
    save.firedtraps = [
      { t: trap.t, X: trap.X, Y: trap.Y, at: NOW - 60 },
      { t: trap.t, X: -9_999, Y: -9_999, at: NOW - 30 },
    ];

    expect(rearmFiredTraps(save, yard)).toBe(1);
    expect(save.buildingdata![String(trap.id)]).toEqual({ id: trap.id, t: trap.t, X: trap.X, Y: trap.Y, l: trap.l } as never);
    expect(save.buildinghealthdata).toEqual({});
    expect(save.firedtraps).toEqual([{ t: trap.t, X: -9_999, Y: -9_999, at: NOW - 30 }]);
  });

  test("the champion is fed and levelled with the bot; a repair heals it", () => {
    const yard = yardFor(7878, "army", 30.5, NOW + DAY);
    const save = saveOf(yardFor(7878, "army", 30.5));
    const want = yard.champion[0]!;
    save.champion = [{ ...save.champion![0]!, l: 1, hp: 1, ft: NOW - DAY }];

    tendChampion(save, yard, false);
    expect(save.champion![0]).toMatchObject({ l: want.l, ft: want.ft, hp: want.hp });

    save.champion = [{ ...save.champion![0]!, hp: 5 }];
    tendChampion(save, yard, false);
    expect(save.champion![0]!.hp).toBe(5);
    tendChampion(save, yard, true);
    expect(save.champion![0]!.hp).toBe(want.hp);
  });
});

describe("the daily rebalance (§4.4)", () => {
  const since = (daysAgo: number) => new Date((NOW - daysAgo * DAY) * 1000);
  const bot = (userid: number, level: number, daysAgo: number, speed = 1) => ({
    userid,
    level,
    level_since: since(daysAgo),
    speed,
  });

  test("a crowded level slows its newest arrivals; a thin one speeds up the bots next to arrive", () => {
    const share = [3, 3, 3, 3];
    const bots = [
      // Level 1: 3, its share.
      bot(1, 1, 1), bot(2, 1, 2), bot(3, 1, 0.5),
      // Level 2: 7, four over: the four newest are slowed.
      bot(10, 2, 2.9), bot(11, 2, 2.5), bot(12, 2, 0.1), bot(13, 2, 0.2), bot(14, 2, 0.3), bot(15, 2, 0.4), bot(16, 2, 2.0),
      // Level 3: 3. Level 4: none, three short: the furthest-on of level 3 hurry.
      bot(20, 3, 2.8), bot(21, 3, 1), bot(22, 3, 0.2),
    ];
    const plan = planRebalance(bots, share, 13, NOW, T);
    const speeds = Object.fromEntries(plan.nudges.map((nudge) => [nudge.userid, nudge.speed]));
    expect(speeds).toEqual({
      12: SLOW_PACE,
      13: SLOW_PACE,
      14: SLOW_PACE,
      15: SLOW_PACE,
      20: FAST_PACE,
      21: FAST_PACE,
      22: FAST_PACE,
    });
    // Each keeps its place on the climb.
    for (const nudge of plan.nudges) {
      const before = bots.find((one) => one.userid === nudge.userid)!;
      expect(pacePosition({ level: before.level, level_since: nudge.level_since }, NOW, T, nudge.speed)).toBeCloseTo(
        pacePosition(before, NOW, T),
        6
      );
    }
    expect(plan.topUp).toBe(0);
  });

  test("a bot already at the asked pace is left alone, and a level within the slack is not touched", () => {
    const bots = [bot(1, 1, 1), bot(2, 1, 0.5, SLOW_PACE), bot(3, 1, 0.1, SLOW_PACE)];
    // Two over a share of one: within the slack.
    expect(planRebalance(bots, [1], 3, NOW, T).nudges).toEqual([]);
    // Three over a share of none: the three newest, two of them slowed already.
    expect(planRebalance(bots, [0], 3, NOW, T).nudges.map((nudge) => nudge.userid)).toEqual([1]);
  });

  test("the total is topped up at level 1, no more than level 1 has room for", () => {
    expect(planRebalance([bot(1, 5, 1)], [3, 3, 3, 3, 3], 15, NOW, T).topUp).toBe(5);
    expect(planRebalance([bot(1, 1, 1), bot(2, 1, 1)], [3, 3], 6, NOW, T).topUp).toBe(3);
    expect(planRebalance([bot(1, 1, 1)], [1], 1, NOW, T).topUp).toBe(0);
  });
});
