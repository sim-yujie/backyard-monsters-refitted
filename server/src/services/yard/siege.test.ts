import { describe, expect, test } from "bun:test";
import { DECOY, JARS, VACUUM } from "../../game-rules/combat/siege.js";
import { ClientSafeError } from "../../middleware/clientSafeError.js";
import type { BuildingData, BuildingDataMap } from "../../types/BuildingData.js";
import type { JsonObject } from "../../types/JsonObject.js";
import { planOneUpgrade } from "../yardplanner/startUpgrades.js";
import { catchUpYard } from "./catchUp.js";
import { resourcesPrice, timeCost } from "./shiny.js";
import {
  SIEGE_FACTORY_TYPE,
  SIEGE_LAB_TYPE,
  catchUpSiege,
  planSiegeCancel,
  planSiegeFinish,
  planSiegeInstant,
  planSiegeStart,
  siegeHold,
  siegeJob,
  siegeStock,
  type SiegeSave,
} from "./siege.js";

/**
 * The Siege Lab and Factory rules (Inferno WP 6.3) against Flash's
 * `com/monsters/siege/` and `STORE.as:155-185`: the gates in the popup's
 * order, the Inferno purse charged floored and funded up to its caps, the
 * Shiny prices, and the catch-up.
 */

const NOW = 1_800_000_000;
const LAB = 20;
const FACTORY = 21;

const MILLION = 1_000_000;

/** A purse of `held` in each resource, every cap 1,000,000. */
const purse = (held: Partial<Record<"r1" | "r2" | "r3" | "r4", number>> = {}): JsonObject => ({
  r1: 500_000,
  r2: 500_000,
  r3: 500_000,
  r4: 500_000,
  ...held,
  r1max: MILLION,
  r2max: MILLION,
  r3max: MILLION,
  r4max: MILLION,
});

/** A main yard: a Town Hall, a Siege Lab at `labLevel`, a Siege Factory; no weapons yet. */
const saveOf = (overrides: Partial<SiegeSave> = {}, labLevel = 5): SiegeSave => ({
  type: "main",
  buildingdata: {
    "0": { id: 0, t: 14, x: 0, y: 0, l: 9 },
    [String(LAB)]: { id: LAB, t: SIEGE_LAB_TYPE, x: 100, y: 100, l: labLevel },
    [String(FACTORY)]: { id: FACTORY, t: SIEGE_FACTORY_TYPE, x: 200, y: 200, l: 1 },
  },
  buildinghealthdata: {},
  siege: {},
  iresources: purse(),
  ...overrides,
});

/** The yard's buildings with one entry replaced or added. */
const withBuilding = (save: SiegeSave, id: number, building: Partial<BuildingData>): BuildingDataMap => ({
  ...save.buildingdata,
  [String(id)]: { ...save.buildingdata![String(id)], ...building } as BuildingData,
});

/** What `fn` threw, as `{ status, reason, ...detail }`. */
const refusal = (fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    if (err instanceof ClientSafeError) return { status: err.status, ...(err.data as object) };
    throw err;
  }
  throw new Error("expected a refusal");
};

const building = (save: SiegeSave, id: number) => save.buildingdata![String(id)]!;

