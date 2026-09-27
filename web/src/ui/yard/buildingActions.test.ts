import { describe, expect, it } from "vitest";
import type { BaseLoadResponse, BuildingData, ResourceCaps, Resources } from "@/api/types";
import { readYard, type YardBuilding } from "@/game/yard/yardModel";
import {
  cancelOffer,
  jobOffer,
  panelModel,
  upgradeOffer,
  type PanelContext,
} from "./buildingActions";

/**
 * What the building panel offers, per building type and state, and the one
 * reason it gives when Upgrade cannot start (WP1.5 tests: "which actions show
 * per type and state; gate message order").
 *
 * The gate order is the server's (`planUpgradeAction` → `planOneUpgrade`):
 * damaged, no Town Hall, top of the ladder, prerequisites, resources, a free
 * worker. Each test below builds a yard where two gates fail at once and
 * checks the earlier one is the one reported.
 *
 * Costs used (from the generated table): Cannon Tower L4 → L5 is 1,250,000
 * twigs, 937,500 pebbles, 312,500 putty, 24,300 s, needing Town Hall 4.
 * Sniper Tower L4 → L5 needs Town Hall 5. Hatchery L1 → L2 needs Town Hall 3
 * and a Monster Locker. A Booby Trap step is 5 s.
 */

const T0 = 2_000_000;
const RICH: Resources = { r1: 1e8, r2: 1e8, r3: 1e8, r4: 1e8 };
const CAPS: ResourceCaps = { r1: 5e8, r2: 5e8, r3: 5e8, r4: 5e8 };

const building = (id: number, t: number, l: number, extra: Partial<BuildingData> = {}): BuildingData => ({
  id,
  t,
  l,
  X: id * 40,
  Y: 0,
  ...extra,
});

interface Fixture {
  readonly buildings: BuildingData[];
  readonly resources?: Resources;
  readonly caps?: ResourceCaps | null;
  readonly credits?: number;
  readonly storedata?: BaseLoadResponse["storedata"];
  readonly health?: BaseLoadResponse["buildinghealthdata"];
  readonly now?: number;
}

const contextOf = (fixture: Fixture): PanelContext => {
  const save = {
    error: 0,
    currenttime: T0,
    savetime: T0,
    resources: fixture.resources ?? RICH,
    credits: fixture.credits ?? 1_000,
    buildingdata: Object.fromEntries(fixture.buildings.map((one) => [String(one.id), one])),
    buildinghealthdata: fixture.health ?? {},
    storedata: fixture.storedata ?? { BEW: { q: 4 } },
  } as unknown as BaseLoadResponse;
  const yard = readYard(save);
  return {
    yard,
    save,
    resources: save.resources ?? {},
    credits: save.credits ?? 0,
    caps: fixture.caps === undefined ? CAPS : fixture.caps,
    workers: yard.workers,
    now: () => fixture.now ?? T0,
  };
};

const pick = (context: PanelContext, id: number): YardBuilding => {
  const found = context.yard.buildings.find((one) => one.id === id);
  if (!found) throw new Error(`no building ${id}`);
  return found;
};

const HALL = (level: number) => building(1, 14, level);

describe("upgradeOffer: the next step", () => {
  it("offers the next level with its table cost, time and instant price", () => {
    const context = contextOf({ buildings: [HALL(5), building(2, 20, 4)] });
    const offer = upgradeOffer(pick(context, 2), context);
    expect(offer).toMatchObject({
      from: 4,
      to: 5,
      cost: { r1: 1_250_000, r2: 937_500, r3: 312_500, r4: 0 },
      seconds: 24_300,
      finishesAtOnce: false,
      gate: null,
      instantGate: null,
    });
    expect(offer?.instantPrice).toBeGreaterThan(0);
  });

  it("shortens the time under Sharper Tools, as the server writes it", () => {
    const context = contextOf({
      buildings: [HALL(5), building(2, 20, 4)],
      storedata: { BEW: { q: 4 }, BST: { q: 1, e: T0 + 60 } },
    });
    expect(upgradeOffer(pick(context, 2), context)?.seconds).toBe(Math.floor(24_300 * 0.8));
  });

  it("marks a step of five minutes or less as finishing at once, needing no worker", () => {
    // Twig Snapper L1 → L2 is 300 s; the only worker is busy on another job.
    const context = contextOf({
      buildings: [HALL(5), building(2, 1, 1), building(3, 20, 1, { cU: 500 })],
      storedata: {},
    });
    expect(upgradeOffer(pick(context, 2), context)).toMatchObject({
      finishesAtOnce: true,
      seconds: 300,
      gate: null,
    });
  });
});

