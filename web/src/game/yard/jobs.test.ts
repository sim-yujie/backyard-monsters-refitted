import { describe, expect, it } from "vitest";
import type { BaseLoadResponse, BuildingDataMap } from "@/api/types";
import { maxHealth } from "./buildingArt";
import { costOf } from "./buildingCosts";
import { readYard } from "./yardModel";
import {
  acceleratedEnd,
  buildingJobs,
  championJobs,
  countdownProgress,
  hatcheryJobs,
  JobKind,
  ACADEMY_TYPE,
  LAB_TYPE,
  lockerJobs,
  unlockEndsAt,
  MUSHROOM_CAP,
  MUSHROOM_RESPAWN_SECONDS,
  nextWorkerJob,
  predictCompletion,
  progressFraction,
  researchJobs,
  savedAtOf,
  SERVER_COMPLETED_KINDS,
  STARVE_SECONDS,
  storeItemJobs,
  trainingEndsAt,
  trainingJobs,
  yardJobs,
  type YardJob,
} from "./jobs";

/**
 * The job end times of `docs/design/yard-buildings.md` §2.2, one kind at a
 * time, and the display flip `YardStore` applies when one reaches zero.
 */

const SAVED = 1_000_000;

const saveWith = (extra: Partial<BaseLoadResponse> = {}): BaseLoadResponse =>
  ({
    error: 0,
    id: 1,
    baseid: "1",
    basesaveid: 1,
    worldsize: [800, 800],
    currenttime: SAVED,
    savetime: SAVED,
    buildingdata: {},
    ...extra,
  }) as BaseLoadResponse;

const only = (jobs: YardJob[], kind: JobKind): YardJob[] =>
  jobs.filter((job) => job.kind === kind);

describe("savedAtOf", () => {
  it("measures from savetime, or from the server clock for a yard never saved", () => {
    expect(savedAtOf({ savetime: 500, currenttime: 900 })).toBe(500);
    expect(savedAtOf({ savetime: 0, currenttime: 900 })).toBe(900);
  });
});

describe("building countdowns", () => {
  it("ends an upgrade, build or fortify at savetime plus the seconds left, holding a worker", () => {
    const jobs = buildingJobs(
      {
        "1": { X: 0, Y: 0, t: 20, id: 1, l: 2, cU: 120 },
        "2": { X: 0, Y: 0, t: 20, id: 2, cB: 30 },
        "3": { X: 0, Y: 0, t: 20, id: 3, cF: 45 },
      },
      SAVED,
    );
    expect(
      jobs.map(({ kind, key, endsAt, holdsWorker }) => ({ kind, key, endsAt, holdsWorker })),
    ).toEqual([
      { kind: "upgrade", key: "upgrade:1", endsAt: SAVED + 120, holdsWorker: true },
      { kind: "build", key: "build:2", endsAt: SAVED + 30, holdsWorker: true },
      { kind: "fortify", key: "fortify:3", endsAt: SAVED + 45, holdsWorker: true },
    ]);
  });

  it("freezes a countdown while the building is damaged or repairing", () => {
    const jobs = buildingJobs(
      {
        "1": { X: 0, Y: 0, t: 20, id: 1, l: 2, cU: 120, hp: 10 },
        "2": { X: 0, Y: 0, t: 20, id: 2, l: 2, cU: 120 },
      },
      SAVED,
      { "2": 50 },
    );
    expect(only(jobs, JobKind.UPGRADE).map((job) => job.endsAt)).toEqual([null, null]);
  });

  it("lists a rebuild without a worker", () => {
    const [job] = buildingJobs({ "1": { X: 0, Y: 0, t: 20, id: 1, cR: 60 } }, SAVED);
    expect(job).toMatchObject({ kind: "rebuild", endsAt: SAVED + 60, holdsWorker: false });
  });
});