describe("Lab start", () => {
  test("charges the floored cost and starts the job (Decoy level 1: 37,599 / 43,866 / 43,866, 4 h)", () => {
    const save = saveOf();
    const plan = planSiegeStart(save, "lab", "decoy", NOW);

    expect(plan.report).toMatchObject({
      site: "lab",
      weapon: "decoy",
      building: LAB,
      endsAt: NOW + 14_400,
      cost: { r1: 37_599, r2: 43_866, r3: 43_866, r4: 0 },
      credits: 0,
    });
    expect(plan.slices.iresources).toMatchObject({
      r1: 500_000 - 37_599,
      r2: 500_000 - 43_866,
      r3: 500_000 - 43_866,
      r4: 500_000,
      r1max: MILLION,
    });
    expect(plan.slices.buildingdata![String(LAB)]).toMatchObject({ unlockingWeapons: { decoy: NOW + 14_400 } });
    expect(plan.shiny).toBe(0);
    // Nothing on the weapon until it is done.
    expect(plan.report.siege.decoy).toEqual({ level: 0, quantity: 0 });
  });

  test("level N needs a level N Lab (`msg_upgraderequiredlevel`)", () => {
    const save = saveOf({ siege: { vacuum: { level: 1, quantity: 0 } } }, 1);
    expect(refusal(() => planSiegeStart(save, "lab", "vacuum", NOW))).toMatchObject({
      status: 409,
      reason: "labLevel",
      have: 1,
      need: 2,
    });
    expect(planSiegeStart(saveOf({}, 1), "lab", "vacuum", NOW).report.endsAt).toBe(NOW + VACUUM.upgradeCosts[0]!.time);
  });

  test("a weapon at level 10 is refused", () => {
    const save = saveOf({ siege: { jars: { level: 10, quantity: 0 } } }, 10);
    expect(refusal(() => planSiegeStart(save, "lab", "jars", NOW))).toMatchObject({
      reason: "maxLevel",
      weapon: "jars",
      level: 10,
    });
  });

  test("one weapon at a time, checked in the popup's order", () => {
    const busy = saveOf({ siege: { jars: { level: 10, quantity: 0 } } });
    busy.buildingdata = withBuilding(busy, LAB, { unlockingWeapons: { decoy: NOW + 100 } });

    expect(refusal(() => planSiegeStart(busy, "lab", "decoy", NOW))).toMatchObject({
      reason: "labBusy",
      weapon: "decoy",
    });
    // The level-10 check comes before the other-weapon one.
    expect(refusal(() => planSiegeStart(busy, "lab", "jars", NOW))).toMatchObject({ reason: "maxLevel" });
    expect(refusal(() => planSiegeStart(busy, "lab", "vacuum", NOW))).toMatchObject({
      reason: "labBusy",
      weapon: "decoy",
    });
  });

  test("an unknown weapon is a 400", () => {
    expect(refusal(() => planSiegeStart(saveOf(), "lab", "catapult", NOW))).toMatchObject({ status: 400 });
  });
});

describe("the building must be usable", () => {
  test("none, or one still being built, is noSiegeLab / noSiegeFactory", () => {
    const none = saveOf();
    delete none.buildingdata![String(LAB)];
    delete none.buildingdata![String(FACTORY)];
    expect(refusal(() => planSiegeStart(none, "lab", "decoy", NOW))).toMatchObject({ reason: "noSiegeLab" });
    expect(refusal(() => planSiegeStart(none, "factory", "decoy", NOW))).toMatchObject({
      reason: "noSiegeFactory",
    });

    const building = saveOf();
    building.buildingdata = withBuilding(building, LAB, { l: 0, cB: 600 });
    expect(refusal(() => planSiegeStart(building, "lab", "decoy", NOW))).toMatchObject({ reason: "noSiegeLab" });
  });

  test("upgrading or fortifying is busy", () => {
    const save = saveOf();
    save.buildingdata = withBuilding(save, LAB, { cU: 600 });
    expect(refusal(() => planSiegeStart(save, "lab", "decoy", NOW))).toMatchObject({ reason: "busy", id: LAB });
    save.buildingdata = withBuilding(save, LAB, { cU: 0, cF: 600 });
    expect(refusal(() => planSiegeInstant(save, "lab", "decoy"))).toMatchObject({ reason: "busy", id: LAB });
  });

  test("under half health is damaged; half is enough", () => {
    // A level 5 Lab has 35,300 health.
    const save = saveOf();
    save.buildingdata = withBuilding(save, LAB, { hp: 17_649 });
    expect(refusal(() => planSiegeStart(save, "lab", "decoy", NOW))).toMatchObject({ reason: "damaged", id: LAB });
    save.buildingdata = withBuilding(save, LAB, { hp: 17_650 });
    expect(planSiegeStart(save, "lab", "decoy", NOW).report.weapon).toBe("decoy");
  });
});