describe("upgradeOffer: gate order", () => {
  it("damaged comes before a Town Hall requirement and a shortfall", () => {
    const context = contextOf({
      buildings: [HALL(4), building(2, 21, 4, { hp: 10 })],
      resources: { r1: 0, r2: 0, r3: 0, r4: 0 },
    });
    expect(upgradeOffer(pick(context, 2), context)?.gate).toEqual({ reason: "damaged" });
  });

  it("a buildinghealthdata entry alone counts as damaged, as on the server", () => {
    const context = contextOf({
      buildings: [HALL(5), building(2, 20, 4)],
      health: { "2": 500 } as BaseLoadResponse["buildinghealthdata"],
    });
    expect(upgradeOffer(pick(context, 2), context)?.gate?.reason).toBe("damaged");
  });

  it("no Town Hall comes before everything but damage", () => {
    const context = contextOf({
      buildings: [building(2, 20, 4)],
      resources: { r1: 0, r2: 0, r3: 0, r4: 0 },
    });
    expect(upgradeOffer(pick(context, 2), context)?.gate).toEqual({
      reason: "townHall",
      have: 0,
      need: 1,
    });
  });

  it("the Town Hall prerequisite comes before a shortfall", () => {
    const context = contextOf({
      buildings: [HALL(4), building(2, 21, 4)],
      resources: { r1: 0, r2: 0, r3: 0, r4: 0 },
    });
    expect(upgradeOffer(pick(context, 2), context)?.gate).toEqual({
      reason: "townHall",
      have: 4,
      need: 5,
    });
  });

  it("another building's prerequisite comes before a shortfall", () => {
    const context = contextOf({
      buildings: [HALL(5), building(2, 13, 1)],
      resources: { r1: 0, r2: 0, r3: 0, r4: 0 },
    });
    expect(upgradeOffer(pick(context, 2), context)?.gate).toEqual({
      reason: "requirements",
      requirements: [[8, 1, 1]],
    });
  });

  it("a shortfall comes before busy workers, and names what is missing", () => {
    const context = contextOf({
      buildings: [HALL(5), building(2, 20, 4), building(3, 20, 1, { cU: 500 })],
      resources: { r1: 1_000_000, r2: 1e8, r3: 1e8, r4: 1e8 },
      storedata: {},
    });
    expect(upgradeOffer(pick(context, 2), context)?.gate).toEqual({
      reason: "shortfall",
      shortfall: { r1: 250_000, r2: 0, r3: 0, r4: 0 },
      overCap: false,
    });
  });

  it("says more silos when the cost is over the storage cap", () => {
    const context = contextOf({
      buildings: [HALL(5), building(2, 20, 4)],
      resources: { r1: 1_000_000, r2: 1e8, r3: 1e8, r4: 1e8 },
      caps: { r1: 1_000_000, r2: 5e8, r3: 5e8, r4: 5e8 },
    });
    expect(upgradeOffer(pick(context, 2), context)?.gate).toMatchObject({
      reason: "shortfall",
      overCap: true,
    });
  });

  it("all workers busy is the last gate", () => {
    const context = contextOf({
      buildings: [HALL(5), building(2, 20, 4), building(3, 20, 1, { cU: 500 })],
      storedata: {},
    });
    expect(upgradeOffer(pick(context, 2), context)?.gate).toEqual({
      reason: "workers",
      total: 1,
      busy: 1,
    });
  });

  it("instant ignores resources and workers but needs the Shiny", () => {
    const context = contextOf({
      buildings: [HALL(5), building(2, 20, 4), building(3, 20, 1, { cU: 500 })],
      resources: { r1: 0, r2: 0, r3: 0, r4: 0 },
      storedata: {},
      credits: 0,
    });
    const offer = upgradeOffer(pick(context, 2), context);
    expect(offer?.gate?.reason).toBe("shortfall");
    expect(offer?.instantGate).toEqual({ reason: "credits", need: offer?.instantPrice });

    const rich = contextOf({
      buildings: [HALL(5), building(2, 20, 4), building(3, 20, 1, { cU: 500 })],
      resources: { r1: 0, r2: 0, r3: 0, r4: 0 },
      storedata: {},
      credits: 10_000,
    });
    expect(upgradeOffer(pick(rich, 2), rich)?.instantGate).toBeNull();
  });

  it("instant shares the prerequisite gates", () => {
    const context = contextOf({ buildings: [HALL(4), building(2, 21, 4)], credits: 10_000 });
    expect(upgradeOffer(pick(context, 2), context)?.instantGate?.reason).toBe("townHall");
  });
});

