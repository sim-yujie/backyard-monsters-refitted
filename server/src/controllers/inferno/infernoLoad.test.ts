import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { Context } from "koa";

import { Save } from "../../database/models/save.model.js";
import { productionOf, siloCapacity } from "../../game-data/buildingCosts.js";
import type { BuildingData, BuildingDataMap } from "../../types/BuildingData.js";

/**
 * `POST /bm/inferno/load` (`docs/design/inferno.md` §3.2, WP 1.14): the
 * Inferno harvesters catch up at the Inferno rates, the purse is the main
 * save's `iresources` with the Inferno cap, only the caller's own Inferno yard
 * loads, and nothing is read while the new Inferno is switched off.
 */

const USER = 7;
const MAIN_BASESAVEID = 70;
const YARD_BASEID = 1_234_567;
const NOW = 1_800_000_000;

/** What the route's entity manager was asked. */
const calls: string[] = [];
let yardRow: Record<string, unknown> | null = null;
let mainRow: Record<string, unknown> = {};

const em = {
  populate: async (user: Record<string, unknown>) => {
    calls.push("populate");
    user.save = mainRow;
  },
  transactional: async <T>(work: (tx: unknown) => Promise<T>): Promise<T> => {
    calls.push("transaction");
    return work(em);
  },
  findOne: async (_entity: unknown, where: Record<string, unknown>, options?: { lockMode?: unknown }) => {
    calls.push(`findOne ${JSON.stringify(where)}${options?.lockMode === undefined ? "" : " locked"}`);
    return "basesaveid" in where ? mainRow : yardRow;
  },
  flush: async () => {
    calls.push("flush");
  },
};
mock.module("../../server.js", () => ({ postgres: { em }, redis: {} }));

const { infernoLoad, loadInfernoYard } = await import("./infernoLoad.js");
const { infernoPurse, infernoStorageCap } = await import("../../services/inferno/infernoLoad.js");
const { catchUpYard } = await import("../../services/yard/catchUp.js");
const { infernoStartBuildingData } = await import("../../services/inferno/infernoYard.js");

/** The Bone Cruncher at level 1: 2 Bone per 10-second cycle, a 720 buffer (`INFERNOYARDPROPS.as:22`). */
const BONE = productionOf(1, "inferno")!;

const bone = (extra: Partial<BuildingData> = {}): BuildingDataMap => ({
  "2": { id: 2, t: 1, l: 1, X: 60, Y: 0, ...extra } as unknown as BuildingData,
});

const user = () => ({ userid: USER, username: "descender" }) as never;

/** The Inferno yard row, a real `Save` so the answer's key filter sees its fields. */
const freshYard = (extra: Record<string, unknown> = {}): Record<string, unknown> =>
  Object.assign(new Save() as unknown as Record<string, unknown>, {
    basesaveid: 99,
    baseid: String(YARD_BASEID),
    type: "inferno",
    userid: USER,
    buildingdata: infernoStartBuildingData(),
    buildinghealthdata: {},
    savetime: NOW - 100,
    attackid: 0,
    attacks: [],
    ...extra,
  });

beforeEach(() => {
  calls.length = 0;
  mainRow = {
    basesaveid: MAIN_BASESAVEID,
    type: "main",
    userid: USER,
    baseid_inferno: YARD_BASEID,
    iresources: { r1: 5_000, r2: 250_000, r3: 0, r4: 12 },
    credits: 40,
    storedata: {},
  };
  yardRow = freshYard();
});

