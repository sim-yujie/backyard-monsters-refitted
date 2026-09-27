import { describe, expect, it, vi } from "vitest";
import type { BaseLoadResponse, MushroomPickReport, YardResponse } from "@/api/types";
import type { YardApi } from "@/api/yard";
import {
  indexOfMushroom,
  mushroomAt,
  MushroomPicker,
  mushroomPickAction,
  ORDINARY_QUIPS,
  pickRefusal,
  SHAKE_MS,
  type MushroomPickView,
} from "./mushroomPick";
import { YardStore } from "./YardStore";
import { readYard, type YardMushroom } from "./yardModel";

/**
 * Picking a mushroom (`docs/design/yard-buildings.md` §5.6): the tap box, the
 * local checks, the index looked up just before sending, and the flow of
 * shake → request → reward or refusal.
 */

const T0 = 1_000_000;

/** A Town Hall and three mushrooms; `busy` puts the one worker on an upgrade. */
const loadWith = (busy = false): BaseLoadResponse =>
  ({
    error: 0,
    id: 1,
    baseid: "1",
    basesaveid: 1,
    currenttime: T0,
    savetime: T0,
    resources: { r1: 1e6, r2: 1e6, r3: 1e6, r4: 0 },
    credits: 10,
    buildingdata: {
      "1": { X: 0, Y: 0, t: 14, id: 1, l: 3 },
      ...(busy ? { "2": { X: 200, Y: 0, t: 20, id: 2, l: 1, cU: 500 } } : {}),
    },
    storedata: {},
    mushrooms: {
      l: [
        [1, 300, 100],
        [2, -300, 100],
        [3, 100, -300],
      ],
      s: T0,
    },
  }) as unknown as BaseLoadResponse;

/** The server's answer to a pick: the list without the picked one, and the report. */
const answer = (
  save: BaseLoadResponse,
  index: number,
  report: Partial<MushroomPickReport> = {},
): YardResponse<MushroomPickReport> => {
  const list = [...(save.mushrooms?.l ?? [])];
  const [picked] = list.splice(index, 1) as [[number, number, number]];
  return {
    error: 0,
    savetime: T0,
    currenttime: T0,
    resources: save.resources,
    credits: 10 + (report.shiny ?? 0),
    caps: { r1: 5e9, r2: 5e9, r3: 5e9, r4: 5e9 },
    workers: { total: 1, busy: 0 },
    buildingdata: save.buildingdata,
    buildinghealthdata: {},
    storedata: {},
    monsters: {},
    lockerdata: {},
    academy: {},
    champion: [],
    mushrooms: { l: list, s: T0 },
    researchdata: {},
    completed: [],
    report: { id: index, x: picked[1], y: picked[2], golden: false, shiny: 0, ...report },
  } as unknown as YardResponse<MushroomPickReport>;
};

const storeOf = (save: BaseLoadResponse, pickMushroom: YardApi["pickMushroom"]) =>
  new YardStore({
    save,
    api: { state: vi.fn(), pickMushroom } as unknown as YardApi,
    clock: () => T0,
    timers: { set: () => 0, clear: () => {} },
  });

const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

/** Timers the test fires by hand. */
const handTimers = () => {
  const due: { fn: () => void; ms: number }[] = [];
  return {
    timers: { set: (fn: () => void, ms: number) => due.push({ fn, ms }) },
    fire: () => due.splice(0).forEach((one) => one.fn()),
    due,
  };
};

const viewSpy = () => {
  const calls: string[] = [];
  const view: MushroomPickView = {
    shake: (spot) => calls.push(`shake ${spot.x},${spot.y}`),
    stop: (spot) => calls.push(`stop ${spot.x},${spot.y}`),
    golden: (shiny) => calls.push(`golden ${shiny}`),
    ordinary: (quip) => calls.push(`ordinary ${quip}`),
    refused: (message) => calls.push(`refused ${message}`),
  };
  return { view, calls };
};

describe("mushroomAt", () => {
  const mushrooms = readYard(loadWith()).mushrooms;
  const [first] = mushrooms as [YardMushroom];

  it("finds the mushroom whose glyph is under the point", () => {
    expect(mushroomAt(mushrooms, first.worldX, first.worldY - 10)).toBe(first);
    expect(mushroomAt(mushrooms, first.worldX + 17, first.worldY)).toBe(first);
  });

  it("misses outside the box", () => {
    expect(mushroomAt(mushrooms, first.worldX + 40, first.worldY)).toBeNull();
    expect(mushroomAt(mushrooms, first.worldX, first.worldY + 20)).toBeNull();
  });
});

