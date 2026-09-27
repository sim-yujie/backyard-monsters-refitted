import { describe, expect, it } from "vitest";
import type { BaseLoadResponse, BuildingData } from "@/api/types";
import { housingCapacity } from "@/game/monsters/housing";
import { housingSpace } from "@/game/monsters/monsterCatalogue";
import { housingCullPreview, recycleBlock, recycleOffer, recycleRefund } from "./recycle";

/** Recycling on the client: the refund, the cap, the refusals and the Housing cull. */

const NOW = 1_800_000_000;

const building = (id: number, t: number, extra: Partial<BuildingData> = {}): BuildingData => ({
  X: 0,
  Y: 0,
  id,
  t,
  ...extra,
});

const saveOf = (buildings: BuildingData[], extra: Partial<BaseLoadResponse> = {}): BaseLoadResponse =>
  ({
    savetime: NOW,
    currenttime: NOW,
    buildingdata: Object.fromEntries(
      [building(0, 14, { l: 10 }), ...buildings].map((one) => [String(one.id), one]),
    ),
    buildinghealthdata: {},
    storedata: {},
    monsters: {},
    academy: {},
    lockerdata: {},
    champion: [],
    ...extra,
  }) as unknown as BaseLoadResponse;

describe("recycleRefund", () => {
  it("is half of every level paid, floored, as the server's refundOf", () => {
    // Twig Snapper level 2: 750 + 1,575 pebbles.
    expect(recycleRefund(building(1, 1, { l: 2 }))).toEqual({ r1: 0, r2: 1162, r3: 0, r4: 0 });
  });

  it("is nothing for a decoration or a taunt sign", () => {
    expect(recycleRefund(building(1, 28))).toEqual({ r1: 0, r2: 0, r3: 0, r4: 0 });
    expect(recycleRefund(building(1, 52))).toEqual({ r1: 0, r2: 0, r3: 0, r4: 0 });
  });
});

describe("recycleOffer", () => {
  it("clamps the refund to the storage cap and says what is lost", () => {
    const save = saveOf([building(1, 1, { l: 2 })]);
    const offer = recycleOffer(
      building(1, 1, { l: 2 }),
      save,
      { r2: 9_500 },
      { r1: 10_000, r2: 10_000, r3: 10_000, r4: 10_000 },
      NOW,
    );
    expect(offer.blocked).toBeNull();
    expect(offer.refund.r2).toBe(500);
    expect(offer.lost.r2).toBe(662);
  });

  it("measures a Storage Silo's refund against the cap it leaves behind", () => {
    const silo = building(1, 6, { l: 1 });
    const save = saveOf([silo]);
    const caps = { r1: 1e6, r2: 1e6, r3: 1e6, r4: 1e6 };
    const offer = recycleOffer(silo, save, { r1: 1e6 }, caps, NOW);
    // Already at the cap, and the cap only shrinks: nothing lands.
    expect(offer.refund.r1).toBe(0);
    expect(offer.lost.r1).toBe(recycleRefund(silo).r1);
  });

  it("marks a decoration for storage", () => {
    const offer = recycleOffer(building(1, 28), saveOf([building(1, 28)]), {}, null, NOW);
    expect(offer.toStorage).toBe(true);
  });
});

describe("recycleBlock", () => {
  it("refuses what the server refuses", () => {
    const reason = (one: BuildingData, extra: Partial<BaseLoadResponse> = {}) =>
      recycleBlock(one, saveOf([one], extra), NOW)?.reason ?? null;

    expect(reason(building(0, 14, { l: 10 }))).toBe("isTownHall");
    expect(reason(building(1, 11, { l: 2 }))).toBe("mapRoom");
    expect(reason(building(1, 20, { l: 3, cU: 60 }))).toBe("busy");
    expect(reason(building(1, 114), { champion: [{ t: 1, status: 0 }] } as never)).toBe("championInCage");
    expect(reason(building(1, 114), { champion: [{ t: 1, status: 2 }] } as never)).toBeNull();
    expect(reason(building(1, 119, { fz: JSON.stringify([{ t: 2 }]) }))).toBe("championsFrozen");
    expect(reason(building(1, 116, { upg: "C5", upt: NOW + 60 }))).toBe("researching");
    expect(reason(building(1, 26, { upg: "C5" }))).toBe("training");
    expect(
      reason(building(1, 13), { monsters: { h: [["C1", 10, [], 1]], hid: [1], hstage: [1] } } as never),
    ).toBe("hatcheryBusy");
    expect(
      reason(building(1, 13), { monsters: { h: [["", 0, [["C1", 2, 1]]]], hid: [1], hstage: [0] } } as never),
    ).toBe("hatcheryBusy");
    expect(reason(building(1, 13), { monsters: { h: [["", 0, []]], hid: [1], hstage: [0] } } as never)).toBeNull();
    expect(reason(building(1, 16), { monsters: { hcc: [["C1", 2, 1]] } } as never)).toBe("hatcheryBusy");
    expect(reason(building(1, 8), { lockerdata: { C5: { t: 1, s: NOW, e: NOW + 60 } } } as never)).toBe(
      "unlocking",
    );
    expect(reason(building(1, 20, { l: 3 }))).toBeNull();
  });
});

describe("a Monster Bunker's contents", () => {
  it("are listed as lost with the bunker (BUILDING22.as:547-551, owner 2026-09-28)", () => {
    const bunker = building(1, 22, { l: 2, m: { C1: 4, C5: 2 } });
    const offer = recycleOffer(bunker, saveOf([bunker]), {}, null, NOW);
    expect(offer.blocked).toBeNull();
    expect(offer.bunkered).toEqual({ C1: 4, C5: 2 });
    expect(offer.culled).toEqual({});
  });

  it("are empty for an empty bunker, a busy one and any other building", () => {
    const empty = building(1, 22, { l: 1 });
    expect(recycleOffer(empty, saveOf([empty]), {}, null, NOW).bunkered).toEqual({});
    const busy = building(1, 22, { l: 1, cU: 60, m: { C1: 3 } });
    expect(recycleOffer(busy, saveOf([busy]), {}, null, NOW).bunkered).toEqual({});
    const housing = building(1, 15, { l: 1, m: { C1: 3 } });
    expect(recycleOffer(housing, saveOf([housing]), {}, null, NOW).bunkered).toEqual({});
  });
});

describe("housingCullPreview", () => {
  it("lists what the cull would remove once a Housing building is gone", () => {
    const housing = [building(1, 15, { l: 1 }), building(2, 15, { l: 1 })];
    const one = housingCapacity(saveOf([housing[0]!]), NOW);
    const space = housingSpace("C1", 1)!;
    const fits = Math.floor(one / space);
    const save = saveOf(housing, { monsters: { housed: { C1: fits + 3 } } } as never);
    expect(housingCullPreview(save, 2, NOW)).toEqual({ C1: 3 });
    expect(recycleOffer(housing[1]!, save, {}, null, NOW).culled).toEqual({ C1: 3 });
  });

  it("is empty when the army still fits", () => {
    const housing = [building(1, 15, { l: 1 }), building(2, 15, { l: 1 })];
    const save = saveOf(housing, { monsters: { housed: { C1: 1 } } } as never);
    expect(housingCullPreview(save, 2, NOW)).toEqual({});
  });
});
