import { describe, expect, test } from "bun:test";
import { RAID_THREAT_MAX, RAID_THREAT_START_CAP, RAID_THREAT_STEPS } from "../../config/RaidThreatConfig.js";
import { MOLOCH_TRIBE } from "../inferno/emergenceRaid.js";
import {
  readSchedule,
  recordEmergenceFinished,
  recordRaidFinished,
  recordTrojanFinished,
  TROJAN_TRIBE,
  type RaidRecord,
} from "./raidSchedule.js";
import { clampThreat, raidThreatStep, startThreat, THREAT_FREE_TRIBES, threatAfter } from "./raidThreat.js";

/** Beta 10: the raid threat (owner, 27 Nov 2026). */

const record = (over: Partial<RaidRecord>): RaidRecord => ({
  id: "r_1",
  at: 1000,
  tribe: "Kozu",
  health: 1,
  stolen: {},
  shiny: 0,
  ...over,
});

describe("the threat table", () => {
  test("threat 0 is the raid before beta 10", () => {
    expect(RAID_THREAT_STEPS[0]).toEqual({
      size: 1,
      sides: 1,
      drops: 1,
      dropGapSeconds: 0,
      vorgShare: 0,
      zafreetiShare: 0,
      championLevel: 0,
      championPower: 0,
      retreatSeconds: 0,
      strength: 1,
    });
  });

  test("every row is sane and the steps never shrink the raid", () => {
    let last = RAID_THREAT_STEPS[0]!;
    for (const step of RAID_THREAT_STEPS) {
      expect(step.sides).toBeGreaterThanOrEqual(1);
      expect(step.sides).toBeLessThanOrEqual(4);
      expect(step.drops).toBeGreaterThanOrEqual(1);
      expect(step.championLevel).toBeGreaterThanOrEqual(0);
      expect(step.championLevel).toBeLessThanOrEqual(6);
      expect(step.championPower).toBeGreaterThanOrEqual(0);
      expect(step.championPower).toBeLessThanOrEqual(3);
      expect(step.size).toBeGreaterThanOrEqual(last.size);
      expect(step.sides).toBeGreaterThanOrEqual(last.sides);
      if (step.drops > 1) expect(step.dropGapSeconds).toBeGreaterThan(0);
      last = step;
    }
    expect(RAID_THREAT_MAX).toBe(RAID_THREAT_STEPS.length - 1);
  });

  test("the owner's steps (desk b10-numbers, 27 Nov 2026)", () => {
    const at = (threat: number) => RAID_THREAT_STEPS[threat]!;
    expect(RAID_THREAT_MAX).toBe(20);
    // +10% monsters on every odd step, x2.0 at 19 and the top.
    for (let threat = 0; threat <= RAID_THREAT_MAX; threat += 1) {
      expect(at(threat).size).toBeCloseTo(1 + 0.1 * Math.ceil(threat / 2), 9);
    }
    expect(at(19).size).toBe(2);
    // Timed drops: 2 from 2, 4 from 14, 5 from 18.
    expect([0, 1, 2, 13, 14, 17, 18, 20].map((threat) => at(threat).drops)).toEqual([1, 1, 2, 2, 4, 4, 5, 5]);
    // Sides: 2 from 4, 3 from 8, 4 from 12.
    expect([3, 4, 7, 8, 11, 12, 20].map((threat) => at(threat).sides)).toEqual([1, 2, 2, 3, 3, 4, 4]);
    // Vorgs (5%) from 6, Zafreetis (2%) from 8.
    expect([5, 6, 20].map((threat) => at(threat).vorgShare)).toEqual([0, 0.05, 0.05]);
    expect([7, 8, 20].map((threat) => at(threat).zafreetiShare)).toEqual([0, 0.02, 0.02]);
    // One champion from 10 at level 1, rising to 6 at 19.
    expect(RAID_THREAT_STEPS.map((step) => step.championLevel)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6]);
    expect(RAID_THREAT_STEPS.every((step) => step.championPower === 0)).toBe(true);
    // Raiders go home 3 minutes after the last group from threat 1.
    expect(RAID_THREAT_STEPS.slice(1).every((step) => step.retreatSeconds === 180)).toBe(true);
  });

  test("a threat past the table reads its last row", () => {
    expect(raidThreatStep(RAID_THREAT_MAX + 50)).toBe(RAID_THREAT_STEPS[RAID_THREAT_MAX]!);
    expect(raidThreatStep(-3)).toBe(RAID_THREAT_STEPS[0]!);
  });
});

