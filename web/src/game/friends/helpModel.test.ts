import { describe, expect, it } from "vitest";
import type { HelpBlock, HelpResult } from "@/api/friends";
import type { YardBuilding, YardCountdown } from "@/game/yard/yardModel";
import {
  afterHelp,
  afterRefusal,
  buildingHelp,
  fromVisitSave,
  HELP_ALL_REPAIRS,
  helpAllCount,
  helpAllCountText,
  helpAllTargets,
  helpMarksOf,
  helperBadgeOf,
  helperBadgeText,
  isHelpOpen,
  savedText,
  savingTag,
  tagSeconds,
  helpableIds,
  helpersOf,
  helpersText,
  helpRefusalText,
  repairText,
  rewardText,
  speedupSeconds,
  speedupText,
  thanksText,
  timeLeft,
} from "./helpModel";

const NOW = 1_800_000_000;

const building = (over: { countdown?: YardCountdown | null; hl?: number[]; name?: string } = {}): YardBuilding =>
  ({
    id: 7,
    type: 6,
    name: over.name ?? "Storage Silo",
    level: 3,
    countdown: over.countdown ?? null,
    raw: { id: 7, t: 6, ...(over.hl && { hl: over.hl }) },
  }) as unknown as YardBuilding;

const upgrading = (left: number, paused = false): YardCountdown => ({
  kind: "upgrade",
  endsAt: NOW + left,
  seconds: left,
  paused,
});

const block: HelpBlock = {
  buildings: {
    "7": { speedup: true },
    "8": { repair: true },
    "9": { speedup: "alreadyHelped", repair: true },
    "10": { speedup: "helpersFull" },
  },
};

describe("the help block, per building (#374)", () => {
  it("puts a wrench on every building with a help allowed, and none on refused ones", () => {
    expect([...helpableIds(block)].sort((a, b) => a - b)).toEqual([7, 8, 9]);
    expect(helpableIds(null).size).toBe(0);
  });

  it("reads each kind as allowed or refused with words", () => {
    expect(buildingHelp(block, 7)).toEqual({ speedup: { allowed: true } });
    expect(buildingHelp(block, 9)).toEqual({
      speedup: { allowed: false, reason: "alreadyHelped", text: "You have already sped up this job." },
      repair: { allowed: true },
    });
    expect(buildingHelp(block, 99)).toBeNull();
    expect(buildingHelp(null, 7)).toBeNull();
  });

  it("words every refusal plainly, and an unknown one generally", () => {
    for (const reason of ["tooNew", "nothingToHelp", "alreadyHelped", "helpersFull", "underAttack", "notFriends", "cannotSend", "self"]) {
      expect(helpRefusalText(reason)).toMatch(/^[A-Z0-9].*[.!]$/);
    }
    expect(helpRefusalText("somethingNew")).toBe("That can't be done right now.");
  });
});

describe("the words (#372, #374)", () => {
  it("says what a speed-up takes off: 5% of the time left now, rounded down", () => {
    expect(speedupSeconds(7_800)).toBe(390);
    expect(speedupSeconds(19)).toBe(0);
    expect(timeLeft(building({ countdown: upgrading(7_800) }), NOW + 100)).toBe(7_700);
    // Paused (the building is damaged): the time left stands still.
    expect(timeLeft(building({ countdown: upgrading(7_800, true) }), NOW + 100)).toBe(7_800);
    expect(speedupText(building({ countdown: upgrading(7_800) }), NOW)).toBe(
      "Takes 6m 30s off the Storage Silo upgrade (5% of the time left).",
    );
    expect(speedupText(building(), NOW)).toBe("Speeds up the Storage Silo by 5% of the time left.");
  });

  it("counts the helpers so far", () => {
    expect(helpersOf(building({ hl: [1, 2, 3] }))).toBe(3);
    expect(helpersOf(building())).toBe(0);
    expect(helpersText(3)).toBe("3 of 5 friends have helped");
    expect(helpersText(1)).toBe("1 of 5 friends has helped");
  });

  it("says what a repair does", () => {
    expect(repairText(building({ name: "Cannon Tower" }))).toBe("Repairs this Cannon Tower now.");
  });

  it("says the reward as one amount when every resource got the same", () => {
    expect(rewardText({ r1: 1250, r2: 1250, r3: 1250, r4: 1250 })).toBe("1,250 of each resource");
    expect(rewardText({ r1: 10, r3: 5 })).toBe("10 Twigs, 5 Putty");
    expect(rewardText({})).toBe("");
  });

  it("thanks the helper with what was saved and earned", () => {
    const sped: HelpResult = { secondsSaved: 390, reward: { r1: 25, r2: 25, r3: 25, r4: 25 }, rewardsLeft: 3, building: null };
    expect(thanksText("speedup", sped, "Bob", "Storage Silo")).toBe(
      "Thanks for helping! You took 6m 30s off Bob's Storage Silo. You earned 25 of each resource.",
    );
    const fixed: HelpResult = { healed: true, reward: {}, rewardsLeft: 3, building: null };
    expect(thanksText("repair", fixed, "Bob", "Cannon Tower")).toBe("Thanks for helping! You repaired Bob's Cannon Tower.");
    // A help after the day's 5 rewarded ones: the server pays all zeros, and nothing is said of earning.
    const unpaid: HelpResult = { secondsSaved: 390, reward: { r1: 0, r2: 0, r3: 0, r4: 0 }, rewardsLeft: 0, building: null };
    expect(thanksText("speedup", unpaid, "Bob", "Storage Silo")).toBe("Thanks for helping! You took 6m 30s off Bob's Storage Silo.");
  });
});

