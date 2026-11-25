import { describe, expect, test } from "bun:test";
import type { BuildingData, BuildingDataMap } from "../../types/BuildingData.js";
import type { JsonObject } from "../../types/JsonObject.js";
import { catchUpYard, type CatchUpSave } from "./catchUp.js";
import { planHatcheryAdd, planHatcheryFinish, planHatcheryRemove, type HatcherySave } from "./hatchery.js";

/**
 * Owner's bug, 25 Nov 2026 (diag-hcc): "When a player has a HCC and some of
 * the hatcheries are under upgrades, monsters shouldn't be assigned to those
 * hatcheries."
 *
 * The yard: Town Hall, Housing L6 (540), an HCC and three level 3 hatcheries
 * 1, 2 and 3. Hatchery 2 is upgrading (`cU` = seconds left, 2 hours).
 * Pokey (C1) at academy level 1: 15 s, 10 space, 250 goo.
 *
 * Option A (patch 8.7): the HCC hands an upgrading hatchery nothing; a
 * monster already inside when the upgrade starts waits there, paused, as in
 * Flash. The first three failed on 8.6.
 */

const NOW = 1_800_000_000;
const TWO_HOURS = 7200;

const HALL = 14;
const HATCHERY = 13;
const HOUSING = 15;
const HCC = 16;

const building = (id: number, t: number, l: number, extra: Partial<BuildingData> = {}): BuildingData =>
  ({ id, t, X: 0, Y: 0, x: 0, y: 0, l, ...extra }) as unknown as BuildingData;

const buildings = (upgrading: Partial<BuildingData> = { cU: TWO_HOURS }): BuildingDataMap => ({
  "0": building(0, HALL, 6),
  "4": building(4, HOUSING, 6),
  "1": building(1, HATCHERY, 3),
  "2": building(2, HATCHERY, 3, upgrading),
  "3": building(3, HATCHERY, 3),
  "6": building(6, HCC, 1),
});

const idle = (): unknown[] => ["", 0, []];

const monstersOf = (h: unknown[][], hcc: unknown[] = []): JsonObject => ({
  saved: NOW,
  housed: {},
  h,
  hid: [1, 2, 3],
  hstage: h.map((entry) => (entry[0] ? 1 : 0)),
  hcc,
});

const yardOf = (monsters: JsonObject, upgrading?: Partial<BuildingData>): HatcherySave & CatchUpSave => ({
  savetime: NOW,
  points: "0",
  buildingdata: buildings(upgrading),
  buildinghealthdata: {},
  resources: { r1: 0, r2: 0, r3: 0, r4: 1_000_000 },
  monsters,
  lockerdata: { C1: { t: 2 } },
  academy: { C1: { level: 1 } },
  storedata: {},
});

const hOf = (monsters: JsonObject | null | undefined, id: number): unknown[] => {
  const index = (monsters!.hid as number[]).indexOf(id);
  return (monsters!.h as unknown[][])[index]!;
};

