import { afterEach, describe, expect, it, vi } from "vitest";
import { YardStore } from "@/game/yard/YardStore";
import type { BaseLoadResponse, YardResponse } from "./types";
import type { YardApi } from "./yard";
import { decorActions, placeDecoration, type DecorApi, type PlaceDecorationReport } from "./yardDecor";

/** `decor/place` on the wire, and its trip through the store's queue (§8.3, #128). */

const T0 = 2_000_000;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("decor/place", () => {
  it("posts the type and the spot", async () => {
    const sent: { url: string; body: URLSearchParams }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init: RequestInit) => {
        sent.push({ url, body: new URLSearchParams(String(init.body ?? "")) });
        return Promise.resolve(
          new Response(JSON.stringify({ error: 0, savetime: 1, currenttime: 1, completed: [], report: null }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }),
    );
    await placeDecoration(28, 200, -150);
    expect(sent[0]!.url).toMatch(/\/bm\/yard\/decor\/place$/);
    expect(Object.fromEntries(sent[0]!.body)).toEqual({ type: "28", x: "200", y: "-150" });
  });
});

const setup = (researchdata: Record<string, unknown>, kind: "main" | "outpost" = "main") => {
  const report: PlaceDecorationReport = { id: 5, t: 28, x: 200, y: 200, level: 1, left: 0 };
  const api = {
    place: vi.fn(() =>
      Promise.resolve({
        error: 0,
        savetime: T0,
        currenttime: T0,
        completed: [],
        report,
        buildingdata: { "5": { id: 5, t: 28, X: 200, Y: 200 } },
        researchdata: {},
      } as unknown as YardResponse<PlaceDecorationReport>),
    ),
  } satisfies DecorApi;
  const store = new YardStore({
    save: {
      error: 0,
      currenttime: T0,
      savetime: T0,
      resources: {},
      buildingdata: {},
      buildinghealthdata: {},
      storedata: {},
      researchdata,
    } as unknown as BaseLoadResponse,
    ...(kind === "outpost" ? { target: { baseid: "9", kind: "outpost" } as const } : {}),
    api: { state: vi.fn() } as unknown as YardApi,
    clock: () => T0,
    timers: { set: () => 0, clear: () => undefined },
  });
  return { store, api, actions: decorActions(store, api) };
};

describe("decorActions", () => {
  it("places a stored decoration and merges the answer's storage", async () => {
    const { store, api, actions } = setup({ b28: 1 });
    expect(await actions.place(28, 200, 200)).toMatchObject({ ok: true, report: { id: 5 } });
    expect(api.place).toHaveBeenCalledWith(28, 200, 200);
    expect(store.save.researchdata).toEqual({});
    expect(store.save.buildingdata?.["5"]).toMatchObject({ t: 28 });
  });

  it("refuses locally with none stored, and in an outpost", async () => {
    const empty = setup({});
    expect(await empty.actions.place(28, 0, 0)).toMatchObject({
      ok: false,
      refusal: { reason: "notInStorage", local: true },
    });
    const outpost = setup({ b28: 2 }, "outpost");
    expect(await outpost.actions.place(28, 0, 0)).toMatchObject({
      ok: false,
      refusal: { reason: "notInOutpost", local: true },
    });
    expect(empty.api.place).not.toHaveBeenCalled();
    expect(outpost.api.place).not.toHaveBeenCalled();
  });
});
