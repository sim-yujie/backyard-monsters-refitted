import { describe, expect, it } from "vitest";
import type { BaseLoadResponse, BuildingData } from "@/api/types";
import { timeCost } from "@/game/yard/buildingCosts";
import {
  activeOverdrive,
  fillLimits,
  freeHousing,
  hatchMonsters,
  housingWarning,
  previewAdd,
  previewFinish,
  queueRoom,
  readHatchYard,
} from "./hatchPlan";

/**
 * The Hatch tab's arithmetic (`docs/design/yard-buildings.md` §4.4): the
 * server's add rules replayed for queue room and the merge preview, Fill as
 * the smallest of queue room, goo and free housing, the over-housing line,
 * and Finish now's walk and price.
 *
 * Numbers used: Pokey (C1) costs 250 goo, takes 15 s and 10 space at academy
 * level 1 (1,250 / 5 s / 7 at level 6); Bolt (C3) 350 goo, 23 s, 15 space;
 * a level 6 Housing holds 540; a level 3 Hatchery has 32,000 health.
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

/** A yard with two Housing L6 (1,080 space), plenty of goo, and whatever else is passed. */
const saveOf = (extra: Partial<BaseLoadResponse> = {}, buildings: BuildingData[] = []): BaseLoadResponse =>
  ({
    error: 0,
    currenttime: T0,
    savetime: T0,
    resources: { r1: 0, r2: 0, r3: 0, r4: 10_000_000 },
    credits: 1_000,
    buildingdata: Object.fromEntries(
      [building(1, 15, 6), building(2, 15, 6), ...buildings].map((one) => [String(one.id), one]),
    ),
    buildinghealthdata: {},
    storedata: {},
    lockerdata: { C1: { t: 2 }, C3: { t: 2 }, C4: { t: 1 } },
    academy: {},
    ...extra,
  }) as unknown as BaseLoadResponse;

const monsters = (entry: Record<string, unknown>) => ({ saved: T0, housed: {}, ...entry });

describe("readHatchYard", () => {
  it("reads each hatchery's state, service order, and a two-element stack at today's level", () => {
    const save = saveOf(
      {
        academy: { C1: { level: 3 } },
        buildinghealthdata: { "13": 1_000 },
        monsters: monsters({
          hid: [12, 10],
          h: [
            ["C1", 8, [["C1", 5], ["C3", 2, 1]], 2],
            ["C3", 0, []],
          ],
          hstage: [1, 2],
        }),
      },
      [
        building(10, 13, 3),
        building(11, 13, 2, { cB: 100 }),
        building(12, 13, 3),
        building(13, 13, 3),
        building(14, 13, 3, { cU: 50 }),
      ],
    );
    const yard = readHatchYard(save, T0);
    expect(yard.hatcheries.map((one) => [one.id, one.state])).toEqual([
      [12, "producing"],
      [10, "stalled"],
      [11, "building"],
      [13, "damaged"],
      [14, "idle"],
    ]);
    const [producing, stalled, built] = yard.hatcheries;
    expect(producing!.queue).toEqual([
      ["C1", 5, 3],
      ["C3", 2, 1],
    ]);
    expect(producing!.paidLevel).toBe(2);
    expect(producing!.endsAt).toBe(T0 + 8);
    expect(producing!.stackLimit).toBe(4);
    expect(stalled!.endsAt).toBeNull();
    // A hatchery being built is level 0: one stack.
    expect(built!.level).toBe(0);
    expect(built!.stackLimit).toBe(1);
    expect(yard.hcc).toBeNull();
    expect(yard.capacity).toBe(1_080);
  });

  it("runs an Overdrive into the countdown and freezes one that cannot work", () => {
    const save = saveOf(
      {
        storedata: { HOD: { e: T0 + 10 } },
        monsters: monsters({
          hid: [10, 11],
          h: [
            ["C4", 100, []],
            ["C4", 100, []],
          ],
          hstage: [1, 1],
        }),
      },
      [building(10, 13, 3), building(11, 13, 3, { cU: 60 })],
    );
    const [fast, upgrading] = readHatchYard(save, T0).hatcheries;
    // 10 s at 4x does 40 s of work; the other 60 s run at 1x.
    expect(fast!.endsAt).toBe(T0 + 70);
    expect(upgrading!.state).toBe("upgrading");
    expect(upgrading!.endsAt).toBeNull();
  });

  it("finds a finished HCC and its queue; one still being built does not count", () => {
    const shared = [["C1", 4, 1]];
    const built = readHatchYard(
      saveOf({ monsters: monsters({ hcc: shared }) }, [building(20, 16, 1)]),
      T0,
    );
    expect(built.hcc).toEqual({ id: 20, works: true });
    expect(built.shared).toEqual([["C1", 4, 1]]);
    const unbuilt = readHatchYard(saveOf({}, [building(20, 16, 1, { cB: 10 })]), T0);
    expect(unbuilt.hcc).toBeNull();
    const broken = readHatchYard(
      saveOf({ buildinghealthdata: { "20": 10 } }, [building(20, 16, 1)]),
      T0,
    );
    expect(broken.hcc?.works).toBe(false);
  });
});

