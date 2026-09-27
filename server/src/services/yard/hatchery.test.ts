import { describe, expect, test } from "bun:test";
import { hatchCost, hatchTime, housingSpace } from "../../game-data/monsterCatalogue.js";
import { ClientSafeError } from "../../middleware/clientSafeError.js";
import type { BuildingData } from "../../types/BuildingData.js";
import type { JsonObject } from "../../types/JsonObject.js";
import { storageCap } from "../base/economy/resourceBudget.js";
import {
  freeHousing,
  hatcheryIds,
  overdriveGate,
  planHatcheryAdd,
  planHatcheryFinish,
  planHatcheryRemove,
  type HatcherySave,
} from "./hatchery.js";
import { hatcheryFinishPrice, timeCost } from "./shiny.js";

/**
 * The hatchery routes (`docs/design/yard-buildings.md` §4.4) against small
 * hand-built yards. Numbers off the catalogue, checked in the first test so a
 * changed table fails here first:
 *
 * - C1 Pokey: 250 / 450 / 675 goo at academy level 1 / 2 / 3; 15 s; 10 space.
 * - C2: 500 goo, 15 s, 10 space. C4: 1,500 goo, 100 s, 20 space.
 * - Housing level 6 holds 540; a level 3 hatchery has 32,000 health.
 */

const NOW = 1_800_000_000;

const HALL = 14;
const HATCHERY = 13;
const HCC = 16;
const HOUSING = 15;
const SILO = 6;

const at = (t: number, l: number, extra: Partial<BuildingData> = {}) =>
  ({ t, x: 0, y: 0, l, ...extra }) as BuildingData;

/**
 * A level 5 hall, hatchery 1 at level 3 and hatchery 2 at level 1, a silo,
 * one level 6 Housing (540); 1,000,000 goo; C1, C2, C4 unlocked at academy
 * level 1, C5 still unlocking.
 */
const yardOf = (overrides: Partial<HatcherySave> = {}): HatcherySave => ({
  buildingdata: {
    "0": { ...at(HALL, 5), id: 0 },
    "1": { ...at(HATCHERY, 3), id: 1 },
    "2": { ...at(HATCHERY, 1), id: 2 },
    "3": { ...at(SILO, 10), id: 3 },
    "4": { ...at(HOUSING, 6), id: 4 },
  },
  buildinghealthdata: {},
  resources: { r1: 0, r2: 0, r3: 0, r4: 1_000_000 },
  monsters: {},
  lockerdata: { C1: { t: 2 }, C2: { t: 2 }, C4: { t: 2 }, C5: { t: 1, s: NOW - 10, e: NOW + 10 } },
  academy: { C1: { level: 1 }, C2: { level: 1 }, C4: { level: 1 } },
  storedata: {},
  ...overrides,
});

/** The same yard with an HCC (building 6), finished unless `extra` says otherwise. */
const hccYard = (
  overrides: Partial<HatcherySave> = {},
  extra: Partial<BuildingData> = {}
): HatcherySave => {
  const base = yardOf(overrides);
  return {
    ...base,
    buildingdata: { ...base.buildingdata, "6": { ...at(HCC, 1, extra), id: 6 } },
  };
};

/** A `monsters` blob: hatcheries 1 and 2 with `h` entries, and an HCC queue. */
const monstersOf = (
  h1: unknown[] = ["", 0, []],
  h2: unknown[] = ["", 0, []],
  hcc: unknown[] = [],
  housed: Record<string, number> = {}
): JsonObject => ({
  saved: NOW,
  housed,
  h: [h1, h2],
  hid: [1, 2],
  hstage: [h1[0] ? 1 : 0, h2[0] ? 1 : 0],
  hcc,
});

/** `h` entry of hatchery `id` in a result's `monsters`. */
const hOf = (monsters: JsonObject | null | undefined, id: number): unknown[] => {
  const index = (monsters!.hid as number[]).indexOf(id);
  return (monsters!.h as unknown[][])[index]!;
};

const queueOf = (monsters: JsonObject | null | undefined, id: number) => hOf(monsters, id)[2];

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

test("the catalogue numbers this file relies on", () => {
  expect([hatchCost("C1", 1), hatchCost("C1", 2), hatchCost("C1", 3)]).toEqual([250, 450, 675]);
  expect([hatchTime("C1", 1), housingSpace("C1", 1)]).toEqual([15, 10]);
  expect([hatchCost("C2", 1), hatchTime("C2", 1), housingSpace("C2", 1)]).toEqual([500, 15, 10]);
  expect([hatchCost("C4", 1), hatchTime("C4", 1), housingSpace("C4", 1)]).toEqual([1500, 100, 20]);
});

