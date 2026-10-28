import { describe, expect, it } from "vitest";
import type { BaseLoadResponse, BuildingData, ResourceCaps, Resources } from "@/api/types";
import { INFERNO_BUILDABLE_TYPES } from "./buildingCostData";
import {
  buildableTypesFor,
  BuildCategory,
  buildOffer,
  buildOffers,
  catalogueFor,
  categoryOf,
  INFERNO_BUILD_CATALOGUE,
  INFERNO_MENU_TYPES,
  type BuildContext,
} from "./buildCatalogue";
import { readYard } from "./yardModel";

/**
 * The Inferno yard's build menu (WP 1.19), read against the Inferno props
 * table: Bone Cruncher `costs[0]` = 750 Coal, 15 s, Under Hall 1; the Quake
 * Tower allowed from Under Hall 3.
 */

const T0 = 2_000_000;
const CAPS: ResourceCaps = { r1: 1_600, r2: 1_600, r3: 1_600, r4: 1_600 };

const building = (id: number, t: number, extra: Partial<BuildingData> = {}): BuildingData => ({
  id,
  t,
  X: id * 100,
  Y: 0,
  ...extra,
});

const inferno = (buildings: BuildingData[], resources: Resources, researchdata = {}): BuildContext => {
  const save = {
    error: 0,
    currenttime: T0,
    savetime: T0,
    resources,
    credits: 0,
    buildingdata: Object.fromEntries(buildings.map((one) => [String(one.id), one])),
    buildinghealthdata: {},
    storedata: {},
    researchdata,
  } as unknown as BaseLoadResponse;
  const yard = readYard(save);
  return {
    yard,
    kind: "inferno",
    save,
    resources,
    credits: 0,
    caps: CAPS,
    workers: yard.workers,
    now: () => T0,
  };
};

const UNDER_HALL = (level: number) => building(1, 14, { l: level });

describe("the Inferno build menu", () => {
  it("offers the sixteen types the server builds, in Flash's tabs and order", () => {
    expect([...INFERNO_MENU_TYPES].sort((a, b) => a - b)).toEqual([...INFERNO_BUILDABLE_TYPES]);
    expect(INFERNO_BUILD_CATALOGUE.map((tab) => tab.types)).toEqual([
      [1, 2, 3, 4, 6],
      [8, 26, 128, 13, 9],
      [21, 129, 130, 132, 24, 17],
      [],
    ]);
  });

  it("is picked by the Inferno kind", () => {
    expect(catalogueFor("inferno")).toBe(INFERNO_BUILD_CATALOGUE);
    expect(buildableTypesFor("inferno")).toBe(INFERNO_MENU_TYPES);
    expect(categoryOf(129, "inferno")).toBe(BuildCategory.DEFENSIVE);
    expect(categoryOf(128, "inferno")).toBe(BuildCategory.BUILDINGS);
    // Surface-only buildings are not on the menu.
    expect(categoryOf(5, "inferno")).toBeNull();
    expect(categoryOf(20, "inferno")).toBeNull();
  });

  it("prices a tile in the Inferno's own table and resources", () => {
    const offer = buildOffer(1, inferno([UNDER_HALL(1)], { r1: 0, r2: 1_000, r3: 0, r4: 0 }));
    expect(offer?.cost).toEqual({ r1: 0, r2: 750, r3: 0, r4: 0 });
    expect(offer?.seconds).toBe(15);
    expect(offer?.gate).toBeNull();
    expect(offer?.needs[0]).toEqual({ kind: "townHall", level: 1, met: true });
  });

  it("locks what the Under Hall does not allow yet", () => {
    const offer = buildOffer(129, inferno([UNDER_HALL(2)], { r1: 1e6, r2: 1e6, r3: 1e6, r4: 1e6 }));
    expect(offer?.status).toBe("locked");
    expect(offer?.gate).toEqual({ reason: "townHall", have: 2, need: 3 });
  });

  it("measures a shortfall against the Inferno purse", () => {
    const offer = buildOffer(1, inferno([UNDER_HALL(1)], { r2: 500 }));
    expect(offer?.gate).toEqual({ reason: "shortfall", shortfall: { r1: 0, r2: 250, r3: 0, r4: 0 }, overCap: false });
  });

  it("lists no decorations: storage is the main yard's", () => {
    const context = inferno([UNDER_HALL(1)], {}, { b28: 3 });
    expect(buildOffers(BuildCategory.DECORATIONS, context)).toEqual([]);
  });
});
