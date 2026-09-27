import { afterEach, describe, expect, it, vi } from "vitest";
import type { BaseLoadResponse, BuildingData, YardResponse } from "./types";
import type { YardApi } from "./yard";
import { YardStore } from "@/game/yard/YardStore";
import {
  buildActions,
  buildAt,
  cancelBuild,
  instantBuildAt,
  type BuildApi,
  type BuildReport,
} from "./yardBuild";

/** The build routes on the wire, and their trip through the store's queue. */

const sent: { url: string; body: URLSearchParams }[] = [];

const stubFetch = (): void => {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit) => {
      sent.push({ url, body: new URLSearchParams(String(init.body ?? "")) });
      return Promise.resolve(
        new Response(
          JSON.stringify({ error: 0, savetime: 1, currenttime: 1, completed: [], report: null }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    }),
  );
};

afterEach(() => {
  vi.unstubAllGlobals();
  sent.length = 0;
});

describe("build routes", () => {
  it("post type, x, y to build and build/instant, and id to build/cancel", async () => {
    stubFetch();
    await buildAt(20, 300, -300);
    await instantBuildAt(17, 0, 200);
    await cancelBuild(9);
    expect(sent.map((call) => call.url.replace(/^.*\/bm\/yard/, ""))).toEqual([
      "/build",
      "/build/instant",
      "/build/cancel",
    ]);
    expect(Object.fromEntries(sent[0]!.body)).toEqual({ type: "20", x: "300", y: "-300" });
    expect(Object.fromEntries(sent[2]!.body)).toEqual({ id: "9" });
  });
});

const T0 = 2_000_000;
const HALL: BuildingData = { id: 1, t: 14, X: -65, Y: -65, l: 3 };

const setup = (
  buildings: BuildingData[],
  resources = { r1: 1e6, r2: 1e6, r3: 1e6, r4: 0 },
  credits = 100,
) => {
  const placed = (id: number, x: number, y: number, extra: Partial<BuildingData>) =>
    ({
      error: 0,
      savetime: T0,
      currenttime: T0,
      completed: [],
      report: { id, t: 17, x, y, seconds: 0, finished: true, cost: { r1: 1000, r2: 0, r3: 0, r4: 0 }, points: 102 },
      buildingdata: {
        ...Object.fromEntries(buildings.map((b) => [String(b.id), b])),
        [String(id)]: { id, t: 17, X: x, Y: y, ...extra },
      },
    }) as unknown as YardResponse<BuildReport>;
  const api = {
    build: vi.fn((_type: number, x: number, y: number) => Promise.resolve(placed(2, x, y, {}))),
    instant: vi.fn(),
    cancel: vi.fn(),
  } as unknown as BuildApi & { build: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn> };
  const store = new YardStore({
    save: {
      error: 0,
      currenttime: T0,
      savetime: T0,
      resources,
      credits,
      caps: { r1: 1e7, r2: 1e7, r3: 1e7, r4: 1e7 },
      buildingdata: Object.fromEntries(buildings.map((b) => [String(b.id), b])),
      buildinghealthdata: {},
      storedata: {},
    } as unknown as BaseLoadResponse,
    api: { state: vi.fn() } as unknown as YardApi,
    clock: () => T0,
    timers: { set: () => 0, clear: () => undefined },
  });
  return { store, api, actions: buildActions(store, api) };
};

describe("buildActions", () => {
  it("builds through the queue and merges the answer", async () => {
    const { store, api, actions } = setup([HALL]);
    const result = await actions.build(17, 200, 200);
    expect(api.build).toHaveBeenCalledWith(17, 200, 200);
    expect(result).toMatchObject({ ok: true, report: { id: 2, finished: true } });
    expect(store.building(2)).toMatchObject({ type: 17, x: 200, y: 200 });
  });

  it("refuses locally what the menu would refuse, without sending", async () => {
    // No hall allows a Lab below level 5; the Radio is not in the menu at all.
    const { api, actions } = setup([HALL], { r1: 0, r2: 0, r3: 0, r4: 0 }, 0);
    expect(await actions.build(116, 300, 300)).toMatchObject({
      ok: false,
      refusal: { reason: "townHall", local: true },
    });
    expect(await actions.build(113, 300, 300)).toMatchObject({
      ok: false,
      refusal: { reason: "notBuildable" },
    });
    expect(await actions.build(20, 300, 300)).toMatchObject({
      ok: false,
      refusal: { reason: "shortfall" },
    });
    expect(await actions.instant(20, 300, 300)).toMatchObject({
      ok: false,
      refusal: { reason: "credits" },
    });
    expect(api.build).not.toHaveBeenCalled();
  });

  it("a wall line clicked quickly goes out one block at a time, each re-checked", async () => {
    // 1,000 twigs a block and 1,500 held: the second block is refused before it is sent.
    const { api, actions, store } = setup([HALL], { r1: 1500, r2: 0, r3: 0, r4: 0 });
    (api.build as ReturnType<typeof vi.fn>).mockImplementation((_t: number, x: number, y: number) =>
      Promise.resolve({
        error: 0,
        savetime: T0,
        currenttime: T0,
        completed: [],
        resources: { r1: 500, r2: 0, r3: 0, r4: 0 },
        report: { id: 2, t: 17, x, y, seconds: 0, finished: true, cost: { r1: 1000, r2: 0, r3: 0, r4: 0 }, points: 102 },
        buildingdata: { "1": HALL, "2": { id: 2, t: 17, X: x, Y: y } },
      }),
    );
    const first = actions.build(17, 200, 200);
    const second = actions.build(17, 220, 200);
    expect(await first).toMatchObject({ ok: true });
    expect(await second).toMatchObject({ ok: false, refusal: { reason: "shortfall", local: true } });
    expect(api.build).toHaveBeenCalledTimes(1);
    expect(store.resources.r1).toBe(500);
  });

  it("cancel is refused locally for a building that is not under construction", async () => {
    const { api, actions } = setup([HALL, { id: 2, t: 20, X: 300, Y: 300 }]);
    expect(await actions.cancel(2)).toMatchObject({
      ok: false,
      refusal: { reason: "notBuilding", local: true },
    });
    expect(await actions.cancel(99)).toMatchObject({ ok: false, refusal: { reason: "badRequest" } });
    expect(api.cancel).not.toHaveBeenCalled();
  });

  it("cancel goes out for a building under construction", async () => {
    const { api, actions } = setup([HALL, { id: 2, t: 20, X: 300, Y: 300, cB: 20 }]);
    (api.cancel as ReturnType<typeof vi.fn>).mockResolvedValue({
      error: 0,
      savetime: T0,
      currenttime: T0,
      completed: [],
      report: { id: 2, t: 20, refund: { r1: 2000, r2: 1500, r3: 500, r4: 0 } },
      buildingdata: { "1": HALL },
    });
    expect(await actions.cancel(2)).toMatchObject({ ok: true, report: { id: 2 } });
    expect(api.cancel).toHaveBeenCalledWith(2);
  });
});
