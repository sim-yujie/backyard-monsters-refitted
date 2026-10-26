import { describe, expect, it } from "vitest";
import type { BaseLoadResponse, BuildingData, CompletedJob, SiegeData } from "@/api/types";
import { DECOY, JARS, VACUUM } from "@/game/combat/rules/siege";
import { JobKind, predictCompletion, siegeJobs, yardJobs } from "@/game/yard/jobs";
import { readYard } from "@/game/yard/yardModel";
import {
  finishPrice,
  instantPrice,
  noticeText,
  purseOf,
  resourcesPrice,
  runningJob,
  shortfallOf,
  shortfallText,
  siegeOffer,
  siegeRows,
  siegeSlices,
  siteNotice,
  statLines,
  warningText,
  type SiegeContext,
} from "./siege";

/**
 * The Siege screen's rules (Inferno WP 6.4) against Flash's popup
 * (`SiegeBuildingPopup.as`) and the server's gates (`services/yard/siege.ts`).
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

const PURSE = { r1: 1e6, r2: 1e6, r3: 1e6, r4: 0, r1max: 2e6, r2max: 2e6, r3max: 2e6, r4max: 2e6 };

const saveOf = (extra: Partial<BaseLoadResponse> = {}): BaseLoadResponse =>
  ({
    error: 0,
    currenttime: T0,
    savetime: T0,
    credits: 1_000,
    buildingdata: { "1": building(1, 14, 7), "20": building(20, 134, 3), "21": building(21, 133, 1) },
    buildinghealthdata: {},
    siege: {},
    iresources: PURSE,
    ...extra,
  }) as unknown as BaseLoadResponse;

const contextOf = (extra: Partial<BaseLoadResponse> = {}): SiegeContext => {
  const save = saveOf(extra);
  return { yard: readYard(save), save, credits: 1_000, now: () => T0, jobs: () => yardJobs(save) };
};

const labAt = (level: number, extra: Partial<BuildingData> = {}) => building(20, 134, level, extra);

describe("siege: the notices", () => {
  it("none on a working Lab; the Factory says no weapon until one is researched", () => {
    const context = contextOf();
    expect(siteNotice(context, "lab")).toBeNull();
    expect(siteNotice(context, "factory")).toBe("noWeapon");
    expect(noticeText("factory", "noWeapon")).toBe(
      "No weapons unlocked yet. Click the Chaos Lab tab to start unlocking a Chaos Weapon.",
    );
    expect(siteNotice(contextOf({ siege: { decoy: { level: 1, quantity: 0 } } }), "factory")).toBeNull();
  });

  it("not built, still building, upgrading, then damaged, in Flash's order", () => {
    expect(siteNotice(contextOf({ buildingdata: {} }), "lab")).toBe("notBuilt");
    expect(siteNotice(contextOf({ buildingdata: { "20": labAt(0, { cB: 600 }) } }), "lab")).toBe("notBuilt");
    expect(siteNotice(contextOf({ buildingdata: { "20": labAt(3, { cU: 600 }) } }), "lab")).toBe("upgrading");
    expect(noticeText("lab", "upgrading")).toBe(
      "Your Chaos Lab is upgrading. You can't use it until the upgrade is finished.",
    );
    const max = readYard(saveOf()).buildings.find((one) => one.id === 20)!.maxHp!;
    const hurt = contextOf({ buildingdata: { "20": labAt(3, { hp: Math.floor(max * 0.4) }) } });
    expect(siteNotice(hurt, "lab")).toBe("damaged");
    expect(noticeText("lab", "damaged")).toBe("Your Chaos Lab is damaged! You must repair it before it can be used.");
    const scratched = contextOf({ buildingdata: { "20": labAt(3, { hp: Math.ceil(max * 0.6) }) } });
    expect(siteNotice(scratched, "lab")).toBeNull();
  });
});

describe("siege: the rows", () => {
  it("the Lab lists all three in Flash's order; the Factory the researched ones by id", () => {
    const siege: SiegeData = { vacuum: { level: 2, quantity: 0 }, jars: { level: 1, quantity: 1 } };
    const context = contextOf({ siege });
    expect(siegeRows(context, "lab").map((row) => [row.weapon.id, row.level])).toEqual([
      ["decoy", 0],
      ["vacuum", 2],
      ["jars", 1],
    ]);
    expect(siegeRows(context, "factory").map((row) => [row.weapon.id, row.quantity])).toEqual([
      ["jars", 1],
      ["vacuum", 0],
    ]);
  });

  it("a running job shows on its row, its end and length read from the building", () => {
    const context = contextOf({ buildingdata: { "20": labAt(3, { unlockingWeapons: { vacuum: T0 + 600 } }) } });
    const job = runningJob(context, "lab")!;
    expect(job).toMatchObject({ weapon: VACUUM, endsAt: T0 + 600, duration: 7_200, buildingId: 20 });
    expect(siegeRows(context, "lab").find((row) => row.weapon.id === "vacuum")!.job).toEqual(job);
  });
});

describe("siege: the right side", () => {
  it("the Lab: start (unlock, then upgrade), the job, another weapon running, the Lab's level, level 10", () => {
    expect(siegeOffer(contextOf(), "lab", "decoy")).toMatchObject({ kind: "start", verb: "unlock", instant: 143 });
    expect(siegeOffer(contextOf({ siege: { decoy: { level: 1 } } }), "lab", "decoy")).toMatchObject({
      kind: "start",
      verb: "upgrade",
    });
    const running = contextOf({ buildingdata: { "20": labAt(3, { unlockingWeapons: { decoy: T0 + 600 } }) } });
    expect(siegeOffer(running, "lab", "decoy").kind).toBe("running");
    expect(siegeOffer(running, "lab", "jars")).toEqual({ kind: "warning", warning: { reason: "labBusy" } });
    expect(warningText({ reason: "labBusy" })).toBe("The Chaos Lab can only upgrade or unlock one weapon at a time.");

    const low = contextOf({ siege: { decoy: { level: 3 } } });
    expect(siegeOffer(low, "lab", "decoy")).toEqual({ kind: "warning", warning: { reason: "labLevel", have: 3, need: 4 } });
    expect(warningText({ reason: "labLevel", have: 3, need: 4 })).toBe("Upgrade Requires: Chaos Lab Level 4");
    expect(siegeOffer(contextOf({ siege: { decoy: { level: 10 } } }), "lab", "decoy")).toEqual({ kind: "max" });
  });

  it("the Factory: start (build), holding, another being made, another held", () => {
    const researched = { decoy: { level: 1, quantity: 0 }, jars: { level: 1, quantity: 0 } };
    const offer = siegeOffer(contextOf({ siege: researched }), "factory", "decoy");
    expect(offer).toMatchObject({ kind: "start", verb: "build", cost: DECOY.buildCosts[0] });

    const held = contextOf({ siege: { ...researched, jars: { level: 1, quantity: 1 } } });
    expect(siegeOffer(held, "factory", "jars")).toEqual({ kind: "holding" });
    expect(siegeOffer(held, "factory", "decoy")).toEqual({ kind: "warning", warning: { reason: "holding" } });

    const making = contextOf({
      siege: researched,
      buildingdata: { "21": building(21, 133, 1, { unlockingWeapons: { jars: T0 + 60 } }) },
    });
    expect(siegeOffer(making, "factory", "jars").kind).toBe("running");
    expect(siegeOffer(making, "factory", "decoy")).toEqual({ kind: "warning", warning: { reason: "factoryBusy" } });
    expect(warningText({ reason: "factoryBusy" })).toBe("The Chaos Factory can only build or hold one weapon at a time.");
  });
});

describe("siege: prices", () => {
  it("instant is the time's price plus the resources' (the server's Decoy level 1: 80 + 63)", () => {
    expect(resourcesPrice(0)).toBe(0);
    expect(instantPrice(DECOY.upgradeCosts[0]!)).toBe(143);
  });

  it("finish is the time left's price, free at five minutes", () => {
    const job = { site: "lab" as const, weapon: JARS, endsAt: T0 + 3_600, duration: 8_100, buildingId: 20 };
    expect(finishPrice(job, T0)).toBe(20);
    expect(finishPrice(job, T0 + 3_400)).toBe(0);
  });

  it("the shortfall: each short resource whole, the raw sum, its top-up and whether a cap is too small", () => {
    const cost = DECOY.upgradeCosts[0]!;
    const purse = purseOf({ r1: 30_000, r2: 50_000, r3: 40_000, r1max: 1e5, r2max: 1e5, r3max: 1e5 });
    const short = shortfallOf(cost, purse)!;
    expect(short.short).toEqual({ r1: 7_600, r2: 0, r3: 3_867, r4: 0 });
    expect(short.missing).toBeCloseTo(7_599.9587 + 3_866.6185, 3);
    expect(short.topUp).toBe(resourcesPrice(short.missing));
    expect(short.overCap).toBe(false);
    expect(shortfallText(short)).toEqual([
      "You need 11,467 more resources to build.",
      `Get the resources and start building for ${short.topUp} Shiny?`,
    ]);
    expect(shortfallOf(cost, purseOf({ r1: 1, r1max: 10, r2max: 1e6, r3max: 1e6 }))!.overCap).toBe(true);
    expect(shortfallOf(cost, purseOf(PURSE))).toBeNull();
  });
});

describe("siege: stat bars", () => {
  it("level 0 shows level 1 ahead; the Lab the figure with its step; the Factory the figure alone", () => {
    expect(statLines(DECOY, 0, "lab")[0]).toEqual({ label: "Damage:", value: 1_000, diff: null, now: 0, next: 1_000 / 23_500 });
    expect(statLines(DECOY, 1, "lab").map((line) => [line.label, line.value, line.diff])).toEqual([
      ["Damage:", 1_000, 500],
      ["Attraction Range:", 250, 20],
      ["Countdown:", 10, 1],
    ]);
    expect(statLines(DECOY, 1, "factory")[0]).toMatchObject({ value: 1_000, diff: null, next: 0 });
    expect(statLines(DECOY, 10, "lab")[0]).toMatchObject({ value: 23_500, diff: null, now: 1, next: 0 });
    expect(statLines(JARS, 1, "lab").map((line) => line.label)).toEqual(["Range:", "Durability:"]);
    expect(statLines(VACUUM, 1, "lab").map((line) => line.label)).toEqual(["Loot Rate:", "Durability:", "Duration:"]);
  });
});

describe("siege: keeping the save right", () => {
  it("a `siege` completion sets the weapon; a siege report sets all three and the purse", () => {
    const save = saveOf({ siege: { decoy: { level: 1, quantity: 0 } } });
    const completed = [
      { kind: "siege", id: "decoy", t: 134, at: T0, detail: { building: 20, level: 2, quantity: 0 } },
      { kind: "upgrade", id: 1, t: 14, at: T0, detail: { from: 6, level: 7, points: 0 } },
    ] as CompletedJob[];
    expect(siegeSlices(save, completed, null)).toEqual({ siege: { decoy: { level: 2, quantity: 0 } } });

    const report = {
      site: "factory",
      weapon: "jars",
      siege: { decoy: { level: 2, quantity: 0 }, vacuum: { level: 0, quantity: 0 }, jars: { level: 1, quantity: 1 } },
      purse: { r1: 5, r2: 6, r3: 7, r4: 0, caps: { r1: 10, r2: 10, r3: 10, r4: 10 } },
    };
    const slices = siegeSlices(save, [], report);
    expect(slices.siege).toEqual(report.siege);
    expect(slices.iresources).toEqual({ r1: 5, r2: 6, r3: 7, r4: 0, r1max: 10, r2max: 10, r3max: 10, r4max: 10 });
    expect(siegeSlices(save, [], { monster: "C3" })).toEqual({});
    // A build, upgrade, cancel or recycle of a main-yard Inferno building reports its purse too (WP 6.1).
    const built = { id: 30, t: 129, purse: { r1: 1, r2: 2, r3: 3, r4: 4, caps: { r1: 9, r2: 9, r3: 9, r4: 9 } } };
    expect(siegeSlices(save, [], built)).toEqual({
      iresources: { r1: 1, r2: 2, r3: 3, r4: 4, r1max: 9, r2max: 9, r3max: 9, r4max: 9 },
    });
  });

  it("the job list carries each running job; its prediction adds a level or makes the weapon", () => {
    const buildings = {
      "20": labAt(3, { unlockingWeapons: { decoy: T0 + 10 } }),
      "21": building(21, 133, 1, { unlockingWeapons: { jars: T0 + 20 } }),
    };
    const jobs = siegeJobs(buildings);
    expect(jobs.map((job) => [job.kind, job.id, job.buildingId, job.endsAt])).toEqual([
      [JobKind.SIEGE, "decoy", 20, T0 + 10],
      [JobKind.SIEGE, "jars", 21, T0 + 20],
    ]);
    const save = saveOf({ buildingdata: buildings, siege: { decoy: { level: 1, quantity: 0 }, jars: { level: 1 } } });
    const next = predictCompletion(save, jobs);
    expect(next.siege).toEqual({ decoy: { level: 2, quantity: 0 }, jars: { level: 1, quantity: 1 } });
    expect(next.buildingdata?.["20"]?.["unlockingWeapons"]).toBeUndefined();
    expect(save.buildingdata?.["20"]?.["unlockingWeapons"]).toEqual({ decoy: T0 + 10 });
  });
});
