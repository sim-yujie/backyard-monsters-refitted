import { describe, expect, test } from "bun:test";
import { costOf } from "../../game-data/buildingCosts.js";
import { ClientSafeError } from "../../middleware/clientSafeError.js";
import type { BuildingData } from "../../types/BuildingData.js";
import type { JsonObject } from "../../types/JsonObject.js";
import { planOneUpgrade } from "../yardplanner/startUpgrades.js";
import { hccLevel, hccLimits, planHatcheryAdd, type HatcherySave } from "./hatchery.js";
import { checkRemote, hccContext, planPresetSave, planPresetSend, readPresets } from "./hccPresets.js";
import { planHccOutposts } from "./hccOutposts.js";

/**
 * Beta 9: the Hatchery Control Centre's levels 2 and 3, its presets and its
 * level 3 "run your outposts from home" (owner, desk cards b9-num-hcc,
 * b9-hcc-r3..r6, 21-22 Nov 2026).
 *
 * Numbers off the catalogue: C1 Pokey 250 goo, C2 500, C4 1,500 at academy 1.
 */

const NOW = 1_800_000_000;
const HALL = 14;
const HATCHERY = 13;
const HCC = 16;
const HOUSING = 15;
const SILO = 6;
const CORE = 112;

const at = (t: number, l: number, extra: Partial<BuildingData> = {}) => ({ t, x: 0, y: 0, l, ...extra }) as BuildingData;

/** Both hatcheries busy with a long C4, so nothing is handed out of the HCC queue while a test fills it. */
const busy = (hcc: unknown[] = []): JsonObject => ({
  saved: NOW,
  housed: {},
  h: [
    ["C4", 90, [], 1],
    ["C4", 90, [], 1],
  ],
  hid: [1, 2],
  hstage: [1, 1],
  hcc,
});

type Yard = HatcherySave & { hccpresets?: JsonObject | null };

/** A main yard: hall `hall`, two level 3 hatcheries, a silo, Housing, an HCC at `level`; 10M goo. */
const mainOf = (level: number, overrides: Partial<Yard> = {}, hall = 8): Yard => ({
  type: "main",
  buildingdata: {
    "0": { ...at(HALL, hall), id: 0 },
    "1": { ...at(HATCHERY, 3), id: 1 },
    "2": { ...at(HATCHERY, 3), id: 2 },
    "3": { ...at(SILO, 10), id: 3 },
    "4": { ...at(HOUSING, 6), id: 4 },
    ...(level > 0 ? { "6": { ...at(HCC, level), id: 6 } } : {}),
  },
  buildinghealthdata: {},
  resources: { r1: 0, r2: 0, r3: 0, r4: 10_000_000 },
  monsters: busy(),
  lockerdata: { C1: { t: 2 }, C2: { t: 2 }, C4: { t: 2 }, C5: { t: 1 } },
  academy: { C1: { level: 1 }, C2: { level: 1 }, C4: { level: 1 } },
  storedata: {},
  ...overrides,
});

/** An outpost: its core, two level 3 hatcheries, Housing, an HCC at `level` (none at 0). */
const outpostOf = (level: number, overrides: Partial<Yard> = {}): Yard => ({
  ...mainOf(0),
  type: "outpost",
  buildingdata: {
    "0": { ...at(CORE, 1), id: 0 },
    "1": { ...at(HATCHERY, 3), id: 1 },
    "2": { ...at(HATCHERY, 3), id: 2 },
    "4": { ...at(HOUSING, 6), id: 4 },
    ...(level > 0 ? { "6": { ...at(HCC, level), id: 6 } } : {}),
  },
  ...overrides,
});

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

const hccQueue = (plan: { slices?: { monsters?: JsonObject } }) => plan.slices?.monsters?.hcc as unknown[];

