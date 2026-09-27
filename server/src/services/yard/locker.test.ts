import { describe, expect, test } from "bun:test";
import { ClientSafeError } from "../../middleware/clientSafeError.js";
import { storageCap } from "../base/economy/resourceBudget.js";
import {
  lockerLevel,
  overdriveOverlap,
  planLockerCancel,
  planLockerFinish,
  planLockerInstant,
  planLockerStart,
  runningUnlock,
  unlockFinishAt,
  type LockerSave,
} from "./locker.js";
import { instantUnlockPrice, timeCost } from "./shiny.js";

/**
 * The Monster Locker's routes (`docs/design/yard-buildings.md` §4.3) against
 * small hand-built yards. Prices off the catalogue (`game-data/monsterCatalogue.ts`):
 *
 * - C1 Pokey 4,000 putty, 600 s, Locker 1.
 * - C5 64,000 putty, 28,800 s, Locker 2.
 * - C16 Vorg 384,000, 129,600 s, Locker 2; C17 Slimeattikus and C19 Rezghul
 *   2,048,000, 129,600 s, Locker 3; C18 (Slimeattikus Mini) blocked.
 */

const NOW = 1_700_000_000;

const HALL = 14;
const LOCKER = 8;
const SILO = 6;

/** A level 5 hall, a level `lockerLvl` Monster Locker and a silo; 10M putty. */
const yard = (lockerLvl = 3, overrides: Partial<LockerSave> = {}): LockerSave => ({
  buildingdata: {
    "0": { id: 0, t: HALL, x: 0, y: 0, l: 5 },
    "1": { id: 1, t: LOCKER, x: 0, y: 0, l: lockerLvl },
    "2": { id: 2, t: SILO, x: 0, y: 0, l: 10 },
  },
  resources: { r1: 0, r2: 0, r3: 10_000_000, r4: 0 },
  lockerdata: { C1: { t: 2 } },
  academy: { C1: { level: 3 } },
  storedata: {},
  ...overrides,
});

/** `[status, reason, data]` of what a call threw. */
const refusal = (run: () => unknown): [number, unknown, Record<string, unknown>] => {
  try {
    run();
  } catch (err) {
    if (err instanceof ClientSafeError) {
      const data = err.data as Record<string, unknown>;
      return [err.status, data.reason, data];
    }
    throw err;
  }
  throw new Error("expected a refusal");
};

describe("locker/start", () => {
  test("writes {t:1, s:now, e:now+time} and charges the full putty price", () => {
    const plan = planLockerStart(yard(), "C5", NOW);

    expect(plan.slices.lockerdata).toEqual({ C1: { t: 2 }, C5: { t: 1, s: NOW, e: NOW + 28_800 } });
    expect(plan.debit).toEqual({ r3: 64_000 });
    expect(plan.report).toEqual({ monster: "C5", endsAt: NOW + 28_800, cost: { r3: 64_000 } });
  });

  test("Vorg, Slimeattikus and Rezghul can be unlocked (D7); Slimeattikus Mini cannot", () => {
    expect(planLockerStart(yard(), "C16", NOW).debit).toEqual({ r3: 384_000 });
    expect(planLockerStart(yard(), "C17", NOW).debit).toEqual({ r3: 2_048_000 });
    expect(planLockerStart(yard(), "C19", NOW).debit).toEqual({ r3: 2_048_000 });
    expect(refusal(() => planLockerStart(yard(), "C18", NOW)).slice(0, 2)).toEqual([400, "badRequest"]);
  });

  test("ids that are not obtainable surface monsters are a 400", () => {
    for (const id of ["C200", "IC1", "C0", "c1", "X", "C1 ", "constructor"]) {
      expect(refusal(() => planLockerStart(yard(), id, NOW)).slice(0, 2)).toEqual([400, "badRequest"]);
    }
  });

  test("a monster already unlocked is refused", () => {
    const [status, reason, data] = refusal(() => planLockerStart(yard(), "C1", NOW));
    expect([status, reason, data.monster]).toEqual([409, "alreadyUnlocked", "C1"]);
  });

  test("one unlock at a time: a second is refused naming the running one", () => {
    const busy = yard(3, { lockerdata: { C1: { t: 2 }, C2: { t: 1, s: NOW, e: NOW + 100 } } });
    const [status, reason, data] = refusal(() => planLockerStart(busy, "C5", NOW));
    expect([status, reason, data.monster]).toEqual([409, "unlockRunning", "C2"]);
    // Asking for the one already running is the same refusal.
    expect(refusal(() => planLockerStart(busy, "C2", NOW)).slice(0, 2)).toEqual([409, "unlockRunning"]);
  });

  test("an Inferno unlock running does not block a surface one", () => {
    const inferno = yard(3, { lockerdata: { IC1: { t: 1, s: NOW, e: NOW + 100 } } });
    expect(planLockerStart(inferno, "C5", NOW).report.monster).toBe("C5");
  });

  test("no Monster Locker, or one still being built, is noLocker", () => {
    const none = yard(3);
    delete none.buildingdata!["1"];
    expect(refusal(() => planLockerStart(none, "C2", NOW)).slice(0, 2)).toEqual([409, "noLocker"]);

    const building = yard(3);
    building.buildingdata!["1"] = { id: 1, t: LOCKER, x: 0, y: 0, l: 0, cB: 300 };
    expect(refusal(() => planLockerStart(building, "C2", NOW)).slice(0, 2)).toEqual([409, "noLocker"]);
  });

  test("a locker below the monster's level is refused with have/need", () => {
    const [status, reason, data] = refusal(() => planLockerStart(yard(2), "C17", NOW));
    expect([status, reason, data.have, data.need]).toEqual([409, "lockerLevel", 2, 3]);
    // A level-2 locker mid-upgrade still counts as 2.
    const upgrading = yard(2);
    upgrading.buildingdata!["1"] = { id: 1, t: LOCKER, x: 0, y: 0, l: 2, cU: 5000 };
    expect(planLockerStart(upgrading, "C16", NOW).report.monster).toBe("C16");
  });

  test("the save it was handed is not changed", () => {
    const save = yard();
    const before = structuredClone(save);
    planLockerStart(save, "C5", NOW);
    expect(save).toEqual(before);
  });
});

