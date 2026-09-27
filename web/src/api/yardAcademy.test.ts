import { afterEach, describe, expect, it, vi } from "vitest";
import type { BaseLoadResponse, BuildingData, YardResponse } from "./types";
import type { YardApi } from "./yard";
import { YardStore } from "@/game/yard/YardStore";
import {
  AcademyKey,
  academyActions,
  academyCancel,
  academyFinish,
  academyInstant,
  academyTrain,
  type AcademyApi,
} from "./yardAcademy";

/** The academy routes on the wire, and their trip through the store's queue. */

const sent: { url: string; body: URLSearchParams }[] = [];

const stubFetch = (status: number, payload: Record<string, unknown>): void => {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit) => {
      sent.push({ url, body: new URLSearchParams(String(init.body ?? "")) });
      return Promise.resolve(
        new Response(JSON.stringify(payload), {
          status,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }),
  );
};

afterEach(() => {
  vi.unstubAllGlobals();
  sent.length = 0;
});

describe("academy routes", () => {
  it("posts each action to its path with the monster as a form field", async () => {
    stubFetch(200, { error: 0, savetime: 1, currenttime: 1, completed: [], report: null });
    await academyTrain("C5");
    await academyCancel("C5");
    await academyFinish("C2");
    await academyInstant("C16");
    expect(sent.map((call) => call.url.replace(/^.*\/bm\/yard/, ""))).toEqual([
      "/academy/train",
      "/academy/cancel",
      "/academy/finish",
      "/academy/instant",
    ]);
    expect(sent.map((call) => call.body.get("monster"))).toEqual(["C5", "C5", "C2", "C16"]);
    expect(sent[0]!.body.has("academy")).toBe(false);
  });
});

const T0 = 2_000_000;

const building = (id: number, t: number, l: number, extra: Partial<BuildingData> = {}): BuildingData => ({
  id,
  t,
  l,
  X: id * 40,
  Y: 0,
  ...extra,
});

/** One academy, level 3. */
const loadOf = (extra: Partial<BaseLoadResponse> = {}): BaseLoadResponse =>
  ({
    error: 0,
    currenttime: T0,
    savetime: T0,
    resources: { r1: 0, r2: 0, r3: 1e7, r4: 0 },
    credits: 1_000,
    caps: { r1: 5e8, r2: 5e8, r3: 5e8, r4: 5e8 },
    buildingdata: { "1": building(1, 14, 6), "5": building(5, 26, 3) },
    buildinghealthdata: {},
    storedata: {},
    lockerdata: { C1: { t: 2 }, C2: { t: 2 } },
    academy: { C1: { level: 1 }, C2: { level: 3 } },
    ...extra,
  }) as unknown as BaseLoadResponse;

const answer = <R>(report: R, extra: Record<string, unknown> = {}): YardResponse<R> =>
  ({ error: 0, savetime: T0, currenttime: T0, completed: [], report, ...extra }) as unknown as YardResponse<R>;

const setup = (load: Partial<BaseLoadResponse> = {}) => {
  const yardApi = {
    state: vi.fn(() => Promise.resolve(answer(null))),
  } as unknown as YardApi;
  const api = {
    train: vi.fn((monster: string) =>
      Promise.resolve(
        answer(
          { monster, academy: 5, to: 2, endsAt: T0 + 7_200, cost: { r3: 4_000 } },
          {
            academy: { C1: { level: 1, time: T0 + 7_200, duration: 7_200 }, C2: { level: 3 } },
            buildingdata: { "1": building(1, 14, 6), "5": building(5, 26, 3, { upg: monster }) },
          },
        ),
      ),
    ),
    cancel: vi.fn((monster: string) => Promise.resolve(answer({ monster, refund: { r3: 4_000 } }))),
    finish: vi.fn((monster: string) => Promise.resolve(answer({ monster, level: 2, credits: 40 }))),
    instant: vi.fn((monster: string) => Promise.resolve(answer({ monster, level: 4, credits: 203 }))),
  } satisfies AcademyApi;
  const store = new YardStore({
    save: loadOf(load),
    api: yardApi,
    clock: () => T0,
    timers: { set: () => 0, clear: () => undefined },
  });
  return { store, api, actions: academyActions(store, api) };
};

describe("academyActions", () => {
  it("sends a training the client can see is allowed, and merges the answer", async () => {
    const { store, api, actions } = setup();
    const result = await actions.train("C1");
    expect(api.train).toHaveBeenCalledWith("C1");
    expect(result).toMatchObject({ ok: true, report: { monster: "C1", academy: 5 } });
    expect(store.save.buildingdata?.["5"]?.["upg"]).toBe("C1");
  });

  it("refuses locally, in the server's terms, what the state already says no to", async () => {
    const { api, actions } = setup({ resources: { r3: 1_000 } });
    expect(await actions.train("C1")).toEqual({
      ok: false,
      refusal: {
        reason: "shortfall",
        message: "Need 3,000 more putty.",
        detail: { shortfall: { r1: 0, r2: 0, r3: 3_000, r4: 0 } },
        local: true,
      },
    });
    const blocked = await actions.train("C18");
    expect(blocked.ok ? null : blocked.refusal.reason).toBe("badRequest");
    const locked = await actions.train("C5");
    expect(locked.ok ? null : locked.refusal.reason).toBe("locked");
    expect(api.train).not.toHaveBeenCalled();
  });

  it("re-checks a queued training against the answer ahead of it: one academy, one monster", async () => {
    const { api, actions } = setup();
    const first = actions.train("C1");
    const second = actions.train("C2");
    await first;
    const refused = await second;
    expect(api.train).toHaveBeenCalledTimes(1);
    expect(refused.ok ? null : refused.refusal.reason).toBe("academyBusy");
  });

  it("cancels and finishes only a monster that is training", async () => {
    const idle = setup();
    expect((await idle.actions.cancel("C1")).ok).toBe(false);
    expect((await idle.actions.finish("C1")).ok).toBe(false);
    expect(idle.api.cancel).not.toHaveBeenCalled();

    const busy = setup({ academy: { C1: { level: 1, time: T0 + 100 } } });
    expect((await busy.actions.cancel("C1")).ok).toBe(true);
    expect(busy.api.cancel).toHaveBeenCalledWith("C1");
  });

  it("instant needs no putty", async () => {
    const { api, actions } = setup({ resources: { r3: 0 } });
    expect((await actions.instant("C2")).ok).toBe(true);
    expect(api.instant).toHaveBeenCalledWith("C2");
  });

  it("runs under one key per action", async () => {
    const { store, actions } = setup();
    const pending = actions.train("C1");
    expect(store.isRunning(AcademyKey.TRAIN)).toBe(true);
    await pending;
    expect(store.isRunning(AcademyKey.TRAIN)).toBe(false);
  });
});
