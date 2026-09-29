import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { costOf, maxLevel, OUTPOST_CORE_TYPE } from "../../game-data/buildingCosts.js";
import { STARTER_KITS } from "../../game-data/starterKits.js";
import type { BuildingDataMap } from "../../types/BuildingData.js";
import { advanceBuildingTimers } from "../base/advanceBuildingTimers.js";
import { busyWorkers } from "../yardplanner/workers.js";
import {
  kitBuildings,
  kitShortfall,
  kitTopUpShiny,
  planStarterKit,
  prefabSeconds,
  starterKit,
  type StarterKitSave,
} from "./starterKit.js";

/**
 * Outpost Starter Kits (outposts WP9, issue #188): the layouts and prices are
 * `popup_prefab.as`'s, the resource path builds prefabs that hold no worker
 * and finish at their level, the Shiny path is instant, and the top-up is
 * Flash's formula.
 */

const SOURCE = resolve(import.meta.dir, "../../../../client/scripts/popup_prefab.as");

/** The three `GetBuildings` branches, read straight from the Flash source. */
const flashKits = () => {
  const lines = readFileSync(SOURCE, "utf8").split(/\r?\n/);
  return [1, 2, 3].map((id) => {
    const branch = lines.findIndex((line, index) => index > 270 && line.includes(`if (param1 == ${id})`));
    const layout = JSON.parse(JSON.parse(`"${/JSON\.parse\("(.*)"\);/.exec(lines[branch + 1]!)![1]}"`));
    const prices = lines
      .slice(branch + 2, branch + 6)
      .map((line) => Number(/new SecNum\((\d+)\)/.exec(line)![1]));
    return { id, layout: layout as Record<string, Record<string, number>>, prices };
  });
};

const outpost = (overrides: Partial<StarterKitSave> = {}): StarterKitSave => ({
  type: "outpost",
  buildingdata: {
    "1": { id: 1, t: 112, X: 0, Y: -50, l: 1, hp: 90_000, rE: 1 },
    "2": { id: 2, t: 20, X: 150, Y: 150, l: 3, cU: 600 },
    "3": { id: 3, t: 13, X: -150, Y: 150, l: 1 },
  } as unknown as BuildingDataMap,
  buildinghealthdata: { "1": 90_000 },
  monsters: { housed: {}, h: [], hid: [], hstage: [], hcc: [] },
  resources: { r1: 300_000_000, r2: 300_000_000, r3: 300_000_000, r4: 5 },
  academy: {},
  ...overrides,
});

const NOW = 1_800_000_000;

describe("the kits are popup_prefab.as's", () => {
  test("every building of every kit, field for field, and its price", () => {
    const flash = flashKits();
    for (const kit of STARTER_KITS) {
      const source = flash.find((one) => one.id === kit.id)!;
      expect(kit.buildings).toEqual(
        Object.entries(source.layout)
          .map(([key, row]) => ({ ...row, id: row.id ?? Number(key) }))
          .sort((a, b) => a.id - b.id) as never
      );
      expect([kit.resources.r1, kit.resources.r2, kit.resources.r3, kit.shiny]).toEqual(source.prices);
    }
  });

  test("prices: Regular 12M/12M/6M or 420, Mega 50M/50M/25M or 800, Ultra 200M/200M/100M or 1,500", () => {
    expect(STARTER_KITS.map((kit) => [kit.id, kit.name, kit.resources, kit.shiny])).toEqual([
      [1, "Regular Kit", { r1: 12_000_000, r2: 12_000_000, r3: 6_000_000 }, 420],
      [2, "Mega Kit", { r1: 50_000_000, r2: 50_000_000, r3: 25_000_000 }, 800],
      [3, "Ultra Kit", { r1: 200_000_000, r2: 200_000_000, r3: 100_000_000 }, 1500],
    ]);
  });

  test("each kit fits the outpost table: one core, every type allowed, no level past its cap", () => {
    for (const kit of STARTER_KITS) {
      expect(kit.buildings.filter((row) => row.t === OUTPOST_CORE_TYPE)).toHaveLength(1);
      const counts = new Map<number, number>();
      for (const row of kit.buildings) {
        counts.set(row.t, (counts.get(row.t) ?? 0) + 1);
        if (row.t === OUTPOST_CORE_TYPE) continue;
        expect(row.prefab ?? 1).toBeLessThanOrEqual(maxLevel(row.t, "outpost"));
      }
      for (const [type, count] of counts) {
        if (type === OUTPOST_CORE_TYPE) continue;
        expect(count).toBeLessThanOrEqual(costOf(type, "outpost")!.quantity[1]!);
      }
    }
  });
});