describe("the HCC's cost ladder (desk b9-num-hcc)", () => {
  test("main yard: L1 as Flash's, L2 8M x3 / 2 days / Town Hall 6 + four level 3 Hatcheries, L3 16M x3 / 4 days / Town Hall 8", () => {
    const steps = costOf(HCC, "main")!.costs;
    expect(steps.length).toBe(3);
    expect(steps[0]).toEqual([4_000_000, 4_000_000, 4_000_000, 0, 90_000, [[14, 1, 3], [13, 3, 2]]]);
    expect(steps[1]).toEqual([8_000_000, 8_000_000, 8_000_000, 0, 172_800, [[14, 1, 6], [13, 4, 3]]]);
    expect(steps[2]).toEqual([16_000_000, 16_000_000, 16_000_000, 0, 345_600, [[14, 1, 8]]]);
    // One HCC from Town Hall 3.
    expect(costOf(HCC, "main")!.quantity[3]).toBe(1);
    expect(costOf(HCC, "main")!.quantity[2]).toBe(0);
  });

  test("outpost: L2 1M x3 / 2 days / two level 3 Hatcheries; the Inferno's Incubator Control Centre keeps one level", () => {
    const steps = costOf(HCC, "outpost")!.costs;
    expect(steps.length).toBe(2);
    expect(steps[1]).toEqual([1_000_000, 1_000_000, 1_000_000, 0, 172_800, [[112, 1, 1], [13, 2, 3]]]);
    expect(costOf(HCC, "inferno")!.costs.length).toBe(1);
  });

  test("the upgrade route's rule: L2 needs Town Hall 6 and four level 3 Hatcheries, L3 Town Hall 8", () => {
    const rich = { resources: { r1: 50_000_000, r2: 50_000_000, r3: 50_000_000, r4: 0 } };
    const four = {
      "7": { ...at(HATCHERY, 3), id: 7 },
      "8": { ...at(HATCHERY, 3), id: 8 },
    };
    // Town Hall 5: the hall stops it.
    const hall5 = mainOf(1, rich, 5);
    expect(planOneUpgrade(hall5, 6, NOW)).toMatchObject({ ok: false, reason: "townHall" });
    // Town Hall 6 with two level 3 Hatcheries: four are needed.
    const two = mainOf(1, rich, 6);
    expect(planOneUpgrade(two, 6, NOW)).toMatchObject({ ok: false, reason: "requirements" });
    const ready = mainOf(1, rich, 6);
    ready.buildingdata = { ...ready.buildingdata, ...four };
    expect(planOneUpgrade(ready, 6, NOW)).toMatchObject({ ok: true });
    // Level 2 to 3 at Town Hall 7 is refused, at 8 allowed; level 3 is the top.
    const l2 = mainOf(2, rich, 7);
    expect(planOneUpgrade(l2, 6, NOW)).toMatchObject({ ok: false, reason: "townHall" });
    expect(planOneUpgrade(mainOf(2, rich, 8), 6, NOW)).toMatchObject({ ok: true });
    expect(planOneUpgrade(mainOf(3, rich, 10), 6, NOW)).toMatchObject({ ok: false });
  });

  test("an outpost's HCC goes to level 2 with two level 3 Hatcheries, and no further", () => {
    const rich = { resources: { r1: 5_000_000, r2: 5_000_000, r3: 5_000_000, r4: 0 } };
    expect(planOneUpgrade(outpostOf(1, rich), 6, NOW)).toMatchObject({ ok: true });
    const low = outpostOf(1, rich);
    low.buildingdata = { ...low.buildingdata, "2": { ...at(HATCHERY, 2), id: 2 } };
    expect(planOneUpgrade(low, 6, NOW)).toMatchObject({ ok: false, reason: "requirements" });
    expect(planOneUpgrade(outpostOf(2, rich), 6, NOW)).toMatchObject({ ok: false });
  });
});