describe("countdownProgress (#136)", () => {
  // Cannon Tower L4 → L5 runs 24,300 s by the table; 19,440 s under Sharper Tools.
  const CANNON = 20;
  const TABLE = costOf(CANNON, 4)?.[4] ?? 0;

  const progressAt = (row: Record<string, unknown>, now: number, extra: Partial<BaseLoadResponse> = {}) => {
    const save = saveWith({
      buildingdata: { "7": { id: 7, t: CANNON, X: 0, Y: 0, l: 4, ...row } },
      ...extra,
    });
    const building = readYard(save).buildings.find((one) => one.id === 7);
    if (!building) throw new Error("no building");
    return countdownProgress(building, now);
  };

  it("a job with its length stored starts at 0 and runs to 1, Sharper Tools or not", () => {
    expect(TABLE).toBe(24_300);
    expect(progressAt({ cU: 19_440, cL: 19_440 }, SAVED)).toEqual({
      remaining: 19_440,
      total: 19_440,
      fraction: 0,
    });
    expect(progressAt({ cU: 19_440, cL: 19_440 }, SAVED + 9_720)?.fraction).toBe(0.5);
    expect(progressAt({ cU: 19_440, cL: 19_440 }, SAVED + 30_000)).toEqual({
      remaining: 0,
      total: 19_440,
      fraction: 1,
    });
  });

  it("an older job with no length falls back to the table's time", () => {
    // The old behaviour, kept for saves from before #136: a Sharper Tools job opens at 20%.
    const progress = progressAt({ cU: 19_440 }, SAVED);
    expect(progress?.total).toBe(TABLE);
    expect(progress?.fraction).toBeCloseTo(0.2, 5);
  });

  it("a speed-up leaves the length alone, so the bar jumps forward", () => {
    // 19,440 − 3,600 left of a 19,440 s job.
    expect(progressAt({ cU: 15_840, cL: 19_440 }, SAVED)?.fraction).toBeCloseTo(3_600 / 19_440, 5);
  });

  it("a build reads its length, or the table's build time", () => {
    const build = costOf(CANNON, 0)?.[4] ?? 0;
    expect(progressAt({ l: 0, cB: 20, cL: 24 }, SAVED)?.total).toBe(24);
    expect(progressAt({ l: 0, cB: 20 }, SAVED)?.total).toBe(Math.max(build, 20));
  });

  it("a paused countdown holds its remaining time whatever the clock says", () => {
    const progress = progressAt({ cU: 10_000, cL: 20_000, hp: 5 }, SAVED + 5_000);
    expect(progress).toEqual({ remaining: 10_000, total: 20_000, fraction: 0.5 });
  });

  it("the total is never below what is left, and never 0", () => {
    expect(progressAt({ cU: 50_000, cL: 1_000 }, SAVED)).toMatchObject({ total: 50_000, fraction: 0 });
    expect(progressFraction(10, 0)).toBe(1);
    expect(progressFraction(-5, 10)).toBe(1);
    expect(progressFraction(20, 10)).toBe(0);
  });

  it("is null for a building with nothing running", () => {
    expect(progressAt({}, SAVED)).toBeNull();
  });
});

describe("repairs", () => {
  it("lists a repairing building, ending at its own repairTime's rate", () => {
    // Town Hall level 1: 4000 health (the combat table the server reads),
    // repairTime 480 s, so ceil(4000 / 480) = 9 a second: 3000 left takes 334 s.
    const jobs = buildingJobs({ "1": { X: 0, Y: 0, t: 14, id: 1, rE: 1, hp: 1_000 } }, SAVED);
    expect(only(jobs, JobKind.REPAIR)).toEqual([
      {
        kind: "repair",
        key: "repair:1",
        id: 1,
        buildingId: 1,
        endsAt: SAVED + 334,
        holdsWorker: false,
      },
    ]);
  });

  it("lists nothing for a damaged building that is not repairing", () => {
    const jobs = buildingJobs({ "1": { X: 0, Y: 0, t: 14, id: 1, hp: 1_000 } }, SAVED);
    expect(only(jobs, JobKind.REPAIR)).toEqual([]);
  });
});

