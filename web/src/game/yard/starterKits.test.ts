import { describe, expect, it } from "vitest";
import type { BaseLoadResponse } from "@/api/types";
import {
  kitOffer,
  kitReplacesBuildings,
  kitShortfall,
  kitSummary,
  kitTopUpShiny,
  STARTER_KIT_SUMMARIES,
} from "./starterKits";
import { busyWorkers } from "./workers";
import { readYard } from "./yardModel";

/**
 * The Starter Kits on the client (outposts WP9, #188): the prices and the
 * top-up are the server's (`server/src/services/yard/starterKit.ts`), and a
 * prefab builds up without the worker.
 */

describe("the kits", () => {
  it("are Regular, Mega and Ultra at Flash's prices, with their thumbnails", () => {
    expect(
      STARTER_KIT_SUMMARIES.map((kit) => [kit.id, kit.name, kit.resources, kit.shiny, kit.thumbnail]),
    ).toEqual([
      [1, "Regular Kit", { r1: 12_000_000, r2: 12_000_000, r3: 6_000_000 }, 420, "/assets/ui/prefab-2.v5.jpg"],
      [2, "Mega Kit", { r1: 50_000_000, r2: 50_000_000, r3: 25_000_000 }, 800, "/assets/ui/prefab-3.v5.jpg"],
      [3, "Ultra Kit", { r1: 200_000_000, r2: 200_000_000, r3: 100_000_000 }, 1500, "/assets/ui/prefab-4.v5.jpg"],
    ]);
    expect(STARTER_KIT_SUMMARIES.map((kit) => kit.buildingCount)).toEqual([112, 147, 170]);
    expect(kitSummary(2)?.name).toBe("Mega Kit");
    expect(kitSummary(4)).toBeNull();
  });
});

describe("the top-up", () => {
  it("is ceil(sqrt(short / 2) ^ 0.75), as the server charges it", () => {
    expect(kitTopUpShiny(0)).toBe(0);
    expect(kitTopUpShiny(2)).toBe(1);
    expect(kitTopUpShiny(1_000_000)).toBe(138);
  });

  it("covers the missing twigs, pebbles and putty added together, never goo", () => {
    const regular = kitSummary(1)!;
    const pool = { r1: 11_000_000, r2: 12_000_000, r3: 5_500_000, r4: 0 };
    expect(kitShortfall(pool, regular)).toEqual({ r1: 1_000_000, r2: 0, r3: 500_000 });
    const offer = kitOffer(regular, { resources: pool, credits: 100 });
    expect(offer).toMatchObject({ short: 1_500_000, topUp: kitTopUpShiny(1_500_000), topUpAffordable: false, shinyAffordable: false });
    expect(kitOffer(regular, { resources: { r1: 20e6, r2: 20e6, r3: 20e6 }, credits: 420 })).toMatchObject({
      short: 0,
      topUp: 0,
      shinyAffordable: true,
    });
  });
});

const outpostWith = (buildingdata: BaseLoadResponse["buildingdata"]) =>
  readYard({
    error: 0,
    id: 1,
    baseid: "9",
    basesaveid: 1,
    worldsize: [800, 800],
    currenttime: 1_000,
    savetime: 1_000,
    type: "outpost",
    buildingdata,
  } as BaseLoadResponse);

describe("a kit's prefabs", () => {
  it("build up without the worker, while a normal build still takes it", () => {
    const yard = outpostWith({
      "1": { X: -65, Y: -105, id: 1, t: 112, l: 1 },
      "2": { X: 0, Y: 0, id: 2, t: 21, l: 5, prefab: 5, cB: 900, cL: 900 },
      "3": { X: 100, Y: 0, id: 3, t: 1, l: 8, prefab: 8, cB: 900, cL: 900 },
    });
    expect(yard.workers).toEqual({ total: 1, busy: 0 });

    const building = outpostWith({
      "1": { X: -65, Y: -105, id: 1, t: 112, l: 1 },
      "2": { X: 0, Y: 0, id: 2, t: 21, l: 5, prefab: 5, cB: 900, cL: 900 },
      "4": { X: 200, Y: 0, id: 4, t: 20, cB: 60 },
    });
    expect(busyWorkers(building)).toBe(1);
  });

  it("warn about the wipe only when the yard holds more than its core", () => {
    expect(kitReplacesBuildings(outpostWith({ "1": { X: 0, Y: -50, id: 1, t: 112 } }))).toBe(false);
    expect(
      kitReplacesBuildings(
        outpostWith({ "1": { X: 0, Y: -50, id: 1, t: 112 }, "2": { X: 100, Y: 0, id: 2, t: 20 } }),
      ),
    ).toBe(true);
  });
});
