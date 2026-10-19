import { describe, expect, it } from "vitest";
import type { HelpBlock, HelpResult } from "@/api/friends";
import type { YardBuilding, YardCountdown } from "@/game/yard/yardModel";
import {
  afterHelp,
  afterRefusal,
  buildingHelp,
  fromVisitSave,
  helpableIds,
  helpersOf,
  helpersText,
  helpingLine,
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
  helpsLeft: 17,
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
    for (const reason of ["tooNew", "dailyCap", "nothingToHelp", "alreadyHelped", "helpersFull", "underAttack", "notFriends", "cannotSend", "self"]) {
      expect(helpRefusalText(reason)).toMatch(/^[A-Z0-9].*[.!]$/);
    }
    expect(helpRefusalText("somethingNew")).toBe("That can't be done right now.");
  });
});

describe("the words (#372, #374)", () => {
  it("says who is helped and how many helps are left", () => {
    expect(helpingLine("Bob", 17)).toBe("Helping Bob: 17 helps left today");
    expect(helpingLine("Bob", 1)).toBe("Helping Bob: 1 help left today");
    expect(helpingLine("Bob", 0)).toBe("Helping Bob: no helps left today");
  });

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
    const sped: HelpResult = { secondsSaved: 390, reward: { r1: 25, r2: 25, r3: 25, r4: 25 }, helpsLeft: 16, building: null };
    expect(thanksText("speedup", sped, "Bob", "Storage Silo")).toBe(
      "Thanks for helping! You took 6m 30s off Bob's Storage Silo. You earned 25 of each resource.",
    );
    const fixed: HelpResult = { healed: true, reward: {}, helpsLeft: 16, building: null };
    expect(thanksText("repair", fixed, "Bob", "Cannon Tower")).toBe("Thanks for helping! You repaired Bob's Cannon Tower.");
  });
});

describe("the block after a help (#374)", () => {
  it("a speed-up leaves that job helped by the player, and the counter drops", () => {
    const next = afterHelp(block, 7, "speedup", 16);
    expect(next.helpsLeft).toBe(16);
    expect(next.buildings["7"]).toEqual({ speedup: "alreadyHelped" });
    expect(helpableIds(next).has(7)).toBe(false);
  });

  it("a repair leaves nothing to repair", () => {
    const next = afterHelp(block, 8, "repair", 16);
    expect(next.buildings["8"]).toBeUndefined();
    expect(afterHelp(block, 9, "repair", 16).buildings["9"]).toEqual({ speedup: "alreadyHelped" });
  });

  it("with no helps left, every open offer becomes the daily cap", () => {
    const next = afterHelp(block, 7, "speedup", 0);
    expect(helpableIds(next).size).toBe(0);
    expect(next.buildings["8"]).toEqual({ repair: "dailyCap" });
    expect(next.buildings["10"]).toEqual({ speedup: "helpersFull" });
  });

  it("a refusal stands on that kind of that building", () => {
    const next = afterRefusal(block, 7, "speedup", "helpersFull");
    expect(next.buildings["7"]).toEqual({ speedup: "helpersFull" });
    expect(afterRefusal(block, 99, "speedup", "helpersFull")).toBe(block);
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
