import { describe, expect, test } from "bun:test";
import type { Save } from "../../database/models/save.model.js";
import { BaseType } from "../../enums/Base.js";
import { fortifyStepsOf, OUTPOST_COSTS } from "../../game-data/buildingCosts.js";
import { ClientSafeError } from "../../middleware/clientSafeError.js";
import type { LayoutNode } from "../../schemas/YardPlannerSchemas.js";
import type { BuildingData, BuildingDataMap } from "../../types/BuildingData.js";
import { storageCap } from "../base/economy/resourceBudget.js";
import { yardKindOf } from "../yardplanner/costs.js";
import { walkUpgrades } from "../yardplanner/startUpgrades.js";
import { planTrapRearm } from "../yardplanner/trapRearm.js";
import { planWallUpgrade } from "../yardplanner/wallUpgrade.js";
import { OUTPOST_WORKERS, workerCount } from "../yardplanner/workers.js";
import { OUTPOST_BUILDABLE_TYPES } from "./build.js";
import { catchUpYard, type CatchUpSave } from "./catchUp.js";
import { capOf, creditResources } from "./credit.js";
import {
  clearOutpostMushrooms,
  outpostCarryover,
  outpostProblems,
  placeOutpostCore,
} from "./outpostYard.js";
import { poolView } from "./poolView.js";

/**
 * The outpost pieces of the yard rules (outposts WP3, issue #184) that do
 * not need the wrapper: the core, the old-data check, the pool view, the
 * outpost catch-up, and the batch rules read from the outpost table.
 */

const NOW = 1_800_000_000;

const CORE = { id: 1, t: 112, X: 0, Y: -50, l: 1 } as unknown as BuildingData;

const rejection = (run: () => unknown): ClientSafeError => {
  try {
    run();
  } catch (err) {
    if (err instanceof ClientSafeError) return err;
    throw err;
  }
  throw new Error("expected a refusal");
};

describe("the outpost build menu", () => {
  test("is Flash's twenty types", () => {
    expect([...OUTPOST_BUILDABLE_TYPES].sort((a, b) => a - b)).toEqual([
      1, 2, 3, 4, 5, 9, 10, 13, 15, 16, 17, 20, 21, 22, 23, 24, 25, 115, 117, 118,
    ]);
  });

  test("an outpost has one worker, bought workers or not", () => {
    expect(workerCount({ BEW: { q: 4 } }, "outpost")).toBe(OUTPOST_WORKERS);
    expect(workerCount({ BEW: { q: 4 } })).toBe(5);
  });

  test("the kind is read off the save's type", () => {
    expect(yardKindOf({ type: BaseType.OUTPOST })).toBe("outpost");
    expect(yardKindOf({ type: BaseType.MAIN })).toBe("main");
    expect(yardKindOf({})).toBe("main");
  });
});

describe("placeOutpostCore", () => {
  test("an empty outpost gets the core at (0, -50), level 1", () => {
    const save = { type: BaseType.OUTPOST, buildingdata: {} };
    expect(placeOutpostCore(save)).toBe(true);
    expect(save.buildingdata).toEqual({ "1": CORE });
  });

  test("an id a health entry still holds is not reused", () => {
    const save = { type: BaseType.OUTPOST, buildingdata: {}, buildinghealthdata: { "4": 0 } };
    placeOutpostCore(save);
    expect(Object.keys(save.buildingdata)).toEqual(["5"]);
  });

  test("a yard with anything in it, or a main yard, is left alone", () => {
    const withTower = { type: BaseType.OUTPOST, buildingdata: { "3": { id: 3, t: 20, X: 0, Y: 0 } } };
    expect(placeOutpostCore(withTower as never)).toBe(false);
    expect(Object.keys(withTower.buildingdata)).toEqual(["3"]);

    const main = { type: BaseType.MAIN, buildingdata: {} };
    expect(placeOutpostCore(main)).toBe(false);
    expect(main.buildingdata).toEqual({});
  });
});

describe("outpostProblems", () => {
  test("a clean outpost has none", () => {
    expect(outpostProblems({ "1": CORE, "2": { id: 2, t: 20, X: 0, Y: 0, l: 10 } } as never)).toEqual([]);
  });

  test("lists blocked and unknown types, counts over the limit, levels over the ladder and a missing core", () => {
    const buildings: Record<string, unknown> = {
      "2": { id: 2, t: 14, X: 0, Y: 0, l: 1 },
      "3": { id: 3, t: 999, X: 0, Y: 0 },
      "4": { id: 4, t: 23, X: 0, Y: 0, l: 8 },
      "5": { id: 5, t: 118, X: 0, Y: 0 },
      "6": { id: 6, t: 118, X: 0, Y: 0 },
    };
    expect(outpostProblems(buildings as never)).toEqual([
      { problem: "blockedType", id: 2, t: 14 },
      { problem: "unknownType", id: 3, t: 999 },
      { problem: "overLevel", id: 4, t: 23, level: 8, max: 6 },
      { problem: "overLimit", t: 118, have: 2, allowed: 1 },
      { problem: "cores", have: 0 },
    ]);
  });
});