describe("locker/cancel", () => {
  const running = (r3: number) =>
    yard(3, {
      resources: { r1: 0, r2: 0, r3, r4: 0 },
      lockerdata: { C1: { t: 2 }, C5: { t: 1, s: NOW - 100, e: NOW + 28_700 } },
    });

  test("removes the entry and credits the full price", () => {
    const plan = planLockerCancel(running(0));
    expect(plan.slices.lockerdata).toEqual({ C1: { t: 2 } });
    expect(plan.credit).toEqual({ r3: 64_000 });
    expect(plan.report).toEqual({ monster: "C5", refund: { r3: 64_000 } });
  });

  test("the reported refund is what fits under the storage cap", () => {
    const save = running(0);
    const cap = storageCap(save);
    save.resources!.r3 = cap - 1_000;
    expect(planLockerCancel(save).report.refund).toEqual({ r3: 1_000 });
    // Already over the cap: nothing comes back, nothing is lost.
    save.resources!.r3 = cap + 5;
    expect(planLockerCancel(save).report.refund).toEqual({ r3: 0 });
  });

  test("nothing running is notUnlocking", () => {
    expect(refusal(() => planLockerCancel(yard())).slice(0, 2)).toEqual([409, "notUnlocking"]);
  });
});

describe("locker/finish", () => {
  test("unlocks now for timeCost(e − now) and creates academy level 1", () => {
    const save = yard(3, { lockerdata: { C1: { t: 2 }, C5: { t: 1, s: NOW - 800, e: NOW + 28_000 } } });
    const plan = planLockerFinish(save, NOW);

    // min(ceil(28,000 × 20 / 3,600) = 156, int(sqrt(22,400)) = 149).
    expect(plan.shiny).toBe(149);
    expect(plan.shiny).toBe(timeCost(28_000));
    expect(plan.report).toEqual({ monster: "C5", credits: 149 });
    expect(plan.slices.lockerdata).toEqual({ C1: { t: 2 }, C5: { t: 2 } });
    expect(plan.slices.academy).toEqual({ C1: { level: 3 }, C5: { level: 1 } });
  });

  test("five minutes or less left is free", () => {
    const save = yard(3, { lockerdata: { C5: { t: 1, s: NOW - 28_500, e: NOW + 300 } } });
    expect(planLockerFinish(save, NOW).shiny).toBe(0);
  });

  test("an existing academy entry is kept", () => {
    const save = yard(3, {
      lockerdata: { C5: { t: 1, s: NOW, e: NOW + 1_000 } },
      academy: { C5: { level: 4 } },
    });
    expect(planLockerFinish(save, NOW).slices.academy).toEqual({ C5: { level: 4 } });
  });

  test("nothing running is notUnlocking", () => {
    expect(refusal(() => planLockerFinish(yard(), NOW)).slice(0, 2)).toEqual([409, "notUnlocking"]);
  });
});

