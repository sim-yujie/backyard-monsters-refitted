import { describe, expect, test } from "bun:test";

import { advanceBuildingTimers } from "../base/advanceBuildingTimers.js";
import { finishBuildingJob } from "../yard/buildingJobs.js";
import { planCancelFortify, planFortify } from "../yard/fortify.js";
import { planCancelUpgrade, planUpgradeAction, type UpgradeActionSave } from "../yard/upgrade.js";
import type { BuildingData } from "../../types/BuildingData.js";
import { FRIEND_GATES, HELP_RULES } from "./helpConfig.js";
import { helpersOf, withoutHelpers } from "./helpList.js";
import {
  gateRefusal,
  helpsLeftOf,
  isRefusal,
  planRepair,
  planSpeedup,
  previewHelp,
  rewardOf,
  type HelpFacts,
  type SpeedupPlan,
} from "./helpRules.js";

/**
 * The help rules (issue #373, `docs/design/friends.md` §4 and §7), pure: the
 * 5% speed-up, the five-helper limit, once per job, the repair, the gates, the
 * reward, the preview, and `hl` cleared wherever a job ends or starts.
 */

const NOW = 1_760_000_000;
const DAY = 24 * 60 * 60;
const CANNON = 20;
const HALL = 14;
const SILO = 6;

const building = (fields: Partial<BuildingData> = {}): BuildingData => ({ id: 7, t: CANNON, x: 0, y: 0, l: 2, ...fields });
const speedup = (b: BuildingData, helper: number) => planSpeedup(b, helper) as SpeedupPlan;

describe("speed-up", () => {
  test("takes floor(5%) of the time left and adds the helper to hl", () => {
    const plan = speedup(building({ cU: 1999 }), 11);
    expect(plan.field).toBe("cU");
    expect(plan.seconds).toBe(99);
    expect(plan.building.cU).toBe(1900);
    expect(plan.building.hl).toEqual([11]);
  });

  test("five helps take 1 - 0.95^5 off, about 23%", () => {
    let b = building({ cB: 100_000 });
    for (const helper of [1, 2, 3, 4, 5]) b = speedup(b, helper).building;
    expect(b.cB).toBe(77_380); // 95,000, 90,250, 85,738, 81,452, 77,380: each cut rounded down
    expect(helpersOf(b)).toEqual([1, 2, 3, 4, 5]);
  });

  test("a sixth helper is refused, and a repeat helper too", () => {
    let b = building({ cF: 10_000 });
    for (const helper of [1, 2, 3, 4, 5]) b = speedup(b, helper).building;
    expect(planSpeedup(b, 6)).toEqual({ reason: "helpersFull" });
    expect(planSpeedup(speedup(building({ cF: 10_000 }), 1).building, 1)).toEqual({ reason: "alreadyHelped" });
  });

  test("build first, then upgrade, then fortify, as Flash's HelpB", () => {
    expect(speedup(building({ cB: 1000, cU: 2000, cF: 3000 }), 1).field).toBe("cB");
    expect(speedup(building({ cU: 2000, cF: 3000 }), 1).field).toBe("cU");
  });

  test("nothing running, or under 20 s left, is nothing to help", () => {
    expect(planSpeedup(building(), 1)).toEqual({ reason: "nothingToHelp" });
    expect(planSpeedup(building({ cU: 19 }), 1)).toEqual({ reason: "nothingToHelp" });
    expect(isRefusal(planSpeedup(building({ cU: 20 }), 1))).toBe(false);
  });

  test("a damaged building's paused countdown can still be helped", () => {
    expect(speedup(building({ cU: 1000, hp: 10, rE: 1 }), 1).seconds).toBe(50);
  });
});

describe("repair", () => {
  test("heals the building to full at once and clears rE; a healthy one is nothing to help", () => {
    const save = {
      type: "main",
      buildingdata: { "7": building({ hp: 10, rE: 1, cU: 500 }), "8": building({ id: 8 }) },
      buildinghealthdata: { "7": 10 },
    };
    const plan = planRepair(save, "7");
    if (isRefusal(plan)) throw new Error("refused");
    expect(plan.buildingdata["7"]).toEqual(building({ cU: 500 }));
    expect(plan.buildinghealthdata).toEqual({});
    expect(planRepair({ ...save, ...plan }, "7")).toEqual({ reason: "nothingToHelp" });
    expect(planRepair(save, "8")).toEqual({ reason: "nothingToHelp" });
    expect(planRepair(save, "99")).toEqual({ reason: "nothingToHelp" });
  });
});

describe("reward", () => {
  test("0.25% of the lower cap, rounded down, in each resource", () => {
    expect(rewardOf(1_000_000, 300_001)).toEqual({ r1: 750, r2: 750, r3: 750, r4: 750 });
    expect(rewardOf(200, 1_000_000)).toEqual({ r1: 0, r2: 0, r3: 0, r4: 0 });
    expect(HELP_RULES.rewardShare * HELP_RULES.dailyHelps).toBeCloseTo(0.05);
  });
});