describe("the shared queue per level", () => {
  test("limits: L1 7 x 20 and 2 presets, L2 10 x 20 and 4, L3 10 x 30 and 6", () => {
    expect([1, 2, 3].map(hccLimits)).toEqual([
      { level: 1, stacks: 7, size: 20, presets: 2 },
      { level: 2, stacks: 10, size: 20, presets: 4 },
      { level: 3, stacks: 10, size: 30, presets: 6 },
    ]);
  });

  test("an HCC being built has no level; one being upgraded keeps its level until it ends", () => {
    expect(hccLevel(mainOf(0))).toBe(0);
    const building = mainOf(1);
    building.buildingdata!["6"] = { ...at(HCC, 0, { cB: 500 }), id: 6 };
    expect(hccLevel(building)).toBe(0);
    const upgrading = mainOf(2);
    upgrading.buildingdata!["6"] = { ...at(HCC, 2, { cU: 500 }), id: 6 };
    expect(hccLevel(upgrading)).toBe(2);
  });

  test("add fills 7 x 20 at L1, 10 x 20 at L2, 10 x 30 at L3", () => {
    const fill = (level: number) => planHatcheryAdd(mainOf(level), "hcc", "C1", 400, NOW);
    expect(fill(1).report).toMatchObject({ added: 140, stoppedBy: "queue" });
    expect(hccQueue(fill(1)).length).toBe(7);
    expect(fill(2).report).toMatchObject({ added: 200, stoppedBy: "queue" });
    expect(hccQueue(fill(2))).toEqual(Array.from({ length: 10 }, () => ["C1", 20, 1]));
    expect(fill(3).report).toMatchObject({ added: 300, stoppedBy: "queue" });
    expect(hccQueue(fill(3))).toEqual(Array.from({ length: 10 }, () => ["C1", 30, 1]));
  });

  test("an outpost's HCC at level 2 holds 10 x 20", () => {
    const plan = planHatcheryAdd(outpostOf(2), "hcc", "C1", 400, NOW);
    expect(plan.report).toMatchObject({ added: 200, stoppedBy: "queue" });
  });
});