describe("previewAdd and queue room", () => {
  it("lets an idle level 3 hatchery take 81: one starts, four new stacks of 20", () => {
    const yard = readHatchYard(saveOf({}, [building(10, 13, 3)]), T0);
    expect(queueRoom(yard, 10, "C1")).toBe(81);
    const preview = previewAdd(yard, 10, "C1", 100)!;
    expect(preview).toMatchObject({
      added: 81,
      stoppedBy: "queue",
      cost: 81 * 250,
      started: 1,
      merged: [],
      newStacks: 4,
      inNewStacks: 80,
    });
    // The preview never touches the yard.
    expect(yard.hatcheries[0]!.monster).toBeNull();
    expect(yard.hatcheries[0]!.queue).toEqual([]);
  });

  it("fills the first non-full stack of the same monster and paid level, then opens new ones", () => {
    const save = saveOf(
      {
        monsters: monsters({
          hid: [10],
          h: [["C1", 10, [["C3", 5, 1], ["C1", 20, 1], ["C1", 3, 1]], 1]],
          hstage: [1],
        }),
      },
      [building(10, 13, 3)],
    );
    const yard = readHatchYard(save, T0);
    expect(previewAdd(yard, 10, "C1", 30)).toMatchObject({
      added: 30,
      stoppedBy: null,
      started: 0,
      merged: [{ slot: 3, count: 17 }],
      newStacks: 1,
      inNewStacks: 13,
    });
    expect(queueRoom(yard, 10, "C1")).toBe(37);
  });

  it("never merges into a stack paid at another academy level", () => {
    const save = saveOf(
      {
        academy: { C1: { level: 3 } },
        monsters: monsters({ hid: [10], h: [["C1", 10, [["C1", 5, 2]], 2]], hstage: [1] }),
      },
      [building(10, 13, 1)],
    );
    const yard = readHatchYard(save, T0);
    expect(previewAdd(yard, 10, "C1", 1)).toMatchObject({ merged: [], newStacks: 1 });
    // Level 1: two stacks; one is taken by the level 2 stack.
    expect(queueRoom(yard, 10, "C1")).toBe(20);
  });

  it("stops at the goo, tested before the stack room", () => {
    const yard = readHatchYard(
      saveOf({ resources: { r4: 3 * 250 + 249 } }, [building(10, 13, 3)]),
      T0,
    );
    expect(previewAdd(yard, 10, "C1", 10)).toMatchObject({ added: 3, stoppedBy: "goo", cost: 750 });
  });

  it("merges into the HCC's last stack only, and hands out to idle hatcheries that can work", () => {
    const save = saveOf(
      {
        buildinghealthdata: { "12": 100 },
        monsters: monsters({ hid: [10, 11, 12], hcc: [["C1", 5, 1], ["C3", 2, 1]] }),
      },
      [building(10, 13, 3), building(11, 13, 3), building(12, 13, 3), building(20, 16, 1)],
    );
    const yard = readHatchYard(save, T0);
    const preview = previewAdd(yard, "hcc", "C1", 1)!;
    // A new stack (the last one is Bolt); hatcheries 10 and 11 take Pokeys off the head.
    expect(preview).toMatchObject({ added: 1, started: 2, newStacks: 1, inNewStacks: 1 });
    expect(preview.merged).toEqual([]);
    // Empty shared queue: 7 stacks of 20, plus one each for the two idle working hatcheries.
    const empty = readHatchYard(
      saveOf({ monsters: monsters({ hid: [10, 11, 12] }), buildinghealthdata: { "12": 100 } }, [
        building(10, 13, 3),
        building(11, 13, 3),
        building(12, 13, 3),
        building(20, 16, 1),
      ]),
      T0,
    );
    expect(queueRoom(empty, "hcc", "C1")).toBe(142);
  });
});

describe("Fill", () => {
  it("is the smallest of queue room, goo and free housing, counting everything on its way", () => {
    // 1,080 space; 100 Pokeys housed (1,000); Bolt producing (15) and 2 queued (30) elsewhere.
    const save = saveOf(
      {
        monsters: monsters({
          housed: { C1: 100 },
          hid: [10, 11],
          h: [
            ["", 0, []],
            ["C3", 10, [["C3", 2, 1]], 1],
          ],
          hstage: [0, 1],
        }),
      },
      [building(10, 13, 3), building(11, 13, 3)],
    );
    const yard = readHatchYard(save, T0);
    expect(freeHousing(yard)).toBe(1_080 - 1_000 - 45);
    expect(fillLimits(yard, 10, "C1")).toEqual({
      queue: 81,
      goo: 400,
      housing: 3,
      fill: 3,
      limitedBy: "housing",
      max: 81,
    });
  });

  it("stops at the goo, or the queue, when those are smaller", () => {
    const poor = readHatchYard(saveOf({ resources: { r4: 2_000 } }, [building(10, 13, 3)]), T0);
    expect(fillLimits(poor, 10, "C1")).toMatchObject({ goo: 8, fill: 8, limitedBy: "goo", max: 8 });
    const rich = readHatchYard(saveOf({}, [building(10, 13, 1)]), T0);
    expect(fillLimits(rich, 10, "C1")).toMatchObject({ queue: 41, fill: 41, limitedBy: "queue" });
  });

  it("warns when the count is more than housing takes", () => {
    const save = saveOf({ monsters: monsters({ housed: { C1: 100 } }) }, [building(10, 13, 3)]);
    const yard = readHatchYard(save, T0);
    expect(housingWarning(yard, "C1", 8)).toBeNull();
    expect(housingWarning(yard, "C1", 9)).toBe("Housing fits 8 of these; the rest will wait.");
    const full = readHatchYard(
      saveOf({ monsters: monsters({ housed: { C1: 108 } }) }, [building(10, 13, 3)]),
      T0,
    );
    expect(housingWarning(full, "C1", 1)).toBe("Housing is full; these will wait for space.");
  });
});