describe("the Inferno harvesters' catch-up", () => {
  test("a Bone Cruncher fills its buffer at the Inferno rate while the player is away", () => {
    expect(BONE.produce[0]).toBe(2);
    expect(BONE.cycleTime[0]).toBe(10);
    const save = { type: "inferno", buildingdata: bone(), savetime: NOW - 100 };
    catchUpYard(save, NOW);
    // Ten 10-second cycles of 2 Bone.
    expect(save.buildingdata["2"]!.st).toBe(20);
    expect(save.buildingdata["2"]!.pr).toBe(1);
    expect(save.savetime).toBe(NOW);
  });

  test("a full buffer stops at the harvester's capacity, as the original's did", () => {
    const save = { type: "inferno", buildingdata: bone(), savetime: NOW - 86_400 };
    catchUpYard(save, NOW);
    expect(save.buildingdata["2"]!.st).toBe(BONE.capacity[0]);
    expect(save.buildingdata["2"]!.pr).toBe(0);
  });

  test("nothing reaches the purse: the buffer waits to be banked", () => {
    const save = { type: "inferno", buildingdata: bone(), savetime: NOW - 100, resources: {} };
    catchUpYard(save, NOW);
    expect(save.resources).toEqual({});
  });

  test("a second run at the same moment changes nothing", () => {
    const save = { type: "inferno", buildingdata: bone(), savetime: NOW - 100 };
    catchUpYard(save, NOW);
    const once = structuredClone(save);
    catchUpYard(save, NOW);
    expect(save).toEqual(once);
  });

  test("a yard never caught up runs from the moment it was made; one with no time starts now", () => {
    const made = { type: "inferno", buildingdata: bone(), savetime: 0, createtime: NOW - 50 };
    catchUpYard(made, NOW);
    expect(made.buildingdata["2"]!.st).toBe(10);

    const timeless = { type: "inferno", buildingdata: bone(), savetime: 0 };
    catchUpYard(timeless, NOW);
    expect(timeless.buildingdata["2"]!.st ?? 0).toBe(0);
    expect(timeless.savetime).toBe(NOW);
  });

  test("a harvester below half health makes nothing; an upgrading one waits", () => {
    const hurt = { type: "inferno", buildingdata: bone(), buildinghealthdata: { "2": 1 }, savetime: NOW - 100 };
    catchUpYard(hurt, NOW);
    expect(hurt.buildingdata["2"]!.st ?? 0).toBe(0);

    const upgrading = { type: "inferno", buildingdata: bone({ cU: NOW + 500 } as never), savetime: NOW - 100 };
    catchUpYard(upgrading, NOW);
    expect(upgrading.buildingdata["2"]!.st ?? 0).toBe(0);
  });

  test("a building countdown finishes on the Inferno row", () => {
    const save = {
      type: "inferno",
      buildingdata: bone({ l: 0, cB: 40, cL: 40 } as never),
      savetime: NOW - 100,
    };
    const done = catchUpYard(save, NOW);
    expect(save.buildingdata["2"]!.cB).toBeUndefined();
    expect(done.map((job) => job.kind)).toEqual(["build"]);
  });

  test("the start layout's Bone and Coal harvesters both fill", () => {
    const save = { type: "inferno", buildingdata: infernoStartBuildingData(), savetime: NOW - 100 };
    catchUpYard(save, NOW);
    expect(save.buildingdata["2"]!.st).toBe(20);
    expect(save.buildingdata["3"]!.st).toBeGreaterThan(0);
    // The Under Hall and the Resource Pods hold no buffer.
    expect(save.buildingdata["1"]!.st).toBeUndefined();
    expect(save.buildingdata["4"]!.st).toBeUndefined();
  });
});

describe("the Inferno purse's cap", () => {
  test("10,000 plus each Resource Pod's Inferno capacity", () => {
    // Flash's start layout: two level 3 Resource Pods.
    expect(siloCapacity(3, "inferno")).toBe(30_000);
    expect(infernoStorageCap({ buildingdata: infernoStartBuildingData() })).toBe(70_000);
    expect(infernoStorageCap({ buildingdata: {} })).toBe(10_000);
  });

  test("a Resource Pod still being built adds nothing", () => {
    const pods = { "4": { id: 4, t: 6, l: 0, X: 0, Y: 0, cB: NOW + 60 } as unknown as BuildingData };
    expect(infernoStorageCap({ buildingdata: pods })).toBe(10_000);
  });

  test("the Inferno yard's own Improved Packing Skills raise it, as Flash reads the loaded yard's", () => {
    expect(
      infernoStorageCap({ buildingdata: infernoStartBuildingData(), storedata: { BIP: { q: 2 } } })
    ).toBe(84_000);
  });

  test("the purse is answered as it is, above the cap too (the Descent's loot is uncapped)", () => {
    expect(infernoPurse({ r1: 5_000, r2: 250_000, r3: -4, r4: "x" }, 70_000)).toEqual({
      r1: 5_000,
      r2: 250_000,
      r3: 0,
      r4: 0,
      r1max: 70_000,
      r2max: 70_000,
      r3max: 70_000,
      r4max: 70_000,
    });
    expect(infernoPurse(null, 10_000).r1).toBe(0);
  });
});

