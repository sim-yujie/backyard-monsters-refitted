import { afterEach, describe, expect, it } from "vitest";
import { ApiError, post, send } from "@/api/http";
import type { BaseLoadResponse, BuildingDataMap, YardResponse } from "@/api/types";
import { YARD_STATE_KEYS } from "@/api/types";
import { maxLevel } from "@/game/yard/buildingCosts";
import { buildOffer } from "@/game/yard/buildCatalogue";
import { readYard } from "@/game/yard/yardModel";
import { endTribeEdit, isTribeEditing, startTribeEdit } from "./tribeEditSession";
import { TribeYardSim } from "./tribeYardSim";

const yard = (): BaseLoadResponse =>
  ({
    baseid: "0",
    buildingdata: {
      "1": { X: 0, Y: 0, t: 14, id: 1, l: 4 },
      "2": { X: 100, Y: 0, t: 22, id: 2, l: 3, m: { C5: 4 } },
      "3": { X: -100, Y: 0, t: 21, id: 3, cU: 20 },
    },
    monsters: { C5: 0 },
    academy: {},
    lockerdata: { C5: { t: 2 } },
    resources: { r1: 5 },
  }) as unknown as BaseLoadResponse;

const call = (sim: TribeYardSim, path: string, body: Record<string, unknown> = {}, method = "POST") =>
  sim.handle(method as "POST", `/api/:apiVersion/bm/${path}`, body as never);

describe("TribeYardSim", () => {
  afterEach(() => endTribeEdit());

  it("answers yard/state with every state key, plenty to spend and no running jobs", async () => {
    const sim = new TribeYardSim(yard(), () => 1000);
    const state = (await call(sim, "yard/state")) as YardResponse<null>;
    for (const key of YARD_STATE_KEYS) expect(state).toHaveProperty(key);
    expect(state.resources.r1).toBeGreaterThan(1e8);
    expect(state.workers).toEqual({ total: 99, busy: 0 });
    expect(state.buildingdata["3"]).not.toHaveProperty("cU");
    expect(state.savetime).toBe(1000);
  });

  it("builds finished at level 1 with a new id, free", async () => {
    const sim = new TribeYardSim(yard());
    const answer = (await call(sim, "yard/build", { type: 21, x: 40, y: 60 })) as YardResponse<{ id: number }>;
    expect(answer.report.id).toBe(4);
    expect(sim.building(4)).toEqual({ X: 40, Y: 60, t: 21, id: 4 });
  });

  it("upgrades a step at a time and sets any level up to the type's top", async () => {
    const sim = new TribeYardSim(yard());
    await call(sim, "yard/upgrade", { id: 1 });
    expect(sim.building(1)?.l).toBe(5);
    expect(sim.setLevel(1, 99)).toBe(maxLevel(14));
    expect(sim.setLevel(1, 1)).toBe(1);
    expect(sim.building(1)).not.toHaveProperty("l");
  });

  it("recycles anything, the Town Hall included", async () => {
    const sim = new TribeYardSim(yard());
    await call(sim, "yard/recycle", { id: 1 });
    expect(sim.building(1)).toBeNull();
  });

  it("fills and empties a bunker with no capacity limit", async () => {
    const sim = new TribeYardSim(yard());
    await call(sim, "yard/bunker/fill", { bunker: "2", monsters: JSON.stringify({ C5: 40, C8: 3 }), source: "housing" });
    expect(sim.garrison(2)).toEqual({ C5: 44, C8: 3 });
    await call(sim, "yard/bunker/remove", { bunker: "2", monster: "C8", count: "3" });
    expect(sim.garrison(2)).toEqual({ C5: 44 });
  });

  it("applies a layout: moves, an old planned level ignored, left-out buildings removed", async () => {
    const sim = new TribeYardSim(yard());
    const data = JSON.stringify({
      version: 2,
      expansion: 0,
      nodes: [
        { id: 1, t: 14, x: 20, y: 20, plan: { level: 7, order: 0 } },
        { id: 2, t: 22, x: 100, y: 0 },
      ],
    });
    const answer = (await call(sim, "yardplanner/apply", { data })) as { moved: number; buildingdata: BuildingDataMap };
    expect(answer.moved).toBe(1);
    expect(answer.buildingdata["1"]).toMatchObject({ X: 20, Y: 20, l: 4 });
    expect(answer.buildingdata["3"]).toBeUndefined();
  });

  it("lists no layout slots and refuses the player's own slots and other yard routes", async () => {
    const sim = new TribeYardSim(yard());
    expect(await call(sim, "yardplanner/layouts", {}, "GET")).toMatchObject({ slots: 0, layouts: [] });
    await expect(call(sim, "yardplanner/layouts/1", {}, "PUT")).rejects.toBeInstanceOf(ApiError);
    await expect(call(sim, "yard/hatchery/add")).rejects.toMatchObject({ status: 409 });
    await expect(sim.handle("POST", "/api/:apiVersion/bm/base/save", {})).rejects.toBeInstanceOf(ApiError);
    expect(sim.handle("GET", "/api/:apiVersion/chat/history", {})).toBeUndefined();
  });

  it("sends the edited slices for Save", () => {
    const sim = new TribeYardSim(yard());
    sim.setHousing("C8", 6);
    sim.setGarrison(2, "C5", 0);
    const body = sim.saveBody();
    expect(body.monsters).toEqual({ C5: 0, C8: 6 });
    expect(body.buildingdata["2"]).not.toHaveProperty("m");
    expect(body.lockerdata).toEqual({ C5: { t: 2 } });
  });
});

describe("the tribe edit session", () => {
  afterEach(() => endTribeEdit());

  it("answers yard requests in the browser while open, and lets them out once it ends", async () => {
    const session = startTribeEdit({
      error: 0,
      tribe: "kozu",
      name: "Kozu",
      level: 30,
      from: 29,
      saved: false,
      yard: yard(),
    });
    expect(isTribeEditing()).toBe(true);
    const answer = await post<YardResponse<{ id: number }>>("/api/:apiVersion/bm/yard/build", { type: 21, x: 0, y: 0 });
    expect(answer.report.id).toBe(4);
    expect(session.sim.building(4)?.t).toBe(21);
    await expect(send("POST", "/api/:apiVersion/bm/yard/hatchery/add")).rejects.toMatchObject({ status: 409 });

    endTribeEdit();
    expect(isTribeEditing()).toBe(false);
  });

  it("lifts the build menu's limits and costs while editing", () => {
    const save = yard();
    const context = {
      yard: readYard(save),
      save,
      resources: {},
      credits: 0,
      caps: null,
      workers: { total: 0, busy: 0 },
      now: () => 0,
    };
    const before = buildOffer(21, context);
    expect(before?.gate).not.toBeNull();
    startTribeEdit({ error: 0, tribe: "kozu", name: "Kozu", level: 30, from: 29, saved: false, yard: save });
    const during = buildOffer(21, context);
    expect(during).toMatchObject({ gate: null, instantGate: null, status: "ready", seconds: 0 });
    expect(during?.cost).toEqual({ r1: 0, r2: 0, r3: 0, r4: 0 });
  });
});