describe("harvesters", () => {
  it("fills the buffer after the current cycle plus one cycle per produce step", () => {
    // Twig Snapper level 1: 2 per 10 s cycle into a 720 buffer.
    const jobs = buildingJobs({ "1": { X: 0, Y: 0, t: 1, id: 1, st: 700, cP: 4 } }, SAVED);
    expect(only(jobs, JobKind.HARVEST)[0]?.endsAt).toBe(SAVED + 4 + 9 * 10);
  });

  it("does not fill while full, upgrading, or below half health", () => {
    const max = maxHealth(1, 1)!;
    const jobs = buildingJobs(
      {
        "1": { X: 0, Y: 0, t: 1, id: 1, st: 720 },
        "2": { X: 0, Y: 0, t: 1, id: 2, cU: 100 },
        "3": { X: 0, Y: 0, t: 1, id: 3, hp: Math.floor(max * 0.4) },
      },
      SAVED,
    );
    expect(only(jobs, JobKind.HARVEST)).toEqual([]);
  });

  it("cycles slower when damaged", () => {
    const max = maxHealth(1, 1)!;
    // At 3/4 health a cycle is 10 + ceil(10 × (4 − 3)) = 20 s.
    const jobs = buildingJobs(
      { "1": { X: 0, Y: 0, t: 1, id: 1, st: 716, hp: (max * 3) / 4 } },
      SAVED,
    );
    expect(only(jobs, JobKind.HARVEST)[0]?.endsAt).toBe(SAVED + 20 + 20);
  });
});

describe("monster timers", () => {
  it("ends an unlock at its absolute e", () => {
    const jobs = lockerJobs({ C1: { t: 2 }, C5: { t: 1, s: SAVED - 10, e: SAVED + 50 } }, 7);
    expect(jobs).toEqual([
      {
        kind: "unlock",
        key: "unlock:C5",
        id: "C5",
        buildingId: 7,
        endsAt: SAVED + 50,
        holdsWorker: false,
      },
    ]);
  });

  it("brings an unlock forward by a Locker Overdrive running after savetime (5x)", () => {
    const clod = { CLOD: { q: 1, s: SAVED - 100, e: SAVED + 1_000 } };
    // 10,000 s left; 1,000 s of Overdrive takes 4,000 off.
    const long = lockerJobs({ C5: { t: 1, s: SAVED - 500, e: SAVED + 10_000 } }, 7, clod, SAVED);
    expect(long[0]?.endsAt).toBe(SAVED + 6_000);
    // 3,000 s left, all inside the Overdrive: a fifth.
    const short = lockerJobs({ C5: { t: 1, s: SAVED - 500, e: SAVED + 3_000 } }, 7, clod, SAVED);
    expect(short[0]?.endsAt).toBe(SAVED + 600);
    // The Overdrive before savetime is already in e.
    expect(unlockEndsAt(SAVED + 3_000, SAVED + 2_000, clod)).toBe(SAVED + 3_000);
    // No s: it started four hours before its e.
    expect(unlockEndsAt(SAVED + 10_000, SAVED, { CLOD: { e: SAVED + 60 } })).toBe(SAVED + 9_760);
  });

  it("leaves Inferno unlocks out", () => {
    expect(lockerJobs({ IC1: { t: 1, s: SAVED, e: SAVED + 5 } })).toEqual([]);
  });

  it("reads an academy time as absolute, converting a legacy remainder once", () => {
    expect(trainingEndsAt(SAVED + 100, SAVED)).toBe(SAVED + 100);
    expect(trainingEndsAt(3_600, SAVED)).toBe(SAVED + 3_600);
    const jobs = trainingJobs({ C2: { level: 2, time: SAVED + 99 }, C3: { level: 4 } }, SAVED);
    expect(jobs.map((job) => [job.key, job.endsAt])).toEqual([["train:C2", SAVED + 99]]);
  });

  it("points a training at the academy whose upg names it", () => {
    const buildings: BuildingDataMap = {
      "4": { X: 0, Y: 0, t: ACADEMY_TYPE, id: 4, l: 3 },
      "7": { X: 0, Y: 0, t: ACADEMY_TYPE, id: 7, l: 3, upg: "C2" },
    };
    const academy = { C2: { level: 2, time: SAVED + 99 }, C5: { level: 1, time: SAVED + 9 } };
    const jobs = trainingJobs(academy, SAVED, buildings);
    expect(jobs.map((job) => [job.id, job.buildingId])).toEqual([
      ["C2", 7],
      ["C5", 4],
    ]);
  });

  it("ends lab research at the lab's upt", () => {
    const buildings: BuildingDataMap = {
      "9": { X: 0, Y: 0, t: LAB_TYPE, id: 9, upg: "C4", upt: SAVED + 70, upl: 2 },
    };
    expect(researchJobs(buildings)).toEqual([
      {
        kind: "research",
        key: "research:C4",
        id: "C4",
        buildingId: 9,
        endsAt: SAVED + 70,
        holdsWorker: false,
      },
    ]);
  });

  it("ends a hatchery's monster from monsters.saved, faster under overdrive", () => {
    const monsters = {
      saved: SAVED,
      h: [
        ["C1", 100],
        ["C2", 30],
        ["", 0],
      ] as [string, number][],
      hid: [11, 12, 13],
      hstage: [1, 2, 0],
    };
    const plain = hatcheryJobs(monsters, {}, SAVED);
    expect(plain.map((job) => [job.key, job.endsAt])).toEqual([
      ["hatch:11", SAVED + 100],
      ["hatch:12", null],
    ]);

    // HOD (4x) with 10 s left: 40 s of countdown in 10 s, then 60 s at normal speed.
    const fast = hatcheryJobs(monsters, { HOD: { e: SAVED + 10 } }, SAVED);
    expect(fast[0]?.endsAt).toBe(SAVED + 70);
  });

  it("finishes wholly inside an overdrive when it is long enough", () => {
    expect(acceleratedEnd(SAVED, 100, { power: 10, until: SAVED + 3_600 })).toBe(SAVED + 10);
    expect(acceleratedEnd(SAVED, 100, null)).toBe(SAVED + 100);
  });

  it("starves an active champion a day after its feed time", () => {
    const jobs = championJobs([
      { t: 1, hp: 1, l: 2, ft: SAVED + 5, fd: 0, fb: 0, pl: 0, status: 0 },
      { t: 2, hp: 1, l: 2, ft: 500, fd: 0, fb: 0, pl: 0, status: 1 },
    ]);
    expect(jobs.map((job) => [job.key, job.endsAt])).toEqual([
      ["hunger:0", SAVED + 5 + STARVE_SECONDS],
    ]);
  });
});

