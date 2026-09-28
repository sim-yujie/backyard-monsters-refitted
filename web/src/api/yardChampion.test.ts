import { afterEach, describe, expect, it, vi } from "vitest";
import type { BaseLoadResponse, ChampionSaveEntry, YardResponse } from "./types";
import type { YardApi } from "./yard";
import { YardStore } from "@/game/yard/YardStore";
import { championActions, championFeed, championRaise, type ChampionApi } from "./yardChampion";

/** The champion routes on the wire, and their local checks in the store's queue. */

const sent: { url: string; body: URLSearchParams }[] = [];

afterEach(() => {
  vi.unstubAllGlobals();
  sent.length = 0;
});

const stubFetch = () =>
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

describe("champion routes", () => {
  it("post the type and the feed mode", async () => {
    stubFetch();
    await championRaise(3);
    await championFeed("shiny");
    expect(sent[0]!.url).toMatch(/\/bm\/yard\/champion\/raise$/);
    expect(sent[0]!.body.get("type")).toBe("3");
    expect(sent[1]!.url).toMatch(/\/bm\/yard\/champion\/feed$/);
    expect(sent[1]!.body.get("mode")).toBe("shiny");
  });
});

const T0 = 2_000_000;

const setup = (champion: ChampionSaveEntry[], housed: Record<string, number> = { C2: 40 }) => {
  const store = new YardStore({
    save: {
      error: 0,
      currenttime: T0,
      savetime: T0,
      resources: {},
      credits: 1_000,
      buildingdata: { "3": { id: 3, t: 114, l: 1, X: 0, Y: 0 } },
      buildinghealthdata: {},
      storedata: {},
      monsters: { housed },
      champion,
    } as unknown as BaseLoadResponse,
    api: { state: vi.fn() } as unknown as YardApi,
    clock: () => T0,
    timers: { set: () => 0, clear: () => undefined },
  });
  const answer = { error: 0, savetime: T0, currenttime: T0, completed: [], report: {} } as unknown as YardResponse<never>;
  const api = {
    raise: vi.fn(() => Promise.resolve(answer)),
    feed: vi.fn(() => Promise.resolve(answer)),
    evolve: vi.fn(() => Promise.resolve(answer)),
    heal: vi.fn(() => Promise.resolve(answer)),
    rename: vi.fn(() => Promise.resolve(answer)),
    juice: vi.fn(() => Promise.resolve(answer)),
    freeze: vi.fn(() => Promise.resolve(answer)),
    thaw: vi.fn(() => Promise.resolve(answer)),
  } as unknown as ChampionApi;
  return { actions: championActions(store, api), api };
};

const gorgo = (overrides: Partial<ChampionSaveEntry> = {}): ChampionSaveEntry => ({
  t: 1,
  hp: 40_000,
  l: 1,
  ft: T0 + 100,
  fd: 0,
  fb: 0,
  pl: 1,
  status: 0,
  ...overrides,
});

const reasonOf = (result: { ok: boolean; refusal?: { reason: string } }) => result.refusal?.reason;

describe("championActions: local checks", () => {
  it("raise: not while a champion is in the cage, not a frozen one, not Korath", async () => {
    const busy = setup([gorgo()]);
    expect(reasonOf(await busy.actions.raise(2))).toBe("championInCage");
    const frozen = setup([gorgo({ status: 1 })]);
    expect(reasonOf(await frozen.actions.raise(1))).toBe("frozen");
    expect(reasonOf(await frozen.actions.raise(4))).toBe("notRaisable");
    expect((await frozen.actions.raise(2)).ok).toBe(true);
    expect(frozen.api.raise).toHaveBeenCalledWith(2);
  });

  it("feed: waits for hunger and checks housing", async () => {
    expect(reasonOf(await setup([gorgo()]).actions.feed("monsters"))).toBe("notHungry");
    expect(reasonOf(await setup([gorgo()]).actions.feed("shiny"))).toBe("notHungry");
    const short = setup([gorgo({ ft: T0 - 1 })], { C2: 3 });
    expect(reasonOf(await short.actions.feed("monsters"))).toBe("notEnough");
    const hungry = setup([gorgo({ ft: T0 - 1 })]);
    expect((await hungry.actions.feed("monsters")).ok).toBe(true);
    expect(hungry.api.feed).toHaveBeenCalledWith("monsters");
  });

  it("evolve, heal, rename: refuse what the client can already see", async () => {
    expect(reasonOf(await setup([gorgo({ l: 6 })]).actions.evolve())).toBe("maxLevel");
    expect(reasonOf(await setup([gorgo()]).actions.heal())).toBe("fullHealth");
    expect(reasonOf(await setup([gorgo()]).actions.rename("   "))).toBe("badRequest");
    expect(reasonOf(await setup([]).actions.evolve())).toBe("noChampion");
  });

  it("freeze and thaw: need a chamber, and thaw an empty cage", async () => {
    expect(reasonOf(await setup([gorgo()]).actions.freeze())).toBe("freezeRefused");
    expect(reasonOf(await setup([gorgo({ status: 1 })]).actions.thaw(1))).toBe("thawRefused");
  });

  it("juice: needs a working Juicer", async () => {
    expect(reasonOf(await setup([gorgo()]).actions.juice())).toBe("noJuicer");
  });
});