describe("previewFinish", () => {
  it("houses the monster in production, then whole stacks, for timeCost × 4", () => {
    const save = saveOf(
      {
        monsters: monsters({
          saved: T0 - 5,
          hid: [10],
          h: [["C3", 20, [["C1", 3, 1], ["C3", 2, 1]], 1]],
          hstage: [1],
        }),
      },
      [building(10, 13, 3)],
    );
    const yard = readHatchYard(save, T0);
    const preview = previewFinish(yard, 10, save, T0);
    // 15 s left on the Bolt, 3 × 15 s of Pokey, 2 × 23 s of Bolt.
    const seconds = 15 + 45 + 46;
    expect(preview).toEqual({
      blocked: null,
      housed: { C3: 3, C1: 3 },
      seconds,
      price: timeCost(seconds, false) * 4,
      finishedAll: true,
    });
  });

  it("stops when housing runs out, and charges nothing for a monster already waiting", () => {
    const save = saveOf(
      {
        monsters: monsters({
          housed: { C1: 105 },
          hid: [10],
          h: [["C1", 0, [["C1", 5, 1]], 1]],
          hstage: [2],
        }),
      },
      [building(10, 13, 3)],
    );
    const yard = readHatchYard(save, T0);
    // 30 space free: the waiting Pokey (0 s) and two queued (15 s each).
    expect(previewFinish(yard, 10, save, T0)).toMatchObject({
      blocked: null,
      housed: { C1: 3 },
      seconds: 30,
      finishedAll: false,
    });
  });

  it("says why it cannot finish", () => {
    const full = saveOf(
      { monsters: monsters({ housed: { C1: 108 }, hid: [10], h: [["C1", 4, []]], hstage: [1] }) },
      [building(10, 13, 3)],
    );
    expect(previewFinish(readHatchYard(full, T0), 10, full, T0).blocked).toBe("housingFull");
    const idle = saveOf({}, [building(10, 13, 3)]);
    expect(previewFinish(readHatchYard(idle, T0), 10, idle, T0).blocked).toBe("nothingToFinish");
    const hurt = saveOf({ buildinghealthdata: { "10": 5 } }, [building(10, 13, 3)]);
    expect(previewFinish(readHatchYard(hurt, T0), 10, hurt, T0).blocked).toBe("damaged");
  });

  it("with an HCC, does every working hatchery's monster and then the shared queue", () => {
    const save = saveOf(
      {
        monsters: monsters({
          hid: [10, 11],
          h: [
            ["C1", 10, []],
            ["C1", 6, []],
          ],
          hstage: [1, 1],
          hcc: [["C3", 2, 1]],
        }),
      },
      [building(10, 13, 3), building(11, 13, 3), building(20, 16, 1)],
    );
    const preview = previewFinish(readHatchYard(save, T0), "hcc", save, T0);
    expect(preview).toMatchObject({ housed: { C1: 2, C3: 2 }, seconds: 10 + 6 + 46, finishedAll: true });
  });
});

describe("overdrive and the monster grid", () => {
  it("names the Hatchery Overdrive running now", () => {
    expect(activeOverdrive({ HOD2: { e: T0 + 60 } }, T0)).toEqual({
      item: "HOD2",
      power: 6,
      endsAt: T0 + 60,
    });
    expect(activeOverdrive({ HOD: { e: T0 } }, T0)).toBeNull();
    expect(activeOverdrive({}, T0)).toBeNull();
  });

  it("lists every obtainable monster with its state and today's price, time and space", () => {
    const rows = hatchMonsters(saveOf({ academy: { C1: { level: 6 } } }));
    expect(rows).toHaveLength(18);
    const pokey = rows.find((row) => row.monster.id === "C1")!;
    expect(pokey).toMatchObject({ state: { kind: "ready" }, level: 6, price: 1_250, seconds: 5, space: 7 });
    expect(rows.find((row) => row.monster.id === "C4")!.state.kind).toBe("unlocking");
    expect(rows.find((row) => row.monster.id === "C5")!.state.kind).toBe("locked");
  });
});
