import { describe, expect, test } from "bun:test";

import { MUSHROOM_TYPE } from "../../game-data/buildingFootprints.js";
import { mulberry32 } from "../../game-rules/combat/rng.js";
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
  RETIRE_POSITION,
  SLOW_PACE,
  SPREAD_TOLERANCE,
  targetAt,
  type RebalanceBot,
  tendChampion,
  type BrainSave,
  type GrowthReport,
} from "./brain.js";
import { evenSpread } from "./factory.js";
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
  /** A bot standing at `position` on the climb at `speed`. */
  const botAt = (userid: number, position: number, speed = 1) =>
    bot(userid, Math.floor(position), ((position - Math.floor(position)) * T) / speed, speed);

  test("a bunch spreads out: its furthest-on bots hurry and its newest arrivals linger", () => {
    // Nine bots all on level 2 against three a level.
    const bots = [2.9, 2.8, 2.7, 2.6, 2.5, 2.4, 2.3, 2.2, 2.1].map((position, index) => botAt(index + 1, position));
    const plan = planRebalance(bots, [3, 3, 3], 9, NOW, T);
    const speeds = Object.fromEntries(plan.nudges.map((nudge) => [nudge.userid, nudge.speed]));
    // The first three places belong on level 3, the last three on level 1; the middle stays.
    expect(speeds).toEqual({ 1: FAST_PACE, 2: FAST_PACE, 8: SLOW_PACE, 9: SLOW_PACE });
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

  test("a bot near its spot goes back to the normal pace; one already at the asked pace is left alone", () => {
    // Spots for a share of three: 1.83, 1.5, 1.17.
    const settled = [botAt(1, 1.83), botAt(2, 1.5, SLOW_PACE), botAt(3, 1.17, FAST_PACE)];
    expect(planRebalance(settled, [3], 3, NOW, T).nudges.map((nudge) => [nudge.userid, nudge.speed])).toEqual([
      [2, 1],
      [3, 1],
    ]);
    const bunch = [2.9, 2.8, 2.7, 2.6, 2.5, 2.4, 2.3, 2.2, 2.1].map((position, index) =>
      botAt(index + 1, position, index === 0 ? FAST_PACE : 1)
    );
    expect(planRebalance(bunch, [3, 3, 3], 9, NOW, T).nudges.map((nudge) => nudge.userid)).toEqual([2, 8, 9]);
  });

  test("the total is topped up at level 1, no more than level 1 has room for", () => {
    expect(planRebalance([bot(1, 5, 1)], [3, 3, 3, 3, 3], 15, NOW, T).topUp).toBe(5);
    expect(planRebalance([bot(1, 1, 1), bot(2, 1, 1)], [3, 3], 6, NOW, T).topUp).toBe(3);
    expect(planRebalance([bot(1, 1, 1)], [1], 1, NOW, T).topUp).toBe(0);
  });
});

describe("the even spread over simulated days (issue #251)", () => {
  const TOTAL = 500;
  const PASS = 10 * 60;

  /**
   * The sweep's climb without the yards, in 10-minute passes: each bot grows
   * every 2-6 hours (its level follows its pace, and a new level ends a
   * nudge), one past level 40 retires for a fresh level 1 bot at the bottom
   * of the level, and the rebalance runs on the first pass of each UTC day.
   * It starts as `create --fill` leaves the table: every level at its share,
   * each bot at a random point in its level.
   */
  const simulate = (days: number, seed: number) => {
    const rng = mulberry32(seed);
    const share = evenSpread(TOTAL);
    const bots: (RebalanceBot & { growAt: number })[] = [];
    const make = (level: number, fraction: number, now: number) =>
      bots.push({
        userid: bots.length + 1,
        level,
        level_since: new Date((now - fraction * T * DAY) * 1000),
        speed: 1,
        growAt: now + rng.float() * 60 * 60,
      });
    share.forEach((want, index) => {
      for (let n = 0; n < want; n++) make(index + 1, rng.float(), NOW);
    });

    const daily: number[][] = [];
    let retired = 0;
    for (let now = NOW + PASS; now <= NOW + days * DAY; now += PASS) {
      if (Math.floor(now / DAY) !== Math.floor((now - PASS) / DAY)) {
        const plan = planRebalance(bots, share, TOTAL, now, T);
        for (const nudge of plan.nudges) Object.assign(bots.find((one) => one.userid === nudge.userid)!, nudge);
        for (let n = 0; n < plan.topUp; n++) make(1, 0, now);
        const counts = share.map(() => 0);
        for (const bot of bots) counts[bot.level - 1]!++;
        daily.push(counts);
      }
      for (let index = bots.length - 1; index >= 0; index--) {
        const bot = bots[index]!;
        if (bot.growAt > now) continue;
        const position = pacePosition(bot, now, T, bot.speed);
        if (position >= RETIRE_POSITION) {
          retired++;
          bots.splice(index, 1);
          make(1, 0, now);
          continue;
        }
        const level = Math.floor(position);
        if (level !== bot.level) {
          bot.level_since = anchorFor(position, level, now, T, bot.speed);
          bot.level = level;
          bot.speed = 1;
        }
        bot.growAt = now + (2 + 4 * rng.float()) * 60 * 60;
      }
    }
    return { share, daily, retired, active: bots.length };
  };

  test("500 bots stay within the tolerance of every level's share over two weeks", () => {
    const { share, daily, retired, active } = simulate(14, 1);
    const worstOff = daily.map((counts) => Math.max(...counts.map((have, index) => Math.abs(have - share[index]!))));
    // The fill's random start needs a few rebalances to even out; from the fourth day on it holds.
    expect(Math.max(...worstOff.slice(3))).toBeLessThanOrEqual(SPREAD_TOLERANCE);
    expect(active).toBe(TOTAL);
    // The nudges even out: about 500 / (40 × 3) bots a day still pass level 40.
    expect(retired).toBeGreaterThan(14 * 3.5);
    expect(retired).toBeLessThan(14 * 5);
  });
});