describe("paid with resources: prefabs", () => {
  test("every building but the core goes; the core moves to the kit's spot, healed", () => {
    const kit = starterKit(1)!;
    const plan = planStarterKit(outpost(), { kit: 1, pay: "resources" }, NOW);
    const after = plan.slices.buildingdata;

    const core = Object.values(after).find((b) => b.t === OUTPOST_CORE_TYPE)!;
    expect(core).toEqual({ id: 1, t: 112, X: -65, Y: -105, l: 1 } as never);
    expect(plan.slices.buildinghealthdata).toEqual({});
    expect(Object.keys(after)).toHaveLength(kit.buildings.length);
    expect(plan.report).toMatchObject({ kit: 1, pay: "resources", placed: 112, removed: 2 });
    // Fresh ids after the core's.
    expect(Object.keys(after).map(Number).sort((a, b) => a - b)).toEqual(
      Array.from({ length: kit.buildings.length }, (_, i) => i + 1)
    );
  });

  test("each building counts down the steps up to its prefab level, and none holds the worker", () => {
    const { buildingdata, seconds } = kitBuildings(starterKit(1)!, "resources", outpost().buildingdata!);
    const sniper = Object.values(buildingdata).find((b) => b.t === 21)!;
    const expected = [0, 1, 2, 3, 4].reduce((sum, k) => sum + costOf(21, "outpost")!.costs[k]![4], 0);
    expect(sniper).toMatchObject({ t: 21, l: 5, prefab: 5, cB: expected, cL: expected });
    expect(prefabSeconds(21, 5)).toBe(expected);
    // A kit building without a prefab builds to level 1.
    expect(Object.values(buildingdata).find((b) => b.t === 25)).toMatchObject({ l: 1, prefab: 1 });
    expect(seconds).toBe(Math.max(...Object.values(buildingdata).map((b) => Number(b.cB ?? 0))));

    expect(busyWorkers(buildingdata)).toBe(0);
    // A normal build next to them still takes the worker.
    expect(busyWorkers({ ...buildingdata, "999": { id: 999, t: 20, X: 0, Y: 0, cB: 60 } as never })).toBe(1);
  });

  test("the catch-up finishes a prefab at its level", () => {
    const { buildingdata, seconds } = kitBuildings(starterKit(2)!, "resources", {});
    const done = advanceBuildingTimers(buildingdata, {}, seconds);
    for (const building of Object.values(done)) {
      expect(building.cB).toBeUndefined();
      expect(building.prefab).toBeUndefined();
    }
    const sniper = Object.values(done).find((b) => b.t === 21)!;
    expect(sniper.l).toBe(6);
  });

  test("charges twigs, pebbles and putty from the pool, never goo, and no Shiny", () => {
    const plan = planStarterKit(outpost(), { kit: 2, pay: "resources" }, NOW);
    expect(plan.debit).toEqual({ r1: 50_000_000, r2: 50_000_000, r3: 25_000_000, r4: 0 });
    expect("shiny" in plan).toBe(false);
  });

  test("the Ultra kit's fortifications come with it, the core's included", () => {
    const plan = planStarterKit(outpost(), { kit: 3, pay: "resources" }, NOW);
    const all = Object.values(plan.slices.buildingdata);
    expect(all.find((b) => b.t === OUTPOST_CORE_TYPE)).toMatchObject({ fort: 4, X: 0, Y: -50 });
    expect(all.filter((b) => b.t === 115).every((b) => b.fort === 3)).toBe(true);
  });
});

