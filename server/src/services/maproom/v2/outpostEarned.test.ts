import { describe, expect, test } from "bun:test";
import { fortifyStepsOf, OUTPOST_COSTS } from "../../../game-data/buildingCosts.js";
import { STARTER_KITS } from "../../../game-data/starterKits.js";
import type { Save } from "../../../database/models/save.model.js";
import type { BuildingDataMap } from "../../../types/BuildingData.js";
import { kitBuildings } from "../../yard/starterKit.js";
import { poolView } from "../../yard/poolView.js";
import { pointsForBuild, pointsForUpgrade } from "../../yardplanner/costs.js";
import { boardPointsOf, bookOutpostPoints, earnedAfterKit, estimateMainPointsEarned } from "./outpostEarned.js";

/** An outpost row and its owner's main row, as `lockOwnYard` hands them to the rules. */
const rows = (earned?: number) => {
  const outpost = { type: "outpost", points: "0", ...(earned !== undefined && { mainpointsearned: earned }) };
  const main = { type: "main", points: "0", resources: {}, buildingdata: {}, storedata: {} };
  return { outpost, main, view: poolView(outpost as unknown as Save, main as unknown as Save) };
};

const regularKit = STARTER_KITS.find((kit) => kit.name === "Regular Kit")!;
const coreFort = (count: number) =>
  fortifyStepsOf(112, "outpost").slice(0, count).reduce((total, step) => total + pointsForUpgrade(step), 0);

describe("bookOutpostPoints", () => {
  test("adds to the outpost row through the pool view, and never to the main row", () => {
    const { outpost, main, view } = rows();
    bookOutpostPoints(view, 1_500);
    bookOutpostPoints(view, 25);
    expect(outpost.mainpointsearned).toBe(1_525);
    expect("mainpointsearned" in main).toBe(false);
  });

  test("a bigint column read back as a string adds as a number", () => {
    const { outpost, view } = rows();
    (outpost as { mainpointsearned?: unknown }).mainpointsearned = "40";
    bookOutpostPoints(view, 2);
    expect(outpost.mainpointsearned).toBe(42);
  });

  test("nothing on a main yard, on a bare outpost row or a copy, or for no points", () => {
    const main = { type: "main" } as { type: string; mainpointsearned?: number };
    bookOutpostPoints(main, 100);
    expect(main.mainpointsearned).toBeUndefined();

    const bare = { type: "outpost" } as { type: string; mainpointsearned?: number };
    bookOutpostPoints(bare, 100);
    expect(bare.mainpointsearned).toBeUndefined();

    const { outpost, view } = rows(7);
    for (const nothing of [0, -3, Number.NaN]) bookOutpostPoints(view, nothing);
    expect(outpost.mainpointsearned).toBe(7);
  });

  test("a trap's points are not the board's", () => {
    expect(boardPointsOf(24, 302)).toBe(0);
    expect(boardPointsOf(117, 15_002)).toBe(0);
    expect(boardPointsOf(20, 450)).toBe(450);
    expect(boardPointsOf(17, 100)).toBe(100);
  });
});

describe("earnedAfterKit", () => {
  const core = (fort?: number): BuildingDataMap => ({
    "1": { id: 1, t: 112, X: 0, Y: -50, l: 1, ...(fort ? { fort } : {}) } as never,
    "2": { id: 2, t: 20, X: 100, Y: 100, l: 6, fort: 2 } as never,
  });

  test("keeps no more than the core's own fortification paid", () => {
    expect(earnedAfterKit(50_000_000, core(2))).toBe(coreFort(2));
    expect(earnedAfterKit(10, core(2))).toBe(10);
    expect(earnedAfterKit("50000000", core(4))).toBe(coreFort(4));
  });

  test("an unfortified core, no core, or nothing earned: 0", () => {
    expect(earnedAfterKit(50_000_000, core())).toBe(0);
    expect(earnedAfterKit(50_000_000, {})).toBe(0);
    expect(earnedAfterKit(50_000_000, null)).toBe(0);
    expect(earnedAfterKit(undefined, core(2))).toBe(0);
  });
});

describe("estimateMainPointsEarned (the one-off seed)", () => {
  const costs = (type: number) => OUTPOST_COSTS[type]!.costs;

  test("an owner-built tower: its build, every upgrade and fortification", () => {
    const yard = {
      "1": { id: 1, t: 112, X: 0, Y: -50, l: 1, fort: 1 },
      "2": { id: 2, t: 20, X: 100, Y: 100, l: 3, fort: 1 },
    } as unknown as BuildingDataMap;
    const fort20 = fortifyStepsOf(20, "outpost");
    expect(estimateMainPointsEarned(yard, 0)).toBe(
      coreFort(1) + pointsForBuild(costs(20)[0]!) + pointsForUpgrade(costs(20)[1]!) + pointsForUpgrade(costs(20)[2]!) +
        pointsForUpgrade(fort20[0]!)
    );
  });

  test("a building still being built has paid nothing yet; traps and decorations never count", () => {
    const yard = {
      "2": { id: 2, t: 20, X: 100, Y: 100, l: 1, cB: 30 },
      "3": { id: 3, t: 24, X: 120, Y: 100, l: 1 },
      "4": { id: 4, t: 28, X: 140, Y: 100, l: 1 },
    } as unknown as BuildingDataMap;
    expect(estimateMainPointsEarned(yard, 0)).toBe(0);
  });

  test("a resource kit mid-countdown has paid nothing; once it stands, each building's level-1 build only", () => {
    const placed = kitBuildings(regularKit, "resources", {}).buildingdata;
    expect(estimateMainPointsEarned(placed, regularKit.id)).toBe(0);

    const standing = Object.fromEntries(
      Object.entries(placed).map(([key, b]) => {
        const { cB: _cB, cL: _cL, prefab, ...rest } = b as unknown as Record<string, unknown>;
        return [key, prefab ? { ...rest, l: prefab } : rest];
      })
    ) as unknown as BuildingDataMap;
    let builds = 0;
    for (const row of regularKit.buildings) if (row.t !== 112) builds += pointsForBuild(costs(row.t)[0]!);
    expect(estimateMainPointsEarned(standing, regularKit.id)).toBe(builds);
    // The kit is read back from the layout when the column says none.
    expect(estimateMainPointsEarned(standing, 0)).toBe(builds);
  });

  test("levels and fortification above the kit's are the owner's", () => {
    const standing = kitBuildings(regularKit, "shiny", {}).buildingdata;
    const base = estimateMainPointsEarned(standing, regularKit.id);
    const [key, tower] = Object.entries(standing).find(([, b]) => Number(b.t) === 20)!;
    const level = Number(tower.l);
    const kitFort = Number(tower.fort ?? 0);
    const raised = { ...standing, [key]: { ...tower, l: level + 1, fort: kitFort + 1 } } as BuildingDataMap;
    expect(estimateMainPointsEarned(raised, regularKit.id) - base).toBe(
      pointsForUpgrade(costs(20)[level]!) + pointsForUpgrade(fortifyStepsOf(20, "outpost")[kitFort]!)
    );
  });
});
