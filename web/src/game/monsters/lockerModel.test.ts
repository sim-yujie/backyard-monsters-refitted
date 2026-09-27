import { describe, expect, it } from "vitest";
import type { BaseLoadResponse, BuildingData, LockerData, StoreData } from "@/api/types";
import { yardJobs } from "@/game/yard/jobs";
import { readYard } from "@/game/yard/yardModel";
import {
  cancelRefund,
  finishPrice,
  gateText,
  instantGate,
  instantPrice,
  lockerLevel,
  lockerRows,
  overdriveBlocked,
  overdriveEndsAt,
  runningUnlock,
  startGate,
  type LockerContext,
} from "./lockerModel";
import { monsterEntry, type MonsterEntry } from "./monsterCatalogue";

/**
 * The Unlock tab's rules (`docs/design/yard-buildings.md` §4.3): row states,
 * the one reason Start or Instant is disabled in the server's order, and the
 * prices the buttons carry.
 */

const T0 = 2_000_000;

const building = (id: number, t: number, l: number, extra: Partial<BuildingData> = {}): BuildingData => ({
  id,
  t,
  l,
  X: id * 40,
  Y: 0,
  ...extra,
});

const HALL = building(1, 14, 6);
const LOCKER = (level: number, extra: Partial<BuildingData> = {}) => building(2, 8, level, extra);

interface Fixture {
  buildings?: BuildingData[];
  lockerdata?: LockerData;
  storedata?: StoreData;
  putty?: number;
  credits?: number;
  cap?: number;
}

const contextOf = (fixture: Fixture = {}): LockerContext => {
  const save = {
    error: 0,
    currenttime: T0,
    savetime: T0,
    resources: { r1: 0, r2: 0, r3: fixture.putty ?? 1e9, r4: 0 },
    credits: fixture.credits ?? 10_000,
    buildingdata: Object.fromEntries(
      (fixture.buildings ?? [HALL, LOCKER(4)]).map((one) => [String(one.id), one]),
    ),
    lockerdata: fixture.lockerdata ?? {},
    storedata: fixture.storedata ?? {},
  } as unknown as BaseLoadResponse;
  const cap = fixture.cap ?? 2e9;
  return {
    yard: readYard(save),
    save,
    resources: save.resources ?? {},
    credits: save.credits ?? 0,
    caps: { r1: cap, r2: cap, r3: cap, r4: cap },
    now: () => T0,
    jobs: () => yardJobs(save),
  };
};

const entry = (id: string): MonsterEntry => {
  const found = monsterEntry(id);
  if (!found) throw new Error(id);
  return found;
};

describe("lockerRows", () => {
  it("lists every obtainable monster once, in list order, Vorg, Slimeattikus and Rezghul included", () => {
    const ids = lockerRows(contextOf()).map((row) => row.monster.id);
    expect(ids).toHaveLength(18);
    expect(ids).toContain("C16");
    expect(ids).toContain("C17");
    expect(ids).toContain("C19");
    expect(ids).not.toContain("C18");
    expect(ids[0]).toBe("C1");
    // The index tie: Brain (C9) before Slimeattikus (C17).
    expect(ids.indexOf("C9")).toBeLessThan(ids.indexOf("C17"));
  });

  it("says unlocked, unlocking, available or which locker level each waits for", () => {
    const rows = lockerRows(
      contextOf({
        buildings: [HALL, LOCKER(2)],
        lockerdata: { C1: { t: 2 }, C2: { t: 1, s: T0 - 60, e: T0 + 3_540 } },
      }),
    );
    const state = (id: string) => rows.find((row) => row.monster.id === id)!.state;
    expect(state("C1")).toEqual({ kind: "unlocked" });
    expect(state("C2")).toEqual({ kind: "unlocking", endsAt: T0 + 3_540 });
    expect(state("C3")).toEqual({ kind: "available" });
    expect(state("C9")).toEqual({ kind: "locked", need: 3 });
    expect(state("C12")).toEqual({ kind: "locked", need: 4 });
  });
});