describe("loading the Inferno yard", () => {
  test("catches the harvesters up under the row lock, writes it, and answers the purse", async () => {
    const body = await loadInfernoYard(em as never, user(), NOW);
    expect(calls).toEqual([
      "populate",
      "transaction",
      `findOne {"basesaveid":${MAIN_BASESAVEID}} locked`,
      `findOne {"baseid":"${YARD_BASEID}"} locked`,
      "flush",
    ]);
    expect(yardRow!.savetime).toBe(NOW);
    expect((yardRow!.buildingdata as BuildingDataMap)["2"]!.st).toBe(20);
    expect(body.error).toBe(0);
    expect(body.baseid).toBe(String(YARD_BASEID));
    expect(body.currenttime).toBe(NOW);
    expect((body.buildingdata as BuildingDataMap)["2"]!.st).toBe(20);
    expect(body.resources).toEqual(infernoPurse(mainRow.iresources as never, 70_000));
    expect(body.credits).toBe(40);
  });

  test("writes the Inferno cap into the main save's iresources, the amounts kept", async () => {
    await loadInfernoYard(em as never, user(), NOW);
    expect(mainRow.iresources).toEqual({
      r1: 5_000,
      r2: 250_000,
      r3: 0,
      r4: 12,
      r1max: 70_000,
      r2max: 70_000,
      r3max: 70_000,
      r4max: 70_000,
    });

    // A third pod finished since: the main yard's caps follow.
    const pods = infernoStartBuildingData();
    pods["6"] = { id: 6, t: 6, l: 3, X: 200, Y: 0 } as unknown as BuildingData;
    yardRow = freshYard({ buildingdata: pods });
    await loadInfernoYard(em as never, user(), NOW);
    expect((mainRow.iresources as Record<string, number>).r1max).toBe(100_000);
    expect((mainRow.iresources as Record<string, number>).r4max).toBe(100_000);
  });

  test("a yard under attack is answered as it is, not caught up", async () => {
    yardRow = freshYard({ attackid: 5, attacks: [{ starttime: Math.floor(Date.now() / 1000) }] });
    const body = await loadInfernoYard(em as never, user(), NOW);
    expect(calls).not.toContain("flush");
    expect(yardRow!.savetime).toBe(NOW - 100);
    expect((body.buildingdata as BuildingDataMap)["2"]!.st).toBeUndefined();
  });

  const refusal = async () =>
    loadInfernoYard(em as never, user(), NOW).then(
      () => null,
      (err) => err
    );

  test("a player with no Inferno yard is refused with 409 noInfernoYard, and none is made", async () => {
    mainRow.baseid_inferno = 0;
    const err = await refusal();
    expect(err?.status).toBe(409);
    expect(err?.data).toEqual({ reason: "noInfernoYard" });
    expect(calls.some((call) => call.startsWith("findOne"))).toBe(false);
    expect(calls).not.toContain("flush");
  });

  test("another player's yard, or a yard that is not an Inferno yard, is refused", async () => {
    yardRow = freshYard({ userid: USER + 1 });
    expect((await refusal())?.data).toEqual({ reason: "noInfernoYard" });
    yardRow = freshYard({ type: "main" });
    expect((await refusal())?.data).toEqual({ reason: "noInfernoYard" });
    yardRow = null;
    expect((await refusal())?.data).toEqual({ reason: "noInfernoYard" });
    expect(calls).not.toContain("flush");
  });
});

describe("the route", () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env.INFERNO_ENABLED;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.INFERNO_ENABLED;
    else process.env.INFERNO_ENABLED = saved;
  });

  const ctxOf = () => ({ authUser: user(), request: { body: {} } }) as unknown as Context;

  test("switched off, it is refused with 403 infernoOff before reading anything", async () => {
    delete process.env.INFERNO_ENABLED;
    const ctx = ctxOf();
    const err = await infernoLoad(ctx).then(
      () => null,
      (caught) => caught
    );
    expect(err?.status).toBe(403);
    expect(err?.data).toEqual({ reason: "infernoOff" });
    expect(calls).toEqual([]);
  });

  test("switched on, it answers the caller's own yard", async () => {
    process.env.INFERNO_ENABLED = "on";
    const ctx = ctxOf();
    await infernoLoad(ctx);
    expect(ctx.status).toBe(200);
    expect((ctx.body as { baseid: string }).baseid).toBe(String(YARD_BASEID));
  });
});