describe("poolView", () => {
  const rows = () => {
    const outpost = {
      type: BaseType.OUTPOST,
      resources: { r1: 5 },
      credits: 0,
      points: "0",
      buildingdata: { "1": CORE },
      storedata: {},
      outposts: [],
    } as unknown as Save;
    const main = {
      type: BaseType.MAIN,
      resources: { r1: 100, r2: 100, r3: 100, r4: 100 },
      credits: 50,
      points: "7",
      buildingdata: { "9": { id: 9, t: 6, X: 0, Y: 0, l: 10 } },
      storedata: {},
      outposts: [[1, 1, "900"]],
      academy: { C1: { level: 3 } },
    } as unknown as Save;
    return { outpost, main, view: poolView(outpost, main) };
  };

  test("reads the pool from the main row and the yard from the outpost row", () => {
    const { main, view } = rows();
    expect(view.resources).toBe(main.resources);
    expect(view.credits).toBe(50);
    expect(view.academy).toEqual({ C1: { level: 3 } });
    expect(view.buildingdata).toEqual({ "1": CORE });
    expect(view.type).toBe(BaseType.OUTPOST);
    expect(capOf(view)).toBe(storageCap(main));
  });

  test("writes the pool to the main row and the yard to the outpost row", () => {
    const { outpost, main, view } = rows();
    view.points = "20";
    view.resources = { r1: 1 };
    view.savetime = NOW;
    expect(main.points).toBe("20");
    expect(main.resources).toEqual({ r1: 1 });
    expect(outpost.resources).toEqual({ r1: 5 });
    expect(outpost.savetime).toBe(NOW);
    expect(main.savetime).toBeUndefined();
  });

  test("a credit is clamped to the main yard's cap and lands on the main row", () => {
    const { main, view } = rows();
    const cap = storageCap(main);
    creditResources(view, { r1: cap * 2 });
    expect((main.resources as Record<string, number>).r1).toBe(cap);
  });

  test("a spread copies the pool, cap included", () => {
    const { main, view } = rows();
    const copy = { ...view, buildingdata: {} };
    expect(copy.resources).toBe(main.resources);
    expect(capOf(copy)).toBe(storageCap(main));
  });
});

describe("the outpost catch-up", () => {
  const outpost = (extra: Record<string, unknown> = {}): CatchUpSave =>
    ({
      type: BaseType.OUTPOST,
      mapversion: 2,
      savetime: NOW - 3600,
      points: "0",
      resources: { r1: 0, r2: 0, r3: 0, r4: 0 },
      buildingdata: { "1": CORE },
      buildinghealthdata: {},
      storedata: {},
      monsters: {},
      ...extra,
    }) as CatchUpSave;

  test("an empty outpost gets its core, not the starter base, and nothing replays", () => {
    const save = outpost({ buildingdata: {} });
    expect(catchUpYard(save, NOW)).toEqual([]);
    expect(save.buildingdata).toEqual({ "1": CORE });
    expect(save.resources).toEqual({ r1: 0, r2: 0, r3: 0, r4: 0 });
    expect(save.savetime).toBe(NOW);
  });

  test("an outpost on Map Room 2 is not given a Map Room", () => {
    const save = outpost({ mr2upgraded: true });
    catchUpYard(save, NOW);
    expect(save.buildingdata).toEqual({ "1": CORE });
  });

  test("its harvesters do not fill: an outpost's income is autobanked", () => {
    const snapper = { id: 2, t: 1, X: 100, Y: 100, l: 5 } as unknown as BuildingData;
    const save = outpost({ buildingdata: { "1": CORE, "2": snapper } });
    catchUpYard(save, NOW);
    expect(save.buildingdata!["2"]).toEqual(snapper);
  });

  test("a finished upgrade is priced from the outpost table", () => {
    const laser = { id: 2, t: 23, X: 100, Y: 100, l: 1, cU: 60, cL: 60 };
    const save = outpost({ buildingdata: { "1": CORE, "2": laser } });
    const [job] = catchUpYard(save, NOW);

    const [r1, r2, r3, r4, time] = OUTPOST_COSTS[23]!.costs[1]!;
    expect(job).toMatchObject({ kind: "upgrade", id: 2, detail: { from: 1, level: 2 } });
    expect(save.points).toBe(String(Math.floor((time + r1 + r2 + r3 + r4) / 3)));
  });

  test("a finished fortification earns Fortified()'s points", () => {
    const save = outpost({ buildingdata: { "1": { ...CORE, cF: 30 } } });
    const [job] = catchUpYard(save, NOW);

    const [r1, r2, r3, r4, time] = fortifyStepsOf(112, "outpost")[0]!;
    expect(job).toMatchObject({ kind: "fortify", id: 1, detail: { fort: 1 } });
    expect(save.points).toBe(String(Math.floor((time + r1 + r2 + r3 + r4) / 3)));
  });

  test("a repair heals, and damage follows it down", () => {
    const save = outpost({
      damage: 40,
      buildingdata: { "1": CORE, "2": { id: 2, t: 20, X: 100, Y: 100, l: 1, hp: 1, rE: 1 } },
      buildinghealthdata: { "2": 1 },
    });
    const completed = catchUpYard(save, NOW);

    expect(completed.map((job) => job.kind)).toContain("repair");
    expect(save.buildingdata!["2"]!.hp).toBeUndefined();
    expect(save.damage).toBe(0);
  });

  test("the core heals to the outpost ladder's 200,000 (the main table has no core)", () => {
    const save = outpost({
      buildingdata: { "1": { ...CORE, hp: 199_000, rE: 1 } },
      buildinghealthdata: { "1": 199_000 },
    });
    const [job] = catchUpYard(save, NOW);

    expect(job).toMatchObject({ kind: "repair", id: 1, detail: { max: 200_000 } });
    expect(save.buildingdata!["1"]).toEqual(CORE);
  });
});