describe("Inferno resources short", () => {
  test("names the Shiny the shortfall costs, then buys only the shortfall", () => {
    const save = saveOf({ iresources: purse({ r1: 30_000, r2: 50_000, r3: 40_000 }) });
    const [r1, r2, r3] = [DECOY.upgradeCosts[0]!.r1, DECOY.upgradeCosts[0]!.r2, DECOY.upgradeCosts[0]!.r3];
    // GetShinyCostFromTotalResources(7,599.96 + 3,866.62) = ceil(sqrt(11,466.58 / 2) ^ 0.75) = 26.
    const price = resourcesPrice(r1 - 30_000 + (r3 - 40_000));
    expect(price).toBe(26);
    expect(r2).toBeLessThan(50_000);

    expect(refusal(() => planSiegeStart(save, "lab", "decoy", NOW))).toMatchObject({
      status: 409,
      reason: "shortfall",
      shortfall: { r1: 7_600, r2: 0, r3: 3_867, r4: 0 },
      topUp: 26,
    });
    expect(refusal(() => planSiegeStart(save, "lab", "decoy", NOW, 25))).toMatchObject({ reason: "shortfall" });

    const plan = planSiegeStart(save, "lab", "decoy", NOW, 26);
    expect(plan.shiny).toBe(26);
    expect(plan.report.credits).toBe(26);
    // Flash's top-up filled every resource to its cap (its NaN); here the short ones end at 0.
    expect(plan.slices.iresources).toMatchObject({ r1: 0, r2: 50_000 - 43_866, r3: 0, r4: 500_000 });
  });

  test("a purse whose cap cannot hold the cost is refused (`msg_morepodsunlock`)", () => {
    const save = saveOf({ iresources: { ...purse({ r1: 10_000 }), r1max: 30_000 } });
    expect(refusal(() => planSiegeStart(save, "lab", "decoy", NOW, 1_000))).toMatchObject({
      reason: "capacity",
      need: { r1: 37_599, r2: 43_866, r3: 43_866, r4: 0 },
      caps: { r1: 30_000, r2: MILLION },
    });
  });

  test("a purse that holds the cost exactly is not short", () => {
    const cost = DECOY.upgradeCosts[0]!;
    // Held as floored integers, one under the raw cost is short by a fraction.
    const save = saveOf({ iresources: purse({ r1: Math.floor(cost.r1) }) });
    expect(refusal(() => planSiegeStart(save, "lab", "decoy", NOW))).toMatchObject({
      reason: "shortfall",
      shortfall: { r1: 1 },
      topUp: 1,
    });
    const enough = saveOf({ iresources: purse({ r1: Math.ceil(cost.r1) }) });
    expect(planSiegeStart(enough, "lab", "decoy", NOW).slices.iresources).toMatchObject({ r1: 1 });
  });
});

describe("Factory", () => {
  const researched = { decoy: { level: 1, quantity: 0 }, vacuum: { level: 3, quantity: 0 } };

  test("makes one at the weapon's level (Decoy level 1: 14,324 / 28,648 / 28,648, 50 min)", () => {
    const plan = planSiegeStart(saveOf({ siege: researched }), "factory", "decoy", NOW);
    expect(plan.report).toMatchObject({
      site: "factory",
      building: FACTORY,
      endsAt: NOW + 3_000,
      cost: { r1: 14_324, r2: 28_648, r3: 28_648, r4: 0 },
    });
    expect(plan.slices.buildingdata![String(FACTORY)]).toMatchObject({ unlockingWeapons: { decoy: NOW + 3_000 } });

    const vacuum = planSiegeStart(saveOf({ siege: researched }), "factory", "vacuum", NOW);
    expect(vacuum.report.endsAt).toBe(NOW + VACUUM.buildCosts[2]!.time);
  });

  test("a weapon not yet researched is locked", () => {
    expect(refusal(() => planSiegeStart(saveOf({ siege: researched }), "factory", "jars", NOW))).toMatchObject({
      reason: "locked",
      weapon: "jars",
    });
  });

  test("makes or holds one weapon at a time", () => {
    const making = saveOf({ siege: researched });
    making.buildingdata = withBuilding(making, FACTORY, { unlockingWeapons: { vacuum: NOW + 100 } });
    expect(refusal(() => planSiegeStart(making, "factory", "vacuum", NOW))).toMatchObject({
      reason: "factoryBusy",
      weapon: "vacuum",
    });
    expect(refusal(() => planSiegeStart(making, "factory", "decoy", NOW))).toMatchObject({
      reason: "factoryBusy",
      weapon: "vacuum",
    });

    const holding = saveOf({ siege: { ...researched, vacuum: { level: 3, quantity: 1 } } });
    expect(refusal(() => planSiegeStart(holding, "factory", "vacuum", NOW))).toMatchObject({
      reason: "holding",
      weapon: "vacuum",
    });
    expect(refusal(() => planSiegeStart(holding, "factory", "decoy", NOW))).toMatchObject({
      reason: "holding",
      weapon: "vacuum",
    });
    expect(refusal(() => planSiegeInstant(holding, "factory", "decoy"))).toMatchObject({ reason: "holding" });
  });
});