describe("panelModel: which blocks each building gets", () => {
  it("a tower at rest: Upgrade, no job, no door", () => {
    const context = contextOf({ buildings: [HALL(5), building(2, 20, 4)] });
    const model = panelModel(pick(context, 2), context);
    expect(model.upgrade).not.toBeNull();
    expect(model).toMatchObject({ job: null, open: null, maxed: false, batch: false });
  });

  it("a tower at the top of its ladder: no Upgrade, marked maxed", () => {
    const context = contextOf({ buildings: [HALL(10), building(2, 20, 10)] });
    const model = panelModel(pick(context, 2), context);
    expect(model.upgrade).toBeNull();
    expect(model.maxed).toBe(true);
  });

  it("walls and traps: no Upgrade here, pointed at the planner", () => {
    const context = contextOf({ buildings: [HALL(5), building(2, 17, 1), building(3, 24, 1)] });
    for (const id of [2, 3]) {
      const model = panelModel(pick(context, id), context);
      expect(model.upgrade).toBeNull();
      expect(model.batch).toBe(true);
      expect(model.maxed).toBe(false);
    }
  });

  it("the Map Room: Open map and never Upgrade", () => {
    const context = contextOf({ buildings: [HALL(6), building(2, 11, 1)] });
    const model = panelModel(pick(context, 2), context);
    expect(model).toMatchObject({ upgrade: null, maxed: false, open: "map", openBlocked: null });
  });

  it("the Map Room below Town Hall 6 says the map is not open yet", () => {
    const context = contextOf({ buildings: [HALL(5), building(2, 11, 1)] });
    expect(panelModel(pick(context, 2), context).openBlocked).toMatch(/Town Hall 6/);
  });

  it("the Yard Planner opens the planner", () => {
    const context = contextOf({ buildings: [HALL(5), building(2, 10, 1)] });
    const model = panelModel(pick(context, 2), context);
    expect(model.open).toBe("planner");
    // One level only.
    expect(model.maxed).toBe(true);
  });

  it("a decoration offers nothing", () => {
    const context = contextOf({ buildings: [HALL(5), building(2, 55, 1)] });
    expect(panelModel(pick(context, 2), context)).toMatchObject({
      upgrade: null,
      maxed: false,
      job: null,
      open: null,
      batch: false,
    });
  });

  it("an upgrading building shows its job with speed-ups and Cancel instead of Upgrade", () => {
    const context = contextOf({ buildings: [HALL(5), building(2, 20, 4, { cU: 5_400 })] });
    const model = panelModel(pick(context, 2), context);
    expect(model.upgrade).toBeNull();
    expect(model.job).toMatchObject({ kind: "upgrade", to: 5, remaining: 5_400, total: 24_300 });
    expect(model.job?.cancel).not.toBeNull();
    expect(model.job?.finish?.item).toBe("SP4");
  });

  it("a building under construction has speed-ups but no Cancel", () => {
    const context = contextOf({ buildings: [HALL(5), building(2, 20, 0, { cB: 20 })] });
    const job = panelModel(pick(context, 2), context).job;
    expect(job).toMatchObject({ kind: "build", to: 1 });
    expect(job?.cancel).toBeNull();
    expect(job?.finish?.item).toBe("SP1");
  });

  it("a fortify countdown shows its clock but no speed-ups", () => {
    const context = contextOf({ buildings: [HALL(5), building(2, 20, 4, { cF: 600 })] });
    const job = panelModel(pick(context, 2), context).job;
    expect(job).toMatchObject({ kind: "fortify", finish: null, minusOne: null, cancel: null });
  });
});