describe("hatchery/add — one hatchery's queue", () => {
  test("80 into an empty level 3 hatchery is one plan: the first starts, 79 queue in four stacks", () => {
    const plan = planHatcheryAdd(yardOf(), 1, "C1", 80, NOW);

    expect(plan.report).toEqual({
      hatchery: 1,
      monster: "C1",
      added: 80,
      requested: 80,
      stoppedBy: null,
      cost: { r4: 80 * 250 },
    });
    expect(plan.debit).toEqual({ r4: 20_000 });
    // The first went straight into production, as the first click did.
    expect(hOf(plan.slices?.monsters, 1)).toEqual([
      "C1",
      15,
      [
        ["C1", 20, 1],
        ["C1", 20, 1],
        ["C1", 20, 1],
        ["C1", 19, 1],
      ],
      1,
    ]);
    expect(plan.slices?.monsters?.hstage).toEqual([1, 0]);
    expect(plan.slices?.monsters?.saved).toBe(NOW);
  });

  test("more than the stacks hold stops at the queue and charges only what went in", () => {
    // Hatchery 2 is level 1: the one that starts, then two stacks of 20.
    const plan = planHatcheryAdd(yardOf(), 2, "C1", 100, NOW);

    expect(plan.report).toMatchObject({ added: 41, requested: 100, stoppedBy: "queue" });
    expect(plan.debit).toEqual({ r4: 41 * 250 });
    expect(hOf(plan.slices?.monsters, 2)).toEqual([
      "C1",
      15,
      [
        ["C1", 20, 1],
        ["C1", 20, 1],
      ],
      1,
    ]);
  });

  test("mixed batches merge into the FIRST non-full stack of the monster (MH §5.2 step 4)", () => {
    let save = yardOf({
      monsters: monstersOf([
        "C4",
        50,
        [
          ["C1", 15, 1],
          ["C2", 5, 1],
        ],
        1,
      ]),
    });
    const step = (monster: string, count: number) => {
      const plan = planHatcheryAdd(save, 1, monster, count, NOW);
      save = { ...save, monsters: plan.slices?.monsters ?? save.monsters };
      return plan;
    };

    step("C1", 10); // 15 → 20, then a new stack of 5
    expect(queueOf(save.monsters, 1)).toEqual([
      ["C1", 20, 1],
      ["C2", 5, 1],
      ["C1", 5, 1],
    ]);
    step("C2", 3); // back to the earlier C2 stack, not a new one
    expect(queueOf(save.monsters, 1)).toEqual([
      ["C1", 20, 1],
      ["C2", 8, 1],
      ["C1", 5, 1],
    ]);
    step("C1", 17); // the first non-full C1 stack is the third: 5 → 20, then a fourth stack of 2
    expect(queueOf(save.monsters, 1)).toEqual([
      ["C1", 20, 1],
      ["C2", 8, 1],
      ["C1", 20, 1],
      ["C1", 2, 1],
    ]);
    const full = step("C4", 1); // four stacks at level 3: no room for a new one
    expect(full.report).toMatchObject({ added: 0, stoppedBy: "queue", cost: { r4: 0 } });
    expect(full.slices).toBeUndefined();
    expect(full.debit).toBeUndefined();
    // The monster in production was left alone throughout.
    expect(hOf(save.monsters, 1).slice(0, 2)).toEqual(["C4", 50]);
  });

  test("a stack merges only with one paid at the same academy level; old two-element stacks read as today's level", () => {
    const trained = { C1: { level: 2 }, C2: { level: 1 }, C4: { level: 1 } };
    const paidAtOne = yardOf({
      academy: trained,
      monsters: monstersOf(["C4", 50, [["C1", 5, 1]], 1]),
    });
    const plan = planHatcheryAdd(paidAtOne, 1, "C1", 3, NOW);
    expect(queueOf(plan.slices?.monsters, 1)).toEqual([
      ["C1", 5, 1],
      ["C1", 3, 2],
    ]);
    expect(plan.report.cost).toEqual({ r4: 3 * 450 });

    const legacy = yardOf({ academy: trained, monsters: monstersOf(["C4", 50, [["C1", 5]], 1]) });
    expect(queueOf(planHatcheryAdd(legacy, 1, "C1", 3, NOW).slices?.monsters, 1)).toEqual([
      ["C1", 8, 2],
    ]);
  });

  test("short of goo: adds what the goo pays for and says so", () => {
    const plan = planHatcheryAdd(
      yardOf({ resources: { r1: 0, r2: 0, r3: 0, r4: 7 * 250 + 100 } }),
      1,
      "C1",
      10,
      NOW
    );
    expect(plan.report).toMatchObject({
      added: 7,
      requested: 10,
      stoppedBy: "goo",
      cost: { r4: 1750 },
    });

    const broke = planHatcheryAdd(yardOf({ resources: { r4: 0 } }), 1, "C1", 1, NOW);
    expect(broke.report).toMatchObject({ added: 0, stoppedBy: "goo" });
    expect(broke.slices).toBeUndefined();
  });

  test("the monster must be obtainable (400) and unlocked (409 locked)", () => {
    expect(refusal(() => planHatcheryAdd(yardOf(), 1, "C18", 1, NOW)).slice(0, 2)).toEqual([
      400,
      "badRequest",
    ]);
    expect(refusal(() => planHatcheryAdd(yardOf(), 1, "IC1", 1, NOW)).slice(0, 2)).toEqual([
      400,
      "badRequest",
    ]);
    expect(refusal(() => planHatcheryAdd(yardOf(), 1, "C5", 1, NOW))).toEqual([
      409,
      "locked",
      { reason: "locked", monster: "C5" },
    ]);
    expect(refusal(() => planHatcheryAdd(yardOf(), 1, "C3", 1, NOW))[1]).toBe("locked");
  });

  test("an id that is not a hatchery is 409 noHatchery", () => {
    expect(refusal(() => planHatcheryAdd(yardOf(), 3, "C1", 1, NOW))).toEqual([
      409,
      "noHatchery",
      { reason: "noHatchery", id: 3 },
    ]);
    expect(refusal(() => planHatcheryAdd(yardOf(), 99, "C1", 1, NOW))[1]).toBe("noHatchery");
  });

  test("a hatchery still being built or damaged still takes queue changes; one being built holds one stack", () => {
    const building = yardOf();
    building.buildingdata!["2"] = { ...at(HATCHERY, 0, { cB: 600 }), id: 2 };
    const plan = planHatcheryAdd(building, 2, "C1", 25, NOW);
    expect(plan.report).toMatchObject({ added: 21, stoppedBy: "queue" });
    // It holds a monster ready; it just does not count down until built.
    expect(hOf(plan.slices?.monsters, 2)).toEqual(["C1", 15, [["C1", 20, 1]], 1]);

    const damaged = yardOf({ buildinghealthdata: { "1": 1_000 } });
    expect(planHatcheryAdd(damaged, 1, "C1", 5, NOW).report.added).toBe(5);
  });

  test("hatcheries are served in the stored hid order, new ones after by id", () => {
    const save = yardOf({ monsters: { hid: [2, 1, 77] } });
    save.buildingdata!["9"] = { ...at(HATCHERY, 1), id: 9 };
    save.buildingdata!["8"] = { ...at(HATCHERY, 1), id: 8 };
    expect(hatcheryIds(save)).toEqual([2, 1, 8, 9]);
  });
});