describe("cancel", () => {
  test("returns the cost floored, the job gone", () => {
    const save = saveOf();
    const started = planSiegeStart(save, "lab", "decoy", NOW);
    Object.assign(save, started.slices);

    const plan = planSiegeCancel(save, "lab");
    expect(plan.report).toMatchObject({
      site: "lab",
      weapon: "decoy",
      refund: { r1: 37_599, r2: 43_866, r3: 43_866, r4: 0 },
    });
    expect(plan.slices.iresources).toMatchObject({ r1: 500_000, r2: 500_000, r3: 500_000, r4: 500_000 });
    expect(siegeJob(plan.slices.buildingdata![String(LAB)])).toBeNull();
    expect(plan.slices.buildingdata![String(LAB)]).not.toHaveProperty("unlockingWeapons");
  });

  test("up to each cap, never lowering a purse already over it (`BASE.Fund`)", () => {
    const save = saveOf({ iresources: purse({ r1: 990_000, r2: 1_200_000 }) });
    save.buildingdata = withBuilding(save, LAB, { unlockingWeapons: { decoy: NOW + 100 } });

    const plan = planSiegeCancel(save, "lab");
    expect(plan.report.refund).toEqual({ r1: 10_000, r2: 0, r3: 43_866, r4: 0 });
    expect(plan.slices.iresources).toMatchObject({ r1: MILLION, r2: 1_200_000, r3: 543_866 });
  });

  test("the Factory's at the weapon's build cost", () => {
    const save = saveOf({ siege: { jars: { level: 2, quantity: 0 } } });
    save.buildingdata = withBuilding(save, FACTORY, { unlockingWeapons: { jars: NOW + 100 } });
    const cost = JARS.buildCosts[1]!;
    expect(planSiegeCancel(save, "factory").report.refund).toEqual({
      r1: Math.floor(cost.r1),
      r2: Math.floor(cost.r2),
      r3: Math.floor(cost.r3),
      r4: Math.floor(cost.r4),
    });
  });

  test("with nothing running is notBusy", () => {
    expect(refusal(() => planSiegeCancel(saveOf(), "lab"))).toMatchObject({ reason: "notBusy" });
    expect(refusal(() => planSiegeFinish(saveOf(), "factory", NOW))).toMatchObject({ reason: "notBusy" });
  });
});