describe("locker/instant", () => {
  test("unlocks at once for timeCost(time) + ceil(sqrt(putty/2)^0.75), no putty", () => {
    const plan = planLockerInstant(yard(), "C5");

    // timeCost(28,800) = min(160, int(sqrt(23,040)) = 151) = 151;
    // ceil(sqrt(32,000)^0.75) = ceil(48.6…) = 49.
    expect(plan.shiny).toBe(200);
    expect(plan.shiny).toBe(instantUnlockPrice(28_800, 64_000));
    expect(plan).not.toHaveProperty("debit");
    expect(plan.slices.lockerdata).toEqual({ C1: { t: 2 }, C5: { t: 2 } });
    expect(plan.slices.academy).toEqual({ C1: { level: 3 }, C5: { level: 1 } });
    expect(plan.report).toEqual({ monster: "C5", credits: 200 });
  });

  test("works with no putty at all", () => {
    const broke = yard(3, { resources: { r1: 0, r2: 0, r3: 0, r4: 0 } });
    expect(planLockerInstant(broke, "C19").slices.lockerdata!.C19).toEqual({ t: 2 });
  });

  test("the start checks apply", () => {
    const busy = yard(3, { lockerdata: { C2: { t: 1, s: NOW, e: NOW + 100 } } });
    expect(refusal(() => planLockerInstant(busy, "C5")).slice(0, 2)).toEqual([409, "unlockRunning"]);
    expect(refusal(() => planLockerInstant(yard(), "C1")).slice(0, 2)).toEqual([409, "alreadyUnlocked"]);
    expect(refusal(() => planLockerInstant(yard(1), "C5")).slice(0, 2)).toEqual([409, "lockerLevel"]);
    expect(refusal(() => planLockerInstant(yard(), "C18")).slice(0, 2)).toEqual([400, "badRequest"]);
  });
});

describe("helpers", () => {
  test("lockerLevel is the highest finished locker", () => {
    expect(lockerLevel(yard(4).buildingdata)).toBe(4);
    expect(lockerLevel({})).toBe(0);
    expect(lockerLevel(null)).toBe(0);
  });

  test("runningUnlock takes the surface t:1 entry", () => {
    expect(runningUnlock({ C1: { t: 2 }, IC2: { t: 1 }, C3: { t: 1, e: 5 } })).toEqual({
      monster: "C3",
      entry: { t: 1, e: 5 },
    });
    expect(runningUnlock({ C1: { t: 2 } })).toBeNull();
    expect(runningUnlock(null)).toBeNull();
  });

  describe("Overdrive: 4 extra seconds per real second (5x)", () => {
    const clod = { s: NOW, e: NOW + 14_400 };

    test("no Overdrive: e", () => {
      expect(unlockFinishAt(NOW + 1_000, NOW, null)).toBe(NOW + 1_000);
    });

    test("ends inside the Overdrive: a fifth of the time", () => {
      expect(unlockFinishAt(NOW + 1_000, NOW, clod)).toBe(NOW + 200);
      // Rounded up to the whole second.
      expect(unlockFinishAt(NOW + 1_001, NOW, clod)).toBe(NOW + 201);
    });

    test("outlasts the Overdrive: e less 4 × its length", () => {
      // 36 h unlock, 4 h at 5x covers 20 h of it: done after 4 + 16 = 20 h.
      expect(unlockFinishAt(NOW + 129_600, NOW, clod)).toBe(NOW + 129_600 - 4 * 14_400);
    });

    test("only the part of the Overdrive after `from` counts", () => {
      // Two hours of it already counted by an earlier catch-up.
      expect(unlockFinishAt(NOW + 100_000, NOW + 7_200, clod)).toBe(NOW + 100_000 - 4 * 7_200);
      expect(unlockFinishAt(NOW + 100_000, NOW + 20_000, clod)).toBe(NOW + 100_000);
    });

    test("ends before the Overdrive starts: e", () => {
      expect(unlockFinishAt(NOW - 5, NOW - 100, clod)).toBe(NOW - 5);
    });

    test("overlap of a window with the Overdrive", () => {
      expect(overdriveOverlap(NOW - 100, NOW + 100, clod)).toBe(100);
      expect(overdriveOverlap(NOW + 14_000, NOW + 20_000, clod)).toBe(400);
      expect(overdriveOverlap(NOW + 15_000, NOW + 20_000, clod)).toBe(0);
      expect(overdriveOverlap(NOW, NOW + 10, null)).toBe(0);
    });
  });
});