describe("presets: saved in order, one tap to send", () => {
  test("a preset keeps its order; the same monster may come back later; side-by-side stacks join", () => {
    const plan = planPresetSave(mainOf(2), undefined, 0, [["C1", 30], ["C2", 40], ["C1", 30]], false);
    expect(plan.report).toEqual({ list: "home", slot: 0, preset: [["C1", 30], ["C2", 40], ["C1", 30]] });
    expect(plan.slices.hccpresets).toEqual({ home: [[["C1", 30], ["C2", 40], ["C1", 30]]], out: [] });
    const joined = planPresetSave(mainOf(2), undefined, 1, [["C1", 10], ["C1", 5], ["C2", 3]], false);
    expect(joined.report.preset).toEqual([["C1", 15], ["C2", 3]]);
    // Slot 1 lands beside the kept slot 0.
    const both = planPresetSave(mainOf(2, { hccpresets: plan.slices.hccpresets }), undefined, 1, [["C4", 5]], false);
    expect(readPresets(both.slices.hccpresets).home.slice(0, 2)).toEqual([
      [["C1", 30], ["C2", 40], ["C1", 30]],
      [["C4", 5]],
    ]);
    // [] empties a slot.
    const cleared = planPresetSave(mainOf(2, { hccpresets: both.slices.hccpresets }), undefined, 0, [], false);
    expect(readPresets(cleared.slices.hccpresets).home[0]).toEqual([]);
  });

  test("slots per level: 2 at L1, 4 at L2, 6 at L3; past that is 409 presetLocked", () => {
    const save = (level: number, slot: number) => () => planPresetSave(mainOf(level), undefined, slot, [["C1", 1]], false);
    expect(save(1, 1)().report.slot).toBe(1);
    expect(refusal(save(1, 2))).toEqual([409, "presetLocked", { reason: "presetLocked", slot: 2, slots: 2 }]);
    expect(save(2, 3)().report.slot).toBe(3);
    expect(refusal(save(2, 4))[1]).toBe("presetLocked");
    expect(save(3, 5)().report.slot).toBe(5);
    expect(refusal(() => planPresetSave(mainOf(0), undefined, 0, [["C1", 1]], false))[1]).toBe("noHcc");
  });

  test("a preset holds what the queue holds: 7 boxes of 20 at L1, 10 of 20 at L2, 10 of 30 at L3", () => {
    const boxes = (level: number, count: number) => () =>
      planPresetSave(mainOf(level), undefined, 0, [["C1", count]], false);
    expect(boxes(1, 140)().report.preset).toEqual([["C1", 140]]);
    expect(refusal(boxes(1, 141))).toEqual([400, "badRequest", expect.objectContaining({ boxes: 8, most: 7, size: 20 })]);
    expect(boxes(2, 200)().report.preset).toEqual([["C1", 200]]);
    expect(refusal(boxes(2, 201))[0]).toBe(400);
    expect(boxes(3, 300)().report.preset).toEqual([["C1", 300]]);
    // Counted per stack: 30 Pokey > 40 Octo > 30 Pokey is 2 + 2 + 2 boxes at size 20, 1 + 2 + 1 at 30.
    expect(refusal(() => planPresetSave(mainOf(1), undefined, 0, [["C1", 30], ["C2", 40], ["C1", 30], ["C2", 21]], false))[2]).toMatchObject({ boxes: 8 });
    // A monster that cannot be hatched is a 400.
    expect(refusal(() => planPresetSave(mainOf(2), undefined, 0, [["IC1", 1]], false))[0]).toBe(400);
  });

  test("send adds the stacks to the END of the queue in order, never merged into totals", () => {
    const saved = planPresetSave(mainOf(2), undefined, 0, [["C1", 30], ["C2", 40], ["C1", 30]], false).slices.hccpresets;
    const plan = planPresetSend(mainOf(2, { hccpresets: saved, monsters: busy([["C4", 5, 1]]) }), undefined, 0, false, NOW);
    expect(plan.report).toMatchObject({ list: "home", slot: 0, added: 100, requested: 100, stoppedBy: null, skipped: [] });
    expect(plan.debit).toEqual({ r4: 60 * 250 + 40 * 500 });
    expect(hccQueue(plan)).toEqual([
      ["C4", 5, 1],
      ["C1", 20, 1],
      ["C1", 10, 1],
      ["C2", 20, 1],
      ["C2", 20, 1],
      ["C1", 20, 1],
      ["C1", 10, 1],
    ]);
  });

  test("send stops at the queue or the goo and says so; a locked monster is skipped", () => {
    const saved = planPresetSave(mainOf(1), undefined, 0, [["C1", 100], ["C5", 20], ["C2", 20]], false).slices.hccpresets;
    // L1: 7 boxes, two already waiting. 100 Pokey fill the other 5, the locked C5 is skipped, no room for C2.
    const waiting = busy([["C4", 5, 1], ["C2", 5, 1]]);
    const full = planPresetSend(mainOf(1, { hccpresets: saved, monsters: waiting }), undefined, 0, false, NOW);
    expect(full.report).toMatchObject({ added: 100, requested: 140, stoppedBy: "queue", skipped: ["C5"] });
    // 30,000 goo: 100 Pokey (25,000) then 10 C2 (5,000).
    const poor = planPresetSend(
      mainOf(1, { hccpresets: saved, resources: { r1: 0, r2: 0, r3: 0, r4: 30_000 } }),
      undefined,
      0,
      false,
      NOW
    );
    expect(poor.report).toMatchObject({ added: 110, stoppedBy: "goo", cost: { r4: 30_000 } });
    // Nothing fits: no write.
    const none = planPresetSend(
      mainOf(1, { hccpresets: saved, resources: { r1: 0, r2: 0, r3: 0, r4: 100 } }),
      undefined,
      0,
      false,
      NOW
    );
    expect(none).toEqual({ report: expect.objectContaining({ added: 0, stoppedBy: "goo" }) });
    // An empty or locked slot.
    expect(refusal(() => planPresetSend(mainOf(1, { hccpresets: saved }), undefined, 1, false, NOW))[1]).toBe("emptyPreset");
    expect(refusal(() => planPresetSend(mainOf(1, { hccpresets: saved }), undefined, 2, false, NOW))[1]).toBe("presetLocked");
  });

  test("a level 3 HCC's preset fills boxes of 30", () => {
    const saved = planPresetSave(mainOf(3), undefined, 0, [["C1", 45], ["C2", 30]], false).slices.hccpresets;
    const plan = planPresetSend(mainOf(3, { hccpresets: saved }), undefined, 0, false, NOW);
    expect(hccQueue(plan)).toEqual([
      ["C1", 30, 1],
      ["C1", 15, 1],
      ["C2", 30, 1],
    ]);
  });
});