describe("HCC and a hatchery under upgrade", () => {
  test("adding to the HCC queue gives the upgrading hatchery no monster", () => {
    const save = yardOf(monstersOf([idle(), idle(), idle()]));
    const plan = planHatcheryAdd(save, "hcc", "C1", 5, NOW);

    expect(hOf(plan.slices?.monsters, 1)[0]).toBe("C1");
    expect(hOf(plan.slices?.monsters, 3)[0]).toBe("C1");
    // On 8.6 hatchery 2 took a Pokey too, which then sat there unhatched for
    // the whole two-hour upgrade.
    expect(hOf(plan.slices?.monsters, 2)[0]).toBe("");
    expect(plan.slices?.monsters?.hcc).toEqual([["C1", 3, 1]]);
  });

  test("an hour later nothing is stuck in the upgrading hatchery", () => {
    const save = yardOf(monstersOf([idle(), idle(), idle()]));
    const plan = planHatcheryAdd(save, "hcc", "C1", 30, NOW);
    save.monsters = plan.slices!.monsters!;
    catchUpYard(save, NOW + 3600);

    // Hatcheries 1 and 3 work the whole queue (8.6 kept one Pokey frozen in hatchery 2: 29).
    expect((save.monsters!.housed as Record<string, number>).C1).toBe(30);
    expect(hOf(save.monsters, 2)).toEqual(["", 0, []]);
  });

  test("cancelling the paused monster does not hand the upgrading hatchery the next one", () => {
    const save = yardOf(monstersOf([idle(), ["C1", 15, [], 1], idle()], [["C1", 5, 1]]));
    const plan = planHatcheryRemove(save, 2, 0, 1, NOW);

    expect(plan.report).toMatchObject({ monster: "C1", removed: 1 });
    expect(hOf(plan.slices?.monsters, 2)[0]).toBe("");
  });

  test("the lazy catch-up itself never feeds an idle upgrading hatchery", () => {
    const save = yardOf(monstersOf([idle(), idle(), idle()], [["C1", 20, 1]]));
    catchUpYard(save, NOW + 60);

    expect(hOf(save.monsters, 2)).toEqual(["", 0, []]);
    expect((save.monsters!.housed as Record<string, number>).C1).toBe(8);
  });

  test("a monster already inside when the upgrade starts waits, frozen, then resumes", () => {
    // Hatchery 2 had 5 s left on a Pokey when its upgrade began; 100 s of upgrade left.
    const save = yardOf(monstersOf([idle(), ["C1", 5, [], 1], idle()]), { cU: 100 });
    catchUpYard(save, NOW + 99);
    expect(hOf(save.monsters, 2)).toEqual(["C1", 5, [], 1]);

    catchUpYard(save, NOW + 105);
    expect((save.monsters!.housed as Record<string, number>).C1).toBe(1);
    expect(hOf(save.monsters, 2)).toEqual(["", 0, []]);
  });

  test("when the upgrade ends, the catch-up hands the upgraded hatchery work again", () => {
    // Every hatchery but 2 broken down to 0 health, so only 2 can take the queue; 100 s of upgrade left.
    const save = yardOf(monstersOf([idle(), idle(), idle()], [["C1", 3, 1]]), { cU: 100 });
    save.buildinghealthdata = { "1": 0, "3": 0 };
    catchUpYard(save, NOW + 99);
    expect(hOf(save.monsters, 2)).toEqual(["", 0, []]);
    expect(save.monsters!.hcc).toEqual([["C1", 3, 1]]);

    // Upgrade done at NOW + 100: three Pokeys of 15 s each, one after another.
    catchUpYard(save, NOW + 100 + 45);
    expect((save.monsters!.housed as Record<string, number>).C1).toBe(3);
    expect(save.monsters!.hcc).toEqual([]);
  });

  test("every hatchery upgrading: the HCC keeps the whole batch, paid, until one is done", () => {
    const all = { cU: TWO_HOURS };
    const save = yardOf(monstersOf([idle(), idle(), idle()]));
    for (const id of ["1", "2", "3"]) Object.assign(save.buildingdata![id]!, all);
    const plan = planHatcheryAdd(save, "hcc", "C1", 30, NOW);

    expect(plan.report).toMatchObject({ added: 30, stoppedBy: null });
    expect(plan.debit).toEqual({ r4: 30 * 250 });
    for (const id of [1, 2, 3]) expect(hOf(plan.slices?.monsters, id)[0]).toBe("");
    expect(plan.slices?.monsters?.hcc).toEqual([
      ["C1", 20, 1],
      ["C1", 10, 1],
    ]);

    // An hour on, still upgrading: nothing hatched, nothing lost.
    save.monsters = plan.slices!.monsters!;
    catchUpYard(save, NOW + 3600);
    expect((save.monsters!.housed as Record<string, number>).C1 ?? 0).toBe(0);
    expect(save.monsters!.hcc).toEqual([
      ["C1", 20, 1],
      ["C1", 10, 1],
    ]);
  });

  test("Finish now on the HCC houses the paused monster but hands the upgrading hatchery nothing new", () => {
    const save = yardOf(monstersOf([idle(), ["C1", 15, [], 1], idle()], [["C1", 60, 1]]));
    const plan = planHatcheryFinish(save, "hcc", NOW);

    expect(plan.report.housed).toEqual({ C1: 54 });
    expect(hOf(plan.slices?.monsters, 2)).toEqual(["", 0, []]);
    // 54 housed (540 space at 10 each); hatcheries 1 and 3 take the next two, 2 stays empty.
    expect(hOf(plan.slices?.monsters, 1)[0]).toBe("C1");
    expect(hOf(plan.slices?.monsters, 3)[0]).toBe("C1");
  });

  test("an outpost's HCC skips an upgrading hatchery too", () => {
    const save = { ...yardOf(monstersOf([idle(), idle(), idle()])), type: "outpost" };
    const plan = planHatcheryAdd(save, "hcc", "C1", 5, NOW);

    expect(hOf(plan.slices?.monsters, 1)[0]).toBe("C1");
    expect(hOf(plan.slices?.monsters, 2)[0]).toBe("");
    expect(hOf(plan.slices?.monsters, 3)[0]).toBe("C1");
  });
});
