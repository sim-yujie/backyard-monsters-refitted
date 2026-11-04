import { afterEach, describe, expect, it, vi } from "vitest";
import { YardStore } from "@/game/yard/YardStore";
import type { BaseLoadResponse, YardResponse } from "./types";
import type { YardApi } from "./yard";
import {
  buyDecoration,
  decorActions,
  placeDecoration,
  type DecorApi,
  type PlaceDecorationReport,
} from "./yardDecor";

/** `decor/place` and `decor/buy` on the wire, and their trip through the store's queue (§8.3, #128). */

const T0 = 2_000_000;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("decor/place and decor/buy", () => {
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

    await buyDecoration(29, 100, 50);
    expect(sent[1]!.url).toMatch(/\/bm\/yard\/decor\/buy$/);
    expect(Object.fromEntries(sent[1]!.body)).toEqual({ type: "29", x: "100", y: "50" });
  });
});

const setup = (researchdata: Record<string, unknown>, kind: "main" | "outpost" = "main", credits = 0) => {
  const report: PlaceDecorationReport = { id: 5, t: 28, x: 200, y: 200, level: 1, left: 0 };
  const answer = (extra: Record<string, unknown> = {}) =>
    Promise.resolve({
      error: 0,
      savetime: T0,
      currenttime: T0,
      completed: [],
      report,
      buildingdata: { "5": { id: 5, t: 28, X: 200, Y: 200 } },
      researchdata: {},
      ...extra,
    } as unknown as YardResponse<PlaceDecorationReport>);
  const api = {
    place: vi.fn(() => answer()),
    buy: vi.fn(() => answer({ credits: credits - 150, report: { ...report, credits: 150 } })),
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
      credits,
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

describe("decorActions.buy", () => {
  it("buys one Flash sold and takes the answer's Shiny", async () => {
    const { store, api, actions } = setup({}, "main", 200);
    expect(await actions.buy(28, 200, 200)).toMatchObject({ ok: true, report: { id: 5, credits: 150 } });
    expect(api.buy).toHaveBeenCalledWith(28, 200, 200);
    expect(store.credits).toBe(50);
    expect(store.save.buildingdata?.["5"]).toMatchObject({ t: 28 });
  });

  it("refuses locally: short of Shiny, not sold, in an outpost", async () => {
    const poor = setup({}, "main", 100);
    expect(await poor.actions.buy(28, 0, 0)).toMatchObject({ ok: false, refusal: { reason: "credits", local: true } });
    const rich = setup({}, "main", 1_000);
    expect(await rich.actions.buy(120, 0, 0)).toMatchObject({ ok: false, refusal: { reason: "notForSale" } });
    const outpost = setup({}, "outpost", 1_000);
    expect(await outpost.actions.buy(28, 0, 0)).toMatchObject({ ok: false, refusal: { reason: "notInOutpost" } });
    for (const one of [poor, rich, outpost]) expect(one.api.buy).not.toHaveBeenCalled();
  });
});