describe("home and outpost presets are kept apart", () => {
  test("an outpost uses the one shared outpost list; the main yard its own", () => {
    const home = planPresetSave(mainOf(2), undefined, 0, [["C1", 10]], false).slices.hccpresets;
    const out = planPresetSave(outpostOf(2, { hccpresets: home }), undefined, 0, [["C2", 20]], false);
    expect(out.report.list).toBe("out");
    expect(readPresets(out.slices.hccpresets).home[0]).toEqual([["C1", 10]]);
    expect(readPresets(out.slices.hccpresets).out[0]).toEqual([["C2", 20]]);
    // Another outpost sends the same shared preset.
    const sent = planPresetSend(outpostOf(1, { hccpresets: out.slices.hccpresets }), undefined, 0, false, NOW);
    expect(sent.report).toMatchObject({ list: "out", added: 20 });
  });

  test("an outpost's presets: 2 with its HCC at L1, 4 at L2, 6 run from a level 3 home; up to 10 boxes of 20", () => {
    expect(hccContext(outpostOf(1), undefined, false)).toMatchObject({ list: "out", slots: 2, boxes: 10, size: 20 });
    expect(hccContext(outpostOf(2), undefined, false)).toMatchObject({ slots: 4 });
    expect(hccContext(outpostOf(1), mainOf(3), true)).toMatchObject({ list: "out", level: 1, slots: 6 });
    expect(refusal(() => planPresetSave(outpostOf(2), undefined, 0, [["C1", 201]], false))[0]).toBe(400);
  });
});

describe("level 3: run your outposts from home", () => {
  test("allowed only with a level 3 home HCC, on an outpost with an HCC of its own", () => {
    expect(() => checkRemote(outpostOf(1), mainOf(3), true)).not.toThrow();
    expect(refusal(() => checkRemote(outpostOf(1), mainOf(2), true))).toEqual([
      409,
      "hccLevel",
      { reason: "hccLevel", need: 3, have: 2 },
    ]);
    expect(refusal(() => checkRemote(outpostOf(0), mainOf(3), true))[1]).toBe("noOutpostHcc");
    // Only an outpost is run from home.
    expect(refusal(() => checkRemote(mainOf(3), mainOf(3), true))[0]).toBe(400);
    // Without `remote`, nothing is checked (the player is in that yard).
    expect(() => checkRemote(outpostOf(0), mainOf(0), false)).not.toThrow();
  });

  test("the yard list: every outpost in the main yard's order with its HCC level and queue, at level 3 only", () => {
    const main = { ...mainOf(3), outposts: [[1, 1, "900"], [2, 2, "901"], [3, 3, "902"]] as [number, number, string][] };
    const rows = [
      { ...outpostOf(2, { monsters: busy([["C1", 20, 1], ["C2", 5, 1]]) }), baseid: "901" },
      { ...outpostOf(0), baseid: "900" },
    ];
    expect(planHccOutposts(main, rows)).toEqual({
      yards: [
        { baseid: "900", hcc: 0, queued: 2 },
        { baseid: "901", hcc: 2, queued: 27 },
      ],
    });
    expect(refusal(() => planHccOutposts({ ...mainOf(2), outposts: [] }, []))[1]).toBe("hccLevel");
  });
});