describe("moving the threat", () => {
  test("a good defence raises it, a poor one lowers it, both held to the table", () => {
    expect(threatAfter(3, true)).toBe(4);
    expect(threatAfter(3, false)).toBe(2);
    expect(threatAfter(0, false)).toBe(0);
    expect(threatAfter(RAID_THREAT_MAX, true)).toBe(RAID_THREAT_MAX);
    expect(clampThreat(Number.NaN)).toBe(0);
    expect(clampThreat(2.7)).toBe(2);
  });

  test("the Trojan Horse and Moloch never count", () => {
    expect(THREAT_FREE_TRIBES.has(TROJAN_TRIBE)).toBe(true);
    expect(THREAT_FREE_TRIBES.has(MOLOCH_TRIBE)).toBe(true);
  });

  test("a landed wild raid moves it one step by its defence", () => {
    const schedule = readSchedule({ threat: 5 });
    expect(recordRaidFinished(schedule, record({ defended: true, shiny: 10 })).threat).toBe(6);
    expect(recordRaidFinished(schedule, record({ defended: false })).threat).toBe(4);
    // A record from before `defended` reads its Shiny.
    expect(recordRaidFinished(schedule, record({ shiny: 10 })).threat).toBe(6);
  });

  test("a Trojan Horse or Moloch raid leaves it, however well defended", () => {
    const schedule = readSchedule({ threat: 5 });
    const good = record({ defended: true });
    expect(recordTrojanFinished(schedule, { ...good, tribe: TROJAN_TRIBE }, 2000).threat).toBe(5);
    expect(recordEmergenceFinished(schedule, { ...good, tribe: MOLOCH_TRIBE }).threat).toBe(5);
  });

  test("a cancelled raid never lands, so the schedule keeps its threat", () => {
    // Cancels never reach `recordRaidFinished` (raidFlow's cancel paths drop the raid only);
    // reading the schedule again keeps what was stored.
    expect(readSchedule({ threat: 7, recent: [] }).threat).toBe(7);
  });
});

describe("the launch threat", () => {
  test("a schedule with no threat starts at its 90%+ wild defences in recent", () => {
    const recent = [
      record({ id: "a", defended: true, shiny: 10 }),
      record({ id: "b", defended: false }),
      record({ id: "c", shiny: 10 }), // before `defended`: Shiny says good
      record({ id: "d", shiny: 0 }),
      record({ id: "e", defended: true, tribe: TROJAN_TRIBE }),
      record({ id: "f", defended: true, tribe: MOLOCH_TRIBE }),
      record({ id: "g", defended: true, tribe: "Dreadnaut" }),
    ];
    expect(startThreat(recent)).toBe(3);
    expect(readSchedule({ recent }).threat).toBe(3);
  });

  test("a stored threat wins over recent, and is held to the table", () => {
    const recent = [record({ defended: true })];
    expect(readSchedule({ threat: 0, recent }).threat).toBe(0);
    expect(readSchedule({ threat: 999, recent }).threat).toBe(RAID_THREAT_MAX);
    expect(readSchedule({ threat: "4", recent }).threat).toBe(4);
  });

  test("ten good defences start at the launch cap, 6, and a good defence still raises it", () => {
    const recent = Array.from({ length: 12 }, (_, at) => record({ id: `r${at}`, defended: true }));
    expect(RAID_THREAT_START_CAP).toBe(6);
    const schedule = readSchedule({ recent });
    expect(schedule.threat).toBe(6);
    expect(recordRaidFinished(schedule, record({ defended: true, shiny: 10 })).threat).toBe(7);
  });

  test("six good defences start at 6, five at 5", () => {
    const good = (count: number) => Array.from({ length: count }, (_, at) => record({ id: `g${at}`, defended: true }));
    expect(startThreat(good(6))).toBe(6);
    expect(startThreat(good(5))).toBe(5);
  });
});