describe("hatchery/add — with a Hatchery Control Centre", () => {
  test("once the HCC is built only `hcc` is accepted; before that `hcc` is refused", () => {
    expect(refusal(() => planHatcheryAdd(hccYard(), 1, "C1", 1, NOW))).toEqual([
      409,
      "useHcc",
      { reason: "useHcc", id: 1 },
    ]);
    expect(refusal(() => planHatcheryAdd(yardOf(), "hcc", "C1", 1, NOW))[1]).toBe("noHcc");

    // An HCC still being built changes nothing yet.
    const building = hccYard({}, { cB: 1000 });
    expect(refusal(() => planHatcheryAdd(building, "hcc", "C1", 1, NOW))[1]).toBe("noHcc");
    expect(planHatcheryAdd(building, 1, "C1", 1, NOW).report.added).toBe(1);
  });

  test("the shared queue merges only into its LAST stack, seven stacks of 20", () => {
    const save = hccYard({
      monsters: monstersOf(
        ["C4", 50, [], 1],
        ["C4", 50, [], 1],
        [
          ["C1", 5, 1],
          ["C2", 5, 1],
        ]
      ),
    });
    const plan = planHatcheryAdd(save, "hcc", "C1", 1, NOW);
    expect(plan.slices?.monsters?.hcc).toEqual([
      ["C1", 5, 1],
      ["C2", 5, 1],
      ["C1", 1, 1],
    ]);

    const more = planHatcheryAdd(save, "hcc", "C2", 200, NOW);
    expect(more.report).toMatchObject({ added: 15 + 5 * 20, stoppedBy: "queue" });
    expect((more.slices?.monsters?.hcc as unknown[]).length).toBe(7);
  });

  test("idle hatcheries that can work take from the shared queue in service order", () => {
    const save = hccYard({ monsters: monstersOf() });
    const plan = planHatcheryAdd(save, "hcc", "C1", 5, NOW);
    expect(hOf(plan.slices?.monsters, 1)).toEqual(["C1", 15, [], 1]);
    expect(hOf(plan.slices?.monsters, 2)).toEqual(["C1", 15, [], 1]);
    expect(plan.slices?.monsters?.hcc).toEqual([["C1", 3, 1]]);

    // Hatchery 1 below half health and hatchery 2 still being built take nothing.
    const idle = hccYard({ monsters: monstersOf(), buildinghealthdata: { "1": 15_000 } });
    idle.buildingdata!["2"] = { ...at(HATCHERY, 0, { cB: 600 }), id: 2 };
    const held = planHatcheryAdd(idle, "hcc", "C1", 5, NOW);
    expect(held.slices?.monsters?.hcc).toEqual([["C1", 5, 1]]);
    expect(hOf(held.slices?.monsters, 1)).toEqual(["", 0, []]);
  });
});