describe("gates", () => {
  // Level 5 needs 7,500 points (`experiencePoints`); 20,000 is past it.
  const side = (userid: number, fields: Partial<HelpFacts["helper"]> = {}) => ({
    userid,
    banned: false,
    blocked_users: [],
    createtime: NOW - 10 * DAY,
    points: "20000",
    basevalue: "0",
    ...fields,
  });
  const facts = (fields: Partial<HelpFacts> = {}): HelpFacts => ({
    helper: side(1),
    owner: side(2),
    friendsSince: NOW - 2 * DAY,
    helpsToday: 0,
    ...fields,
  });

  test("friends for a day, both accounts 3 days old and level 5, under the cap: allowed", () => {
    expect(gateRefusal(facts(), NOW)).toBeNull();
  });

  test("each refusal, with from when time alone lifts it", () => {
    expect(gateRefusal(facts({ friendsSince: null }), NOW)).toEqual({ reason: "notFriends" });
    expect(gateRefusal(facts({ owner: side(2, { blocked_users: [1] }) }), NOW)).toEqual({ reason: "cannotSend" });
    expect(gateRefusal(facts({ helper: side(1, { blocked_users: [2] }) }), NOW)).toEqual({ reason: "cannotSend" });
    expect(gateRefusal(facts({ owner: side(2, { banned: true }) }), NOW)).toEqual({ reason: "cannotSend" });
    expect(gateRefusal(facts({ friendsSince: NOW - 3600 }), NOW)).toEqual({ reason: "tooNew", from: NOW - 3600 + DAY });
    expect(gateRefusal(facts({ owner: side(2, { createtime: NOW - DAY }) }), NOW)).toEqual({
      reason: "tooNew",
      from: NOW - DAY + FRIEND_GATES.accountAgeDays * DAY,
    });
    expect(gateRefusal(facts({ helper: side(1, { points: "100" }) }), NOW)).toEqual({ reason: "tooNew" });
    expect(gateRefusal(facts({ helpsToday: 20 }), NOW)).toEqual({ reason: "dailyCap" });
    expect(helpsLeftOf(19)).toBe(1);
    expect(helpsLeftOf(25)).toBe(0);
  });
});

describe("preview", () => {
  test("offers running jobs and damage, says why not, and skips a job that ended since the save", () => {
    const save = {
      type: "main",
      savetime: NOW - 100,
      buildingdata: {
        "1": building({ id: 1, cU: 5000 }),
        "2": building({ id: 2, cU: 50 }),
        "3": building({ id: 3, hp: 10 }),
        "4": building({ id: 4, cB: 5000, hl: [9] }),
        "5": building({ id: 5 }),
      },
      buildinghealthdata: { "3": 10 },
    };
    expect(previewHelp(save, 9, NOW, null)).toEqual({
      "1": { speedup: true },
      "3": { repair: true },
      "4": { speedup: "alreadyHelped" },
    });
    expect(previewHelp(save, 9, NOW, { reason: "dailyCap" })).toEqual({
      "1": { speedup: "dailyCap" },
      "3": { repair: "dailyCap" },
      "4": { speedup: "dailyCap" },
    });
  });
});

describe("hl is cleared wherever a job ends or starts", () => {
  const helped = (fields: Partial<BuildingData>) => building({ ...fields, hl: [1, 2] });

  test("withoutHelpers drops it and leaves a building without one as it is", () => {
    const plain = building();
    expect(withoutHelpers(plain)).toBe(plain);
    expect(withoutHelpers(helped({}))).toEqual(plain);
  });

  test("a countdown running out (catch-up, attack save, planner)", () => {
    const after = advanceBuildingTimers({ "1": helped({ id: 1, cU: 10 }), "2": helped({ id: 2, cB: 10 }), "3": helped({ id: 3, cF: 10 }), "4": helped({ id: 4, cU: 99 }) }, {}, 10);
    expect(after["1"]!.hl).toBeUndefined();
    expect(after["2"]!.hl).toBeUndefined();
    expect(after["3"]!.hl).toBeUndefined();
    expect(after["4"]!.hl).toEqual([1, 2]);
  });

  test("finished with Shiny or by an instant upgrade", () => {
    expect(finishBuildingJob(helped({ cU: 500 }), "cU", NOW).building.hl).toBeUndefined();
  });

  const yard = (b: BuildingData): UpgradeActionSave => ({
    buildingdata: { "0": { id: 0, t: HALL, x: 0, y: 0, l: 10 }, "3": { id: 3, t: SILO, x: 0, y: 0, l: 10 }, "7": b },
    buildinghealthdata: {},
    resources: { r1: 1e9, r2: 1e9, r3: 1e9, r4: 1e9 },
    storedata: {},
  });

  test("an upgrade or fortify cancelled", () => {
    expect(planCancelUpgrade(yard(helped({ cU: 500, cL: 900 })), 7).slices.buildingdata["7"]!.hl).toBeUndefined();
    expect(planCancelFortify(yard(helped({ cF: 500 })), 7).slices.buildingdata["7"]!.hl).toBeUndefined();
  });

  test("a new upgrade or fortify started on a building with a stale list", () => {
    expect(planUpgradeAction(yard(helped({})), 7, NOW).slices.buildingdata["7"]!.hl).toBeUndefined();
    expect((planFortify(yard(helped({ l: 6 })), 7, NOW).slices.buildingdata["7"] as BuildingData).hl).toBeUndefined();
  });
});