describe("the block after a help (#374)", () => {
  it("a speed-up leaves that job helped by the player", () => {
    const next = afterHelp(block, 7, "speedup", 4);
    expect(next).not.toHaveProperty("helpsLeft");
    expect(next.rewardsLeft).toBe(4);
    expect(next.buildings["7"]).toEqual({ speedup: "alreadyHelped" });
    expect(helpableIds(next).has(7)).toBe(false);
  });

  it("a repair leaves nothing to repair", () => {
    const next = afterHelp(block, 8, "repair", 4);
    expect(next.buildings["8"]).toBeUndefined();
    expect(afterHelp(block, 9, "repair", 4).buildings["9"]).toEqual({ speedup: "alreadyHelped" });
  });

  it("however many helps were given, every other open offer stays open (no daily cap)", () => {
    let next = block;
    for (let i = 0; i < 25; i++) next = afterHelp(next, 7, "speedup", 0);
    expect([...helpableIds(next)].sort((a, b) => a - b)).toEqual([8, 9]);
    expect(next.buildings["8"]).toEqual({ repair: true });
    expect(next.buildings["10"]).toEqual({ speedup: "helpersFull" });
  });

  it("once today's rewarded helps are used up, the help still goes and says the reward is used up", () => {
    expect(buildingHelp(block, 8)).toEqual({ repair: { allowed: true } });
    expect(buildingHelp({ ...block, rewardsLeft: 1 }, 8)).toEqual({ repair: { allowed: true } });
    const spent = afterHelp(block, 7, "speedup", 0);
    expect(buildingHelp(spent, 8)).toEqual({ repair: { allowed: true }, rewardUsedUp: true });
  });

  it("a refusal stands on that kind of that building", () => {
    const next = afterRefusal(block, 7, "speedup", "helpersFull");
    expect(next.buildings["7"]).toEqual({ speedup: "helpersFull" });
    expect(next.gate).toBeUndefined();
    expect(afterRefusal(block, 99, "speedup", "helpersFull")).toBe(block);
  });

  it("a tooNew refusal keeps its gate, so the panel says which and when", () => {
    const next = afterRefusal(block, 7, "speedup", "tooNew", { from: NOW + 3 * 3600, rule: "friendship" });
    expect(next.gate).toEqual({ reason: "tooNew", from: NOW + 3 * 3600, rule: "friendship" });
    expect(buildingHelp(next, 7, NOW)?.speedup).toEqual({
      allowed: false,
      reason: "tooNew",
      text: "Opens in 3h 0m (friends for 12 hours first).",
    });
  });

  it("tooNew says the gate the help block names", () => {
    const gated = (gate: HelpBlock["gate"]): HelpBlock => ({ buildings: { "7": { speedup: "tooNew" } }, ...(gate && { gate }) });
    const text = (gate: HelpBlock["gate"]) => (buildingHelp(gated(gate), 7, NOW)?.speedup as { text: string }).text;
    expect(text({ reason: "tooNew", from: NOW + 5 * 3600 + 60, rule: "friendship" })).toBe("Opens in 5h 1m (friends for 12 hours first).");
    expect(text({ reason: "tooNew", rule: "level" })).toBe("Not yet: each player must be level 5.");
    expect(text(undefined)).toBe("Not yet: friends for 12 hours and each player level 5.");
    expect(helpRefusalText("tooNew", { from: NOW + 90, rule: "friendship" }, NOW)).toBe("Opens in 1m 30s (friends for 12 hours first).");
  });
});

describe("the building a help answers with (#374)", () => {
  it("counts a running countdown from the visit's savetime, not the server's now", () => {
    // Loaded 2,611 s ago; the server says 4,930 s are left now.
    const raw = { X: 0, Y: 0, t: 6, id: 45, cU: 4_930, hl: [3] };
    expect(fromVisitSave(raw, 2_611.6, false)).toEqual({ X: 0, Y: 0, t: 6, id: 45, cU: 7_541, hl: [3] });
    expect(raw.cU).toBe(4_930);
  });

  it("leaves a frozen countdown and a building with no job as they are", () => {
    expect(fromVisitSave({ X: 0, Y: 0, t: 6, id: 45, cU: 4_930 }, 600, true)).toEqual({ X: 0, Y: 0, t: 6, id: 45, cU: 4_930 });
    expect(fromVisitSave({ X: 0, Y: 0, t: 6, id: 45 }, 600, false)).toEqual({ X: 0, Y: 0, t: 6, id: 45 });
  });
});