describe("hatchery/remove", () => {
  const busy = () =>
    yardOf({
      monsters: monstersOf([
        "C2",
        9,
        [
          ["C1", 20, 1],
          ["C2", 5, 1],
        ],
        1,
      ]),
    });

  test("count off a stack, refunded at the paid price", () => {
    const plan = planHatcheryRemove(busy(), 1, 1, 3, NOW);
    expect(plan.report).toEqual({
      hatchery: 1,
      slot: 1,
      monster: "C1",
      removed: 3,
      refund: { r4: 750 },
    });
    expect(plan.credit).toEqual({ r4: 750 });
    expect(queueOf(plan.slices?.monsters, 1)).toEqual([
      ["C1", 17, 1],
      ["C2", 5, 1],
    ]);
  });

  test("`all` (or more than the stack holds) takes the stack away", () => {
    const all = planHatcheryRemove(busy(), 1, 2, "all", NOW);
    expect(all.report).toMatchObject({ monster: "C2", removed: 5, refund: { r4: 2500 } });
    expect(queueOf(all.slices?.monsters, 1)).toEqual([["C1", 20, 1]]);
    expect(planHatcheryRemove(busy(), 1, 2, 99, NOW).report.removed).toBe(5);
  });

  test("the refund is what was paid, not today's price (§10 Q2)", () => {
    const save = yardOf({
      academy: { C1: { level: 3 } },
      monsters: monstersOf([
        "C1",
        5,
        [
          ["C1", 4, 1],
          ["C1", 2, 3],
        ],
        2,
      ]),
    });
    expect(planHatcheryRemove(save, 1, 1, "all", NOW).report.refund).toEqual({ r4: 4 * 250 });
    expect(planHatcheryRemove(save, 1, 2, "all", NOW).report.refund).toEqual({ r4: 2 * 675 });
    expect(planHatcheryRemove(save, 1, 0, 1, NOW).report.refund).toEqual({ r4: 450 });
  });

  test("slot 0 refunds the monster in production and starts the next", () => {
    const plan = planHatcheryRemove(busy(), 1, 0, "all", NOW);
    expect(plan.report).toMatchObject({ slot: 0, monster: "C2", removed: 1, refund: { r4: 500 } });
    expect(hOf(plan.slices?.monsters, 1)).toEqual([
      "C1",
      15,
      [
        ["C1", 19, 1],
        ["C2", 5, 1],
      ],
      1,
    ]);

    // A hatchery with nothing queued goes idle.
    const last = yardOf({ monsters: monstersOf(["C2", 9, [], 1]) });
    const idle = planHatcheryRemove(last, 1, 0, 1, NOW);
    expect(hOf(idle.slices?.monsters, 1)).toEqual(["", 0, []]);
    expect(idle.slices?.monsters?.hstage).toEqual([0, 0]);
  });

  test("an empty slot is 409 noSlot", () => {
    expect(refusal(() => planHatcheryRemove(yardOf(), 1, 0, 1, NOW))).toEqual([
      409,
      "noSlot",
      { reason: "noSlot", slot: 0 },
    ]);
    expect(refusal(() => planHatcheryRemove(busy(), 1, 3, 1, NOW))[1]).toBe("noSlot");
  });

  test("with an HCC: `hcc` names the shared stacks, a hatchery only its monster in production", () => {
    const save = hccYard({
      monsters: monstersOf(
        ["C4", 70, [], 1],
        ["C2", 3, [], 1],
        [
          ["C1", 6, 1],
          ["C2", 2, 1],
        ]
      ),
    });

    const stack = planHatcheryRemove(save, "hcc", 1, 2, NOW);
    expect(stack.report).toMatchObject({ monster: "C1", removed: 2, refund: { r4: 500 } });
    expect(stack.slices?.monsters?.hcc).toEqual([
      ["C1", 4, 1],
      ["C2", 2, 1],
    ]);

    // The × on a hatchery's tile: refund, and it takes the next from the shared queue.
    const tile = planHatcheryRemove(save, 1, 0, 1, NOW);
    expect(tile.report).toMatchObject({ monster: "C4", refund: { r4: 1500 } });
    expect(hOf(tile.slices?.monsters, 1)).toEqual(["C1", 15, [], 1]);
    expect(tile.slices?.monsters?.hcc).toEqual([
      ["C1", 5, 1],
      ["C2", 2, 1],
    ]);

    expect(refusal(() => planHatcheryRemove(save, 1, 1, 1, NOW))[1]).toBe("useHcc");
    expect(refusal(() => planHatcheryRemove(save, "hcc", 0, 1, NOW))[1]).toBe("noSlot");
  });

  test("the report says what actually came back under the storage cap", () => {
    const cap = storageCap(yardOf());
    const full = yardOf({ resources: { r4: cap - 100 }, monsters: busy().monsters });
    const plan = planHatcheryRemove(full, 1, 1, "all", NOW);
    expect(plan.credit).toEqual({ r4: 20 * 250 });
    expect(plan.report.refund).toEqual({ r4: 100 });
  });
});