describe("local checks", () => {
  it("a mushroom no longer in the list is refused as moved; a busy worker as workers", () => {
    const yard = readYard(loadWith());
    expect(pickRefusal({ yard }, { x: 300, y: 100 })).toBeNull();
    expect(pickRefusal({ yard }, { x: 1, y: 1 })?.reason).toBe("moved");
    expect(pickRefusal({ yard: readYard(loadWith(true)) }, { x: 300, y: 100 })?.reason).toBe(
      "workers",
    );
  });

  it("looks the index up by where the mushroom stands", () => {
    const yard = readYard(loadWith());
    expect(indexOfMushroom(yard.mushrooms, { x: 100, y: -300 })).toBe(2);
    expect(indexOfMushroom(yard.mushrooms, { x: 5, y: 5 })).toBe(-1);
  });
});

describe("mushroomPickAction through the store", () => {
  it("a pick queued behind another sends the index the first answer left", async () => {
    const save = loadWith();
    const pickMushroom = vi
      .fn()
      .mockResolvedValueOnce(answer(save, 0))
      .mockImplementationOnce((index: number) => {
        const after = { ...save, mushrooms: { l: [[2, -300, 100], [3, 100, -300]], s: T0 } };
        return Promise.resolve(answer(after as BaseLoadResponse, index));
      });
    const store = storeOf(save, pickMushroom);

    const first = store.run(mushroomPickAction({ x: 300, y: 100 }));
    const second = store.run(mushroomPickAction({ x: 100, y: -300 }));
    await Promise.all([first, second]);

    expect(pickMushroom.mock.calls).toEqual([
      [0, 300, 100],
      [1, 100, -300],
    ]);
    expect(store.yard.mushrooms.map((one) => [one.x, one.y])).toEqual([[-300, 100]]);
  });
});

describe("MushroomPicker", () => {
  it("shakes, then asks; a golden answer shows the popup with the Shiny", async () => {
    const save = loadWith();
    const pickMushroom = vi.fn(() => Promise.resolve(answer(save, 1, { golden: true, shiny: 8 })));
    const store = storeOf(save, pickMushroom);
    const { view, calls } = viewSpy();
    const time = handTimers();
    const picker = new MushroomPicker(store, view, { timers: time.timers });

    const done = picker.pick(store.yard.mushrooms[1]!);
    expect(calls).toEqual(["shake -300,100"]);
    expect(time.due.map((one) => one.ms)).toEqual([SHAKE_MS]);
    expect(pickMushroom).not.toHaveBeenCalled();
    expect(picker.isPicking({ x: -300, y: 100 })).toBe(true);

    // A second tap while it shakes does nothing.
    await picker.pick(store.yard.mushrooms[1]!);
    expect(time.due).toHaveLength(1);

    time.fire();
    await done;

    expect(pickMushroom).toHaveBeenCalledWith(1, -300, 100);
    expect(calls).toEqual(["shake -300,100", "stop -300,100", "golden 8"]);
    expect(store.credits).toBe(18);
    expect(picker.isPicking({ x: -300, y: 100 })).toBe(false);
  });

  it("an ordinary answer gets a worker's quip", async () => {
    const save = loadWith();
    const store = storeOf(save, vi.fn(() => Promise.resolve(answer(save, 0))));
    const { view, calls } = viewSpy();
    const time = handTimers();
    const picker = new MushroomPicker(store, view, { timers: time.timers, random: () => 0.5 });

    const done = picker.pick(store.yard.mushrooms[0]!);
    time.fire();
    await done;

    expect(calls.at(-1)).toBe(`ordinary ${ORDINARY_QUIPS[1]}`);
  });

  it("no free worker: says so at once, no shake, nothing sent", async () => {
    const save = loadWith(true);
    const pickMushroom = vi.fn();
    const store = storeOf(save, pickMushroom);
    const { view, calls } = viewSpy();
    const time = handTimers();

    await new MushroomPicker(store, view, { timers: time.timers }).pick(store.yard.mushrooms[0]!);

    expect(calls).toEqual(["refused All your workers are busy."]);
    expect(time.due).toHaveLength(0);
    expect(pickMushroom).not.toHaveBeenCalled();
  });

  it("a server refusal stops the shake and says why", async () => {
    const save = loadWith();
    const { ApiError } = await import("@/api/http");
    const refused = new ApiError("All your workers are busy.", {
      status: 409,
      code: "All your workers are busy.",
      body: { error: "All your workers are busy.", reason: "workers" },
    });
    const store = storeOf(save, vi.fn(() => Promise.reject(refused)));
    const { view, calls } = viewSpy();
    const time = handTimers();
    const picker = new MushroomPicker(store, view, { timers: time.timers });

    const done = picker.pick(store.yard.mushrooms[2]!);
    time.fire();
    await done;
    await flush();

    expect(calls).toEqual(["shake 100,-300", "stop 100,-300", "refused All your workers are busy."]);
  });
});