describe("mushrooms and store buffs", () => {
  it("respawns a mushroom 17,280 s after the last, below the cap", () => {
    const save = saveWith({ mushrooms: { s: SAVED, l: [{ X: 1, Y: 1 }] } });
    expect(yardJobs(save).find((job) => job.kind === JobKind.MUSHROOM)?.endsAt).toBe(
      SAVED + MUSHROOM_RESPAWN_SECONDS,
    );
    const full = saveWith({
      mushrooms: { s: SAVED, l: Array.from({ length: MUSHROOM_CAP }, () => ({})) },
    });
    expect(yardJobs(full).some((job) => job.kind === JobKind.MUSHROOM)).toBe(false);
  });

  it("stops at 10 mushrooms, and a yard above 10 has no respawn either", () => {
    expect(MUSHROOM_CAP).toBe(10);
    const nine = saveWith({ mushrooms: { s: SAVED, l: Array.from({ length: 9 }, () => ({})) } });
    expect(yardJobs(nine).some((job) => job.kind === JobKind.MUSHROOM)).toBe(true);
    const above = saveWith({ mushrooms: { s: SAVED, l: Array.from({ length: 16 }, () => ({})) } });
    expect(yardJobs(above).some((job) => job.kind === JobKind.MUSHROOM)).toBe(false);
  });

  it("expires a timed buff at its e and ignores a permanent purchase", () => {
    expect(storeItemJobs({ BST: { q: 1, e: SAVED + 30 }, BEW: { q: 2 } })).toEqual([
      {
        kind: "storeItem",
        key: "storeItem:BST",
        id: "BST",
        buildingId: null,
        endsAt: SAVED + 30,
        holdsWorker: false,
      },
    ]);
  });
});