describe("the planner batches on an outpost", () => {
  const yard = (buildingdata: BuildingDataMap) => ({
    type: BaseType.OUTPOST,
    buildingdata,
    buildinghealthdata: {},
    resources: { r1: 1e9, r2: 1e9, r3: 1e9, r4: 1e9 },
    storedata: {},
    mushrooms: {},
    firedtraps: [],
  });

  test("walls are priced from the outpost ladder", () => {
    const plan = planWallUpgrade(yard({ "1": CORE, "2": { id: 2, t: 17, X: 200, Y: 200 } } as never), [2], 3);
    const [a, b] = OUTPOST_COSTS[17]!.costs.slice(1, 3);
    expect(plan.cost).toEqual({ r1: a![0] + b![0], r2: a![1] + b![1], r3: 0, r4: 0 });
  });

  test("an outpost holds five Heavy Traps at most", () => {
    const traps: Record<string, unknown> = { "1": CORE };
    for (let id = 2; id <= 6; id++) traps[String(id)] = { id, t: 117, X: -300 + id * 40, Y: 300 };
    const refusal = rejection(() => planTrapRearm(yard(traps as never), [{ t: 117, x: 300, y: -300 }]));
    expect(refusal.data).toMatchObject({ capReached: { type: 117, have: 5, max: 5 } });
  });

  test("Apply's walk starts one job, whatever the plan wants", () => {
    const buildings = {
      "1": CORE,
      "2": { id: 2, t: 20, X: 100, Y: 100, l: 1 },
      "3": { id: 3, t: 21, X: -100, Y: 100, l: 1 },
    };
    const nodes = [
      { id: 2, t: 20, x: 100, y: 100, plan: { level: 2, order: 0 } },
      { id: 3, t: 21, x: -100, y: 100, plan: { level: 2, order: 1 } },
    ] as unknown as LayoutNode[];

    const walk = walkUpgrades(yard(buildings as never), nodes, NOW);

    expect(walk.started.map((row) => row.id)).toEqual([2]);
    expect(walk.waiting.map((row) => row.id)).toEqual([3]);
    expect(walk.workers).toEqual({ total: 1, busyBefore: 0, busyAfter: 1 });
    const [r1] = OUTPOST_COSTS[20]!.costs[1]!;
    expect(walk.cost.r1).toBe(r1);
  });

  test("a plan past the outpost ladder is refused (a Laser Tower to 7)", () => {
    const nodes = [{ id: 2, t: 23, x: 100, y: 100, plan: { level: 7, order: 0 } }] as unknown as LayoutNode[];
    const refusal = rejection(() =>
      walkUpgrades(yard({ "1": CORE, "2": { id: 2, t: 23, X: 100, Y: 100, l: 1 } } as never), nodes, NOW)
    );
    expect(refusal.data).toMatchObject({ planLevel: [2] });
  });
});

describe("main-yard data on an outpost (#191)", () => {
  const copied = () =>
    ({
      type: BaseType.OUTPOST,
      savetime: 1_000,
      buildingdata: { "1": { ...CORE } },
      buildinghealthdata: {},
      mushrooms: { l: [[1, 10, 20], [2, 30, 40]], s: 900 },
      storedata: { ENL: { q: 6 } },
      monsters: {},
      points: "0",
    }) as unknown as CatchUpSave;

  test("the catch-up drops an outpost's mushrooms and keeps its expansion", () => {
    const save = copied();
    expect(outpostCarryover(save as never)).toEqual({ mushrooms: 2, expansion: 6 });

    catchUpYard(save, 2_000);

    expect(outpostCarryover(save as never)).toEqual({ mushrooms: 0, expansion: 6 });
    expect(save.storedata).toEqual({ ENL: { q: 6 } });
  });

  test("a main yard keeps its mushrooms", () => {
    const main = { type: BaseType.MAIN, mushrooms: { l: [[1, 10, 20]] } };
    expect(clearOutpostMushrooms(main)).toBe(0);
    expect(main.mushrooms.l).toHaveLength(1);
  });
});