describe("Shiny", () => {
  test("finish costs GetTimeCost(seconds left) and does the job", () => {
    const save = saveOf({ siege: { decoy: { level: 2, quantity: 0 } } });
    save.buildingdata = withBuilding(save, LAB, { unlockingWeapons: { decoy: NOW + 14_400 } });

    const plan = planSiegeFinish(save, "lab", NOW);
    // min(ceil(14,400 × 20 / 3,600), int(sqrt(14,400 × 0.8))) = min(80, 107).
    expect(plan.shiny).toBe(80);
    expect(plan.report).toMatchObject({ site: "lab", weapon: "decoy", credits: 80 });
    expect(siegeStock(plan.slices.siege, "decoy")).toEqual({ level: 3, quantity: 0 });
    expect(plan.slices.buildingdata![String(LAB)]).not.toHaveProperty("unlockingWeapons");
  });

  test("finish is free with five minutes or less left", () => {
    const save = saveOf({ siege: { vacuum: { level: 1, quantity: 0 } } });
    save.buildingdata = withBuilding(save, FACTORY, { unlockingWeapons: { vacuum: NOW + 300 } });
    const plan = planSiegeFinish(save, "factory", NOW);
    expect(plan.shiny).toBe(0);
    expect(siegeStock(plan.slices.siege, "vacuum")).toEqual({ level: 1, quantity: 1 });
  });

  test("instant costs GetInstantBuyCost(cost) and takes no resources", () => {
    const plan = planSiegeInstant(saveOf(), "lab", "decoy");
    const cost = DECOY.upgradeCosts[0]!;
    // GetTimeCost(14,400) + GetResourceCost(125,333.2) = 80 + 63.
    expect(plan.shiny).toBe(143);
    expect(plan.shiny).toBe(timeCost(cost.time) + resourcesPrice(cost.r1 + cost.r2 + cost.r3 + cost.r4));
    expect(plan.slices).not.toHaveProperty("iresources");
    expect(plan.slices).not.toHaveProperty("buildingdata");
    expect(siegeStock(plan.slices.siege, "decoy")).toEqual({ level: 1, quantity: 0 });
  });

  test("instant keeps the Lab's other gates", () => {
    const save = saveOf({ siege: { decoy: { level: 1, quantity: 0 } } }, 1);
    expect(refusal(() => planSiegeInstant(save, "lab", "decoy"))).toMatchObject({ reason: "labLevel" });
  });

  test("other weapon fields are kept", () => {
    const save = saveOf({ siege: { decoy: { level: 1, quantity: 0, extra: 5 }, jars: { level: 4, quantity: 0 } } });
    const plan = planSiegeInstant(save, "factory", "decoy");
    expect(plan.slices.siege).toEqual({
      decoy: { level: 1, quantity: 1, extra: 5 },
      jars: { level: 4, quantity: 0 },
    });
  });
});

describe("siegeHold (upgrade and recycle refusals)", () => {
  const lab = (extra: Partial<BuildingData> = {}) => ({ id: LAB, t: SIEGE_LAB_TYPE, x: 0, y: 0, l: 2, ...extra }) as BuildingData;
  const factory = (extra: Partial<BuildingData> = {}) =>
    ({ id: FACTORY, t: SIEGE_FACTORY_TYPE, x: 0, y: 0, l: 1, ...extra }) as BuildingData;

  test("the Lab while it researches: unlocking a level 0 weapon, else upgrading", () => {
    expect(siegeHold(lab(), {})).toBeNull();
    expect(siegeHold(lab({ unlockingWeapons: { decoy: NOW } }), {})).toEqual({ hold: "unlocking", weapon: "decoy" });
    expect(siegeHold(lab({ unlockingWeapons: { decoy: NOW } }), { decoy: { level: 1 } })).toEqual({
      hold: "upgrading",
      weapon: "decoy",
    });
  });

  test("the Factory while it makes or holds a weapon", () => {
    expect(siegeHold(factory(), { decoy: { level: 1, quantity: 0 } })).toBeNull();
    expect(siegeHold(factory({ unlockingWeapons: { jars: NOW } }), {})).toEqual({ hold: "building", weapon: "jars" });
    expect(siegeHold(factory(), { vacuum: { level: 1, quantity: 1 } })).toEqual({ hold: "holding", weapon: "vacuum" });
  });

  test("no other building", () => {
    expect(siegeHold({ id: 1, t: 116, x: 0, y: 0, l: 1, unlockingWeapons: { decoy: NOW } } as BuildingData, {})).toBeNull();
  });

  test("planOneUpgrade refuses busy with the hold", () => {
    const save = { ...saveOf(), resources: { r1: 1e9, r2: 1e9, r3: 1e9, r4: 1e9 }, storedata: {} };
    save.buildingdata = withBuilding(save, LAB, { unlockingWeapons: { decoy: NOW + 100 } });
    expect(planOneUpgrade(save, LAB, NOW)).toMatchObject({
      ok: false,
      reason: "busy",
      siege: { hold: "unlocking", weapon: "decoy" },
    });
  });
});