describe("jobOffer: speed-ups by time left", () => {
  const at = (seconds: number, credits = 1_000, extra: Partial<BuildingData> = {}) => {
    const context = contextOf({
      buildings: [HALL(5), building(2, 20, 4, { cU: seconds, ...extra })],
      credits,
    });
    const job = jobOffer(pick(context, 2), context);
    if (!job) throw new Error("no job");
    return job;
  };

  it("90 minutes: Finish now at the time price, −1 h yes, −2 h no", () => {
    const job = at(5_400);
    // timeCost(5400) = min(ceil(5400 × 20 / 3600), trunc(sqrt(5400 × 0.8))) = min(30, 65).
    expect(job.finish).toEqual({ item: "SP4", price: 30, blocked: null });
    expect(job.minusOne).toEqual({ item: "SP2", price: 20, blocked: null });
    expect(job.minusTwo).toEqual({ item: "SP3", price: 40, blocked: "tooShort" });
  });

  it("24 hours: Finish now costs 262 (the design's worked example)", () => {
    expect(at(86_400).finish?.price).toBe(262);
  });

  it("five minutes or less: the finish is free (SP1) and the hour items are refused", () => {
    const job = at(200);
    expect(job.finish).toEqual({ item: "SP1", price: 0, blocked: null });
    expect(job.minusOne?.blocked).toBe("tooShort");
  });

  it("not enough Shiny blocks the paid ones", () => {
    const job = at(5_400, 25);
    expect(job.finish?.blocked).toBe("credits");
    expect(job.minusOne?.blocked).toBeNull();
  });

  it("a damaged building's countdown is paused and every speed-up with it", () => {
    const job = at(5_400, 1_000, { hp: 100 });
    expect(job.paused).toBe(true);
    expect(job.finish?.blocked).toBe("paused");
    expect(job.minusOne?.blocked).toBe("paused");
  });

  it("counts the time left down with the clock", () => {
    const context = contextOf({
      buildings: [HALL(5), building(2, 20, 4, { cU: 5_400 })],
      now: T0 + 400,
    });
    expect(jobOffer(pick(context, 2), context)?.remaining).toBe(5_000);
  });
});

describe("cancelOffer: the refund", () => {
  it("is the step's full cost when it fits", () => {
    const context = contextOf({ buildings: [HALL(5), building(2, 20, 4, { cU: 5_400 })] });
    expect(cancelOffer(pick(context, 2), context)).toEqual({
      refund: { r1: 1_250_000, r2: 937_500, r3: 312_500, r4: 0 },
      lost: { r1: 0, r2: 0, r3: 0, r4: 0 },
    });
  });

  it("is clamped to the storage cap, and says what does not fit", () => {
    const context = contextOf({
      buildings: [HALL(5), building(2, 20, 4, { cU: 5_400 })],
      resources: { r1: 1_000_000, r2: 0, r3: 0, r4: 0 },
      caps: { r1: 2_000_000, r2: 5e8, r3: 5e8, r4: 5e8 },
    });
    expect(cancelOffer(pick(context, 2), context)).toEqual({
      refund: { r1: 1_000_000, r2: 937_500, r3: 312_500, r4: 0 },
      lost: { r1: 250_000, r2: 0, r3: 0, r4: 0 },
    });
  });

  it("before the caps are known, promises the full cost", () => {
    const context = contextOf({
      buildings: [HALL(5), building(2, 20, 4, { cU: 5_400 })],
      caps: null,
    });
    expect(cancelOffer(pick(context, 2), context).lost).toEqual({ r1: 0, r2: 0, r3: 0, r4: 0 });
  });
});