describe("the visit's marks and Help all (beta 8)", () => {
  const block: HelpBlock = {
    rewardsLeft: 5,
    buildings: {
      "7": { speedup: true },
      "3": { speedup: true, repair: true },
      "9": { repair: true },
      "4": { speedup: "alreadyHelped" },
      "5": { speedup: "helpersFull", repair: true },
    },
  };

  it("Help all and its count are speed-ups only (owner, 15 Nov 2026)", () => {
    expect(HELP_ALL_REPAIRS).toBe(false);
    expect(helpAllTargets(block)).toEqual([
      { id: 3, kind: "speedup" },
      { id: 7, kind: "speedup" },
    ]);
    expect(helpAllCount(block)).toBe(2);
    expect(helpAllCountText(2)).toBe("2 to speed up");
    expect(helpAllCount(null)).toBe(0);
  });

  it("with repairs on, a building taking both counts once and gets both, speed-up first", () => {
    expect(helpAllTargets(block, true)).toEqual([
      { id: 3, kind: "speedup" },
      { id: 3, kind: "repair" },
      { id: 5, kind: "repair" },
      { id: 7, kind: "speedup" },
      { id: 9, kind: "repair" },
    ]);
    expect(helpAllCount(block, true)).toBe(4);
  });

  it("drops a building from the count once helped", () => {
    expect(helpAllCount(afterHelp(block, 7, "speedup", 4))).toBe(1);
    expect(isHelpOpen(afterHelp(block, 7, "speedup", 4), { id: 7, kind: "speedup" })).toBe(false);
    expect(isHelpOpen(block, { id: 3, kind: "repair" })).toBe(true);
  });

  it("marks a speed-up big with its saving, a repair only small with none", () => {
    const silo = { ...building({ countdown: upgrading(21_600) }), id: 7 } as YardBuilding;
    const both = { ...building({ countdown: upgrading(10, true) }), id: 3 } as YardBuilding;
    const hurt = { ...building(), id: 9 } as YardBuilding;
    const helped = { ...building({ countdown: upgrading(600) }), id: 4 } as YardBuilding;
    expect(helpMarksOf(block, [silo, both, hurt, helped], NOW)).toEqual([
      { id: 7, kind: "speedup", saving: 1080 },
      // 5% of 10 s is under a second: no tag.
      { id: 3, kind: "speedup", saving: null },
      { id: 9, kind: "repair", saving: null },
    ]);
  });

  it("tags a saving in its largest unit", () => {
    expect(savingTag(1080)).toBe("-18m");
    expect(savingTag(1110)).toBe("-18m");
    expect(savingTag(40)).toBe("-40s");
    expect(savingTag(7500)).toBe("-2h 5m");
    expect(savingTag(7200)).toBe("-2h");
    expect(savingTag(97_200)).toBe("-1d 3h");
  });

  it("cuts seconds to what the tag shows, and says a total with every unit", () => {
    expect(tagSeconds(9539)).toBe(9480);
    expect(savingTag(tagSeconds(9539))).toBe(savingTag(9539));
    expect(tagSeconds(40.7)).toBe(40);
    expect(tagSeconds(97_250)).toBe(97_200);
    expect(savedText(96_600)).toBe("1d 2h 50m");
    expect(savedText(7200)).toBe("2h");
    expect(savedText(40)).toBe("40s");
  });
});

describe("the own yard's helper badge (beta 8)", () => {
  it("shows on a running build, upgrade or fortify, with its helpers out of 5", () => {
    expect(helperBadgeOf(building({ countdown: upgrading(600), hl: [11, 12] }), NOW)).toEqual({
      id: 7,
      helpers: 2,
      full: false,
    });
    expect(helperBadgeOf(building({ countdown: upgrading(600) }), NOW)).toMatchObject({ helpers: 0, full: false });
    const fortify: YardCountdown = { kind: "fortify", endsAt: NOW + 60, seconds: 60, paused: false };
    expect(helperBadgeOf(building({ countdown: fortify, hl: [1, 2, 3, 4, 5] }), NOW)).toMatchObject({
      helpers: 5,
      full: true,
    });
    expect(helperBadgeText(2)).toBe("2/5");
  });

  it("stays on a paused job; goes with no job, a finished one, or a rebuild", () => {
    expect(helperBadgeOf(building({ countdown: upgrading(600, true), hl: [1] }), NOW + 9_999)).toMatchObject({
      helpers: 1,
    });
    expect(helperBadgeOf(building(), NOW)).toBeNull();
    expect(helperBadgeOf(building({ countdown: upgrading(600), hl: [1] }), NOW + 600)).toBeNull();
    const rebuild: YardCountdown = { kind: "rebuild", endsAt: NOW + 60, seconds: 60, paused: false };
    expect(helperBadgeOf(building({ countdown: rebuild }), NOW)).toBeNull();
  });
});