describe("catchUpSiege", () => {
  test("a job that has ended is done and reported; one still running is kept", () => {
    const save = saveOf({ siege: { vacuum: { level: 2, quantity: 0 } } });
    save.buildingdata = withBuilding(save, LAB, { unlockingWeapons: { decoy: NOW - 5 } });
    save.buildingdata = withBuilding(save, FACTORY, { unlockingWeapons: { vacuum: NOW + 60 } });

    const jobs = catchUpSiege(save, NOW - 1_000, NOW);
    expect(jobs).toEqual([
      { kind: "siege", id: "decoy", t: SIEGE_LAB_TYPE, at: NOW - 5, detail: { building: LAB, level: 1, quantity: 0 } },
    ]);
    expect(siegeStock(save.siege, "decoy")).toEqual({ level: 1, quantity: 0 });
    expect(building(save, LAB)).not.toHaveProperty("unlockingWeapons");
    expect(building(save, FACTORY)).toMatchObject({ unlockingWeapons: { vacuum: NOW + 60 } });

    // Idempotent at the same `now`.
    const again = structuredClone(save);
    expect(catchUpSiege(again, NOW, NOW)).toEqual([]);
    expect(again).toEqual(save);
  });

  test("the Factory's job makes the weapon", () => {
    const save = saveOf({ siege: { jars: { level: 4, quantity: 0 } } });
    save.buildingdata = withBuilding(save, FACTORY, { unlockingWeapons: { jars: NOW - 1 } });
    expect(catchUpSiege(save, NOW - 100, NOW)[0]).toMatchObject({ t: SIEGE_FACTORY_TYPE, detail: { level: 4, quantity: 1 } });
    expect(siegeStock(save.siege, "jars")).toEqual({ level: 4, quantity: 1 });
  });

  test("paused over a window its building spends destroyed", () => {
    const save = saveOf();
    save.buildingdata = withBuilding(save, LAB, { hp: 0, unlockingWeapons: { decoy: NOW - 5 } });
    expect(catchUpSiege(save, NOW - 1_000, NOW)).toEqual([]);
    expect(building(save, LAB)).toMatchObject({ unlockingWeapons: { decoy: NOW + 995 } });

    // Repairing, it runs again.
    const repairing = saveOf();
    repairing.buildingdata = withBuilding(repairing, LAB, { hp: 0, rE: 1, unlockingWeapons: { decoy: NOW - 5 } });
    expect(catchUpSiege(repairing, NOW - 1_000, NOW)).toHaveLength(1);

    // Damaged but standing, it runs.
    const damaged = saveOf();
    damaged.buildingdata = withBuilding(damaged, LAB, { hp: 1, unlockingWeapons: { decoy: NOW - 5 } });
    expect(catchUpSiege(damaged, NOW - 1_000, NOW)).toHaveLength(1);
  });

  test("Flash's own `unlockingWeapons2` (seconds left) is made absolute from the window's start", () => {
    const save = saveOf();
    save.buildingdata = withBuilding(save, LAB, { unlockingWeapons2: { vacuum: 5_000 } });
    expect(catchUpSiege(save, NOW - 1_000, NOW)).toEqual([]);
    expect(building(save, LAB)).toMatchObject({ unlockingWeapons: { vacuum: NOW + 4_000 } });
    expect(building(save, LAB)).not.toHaveProperty("unlockingWeapons2");

    const done = saveOf();
    done.buildingdata = withBuilding(done, LAB, { unlockingWeapons2: { vacuum: 500 } });
    expect(catchUpSiege(done, NOW - 1_000, NOW)).toMatchObject([{ id: "vacuum", at: NOW - 500 }]);
  });

  test("unreadable job fields are dropped", () => {
    const save = saveOf();
    save.buildingdata = withBuilding(save, LAB, { unlockingWeapons: { catapult: NOW - 5, decoy: "soon" } });
    expect(catchUpSiege(save, NOW - 1_000, NOW)).toEqual([]);
    expect(building(save, LAB)).not.toHaveProperty("unlockingWeapons");
  });

  test("runs in catchUpYard and is reported in `completed`", () => {
    const save = { ...saveOf(), savetime: NOW - 1_000 };
    save.buildingdata = withBuilding(save, LAB, { unlockingWeapons: { jars: NOW - 10 } });
    const completed = catchUpYard(save as Parameters<typeof catchUpYard>[0], NOW);
    expect(completed.filter((job) => job.kind === "siege")).toMatchObject([{ id: "jars", at: NOW - 10 }]);
    expect(siegeStock(save.siege, "jars").level).toBe(1);
  });
});