describe("yardJobs", () => {
  it("lists every kind soonest first, frozen jobs last", () => {
    const save = saveWith({
      buildingdata: {
        "1": { X: 0, Y: 0, t: 20, id: 1, l: 2, cU: 500 },
        "2": { X: 0, Y: 0, t: 20, id: 2, l: 2, cU: 5, hp: 1 },
        "3": { X: 0, Y: 0, t: 8, id: 3, l: 2 },
      },
      lockerdata: { C5: { t: 1, e: SAVED + 100 } },
      storedata: { BST: { e: SAVED + 300 } },
    });
    const jobs = yardJobs(save);
    expect(jobs.map((job) => job.key)).toEqual([
      "unlock:C5",
      "storeItem:BST",
      "upgrade:1",
      "upgrade:2",
    ]);
    // The unlock points at the Monster Locker.
    expect(jobs[0]?.buildingId).toBe(3);
    expect(nextWorkerJob(jobs)?.key).toBe("upgrade:1");
  });

  it("marks only the kinds the server's catch-up completes", () => {
    expect([...SERVER_COMPLETED_KINDS].sort()).toEqual([
      "build",
      "fortify",
      "mushroom",
      "repair",
      "research",
      "storeItem",
      "train",
      "unlock",
      "upgrade",
    ]);
  });
});

describe("predictCompletion", () => {
  it("finishes building countdowns the way advanceBuildingTimers does (length too), copying what it touches", () => {
    const save = saveWith({
      buildingdata: {
        "1": { X: 0, Y: 0, t: 20, id: 1, l: 2, cU: 5, cL: 720 },
        "2": { X: 0, Y: 0, t: 20, id: 2, cB: 5, prefab: 3, cL: 30 },
        "3": { X: 0, Y: 0, t: 20, id: 3, cB: 5 },
        "4": { X: 0, Y: 0, t: 20, id: 4, fort: 1, cF: 5 },
        "5": { X: 0, Y: 0, t: 20, id: 5, cU: 99 },
      },
    });
    const due = yardJobs(save).filter((job) => job.endsAt === SAVED + 5);
    const next = predictCompletion(save, due);

    const rows = next.buildingdata!;
    expect(rows["1"]).toEqual({ X: 0, Y: 0, t: 20, id: 1, l: 3 });
    expect(rows["2"]).toEqual({ X: 0, Y: 0, t: 20, id: 2, l: 3 });
    expect(rows["3"]).toEqual({ X: 0, Y: 0, t: 20, id: 3 });
    expect(rows["4"]).toEqual({ X: 0, Y: 0, t: 20, id: 4, fort: 2 });
    expect(rows["5"]).toBe(save.buildingdata!["5"]);
    // The original is untouched.
    expect(save.buildingdata!["1"]).toEqual({ X: 0, Y: 0, t: 20, id: 1, l: 2, cU: 5, cL: 720 });
  });

  it("expires a buff, completes an unlock, a training and a research", () => {
    const save = saveWith({
      buildingdata: {
        "9": { X: 0, Y: 0, t: LAB_TYPE, id: 9, upg: "C4", upt: SAVED, upl: 2 },
      },
      storedata: { BST: { e: SAVED }, BEW: { q: 1 } },
      lockerdata: { C5: { t: 1, s: 1, e: SAVED } },
      academy: { C2: { level: 2, time: SAVED, duration: 60 } },
    });
    const next = predictCompletion(save, yardJobs(save));
    expect(next.storedata).toEqual({ BEW: { q: 1 } });
    expect(next.lockerdata).toEqual({ C5: { t: 2 } });
    expect(next.academy).toEqual({ C2: { level: 3 }, C5: { level: 1 }, C4: { powerup: 2 } });
    expect(next.buildingdata!["9"]).toEqual({ X: 0, Y: 0, t: LAB_TYPE, id: 9 });
    expect(save.storedata).toEqual({ BST: { e: SAVED }, BEW: { q: 1 } });
  });

  it("heals a finished repair and fills a finished harvester", () => {
    const save = saveWith({
      buildingdata: {
        "1": { X: 0, Y: 0, t: 14, id: 1, rE: 1, hp: 3_999 },
        "2": { X: 0, Y: 0, t: 1, id: 2, st: 718, rCP: 1 },
      },
      buildinghealthdata: { "1": 3_999 },
    });
    const next = predictCompletion(save, yardJobs(save));
    expect(next.buildingdata!["1"]).toEqual({ X: 0, Y: 0, t: 14, id: 1 });
    expect(next.buildinghealthdata).toEqual({});
    expect(next.buildingdata!["2"]?.st).toBe(720);
  });

  it("returns the same save when nothing finished", () => {
    const save = saveWith();
    expect(predictCompletion(save, [])).toBe(save);
  });
});