describe("hatchery/finish", () => {
  test("houses the monster in production and the queue for timeCost(total, false) × 4", () => {
    const save = yardOf({ monsters: monstersOf(["C4", 60, [["C4", 5, 1]], 1]) });
    const plan = planHatcheryFinish(save, 1, NOW);

    // 60 s left on the one in production + 5 × 100 s queued.
    expect(plan.report).toEqual({
      hatchery: 1,
      housed: { C4: 6 },
      credits: hatcheryFinishPrice(560),
      finishedAll: true,
    });
    expect(plan.shiny).toBe(timeCost(560, false) * 4);
    expect(plan.shiny).toBe(16);
    expect(plan.slices?.monsters?.housed).toEqual({ C4: 6 });
    expect(hOf(plan.slices?.monsters, 1)).toEqual(["", 0, []]);
  });

  test("housing short: houses what fits, the next one starts, finishedAll false", () => {
    // 540 space, 500 used by 50 Pokeys: room for four more.
    const save = yardOf({
      monsters: monstersOf(["C1", 10, [["C1", 5, 1]], 1], undefined, [], { C1: 50 }),
    });
    expect(freeHousing(save, { C1: 50 }, {}, NOW)).toBe(40);

    const plan = planHatcheryFinish(save, 1, NOW);
    expect(plan.report).toMatchObject({ housed: { C1: 4 }, finishedAll: false });
    expect(plan.shiny).toBe(hatcheryFinishPrice(10 + 3 * 15));
    expect(plan.slices?.monsters?.housed).toEqual({ C1: 54 });
    expect(hOf(plan.slices?.monsters, 1)).toEqual(["C1", 15, [["C1", 1, 1]], 1]);
  });

  test("a finished monster waiting for housing costs no time", () => {
    const monsters = monstersOf(["C1", 0, [], 1]);
    monsters.hstage = [2, 0];
    const plan = planHatcheryFinish(yardOf({ monsters }), 1, NOW);
    expect(plan.report).toMatchObject({ housed: { C1: 1 }, credits: 0, finishedAll: true });
  });

  test("Housing Expansion counts: 1.25x while it runs", () => {
    const save = yardOf({ storedata: { EXH: { q: 1, s: NOW - 10, e: NOW + 10 } } });
    expect(freeHousing(save, {}, {}, NOW)).toBe(675);
    expect(freeHousing(save, {}, {}, NOW + 10)).toBe(540);
  });

  test("nothing fits: 409 housingFull; nothing there: 409 nothingToFinish", () => {
    const full = yardOf({ monsters: monstersOf(["C4", 60, [], 1], undefined, [], { C1: 53 }) });
    expect(refusal(() => planHatcheryFinish(full, 1, NOW))).toEqual([
      409,
      "housingFull",
      { reason: "housingFull", free: 10 },
    ]);
    expect(refusal(() => planHatcheryFinish(yardOf(), 1, NOW))[1]).toBe("nothingToFinish");
  });

  test("the hatchery must be able to work: 409 busy while built, 409 damaged below half health", () => {
    const monsters = monstersOf(["C1", 10, [], 1]);
    const building = yardOf({ monsters });
    building.buildingdata!["1"] = { ...at(HATCHERY, 0, { cB: 60 }), id: 1 };
    expect(refusal(() => planHatcheryFinish(building, 1, NOW))[1]).toBe("busy");
    expect(
      refusal(() =>
        planHatcheryFinish(yardOf({ monsters, buildinghealthdata: { "1": 15_999 } }), 1, NOW)
      )[1]
    ).toBe("damaged");
    expect(
      planHatcheryFinish(yardOf({ monsters, buildinghealthdata: { "1": 16_000 } }), 1, NOW).report
        .housed
    ).toEqual({
      C1: 1,
    });
  });

  test("with an HCC: `hcc` finishes every working hatchery and the shared queue", () => {
    const save = hccYard({
      monsters: monstersOf(
        ["C4", 70, [], 1],
        ["C1", 4, [], 1],
        [
          ["C2", 3, 1],
          ["C1", 2, 1],
        ]
      ),
    });
    const plan = planHatcheryFinish(save, "hcc", NOW);
    expect(plan.report).toEqual({
      hatchery: "hcc",
      housed: { C4: 1, C1: 3, C2: 3 },
      credits: hatcheryFinishPrice(70 + 4 + 3 * 15 + 2 * 15),
      finishedAll: true,
    });
    expect(plan.slices?.monsters?.hcc).toEqual([]);

    expect(refusal(() => planHatcheryFinish(save, 1, NOW))[1]).toBe("useHcc");
    expect(refusal(() => planHatcheryFinish(yardOf(), "hcc", NOW))[1]).toBe("noHcc");
  });

  test("with an HCC: a damaged hatchery's monster is left out, and idle ones take the next", () => {
    const save = hccYard({
      buildinghealthdata: { "2": 100 },
      monsters: monstersOf(["C4", 70, [], 1], ["C1", 4, [], 1], [["C1", 30, 1]], { C1: 20 }),
    });
    // 540 − 200 = 340 free: the C4 (20) and all 30 queued Pokeys (300) fit.
    const plan = planHatcheryFinish(save, "hcc", NOW);
    expect(plan.report).toMatchObject({ housed: { C4: 1, C1: 30 }, finishedAll: true });
    expect(hOf(plan.slices?.monsters, 2)).toEqual(["C1", 4, [], 1]);

    const tight = hccYard({
      monsters: monstersOf(["C4", 70, [], 1], ["", 0, []], [["C1", 30, 1]], { C1: 50 }),
    });
    const partial = planHatcheryFinish(tight, "hcc", NOW);
    // 40 free: C4 takes 20, two Pokeys fill the rest; the rest wait, and both hatcheries take one.
    expect(partial.report).toMatchObject({ housed: { C4: 1, C1: 2 }, finishedAll: false });
    expect(partial.slices?.monsters?.hcc).toEqual([["C1", 26, 1]]);
    expect(hOf(partial.slices?.monsters, 1)).toEqual(["C1", 15, [], 1]);
    expect(hOf(partial.slices?.monsters, 2)).toEqual(["C1", 15, [], 1]);
  });
});

describe("overdrives", () => {
  test("one hatchery overdrive at a time", () => {
    expect(() => overdriveGate({}, NOW)).not.toThrow();
    expect(() => overdriveGate({ HOD: { q: 1, e: NOW } }, NOW)).not.toThrow();
    expect(refusal(() => overdriveGate({ HOD2: { q: 1, e: NOW + 60 } }, NOW))).toEqual([
      409,
      "alreadyActive",
      { reason: "alreadyActive", item: "HOD2", endsAt: NOW + 60 },
    ]);
  });
});