describe("paid with Shiny: instant", () => {
  test("every building at its level at once, the kit's Shiny charged, no resources", () => {
    const plan = planStarterKit(outpost(), { kit: 1, pay: "shiny" }, NOW);
    const all = Object.values(plan.slices.buildingdata);
    expect(all.some((b) => b.cB !== undefined || b.prefab !== undefined)).toBe(false);
    expect(all.find((b) => b.t === 21)!.l).toBe(5);
    expect(plan.shiny).toBe(420);
    expect(plan.debit).toEqual({ r1: 0, r2: 0, r3: 0, r4: 0 });
    expect(plan.report.doneBy).toBe(NOW);
  });
});

describe("a short pool and the Shiny top-up", () => {
  test("the formula: ceil(sqrt(short / 2) ^ 0.75)", () => {
    expect(kitTopUpShiny(0)).toBe(0);
    expect(kitTopUpShiny(1_000_000)).toBe(Math.ceil(Math.pow(Math.sqrt(500_000), 0.75)));
    expect(kitTopUpShiny(1_000_000)).toBe(138);
    expect(kitTopUpShiny(2)).toBe(1);
  });

  test("refused with the shortfall and the top-up when none was agreed", () => {
    const save = outpost({ resources: { r1: 11_000_000, r2: 12_000_000, r3: 5_500_000, r4: 0 } });
    expect(kitShortfall(save.resources, starterKit(1)!)).toEqual({ r1: 1_000_000, r2: 0, r3: 500_000 });
    const topUp = kitTopUpShiny(1_500_000);

    let caught: unknown = null;
    try {
      planStarterKit(save, { kit: 1, pay: "resources" }, NOW);
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ status: 409, data: { reason: "shortfall", topUp: topUp } });
    expect(() => planStarterKit(save, { kit: 1, pay: "resources", topUp: topUp - 1 }, NOW)).toThrow();

    const plan = planStarterKit(save, { kit: 1, pay: "resources", topUp }, NOW);
    expect(plan.debit).toEqual({ r1: 11_000_000, r2: 12_000_000, r3: 5_500_000, r4: 0 });
    expect(plan.shiny).toBe(topUp);
  });
});

describe("what a kit refuses", () => {
  test("an unknown kit and a main yard", () => {
    expect(() => planStarterKit(outpost(), { kit: 4, pay: "shiny" }, NOW)).toThrow("no such Starter Kit");
    expect(() => planStarterKit(outpost({ type: "main" }), { kit: 1, pay: "shiny" }, NOW)).toThrow(
      "Starter Kits are for outposts."
    );
  });

  test("housed monsters while the kit's Housing is still building, and too many for it when finished", () => {
    const housed = outpost({ monsters: { housed: { C1: 10 } } });
    expect(() => planStarterKit(housed, { kit: 1, pay: "resources" }, NOW)).toThrow("Move the monsters out");
    // Paid with Shiny the kit's Housing (level 2 in Regular) stands at once and takes them.
    expect(() => planStarterKit(housed, { kit: 1, pay: "shiny" }, NOW)).not.toThrow();

    const crowd = outpost({ monsters: { housed: { C1: 1_000 } } });
    expect(() => planStarterKit(crowd, { kit: 1, pay: "shiny" }, NOW)).toThrow("Move the monsters out");
  });

  test("monsters in a Bunker or in a hatchery", () => {
    const bunker = outpost({
      buildingdata: {
        ...outpost().buildingdata,
        "4": { id: 4, t: 22, X: 200, Y: -200, l: 1, m: { C2: 3 } },
      } as unknown as BuildingDataMap,
    });
    expect(() => planStarterKit(bunker, { kit: 1, pay: "shiny" }, NOW)).toThrow("Move the monsters out");

    const hatching = outpost({ monsters: { housed: {}, h: [["C1", 30]], hid: [3], hstage: [1], hcc: [] } });
    expect(() => planStarterKit(hatching, { kit: 1, pay: "shiny" }, NOW)).toThrow("Move the monsters out");
  });

  test("an idle outpost's production fields are emptied with its hatcheries", () => {
    const plan = planStarterKit(
      outpost({ monsters: { housed: {}, h: [[]], hid: [3], hstage: [0], hcount: 1, hcc: [], saved: 5 } }),
      { kit: 1, pay: "shiny" },
      NOW
    );
    expect(plan.slices.monsters).toEqual({ housed: {}, h: [], hid: [], hstage: [], hcount: 0, hcc: [], saved: 5 });
  });
});