describe("startGate: one reason, in the server's order", () => {
  it("lets a monster go when everything holds", () => {
    expect(startGate(entry("C3"), contextOf())).toBeNull();
  });

  it("refuses one already unlocked", () => {
    const gate = startGate(entry("C1"), contextOf({ lockerdata: { C1: { t: 2 } } }));
    expect(gate).toEqual({ reason: "alreadyUnlocked" });
  });

  it("refuses while another unlock runs, before looking at the locker", () => {
    const context = contextOf({
      buildings: [HALL],
      lockerdata: { C2: { t: 1, s: T0, e: T0 + 100 } },
    });
    const gate = startGate(entry("C3"), context);
    expect(gate).toEqual({ reason: "unlockRunning", monster: "C2" });
    expect(gateText(gate!)).toBe("Another unlock is running");
  });

  it("needs a finished Monster Locker", () => {
    for (const buildings of [[HALL], [HALL, LOCKER(0, { cB: 300 })]]) {
      const gate = startGate(entry("C1"), contextOf({ buildings }));
      expect(gate).toEqual({ reason: "noLocker" });
      expect(gateText(gate!)).toBe("Build a Monster Locker");
    }
  });

  it("needs the monster's locker level, counting a locker mid-upgrade at its level", () => {
    const context = contextOf({ buildings: [HALL, LOCKER(2, { cU: 600 })] });
    expect(lockerLevel(context.yard)).toBe(2);
    const gate = startGate(entry("C9"), context);
    expect(gate).toEqual({ reason: "lockerLevel", have: 2, need: 3 });
    expect(gateText(gate!)).toBe("Needs Monster Locker level 3");
  });

  it("names the putty short last", () => {
    const gate = startGate(entry("C9"), contextOf({ putty: 900_000 }));
    expect(gate).toEqual({ reason: "shortfall", need: 124_000 });
    expect(gateText(gate!)).toBe("Need 124,000 more putty");
  });
});

describe("instant", () => {
  it("prices timeCost(time) + ceil(sqrt(putty / 2)^0.75)", () => {
    // Pokey: 600 s → min(ceil(600·20/3600), trunc(sqrt(480))) = 4; ceil(sqrt(2000)^0.75) = 18.
    expect(instantPrice(entry("C1"))).toBe(4 + 18);
  });

  it("skips putty but needs the Shiny", () => {
    const poor = contextOf({ putty: 0, credits: 0 });
    expect(startGate(entry("C3"), poor)?.reason).toBe("shortfall");
    expect(instantGate(entry("C3"), poor)).toEqual({ reason: "credits", need: instantPrice(entry("C3")) });
    expect(instantGate(entry("C3"), contextOf({ putty: 0 }))).toBeNull();
  });

  it("shares the locker gates", () => {
    expect(instantGate(entry("C12"), contextOf({ buildings: [HALL, LOCKER(3)] }))?.reason).toBe(
      "lockerLevel",
    );
  });
});

describe("the running unlock", () => {
  it("reads the first surface t: 1 entry and ignores Inferno ones", () => {
    const context = contextOf({
      lockerdata: { IC1: { t: 1, s: T0, e: T0 + 50 }, C4: { t: 1, s: T0 - 400, e: T0 + 1_000 } },
    });
    const running = runningUnlock(context)!;
    expect(running.monster.id).toBe("C4");
    expect(running.endsAt).toBe(T0 + 1_000);
    expect(running.startedAt).toBe(T0 - 400);
  });

  it("prices Finish now by the time left, free at five minutes or less", () => {
    const running = runningUnlock(contextOf({ lockerdata: { C4: { t: 1, s: T0, e: T0 + 7_200 } } }))!;
    expect(finishPrice(running, T0)).toBe(40);
    expect(finishPrice(running, T0 + 7_200 - 300)).toBe(0);
  });

  it("refunds the full price on Cancel, less what the cap turns away", () => {
    const lockerdata = { C4: { t: 1, s: T0, e: T0 + 100 } };
    const roomy = contextOf({ lockerdata, putty: 0 });
    expect(cancelRefund(runningUnlock(roomy)!, roomy)).toEqual({ refund: 32_000, lost: 0 });
    const full = contextOf({ lockerdata, putty: 990_000, cap: 1_000_000 });
    expect(cancelRefund(runningUnlock(full)!, full)).toEqual({ refund: 10_000, lost: 22_000 });
  });
});

describe("the Locker Overdrive", () => {
  const lockerdata = { C4: { t: 1, s: T0, e: T0 + 10_000 } };

  it("is sold only while an unlock runs and none is active, for 60 Shiny", () => {
    expect(overdriveBlocked(contextOf())).toBe("Nothing is unlocking.");
    expect(overdriveBlocked(contextOf({ lockerdata }))).toBeNull();
    expect(overdriveBlocked(contextOf({ lockerdata, credits: 59 }))).toBe("Not enough Shiny.");
    const active = contextOf({ lockerdata, storedata: { CLOD: { e: T0 + 60 } } });
    expect(overdriveEndsAt(active)).toBe(T0 + 60);
    expect(overdriveBlocked(active)).toBe("An overdrive is already running.");
  });

  it("an expired one no longer counts", () => {
    const expired = contextOf({ lockerdata, storedata: { CLOD: { e: T0 - 1 } } });
    expect(overdriveEndsAt(expired)).toBeNull();
    expect(overdriveBlocked(expired)).toBeNull();
  });
});
